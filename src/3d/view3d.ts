import * as THREE from 'three';
import { maps, mouseWorld, selected, activeSide, setSelected, setActiveSide, snapSize, multiSelected, multiSelectType, setMultiSelected, multiSelectedSides, setMultiSelectedSides, tool } from '../state/appState';
import { mapRef } from '../config/firebase';
import { renderPanel } from '../ui/propertiesPanel';
import { draw } from '../canvas/renderer';
import { showToast } from '../ui/toast';
import { placeThing } from '../map/mapActions';
import { snap } from '../canvas/transforms';
import { buildFloorsCeilings, buildWalls, buildThings, clearTexCache } from './buildGeometry';
import { pointInSector } from '../geometry/cycleFinder';
import { beginAction, record, endAction } from '../history/undoRedo';
import { openTextureBrowser } from '../ui/textureBrowser';

let renderer: THREE.WebGLRenderer | null = null;
let scene: THREE.Scene;
let camera: THREE.PerspectiveCamera;
let container: HTMLDivElement | null = null;
let isActive = false;
let splitMode = false;
let animFrameId = 0;
let sceneGroup: THREE.Group;

// ── Camera state ──
let yaw = 0;     // radians, 0 = looking along +X
let pitch = 0;   // radians, clamped to ±85°
const keys: Record<string, boolean> = {};
const MOVE_SPEED = 300;
const MOUSE_SENS = 0.002;
let pointerLocked = false;
let mouseOverCanvas = false;

// ── Selection ──
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
let crosshairEl: HTMLElement | null = null;
let unlockedMouse = new THREE.Vector2();

// ── Crosshair highlight ──
let highlightedMesh: THREE.Mesh | null = null;
let highlightedOrigColor: THREE.Color | null = null;
let highlightStartTime = 0;

// ── Texture clipboard ──
let copiedTexture: string | null = null;

// ── Texture copy/paste helpers ──

function getTextureFromHit(ud: any): string | null {
  if (ud.entityType === 'sector' && ud.entityId) {
    const sec = maps.sectors.get(ud.entityId);
    if (!sec) return null;
    return ud.surface === 'ceiling' ? (sec.ceilTex || 'CEIL3_5') : (sec.floorTex || 'FLOOR4_8');
  }
  if (ud.entityType === 'linedef' && ud.sidedefId && ud.surface) {
    const sd = maps.sidedefs.get(ud.sidedefId);
    if (!sd) return null;
    return sd[ud.surface as 'upper' | 'mid' | 'lower'] || null;
  }
  return null;
}

function pasteTextureToHit(ud: any, tex: string): void {
  if (ud.entityType === 'sector' && ud.entityId) {
    const sec = maps.sectors.get(ud.entityId);
    if (!sec) return;
    const field = ud.surface === 'ceiling' ? 'ceilTex' : 'floorTex';
    beginAction();
    record(`map/sectors/${ud.entityId}`, { ...sec }, { ...sec, [field]: tex });
    endAction();
    mapRef('sectors').child(ud.entityId).update({ [field]: tex });
    showToast(`Pasted ${tex} → ${ud.surface}`);
  } else if (ud.entityType === 'linedef' && ud.sidedefId && ud.surface) {
    const sd = maps.sidedefs.get(ud.sidedefId);
    if (!sd) return;
    const field = ud.surface as string;
    beginAction();
    record(`map/sidedefs/${ud.sidedefId}`, { ...sd }, { ...sd, [field]: tex });
    endAction();
    mapRef('sidedefs').child(ud.sidedefId).update({ [field]: tex });
    showToast(`Pasted ${tex} → ${field}`);
  }
}

// ── Init ──

function ensureInit(): void {
  if (renderer) return;

  const wrap = document.getElementById('canvas-wrap')!;

  container = document.createElement('div');
  container.id = 'view3d-container';
  container.style.cssText = 'position:absolute;inset:0;display:none;z-index:10;cursor:crosshair;';
  wrap.style.position = 'relative';
  wrap.appendChild(container);

  // Crosshair
  crosshairEl = document.createElement('div');
  crosshairEl.style.cssText = 'position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);' +
    'width:16px;height:16px;pointer-events:none;z-index:11;' +
    'border:1px solid rgba(255,255,255,0.4);border-radius:50%;';
  container.appendChild(crosshairEl);

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setClearColor(0x111111);
  container.appendChild(renderer.domElement);

  scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x111111, 0.0008);

  camera = new THREE.PerspectiveCamera(90, 1, 1, 20000);
  sceneGroup = new THREE.Group();
  scene.add(sceneGroup);

  // Ambient light (unused by MeshBasicMaterial, kept for future use)
  scene.add(new THREE.AmbientLight(0xffffff, 1));

  // ── Event listeners ──

  renderer.domElement.addEventListener('click', (e: MouseEvent) => {
    if (justUnlocked) { justUnlocked = false; return; }
    if (!pointerLocked) {
      // Thing tool: place thing at click position
      if (tool === 'thing') {
        raycaster.setFromCamera(unlockedMouse, camera);
        const hits = raycaster.intersectObjects(sceneGroup.children, false);
        if (hits.length > 0) {
          const p = hits[0].point;
          beginAction();
          placeThing(snap(p.x), snap(-p.z));
          endAction();
        }
        return;
      }
      // Unlocked: raycast from cursor to select/shift-select
      raycaster.setFromCamera(unlockedMouse, camera);
      const hits = raycaster.intersectObjects(sceneGroup.children, false);
      if (hits.length > 0) {
        const ud = hits[0].object.userData;
        if (ud.entityType && ud.entityId) {
          const hitType = ud.entityType === 'linedef' ? 'linedef' : ud.entityType === 'sector' ? 'sector' : null;
          if ((hitType === 'sector' || hitType === 'linedef') && e.shiftKey) {
            // Shift+click: multi-select sectors or linedefs
            const next = multiSelectType === hitType ? new Set(multiSelected) : new Set<string>();
            const nextSides = multiSelectType === hitType ? new Map(multiSelectedSides) : new Map<string, string>();
            // Carry over single selection
            if (selected?.type === hitType && !next.has(selected.id)) {
              next.add(selected.id);
              if (hitType === 'linedef' && activeSide) {
                const prevLd = maps.linedefs.get(selected.id);
                if (prevLd) {
                  const sid = activeSide === 'front' ? prevLd.frontSide : prevLd.backSide;
                  if (sid) nextSides.set(selected.id, sid);
                }
              }
            }
            if (next.has(ud.entityId)) {
              next.delete(ud.entityId);
              nextSides.delete(ud.entityId);
            } else {
              next.add(ud.entityId);
              if (hitType === 'linedef' && ud.sidedefId) nextSides.set(ud.entityId, ud.sidedefId);
            }
            setMultiSelected(next, hitType);
            setMultiSelectedSides(nextSides);
            setSelected(null);
            renderPanel();
          } else if (hitType) {
            setMultiSelected(new Set<string>());
            let newSide: 'front' | 'back' | null = null;
            if (hitType === 'linedef' && ud.sidedefId) {
              const ld = maps.linedefs.get(ud.entityId);
              if (ld) newSide = ud.sidedefId === ld.frontSide ? 'front' : 'back';
            }
            setSelected({ type: hitType, id: ud.entityId });
            setActiveSide(newSide);
            renderPanel();
            draw();
          }
        }
      } else if (!e.shiftKey) {
        setMultiSelected(new Set<string>());
        setSelected(null);
        renderPanel();
        draw();
      }
    }
  });

  let justUnlocked = false;
  document.addEventListener('pointerlockchange', () => {
    const wasLocked = pointerLocked;
    pointerLocked = document.pointerLockElement === renderer!.domElement;
    if (wasLocked && !pointerLocked) justUnlocked = true;
    if (container) container.style.cursor = pointerLocked ? 'none' : 'default';
    if (crosshairEl) crosshairEl.style.display = pointerLocked ? '' : 'none';
  });

  document.addEventListener('mousemove', (e: MouseEvent) => {
    if (!isActive) return;
    if (pointerLocked) {
      yaw += e.movementX * MOUSE_SENS;
      pitch -= e.movementY * MOUSE_SENS;
      pitch = Math.max(-Math.PI * 0.47, Math.min(Math.PI * 0.47, pitch));
    } else if (renderer) {
      // Track mouse in NDC for unlocked raycasting
      const rect = renderer.domElement.getBoundingClientRect();
      unlockedMouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      unlockedMouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    }
  });

  renderer.domElement.addEventListener('mouseenter', () => { mouseOverCanvas = true; });
  renderer.domElement.addEventListener('mouseleave', () => { mouseOverCanvas = false; });

  renderer.domElement.addEventListener('contextmenu', (e: Event) => e.preventDefault());
  renderer.domElement.addEventListener('mousedown', (e: MouseEvent) => {
    if (pointerLocked) {
      // Thing tool: place thing at crosshair hit point
      if (e.button === 0 && tool === 'thing') {
        mouse.set(0, 0);
        raycaster.setFromCamera(mouse, camera);
        const hits = raycaster.intersectObjects(sceneGroup.children, false);
        if (hits.length > 0) {
          const p = hits[0].point;
          beginAction();
          placeThing(snap(p.x), snap(-p.z));
          endAction();
        }
        return;
      }
      // Left-click or right-click: exit pointer lock so user can select
      if (e.button === 0 || e.button === 2) document.exitPointerLock();
    } else {
      // Right-click: re-enter pointer lock for FPS movement
      if (e.button === 2) renderer!.domElement.requestPointerLock();
    }
  });

  renderer.domElement.addEventListener('wheel', (e: WheelEvent) => {
    if (!isActive) return;
    if (!pointerLocked && !mouseOverCanvas) return;
    e.preventDefault();
    raycaster.setFromCamera(pointerLocked ? mouse.set(0, 0) : unlockedMouse, camera);
    const hits = raycaster.intersectObjects(sceneGroup.children, false);
    if (hits.length === 0) return;
    const ud = hits[0].object.userData;
    if (ud.entityType !== 'sector' || !ud.entityId) return;
    const sec = maps.sectors.get(ud.entityId);
    if (!sec) return;
    const step = e.ctrlKey ? Math.max(1, snapSize / 2) : snapSize;
    const delta = e.deltaY < 0 ? step : -step;
    const field = ud.surface === 'ceiling' ? 'ceiling' : 'floor';
    const newVal = (sec[field] ?? (field === 'ceiling' ? 128 : 0)) + delta;
    beginAction();
    record(`map/sectors/${ud.entityId}`, { ...sec }, { ...sec, [field]: newVal });
    endAction();
    mapRef('sectors').child(ud.entityId).update({ [field]: newVal });
  }, { passive: false });

  window.addEventListener('keydown', e => {
    if (!isActive) return;
    keys[e.code] = true;

    if (pointerLocked && (e.code === 'KeyC' || e.code === 'KeyV' || e.code === 'KeyT')) {
      mouse.set(0, 0);
      raycaster.setFromCamera(mouse, camera);
      const hits = raycaster.intersectObjects(sceneGroup.children, false);
      if (hits.length === 0) return;
      const ud = hits[0].object.userData;

      if (e.code === 'KeyC') {
        // Copy texture from surface under crosshair
        const tex = getTextureFromHit(ud);
        if (tex) {
          copiedTexture = tex;
          showToast(`Copied: ${tex}`);
        }
      } else if (e.code === 'KeyV' && copiedTexture) {
        // Paste texture onto surface under crosshair
        pasteTextureToHit(ud, copiedTexture);
      } else if (e.code === 'KeyT') {
        // Open texture browser for surface under crosshair
        const currentTex = getTextureFromHit(ud) || '';
        const texType: 'flat' | 'wall' = ud.entityType === 'sector' ? 'flat' : 'wall';
        document.exitPointerLock();
        openTextureBrowser({
          filter: texType,
          currentValue: currentTex,
          onSelect: (name) => { pasteTextureToHit(ud, name); renderer!.domElement.requestPointerLock(); },
        });
      }
    }
  });
  window.addEventListener('keyup', e => {
    keys[e.code] = false;
  });

  window.addEventListener('resize', resize);
}

function resize(): void {
  if (!renderer || !container || !isActive) return;
  const w = container.clientWidth;
  const h = container.clientHeight;
  if (w === 0 || h === 0) return;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

function applyLayout(): void {
  const wrap = document.getElementById('canvas-wrap')!;
  const canvas2d = document.getElementById('canvas') as HTMLCanvasElement;
  if (!isActive) {
    container!.style.cssText = 'position:absolute;inset:0;display:none;z-index:10;cursor:crosshair;';
    canvas2d.style.display = '';
    canvas2d.style.flex = '';
    canvas2d.style.minWidth = '';
    canvas2d.style.width = '';
    canvas2d.style.height = '';
    wrap.style.display = '';
    return;
  }
  if (splitMode) {
    wrap.style.display = 'flex';
    canvas2d.style.display = 'block';
    canvas2d.style.flex = '1 1 0';
    canvas2d.style.minWidth = '0';
    canvas2d.style.width = 'auto';
    canvas2d.style.height = '100%';
    container!.style.cssText = 'position:relative;flex:1 1 0;min-width:0;height:100%;display:block;cursor:crosshair;border-left:1px solid #333;';
  } else {
    wrap.style.display = '';
    canvas2d.style.display = 'none';
    canvas2d.style.flex = '';
    canvas2d.style.minWidth = '';
    canvas2d.style.width = '';
    canvas2d.style.height = '';
    container!.style.cssText = 'position:absolute;inset:0;display:block;z-index:10;cursor:crosshair;';
  }
}

// ── Scene building ──

function rebuildScene(): void {
  // Clear old geometry
  while (sceneGroup.children.length) {
    const obj = sceneGroup.children[0];
    sceneGroup.remove(obj);
    if (obj instanceof THREE.Mesh) {
      obj.geometry.dispose();
      if (obj.material instanceof THREE.Material) obj.material.dispose();
    }
  }

  buildFloorsCeilings(sceneGroup);
  buildWalls(sceneGroup);
  buildThings(sceneGroup);
}

// ── Camera positioning ──

const PLAYER_VIEW_HEIGHT = 41; // DOOM player eye height

function floorHeightAt(wx: number, wy: number): number {
  let floorH = 0;
  maps.sectors.forEach((sec, sid) => {
    if (pointInSector(wx, wy, sid)) {
      floorH = sec.floor ?? 0;
    }
  });
  return floorH;
}

function positionCamera(): void {
  const startX = mouseWorld.x;
  const startY = mouseWorld.y;
  const floorH = floorHeightAt(startX, startY);

  // DOOM coords → Three coords: (doomX, height, -doomY)
  camera.position.set(startX, floorH + PLAYER_VIEW_HEIGHT, -startY);
  yaw = 0;
  pitch = 0;
}

// ── Animation loop ──

let lastTime = 0;

function animate(time: number): void {
  if (!isActive) return;
  animFrameId = requestAnimationFrame(animate);

  const delta = Math.min((time - lastTime) / 1000, 0.1);
  lastTime = time;

  // Camera movement
  const speed = (keys['ShiftLeft'] || keys['ShiftRight'] ? MOVE_SPEED * 3 : MOVE_SPEED) * delta;

  // Direction vectors
  const forward = new THREE.Vector3(
    Math.cos(pitch) * Math.sin(yaw),
    Math.sin(pitch),
    Math.cos(pitch) * -Math.cos(yaw)
  );
  const right = new THREE.Vector3(Math.cos(yaw), 0, Math.sin(yaw));
  const up = new THREE.Vector3(0, 1, 0);

  if (pointerLocked) {
    if (keys['KeyW']) camera.position.addScaledVector(forward, speed);
    if (keys['KeyS']) camera.position.addScaledVector(forward, -speed);
    if (keys['KeyA']) camera.position.addScaledVector(right, -speed);
    if (keys['KeyD']) camera.position.addScaledVector(right, speed);
    if (keys['KeyQ']) camera.position.addScaledVector(up, speed);
    if (keys['KeyE']) camera.position.addScaledVector(up, -speed);
  }

  // Apply camera rotation
  const lookTarget = camera.position.clone().add(forward);
  camera.lookAt(lookTarget);

  // Reset previous crosshair highlight
  const prevHighlightMesh = highlightedMesh;
  if (highlightedMesh && highlightedOrigColor) {
    (highlightedMesh.material as THREE.MeshBasicMaterial).color.copy(highlightedOrigColor);
    highlightedMesh = null;
    highlightedOrigColor = null;
  }

  // Raycast from crosshair (locked) or cursor (unlocked, only when hovering the 3D canvas)
  const hits: THREE.Intersection[] = [];
  if (pointerLocked) {
    raycaster.setFromCamera(mouse.set(0, 0), camera);
    hits.push(...raycaster.intersectObjects(sceneGroup.children, false));
  } else if (mouseOverCanvas) {
    raycaster.setFromCamera(unlockedMouse, camera);
    hits.push(...raycaster.intersectObjects(sceneGroup.children, false));
  }

  // Update selection when pointer-locked
  if (pointerLocked) {
    if (hits.length > 0) {
      const ud = hits[0].object.userData;
      if (ud.entityType && ud.entityId) {
        const newType = ud.entityType === 'linedef' ? 'linedef' : 'sector';
        let newSide: 'front' | 'back' | null = null;
        if (newType === 'linedef' && ud.sidedefId) {
          const ld = maps.linedefs.get(ud.entityId);
          if (ld) newSide = ud.sidedefId === ld.frontSide ? 'front' : 'back';
        }
        if (!selected || selected.type !== newType || selected.id !== ud.entityId || activeSide !== newSide) {
          setSelected({ type: newType, id: ud.entityId });
          setActiveSide(newSide);
          renderPanel();
        }
      }
    } else if (selected) {
      setSelected(null);
      setActiveSide(null);
      renderPanel();
    }
  }

  // Highlight surface under crosshair/cursor with a slow throb
  if (hits.length > 0 && !hits[0].object.userData.billboard) {
    const hitMesh = hits[0].object as THREE.Mesh;
    if (hitMesh !== prevHighlightMesh) highlightStartTime = time;
    const mat = hitMesh.material as THREE.MeshBasicMaterial;
    highlightedOrigColor = mat.color.clone();
    highlightedMesh = hitMesh;
    const throb = 0.12 + 0.12 * Math.cos((time - highlightStartTime) * 0.004);
    mat.color.setRGB(
      highlightedOrigColor.r + throb,
      highlightedOrigColor.g + throb,
      highlightedOrigColor.b + throb,
    );
  }

  // Align billboards (things) with view plane (all face same direction)
  const billboardDir = new THREE.Vector3(Math.sin(yaw), 0, -Math.cos(yaw));
  for (const obj of sceneGroup.children) {
    if (obj.userData.billboard) {
      obj.lookAt(obj.position.clone().add(billboardDir));
    }
  }

  renderer!.render(scene, camera);
}

// ── Public API ──

export function toggle3D(): void {
  ensureInit();

  isActive = !isActive;

  if (isActive) {
    applyLayout();
    // Trigger 2D canvas resize in split mode (flex layout changed its size)
    window.dispatchEvent(new Event('resize'));
    resize();
    rebuildScene();
    positionCamera();
    lastTime = performance.now();
    animFrameId = requestAnimationFrame(animate);
    if (!splitMode) {
      renderer!.domElement.requestPointerLock();
      showToast('Left-click exit look | Right-click enter look | WASD move | Shift+click multi-select | Tab exit');
    } else {
      showToast('Split view: right-click 3D pane for FPS look | WASD move');
    }
  } else {
    applyLayout();
    window.dispatchEvent(new Event('resize'));
    cancelAnimationFrame(animFrameId);
    // Exit pointer lock
    if (pointerLocked) document.exitPointerLock();
    // Clear key state
    for (const k in keys) keys[k] = false;
    draw();
  }
}

export function set3DSplit(v: boolean): void {
  if (splitMode === v) return;
  splitMode = v;
  if (!isActive) return;
  // Re-apply layout; exit pointer lock when switching to split
  if (splitMode && pointerLocked) document.exitPointerLock();
  applyLayout();
  window.dispatchEvent(new Event('resize'));
  resize();
  draw();
}

export function is3DSplit(): boolean { return splitMode; }

export function is3DActive(): boolean { return isActive; }
export function get3DCameraPos(): { x: number; y: number } | null {
  if (!isActive || !camera) return null;
  return { x: camera.position.x, y: -camera.position.z }; // Three coords → DOOM coords
}

let rebuildTimer = 0;

export function rebuild3D(): void {
  if (!isActive) return;
  // Debounce: batch rapid updates into a single rebuild
  clearTimeout(rebuildTimer);
  rebuildTimer = window.setTimeout(rebuildScene, 100);
}
