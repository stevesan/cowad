import * as THREE from 'three';
import { maps, mouseWorld, setSelected } from '../state/appState';
import { renderPanel } from '../ui/propertiesPanel';
import { draw } from '../canvas/renderer';
import { showToast } from '../ui/toast';
import { buildFloorsCeilings, buildWalls, clearTexCache } from './buildGeometry';
import { buildSectorPolys } from '../geometry/cycleFinder';
import { pointInPoly } from '../geometry/hitTest';

let renderer: THREE.WebGLRenderer | null = null;
let scene: THREE.Scene;
let camera: THREE.PerspectiveCamera;
let container: HTMLDivElement | null = null;
let isActive = false;
let animFrameId = 0;
let sceneGroup: THREE.Group;

// ── Camera state ──
let yaw = 0;     // radians, 0 = looking along +X
let pitch = 0;   // radians, clamped to ±85°
const keys: Record<string, boolean> = {};
const MOVE_SPEED = 300;
const MOUSE_SENS = 0.002;
let pointerLocked = false;

// ── Selection ──
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

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
  const crosshair = document.createElement('div');
  crosshair.style.cssText = 'position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);' +
    'width:16px;height:16px;pointer-events:none;z-index:11;' +
    'border:1px solid rgba(255,255,255,0.4);border-radius:50%;';
  container.appendChild(crosshair);

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

  renderer.domElement.addEventListener('click', () => {
    if (!pointerLocked) {
      renderer!.domElement.requestPointerLock();
    }
  });

  document.addEventListener('pointerlockchange', () => {
    pointerLocked = document.pointerLockElement === renderer!.domElement;
    if (container) container.style.cursor = pointerLocked ? 'none' : 'crosshair';
  });

  document.addEventListener('mousemove', (e: MouseEvent) => {
    if (!pointerLocked || !isActive) return;
    yaw += e.movementX * MOUSE_SENS;
    pitch -= e.movementY * MOUSE_SENS;
    pitch = Math.max(-Math.PI * 0.47, Math.min(Math.PI * 0.47, pitch));
  });

  renderer.domElement.addEventListener('contextmenu', (e: Event) => e.preventDefault());
  renderer.domElement.addEventListener('mousedown', (e: MouseEvent) => {
    if (!pointerLocked) return;

    if (e.button === 0 || e.button === 2) {
      // Raycast from center of screen
      mouse.set(0, 0);
      raycaster.setFromCamera(mouse, camera);
      const hits = raycaster.intersectObjects(sceneGroup.children, false);
      if (hits.length > 0) {
        const ud = hits[0].object.userData;
        if (ud.entityType && ud.entityId) {
          setSelected({ type: ud.entityType === 'linedef' ? 'linedef' : 'sector', id: ud.entityId });
          renderPanel();
        }
      }
      // Left-click: also exit pointer lock so user can edit properties
      if (e.button === 0) {
        document.exitPointerLock();
      }
    }
  });

  window.addEventListener('keydown', e => {
    if (!isActive) return;
    keys[e.code] = true;
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
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
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
}

// ── Camera positioning ──

const PLAYER_VIEW_HEIGHT = 41; // DOOM player eye height

function floorHeightAt(wx: number, wy: number): number {
  let floorH = 0;
  maps.sectors.forEach((sec, sid) => {
    const loops = buildSectorPolys(sid);
    for (const poly of loops) {
      if (poly.length >= 3 && pointInPoly(wx, wy, poly)) {
        floorH = sec.floor ?? 0;
        return;
      }
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

  if (keys['KeyW']) camera.position.addScaledVector(forward, speed);
  if (keys['KeyS']) camera.position.addScaledVector(forward, -speed);
  if (keys['KeyA']) camera.position.addScaledVector(right, -speed);
  if (keys['KeyD']) camera.position.addScaledVector(right, speed);
  if (keys['Space']) camera.position.addScaledVector(up, speed);
  if (keys['ControlLeft'] || keys['ControlRight']) camera.position.addScaledVector(up, -speed);

  // Apply camera rotation
  const lookTarget = camera.position.clone().add(forward);
  camera.lookAt(lookTarget);

  renderer!.render(scene, camera);
}

// ── Public API ──

export function toggle3D(): void {
  ensureInit();

  isActive = !isActive;
  const canvas2d = document.getElementById('canvas') as HTMLCanvasElement;

  if (isActive) {
    container!.style.display = '';
    canvas2d.style.display = 'none';
    resize();
    rebuildScene();
    positionCamera();
    lastTime = performance.now();
    animFrameId = requestAnimationFrame(animate);
    renderer!.domElement.requestPointerLock();
    showToast('Left-click select | WASD move | Space/Ctrl up/down | Shift fast | 3 to exit');
  } else {
    container!.style.display = 'none';
    canvas2d.style.display = '';
    cancelAnimationFrame(animFrameId);
    // Exit pointer lock
    if (pointerLocked) document.exitPointerLock();
    // Clear key state
    for (const k in keys) keys[k] = false;
    draw();
  }
}

export function is3DActive(): boolean { return isActive; }

let rebuildTimer = 0;

export function rebuild3D(): void {
  if (!isActive) return;
  // Debounce: batch rapid updates into a single rebuild
  clearTimeout(rebuildTimer);
  rebuildTimer = window.setTimeout(rebuildScene, 100);
}
