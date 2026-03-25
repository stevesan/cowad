import { maps, selected, activeSide, snapSize, multiSelected, multiSelectType, multiSelectedSides } from '../state/appState';
import { mapRef } from '../config/firebase';
import { THINGS, FLAG_BITS } from '../config/constants';
import { deleteSelected } from '../map/mapActions';
import { beginAction, record, endAction } from '../history/undoRedo';
import { getTextureDataUrl, isWadLoaded, getTextures } from '../wad/textureLoader';
import { openTextureBrowser } from './textureBrowser';

function texPreviewStyle(name: string, maxH = 24): string {
  const entry = getTextures().get(name.toUpperCase());
  if (!entry || !entry.width || !entry.height) return `width:${maxH}px;height:${maxH}px`;
  const aspect = entry.width / entry.height;
  const w = Math.round(maxH * aspect);
  return `width:${w}px;height:${maxH}px`;
}

function esc(s: string | number | null | undefined): string {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function evalMath(expr: string): number {
  const s = expr.trim();
  if (!s) return 0;
  if (/^[\d+\-*/().  ]+$/.test(s)) {
    try {
      const r = new Function('return ' + s)();
      if (typeof r === 'number' && isFinite(r)) return Math.round(r * 1000) / 1000;
    } catch { /* fall through */ }
  }
  return parseFloat(s) || 0;
}

export function renderPanel(): void {
  const pEmpty   = document.getElementById('panel-empty')!;
  const pContent = document.getElementById('panel-content')!;

  if (multiSelectType === 'sector' && multiSelected.size > 0) {
    pEmpty.style.display = 'none'; pContent.style.display = '';
    renderMultiSectorPanel(pContent);
    return;
  }

  if (multiSelectType === 'linedef' && multiSelected.size > 0) {
    pEmpty.style.display = 'none'; pContent.style.display = '';
    renderMultiLinedefPanel(pContent);
    return;
  }

  if (!selected) {
    pEmpty.style.display = ''; pContent.style.display = 'none'; pContent.innerHTML = ''; return;
  }
  pEmpty.style.display = 'none'; pContent.style.display = '';

  const { type, id } = selected;
  const col    = type + 's';
  const entity = maps[col] && maps[col].get(id);
  if (!entity) { pContent.innerHTML = '<div id="panel-empty">Not found.</div>'; return; }

  let html = `<div class="panel-title">${type} <span style="color:#444">${id.slice(-6)}</span></div>`;

  function numField(label: string, path: string, val: number | undefined, step = 1): string {
    return `<div class="prop-row"><label>${label}</label>
      <input type="text" data-path="${path}" data-numeric data-step="${step}" value="${val ?? 0}"></div>`;
  }
  function txtField(label: string, path: string, val: string | undefined): string {
    return `<div class="prop-row"><label>${label}</label>
      <input type="text" data-path="${path}" value="${esc(val ?? '')}"></div>`;
  }
  function texField(label: string, path: string, val: string | undefined, texType: 'flat' | 'wall'): string {
    const v = val ?? '';
    const dataUrl = isWadLoaded() ? getTextureDataUrl(v) : null;
    const style = v ? texPreviewStyle(v) : `width:24px;height:24px`;
    const preview = dataUrl
      ? `<img class="tex-preview tex-clickable" src="${dataUrl}" style="${style}" data-path="${path}" data-tex-type="${texType}">`
      : `<span class="tex-clickable tex-placeholder" data-path="${path}" data-tex-type="${texType}"></span>`;
    return `<div class="prop-row"><label>${label}</label>
      ${preview}
      <span class="tex-name tex-clickable" data-path="${path}" data-tex-type="${texType}">${esc(v) || '—'}</span></div>`;
  }
  function chkField(label: string, bitmaskPath: string, bit: number, flags: number): string {
    const checked = (flags & bit) ? 'checked' : '';
    return `<div class="prop-row"><label>${label}</label>
      <input type="checkbox" data-bitmask="${bitmaskPath}" data-bit="${bit}" ${checked}></div>`;
  }
  function sidedefBlock(title: string, sdid: string, active: boolean = false): string {
    const sd = maps.sidedefs.get(sdid);
    if (!sd) return '';
    const p = (field: string) => `sidedefs/${sdid}/${field}`;
    return `<div class="prop-section${active ? ' active-side' : ''}">
      <div class="panel-title">${title}</div>
      ${txtField('Sector', p('sector'), sd.sector ?? '')}
      ${numField('X Off',  p('xoff'),  sd.xoff)}
      ${numField('Y Off',  p('yoff'),  sd.yoff)}
      ${texField('Upper',  p('upper'), sd.upper, 'wall')}
      ${texField('Mid',    p('mid'),   sd.mid, 'wall')}
      ${texField('Lower',  p('lower'), sd.lower, 'wall')}
    </div>`;
  }

  if (type === 'vertex') {
    const p = (f: string) => `vertices/${id}/${f}`;
    html += numField('X', p('x'), entity.x) + numField('Y', p('y'), entity.y);

  } else if (type === 'linedef') {
    const p = (f: string) => `linedefs/${id}/${f}`;
    html += numField('Special', p('special'), entity.special)
          + numField('Tag',     p('tag'),     entity.tag);
    html += `<div class="prop-section"><div class="panel-title">Flags</div>`;
    for (const { bit, label } of FLAG_BITS)
      html += chkField(label, `linedefs/${id}/flags`, bit, entity.flags || 0);
    html += `</div>`;
    if (entity.frontSide) html += sidedefBlock('Front Sidedef', entity.frontSide, activeSide === 'front');
    if (entity.backSide)  html += sidedefBlock('Back Sidedef',  entity.backSide, activeSide === 'back');

  } else if (type === 'sector') {
    const p = (f: string) => `sectors/${id}/${f}`;
    html += numField('Floor H',   p('floor'),    entity.floor)
          + numField('Ceil H',    p('ceiling'),  entity.ceiling)
          + texField('Floor Tex', p('floorTex'), entity.floorTex || 'FLOOR4_8', 'flat')
          + texField('Ceil Tex',  p('ceilTex'),  entity.ceilTex  || 'CEIL3_5', 'flat')
          + numField('Light',     p('light'),    entity.light)
          + numField('Special',   p('special'),  entity.special)
          + numField('Tag',       p('tag'),      entity.tag);
    html += `<button class="door-btn" id="door-btn">Create Door</button>`;

  } else if (type === 'thing') {
    const p = (f: string) => `things/${id}/${f}`;
    html += numField('X',     p('x'),     entity.x)
          + numField('Y',     p('y'),     entity.y)
          + numField('Angle', p('angle'), entity.angle);
    html += `<div class="prop-row"><label>Type</label><select data-path="${p('type')}">`;
    for (const [t, info] of Object.entries(THINGS))
      html += `<option value="${t}" ${entity.type == t ? 'selected' : ''}>${info.name}</option>`;
    html += `</select></div>`;
    html += numField('Flags', p('flags'), entity.flags);
  }

  html += `<button class="del-btn" id="del-btn">Delete ${type}</button>`;
  pContent.innerHTML = html;

  pContent.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-path]').forEach(el => {
    el.addEventListener('change', () => {
      const [c, i, f] = el.dataset.path!.split('/');
      const isNumeric = el.hasAttribute('data-numeric');
      if (isNumeric) el.value = String(evalMath(el.value));
      const val = isNumeric ? evalMath(el.value)
                : (el.tagName === 'SELECT') ? (isNaN(Number(el.value)) ? el.value : +el.value)
                : el.value;
      const entity = maps[c]?.get(i);
      if (entity) {
        beginAction();
        record(`map/${c}/${i}`, { ...entity }, { ...entity, [f]: val });
        endAction();
      }
      mapRef(c).child(i).update({ [f]: val });
    });
  });

  pContent.querySelectorAll<HTMLInputElement>('[data-bitmask]').forEach(el => {
    el.addEventListener('change', () => {
      const [c, i, f] = el.dataset.bitmask!.split('/');
      const bit = parseInt(el.dataset.bit!, 10);
      const cur = (maps[c].get(i) || {})[f] || 0;
      const val = el.checked ? (cur | bit) : (cur & ~bit);
      const entity = maps[c]?.get(i);
      if (entity) {
        beginAction();
        record(`map/${c}/${i}`, { ...entity }, { ...entity, [f]: val });
        endAction();
      }
      mapRef(c).child(i).update({ [f]: val });
    });
  });

  pContent.querySelectorAll<HTMLElement>('.tex-clickable').forEach(el => {
    el.addEventListener('click', () => {
      const path = el.dataset.path!;
      const texType = el.dataset.texType as 'flat' | 'wall';
      const [c, i, f] = path.split('/');
      const currentVal = (maps[c]?.get(i) as any)?.[f] ?? '';
      openTextureBrowser({
        filter: texType,
        currentValue: currentVal,
        onSelect: (name) => {
          const entity = maps[c]?.get(i);
          if (entity) {
            beginAction();
            record(`map/${c}/${i}`, { ...entity }, { ...entity, [f]: name });
            endAction();
          }
          mapRef(c).child(i).update({ [f]: name });
          renderPanel();
        },
      });
    });
  });

  // Mouse wheel on number fields: increment/decrement by snap size
  pContent.querySelectorAll<HTMLInputElement>('input[data-numeric]').forEach(el => {
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      const delta = e.deltaY < 0 ? snapSize : -snapSize;
      el.value = String(evalMath(el.value) + delta);
      el.dispatchEvent(new Event('change'));
    });
  });

  // Select all text on click for easy editing
  pContent.querySelectorAll<HTMLInputElement>('input[type="text"]').forEach(el => {
    el.addEventListener('focus', () => el.select());
  });

  document.getElementById('del-btn')!.addEventListener('click', deleteSelected);
  document.getElementById('door-btn')?.addEventListener('click', () => {
    if (selected?.type === 'sector') showDoorModal(selected.id);
  });
}

// ── Door modal ──

const DOOR_TYPES: { value: number; label: string }[] = [
  { value: 1,  label: 'Standard Door (open/close)' },
  { value: 31, label: 'Door (stays open)' },
  { value: 26, label: 'Blue Key Door' },
  { value: 27, label: 'Yellow Key Door' },
  { value: 28, label: 'Red Key Door' },
  { value: 32, label: 'Blue Key Door (stays open)' },
  { value: 33, label: 'Yellow Key Door (stays open)' },
  { value: 34, label: 'Red Key Door (stays open)' },
];

function doorTexField(id: string, label: string, value: string, texType: 'flat' | 'wall'): string {
  const dataUrl = isWadLoaded() ? getTextureDataUrl(value) : null;
  const style = texPreviewStyle(value);
  const preview = dataUrl
    ? `<img class="tex-preview door-tex-pick" src="${dataUrl}" style="${style}" data-door-id="${id}" data-tex-type="${texType}">`
    : `<span class="door-tex-pick tex-placeholder" data-door-id="${id}" data-tex-type="${texType}"></span>`;
  return `<div class="prop-row"><label>${label}</label>
    ${preview}
    <span class="tex-name door-tex-pick" data-door-id="${id}" data-tex-type="${texType}" id="${id}-name">${value || '—'}</span>
    <input type="hidden" id="${id}" value="${esc(value)}">
  </div>`;
}

function refreshDoorTexPreview(id: string): void {
  const input = document.getElementById(id) as HTMLInputElement;
  if (!input) return;
  const val = input.value;
  const nameEl = document.getElementById(id + '-name');
  if (nameEl) nameEl.textContent = val || '—';
  // Update preview image
  const container = input.closest('.prop-row');
  if (!container) return;
  const img = container.querySelector('img.door-tex-pick') as HTMLImageElement | null;
  const placeholder = container.querySelector('span.door-tex-pick.tex-placeholder') as HTMLElement | null;
  const dataUrl = isWadLoaded() ? getTextureDataUrl(val) : null;
  if (dataUrl && img) {
    img.src = dataUrl;
  } else if (dataUrl && placeholder) {
    const newImg = document.createElement('img');
    newImg.className = 'tex-preview door-tex-pick';
    newImg.src = dataUrl;
    newImg.style.cssText = texPreviewStyle(val);
    newImg.dataset.doorId = placeholder.dataset.doorId!;
    newImg.dataset.texType = placeholder.dataset.texType!;
    placeholder.replaceWith(newImg);
  }
}

function showDoorModal(sectorId: string): void {
  let modal = document.getElementById('door-modal');
  if (modal) modal.remove();

  modal = document.createElement('div');
  modal.id = 'door-modal';
  modal.className = 'tex-modal-overlay';
  modal.innerHTML = `
    <div class="door-modal-content">
      <div class="panel-title" style="margin-bottom:12px;">Create Door</div>
      <div class="prop-row"><label>Type</label>
        <select id="door-type">
          ${DOOR_TYPES.map(d => `<option value="${d.value}">${d.label}</option>`).join('')}
        </select>
      </div>
      ${doorTexField('door-tex-face', 'Door Face', 'BIGDOOR2', 'wall')}
      ${doorTexField('door-tex-bottom', 'Door Bottom', 'FLAT20', 'flat')}
      ${doorTexField('door-tex-track', 'Track Sides', 'DOORTRAK', 'wall')}
      ${doorTexField('door-tex-floor', 'Track Floor', 'FLAT20', 'flat')}
      <div style="display:flex;gap:8px;margin-top:16px;justify-content:flex-end;">
        <button id="door-cancel" class="del-btn" style="background:#333;">Cancel</button>
        <button id="door-ok" class="del-btn" style="background:#2a6e2a;">OK</button>
      </div>
    </div>`;
  document.body.appendChild(modal);

  // Texture picker click handlers
  modal.querySelectorAll<HTMLElement>('.door-tex-pick').forEach(el => {
    el.style.cursor = 'pointer';
    el.addEventListener('click', () => {
      const fieldId = el.dataset.doorId!;
      const texType = el.dataset.texType as 'flat' | 'wall';
      const input = document.getElementById(fieldId) as HTMLInputElement;
      openTextureBrowser({
        filter: texType,
        currentValue: input.value,
        onSelect: (name) => {
          input.value = name;
          refreshDoorTexPreview(fieldId);
        },
      });
    });
  });

  modal.addEventListener('click', e => { if (e.target === modal) modal!.remove(); });
  modal.addEventListener('keydown', e => {
    if (e.key === 'Escape') modal!.remove();
    e.stopPropagation();
  });
  modal.addEventListener('keyup', e => e.stopPropagation());
  document.getElementById('door-cancel')!.addEventListener('click', () => modal!.remove());
  document.getElementById('door-ok')!.addEventListener('click', () => {
    const doorType = parseInt((document.getElementById('door-type') as HTMLSelectElement).value, 10);
    const doorFace = (document.getElementById('door-tex-face') as HTMLInputElement).value || 'BIGDOOR2';
    const doorBottom = (document.getElementById('door-tex-bottom') as HTMLInputElement).value || 'FLAT20';
    const trackSides = (document.getElementById('door-tex-track') as HTMLInputElement).value || 'DOORTRAK';
    const trackFloor = (document.getElementById('door-tex-floor') as HTMLInputElement).value || 'FLAT20';
    applyDoor(sectorId, doorType, { face: doorFace, bottom: doorBottom, trackSides, trackFloor });
    modal!.remove();
  });

  (document.getElementById('door-type') as HTMLSelectElement).focus();
}

interface DoorTextures {
  face: string;      // upper texture on adjacent-side sidedefs (the door face)
  bottom: string;    // ceiling flat of door sector (visible underside)
  trackSides: string; // upper texture on door-side sidedefs (track rails)
  trackFloor: string; // floor flat of door sector
}

function applyDoor(sectorId: string, doorType: number, tex: DoorTextures): void {
  const sec = maps.sectors.get(sectorId);
  if (!sec) return;

  beginAction();

  // Set sector: ceiling = floor (closed), textures for track floor and door bottom
  const floorH = sec.floor ?? 0;
  const newSec = { ...sec, ceiling: floorH, ceilTex: tex.bottom, floorTex: tex.trackFloor };
  record(`map/sectors/${sectorId}`, { ...sec }, newSec);
  mapRef('sectors').child(sectorId).update({ ceiling: floorH, ceilTex: tex.bottom, floorTex: tex.trackFloor });

  // Find all linedefs bordering this sector
  maps.linedefs.forEach((ld, lid) => {
    if (!ld.frontSide) return;
    const frontSd = maps.sidedefs.get(ld.frontSide);
    if (!frontSd) return;
    const backSd = ld.backSide ? maps.sidedefs.get(ld.backSide) : null;

    const frontIsDoor = frontSd.sector === sectorId;
    const backIsDoor = backSd?.sector === sectorId;
    if (!frontIsDoor && !backIsDoor) return;

    const oldLd = { ...ld };

    if (!ld.backSide) {
      // One-sided linedef (door track side wall): add upper unpeg so mid texture stays fixed
      const newFlags = (ld.flags || 0) | 16; // upper unpeg
      record(`map/linedefs/${lid}`, oldLd, { ...oldLd, flags: newFlags });
      mapRef('linedefs').child(lid).update({ flags: newFlags });
      // Set mid texture to track sides
      record(`map/sidedefs/${ld.frontSide}`, { ...frontSd }, { ...frontSd, mid: tex.trackSides });
      mapRef('sidedefs').child(ld.frontSide).update({ mid: tex.trackSides });
      return;
    }

    // Two-sided linedef: set door special + upper unpeg
    const newFlags = (ld.flags || 0) | 16; // upper unpeg

    if (frontIsDoor) {
      // Front side faces door sector — flip linedef so front faces adjacent sector
      // (DOOM DR doors only activate from the front side)
      const newLd = {
        ...oldLd,
        v1: ld.v2, v2: ld.v1,
        frontSide: ld.backSide, backSide: ld.frontSide,
        special: doorType, flags: newFlags,
      };
      record(`map/linedefs/${lid}`, oldLd, newLd);
      mapRef('linedefs').child(lid).update(newLd);
    } else {
      record(`map/linedefs/${lid}`, oldLd, { ...oldLd, special: doorType, flags: newFlags });
      mapRef('linedefs').child(lid).update({ special: doorType, flags: newFlags });
    }

    // Adjacent-side sidedef: door face upper texture
    const adjSdId = frontIsDoor ? ld.backSide! : ld.frontSide!;
    const adjSd = maps.sidedefs.get(adjSdId)!;
    record(`map/sidedefs/${adjSdId}`, { ...adjSd }, { ...adjSd, upper: tex.face });
    mapRef('sidedefs').child(adjSdId).update({ upper: tex.face });

    // Door-side sidedef: track texture on upper
    const doorSdId = frontIsDoor ? ld.frontSide! : ld.backSide!;
    const doorSd = maps.sidedefs.get(doorSdId)!;
    record(`map/sidedefs/${doorSdId}`, { ...doorSd }, { ...doorSd, upper: tex.trackSides });
    mapRef('sidedefs').child(doorSdId).update({ upper: tex.trackSides });
  });

  endAction();
  renderPanel();
}

function renderMultiSectorPanel(pContent: HTMLElement): void {
  const sids = [...multiSelected];
  const sectors = sids.map(sid => maps.sectors.get(sid)).filter(Boolean) as any[];
  if (sectors.length === 0) return;

  // Find common values (show value if all match, otherwise "—")
  function commonVal(field: string): string | number | null {
    const vals = sectors.map(s => s[field]);
    return vals.every(v => v === vals[0]) ? vals[0] : null;
  }

  const floor = commonVal('floor');
  const ceiling = commonVal('ceiling');
  const light = commonVal('light');
  const special = commonVal('special');
  const tag = commonVal('tag');
  const floorTex = commonVal('floorTex');
  const ceilTex = commonVal('ceilTex');

  function multiNumField(label: string, field: string, val: number | null, step = 1): string {
    const display = val !== null ? val : '';
    return `<div class="prop-row"><label>${label}</label>
      <input type="text" data-multi-field="${field}" data-numeric data-step="${step}" value="${display}" placeholder="mixed"></div>`;
  }

  function multiTexField(label: string, field: string, val: string | null, texType: 'flat' | 'wall'): string {
    const v = val ?? '';
    const dataUrl = v && isWadLoaded() ? getTextureDataUrl(v) : null;
    const style = v ? texPreviewStyle(v) : `width:24px;height:24px`;
    const preview = dataUrl
      ? `<img class="tex-preview tex-clickable" src="${dataUrl}" style="${style}" data-multi-field="${field}" data-tex-type="${texType}">`
      : `<span class="tex-clickable tex-placeholder" data-multi-field="${field}" data-tex-type="${texType}"></span>`;
    return `<div class="prop-row"><label>${label}</label>
      ${preview}
      <span class="tex-name tex-clickable" data-multi-field="${field}" data-tex-type="${texType}">${val ? esc(v) : 'mixed'}</span></div>`;
  }

  let html = `<div class="panel-title">sectors <span style="color:#444">${sids.length} selected</span></div>`;
  html += multiNumField('Floor H', 'floor', floor as number | null);
  html += multiNumField('Ceil H', 'ceiling', ceiling as number | null);
  html += multiTexField('Floor Tex', 'floorTex', floorTex as string | null, 'flat');
  html += multiTexField('Ceil Tex', 'ceilTex', ceilTex as string | null, 'flat');
  html += multiNumField('Light', 'light', light as number | null);
  html += multiNumField('Special', 'special', special as number | null);
  html += multiNumField('Tag', 'tag', tag as number | null);

  pContent.innerHTML = html;

  // Number field change handlers — apply to all selected sectors
  pContent.querySelectorAll<HTMLInputElement>('[data-multi-field]').forEach(el => {
    if (el.tagName !== 'INPUT') return;
    el.addEventListener('change', () => {
      const field = el.dataset.multiField!;
      const isNumeric = el.hasAttribute('data-numeric');
      if (isNumeric) el.value = String(evalMath(el.value));
      const val = isNumeric ? evalMath(el.value) : el.value;
      beginAction();
      for (const sid of sids) {
        const entity = maps.sectors.get(sid);
        if (entity) {
          record(`map/sectors/${sid}`, { ...entity }, { ...entity, [field]: val });
          mapRef('sectors').child(sid).update({ [field]: val });
        }
      }
      endAction();
    });
  });

  // Texture clickable handlers
  pContent.querySelectorAll<HTMLElement>('.tex-clickable').forEach(el => {
    el.addEventListener('click', () => {
      const field = el.dataset.multiField!;
      const texType = el.dataset.texType as 'flat' | 'wall';
      const currentVal = (commonVal(field) as string) ?? '';
      openTextureBrowser({
        filter: texType,
        currentValue: currentVal,
        onSelect: (name) => {
          beginAction();
          for (const sid of sids) {
            const entity = maps.sectors.get(sid);
            if (entity) {
              record(`map/sectors/${sid}`, { ...entity }, { ...entity, [field]: name });
              mapRef('sectors').child(sid).update({ [field]: name });
            }
          }
          endAction();
          renderPanel();
        },
      });
    });
  });

  // Mouse wheel on number fields
  pContent.querySelectorAll<HTMLInputElement>('input[data-numeric]').forEach(el => {
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      const delta = e.deltaY < 0 ? snapSize : -snapSize;
      el.value = String(evalMath(el.value) + delta);
      el.dispatchEvent(new Event('change'));
    });
  });

  pContent.querySelectorAll<HTMLInputElement>('input[data-numeric]').forEach(el => {
    el.addEventListener('focus', () => el.select());
  });
}

function renderMultiLinedefPanel(pContent: HTMLElement): void {
  const lids = [...multiSelected];
  const linedefs = lids.map(lid => maps.linedefs.get(lid)).filter(Boolean) as any[];
  if (linedefs.length === 0) return;

  function commonVal(field: string): string | number | null {
    const vals = linedefs.map(l => l[field]);
    return vals.every(v => v === vals[0]) ? vals[0] : null;
  }

  // Collect all front/back sidedefs
  const frontSids = lids.map(lid => maps.linedefs.get(lid)?.frontSide).filter(Boolean) as string[];
  const backSids = lids.map(lid => maps.linedefs.get(lid)?.backSide).filter(Boolean) as string[];

  function commonSideVal(sids: string[], field: string): string | null {
    if (sids.length === 0) return null;
    const vals = sids.map(sid => {
      const sd = maps.sidedefs.get(sid);
      return sd ? (sd as any)[field] : undefined;
    });
    return vals.every(v => v === vals[0]) ? vals[0] : null;
  }

  const special = commonVal('special');
  const tag = commonVal('tag');
  const flags = commonVal('flags');

  function multiNumField(label: string, field: string, val: number | null, step = 1): string {
    return `<div class="prop-row"><label>${label}</label>
      <input type="text" data-multi-field="${field}" data-numeric data-step="${step}" value="${val !== null ? val : ''}" placeholder="mixed"></div>`;
  }

  function multiChkField(label: string, bit: number, allFlags: number | null): string {
    // If all share the same flags, show checked/unchecked; otherwise indeterminate
    const checked = allFlags !== null && (allFlags & bit) ? 'checked' : '';
    return `<div class="prop-row"><label>${label}</label>
      <input type="checkbox" data-multi-bit="${bit}" ${checked}></div>`;
  }

  function multiSideTexField(label: string, field: string, sids: string[], texType: 'flat' | 'wall'): string {
    if (sids.length === 0) return '';
    const val = commonSideVal(sids, field);
    const v = val ?? '';
    const dataUrl = v && isWadLoaded() ? getTextureDataUrl(v) : null;
    const style = v ? texPreviewStyle(v) : `width:24px;height:24px`;
    const preview = dataUrl
      ? `<img class="tex-preview tex-clickable" src="${dataUrl}" style="${style}" data-side-field="${field}" data-side-type="${texType}" data-side-ids="${sids.join(',')}">`
      : `<span class="tex-clickable tex-placeholder" data-side-field="${field}" data-side-type="${texType}" data-side-ids="${sids.join(',')}"></span>`;
    return `<div class="prop-row"><label>${label}</label>
      ${preview}
      <span class="tex-name tex-clickable" data-side-field="${field}" data-side-type="${texType}" data-side-ids="${sids.join(',')}">${val ? esc(v) : 'mixed'}</span></div>`;
  }

  let html = `<div class="panel-title">linedefs <span style="color:#444">${lids.length} selected</span></div>`;
  html += multiNumField('Special', 'special', special as number | null);
  html += multiNumField('Tag', 'tag', tag as number | null);

  html += `<div class="prop-section"><div class="panel-title">Flags</div>`;
  for (const { bit, label } of FLAG_BITS)
    html += multiChkField(label, bit, flags as number | null);
  html += `</div>`;

  // Per-linedef selected sides (from 3D view shift+click)
  const selectedSids = lids.map(lid => multiSelectedSides.get(lid)).filter(Boolean) as string[];
  if (selectedSids.length > 0) {
    function commonSideNumVal(sids: string[], field: string): number | null {
      const vals = sids.map(sid => {
        const sd = maps.sidedefs.get(sid);
        return sd ? ((sd as any)[field] ?? 0) : 0;
      });
      return vals.every((v: number) => v === vals[0]) ? vals[0] : null;
    }
    function multiSideNumField(label: string, field: string, val: number | null, sids: string[], step = 1): string {
      return `<div class="prop-row"><label>${label}</label>
        <input type="text" data-multi-side-num="${field}" data-side-ids="${sids.join(',')}" data-numeric data-step="${step}" value="${val !== null ? val : ''}" placeholder="mixed"></div>`;
    }
    const cxoff = commonSideNumVal(selectedSids, 'xoff');
    const cyoff = commonSideNumVal(selectedSids, 'yoff');
    html += `<div class="prop-section"><div class="panel-title">Selected Sides <span style="color:#444">${selectedSids.length}</span></div>`;
    html += multiSideNumField('X Off', 'xoff', cxoff, selectedSids);
    html += multiSideNumField('Y Off', 'yoff', cyoff, selectedSids);
    html += `</div>`;
  }

  if (frontSids.length > 0) {
    html += `<div class="prop-section"><div class="panel-title">Front Sidedef</div>`;
    html += multiSideTexField('Upper', 'upper', frontSids, 'wall');
    html += multiSideTexField('Mid', 'mid', frontSids, 'wall');
    html += multiSideTexField('Lower', 'lower', frontSids, 'wall');
    html += `</div>`;
  }
  if (backSids.length > 0) {
    html += `<div class="prop-section"><div class="panel-title">Back Sidedef</div>`;
    html += multiSideTexField('Upper', 'upper', backSids, 'wall');
    html += multiSideTexField('Mid', 'mid', backSids, 'wall');
    html += multiSideTexField('Lower', 'lower', backSids, 'wall');
    html += `</div>`;
  }

  pContent.innerHTML = html;

  // Number field handlers
  pContent.querySelectorAll<HTMLInputElement>('[data-multi-field]').forEach(el => {
    el.addEventListener('change', () => {
      const field = el.dataset.multiField!;
      if (el.hasAttribute('data-numeric')) el.value = String(evalMath(el.value));
      const val = evalMath(el.value);
      beginAction();
      for (const lid of lids) {
        const entity = maps.linedefs.get(lid);
        if (entity) {
          record(`map/linedefs/${lid}`, { ...entity }, { ...entity, [field]: val });
          mapRef('linedefs').child(lid).update({ [field]: val });
        }
      }
      endAction();
    });
  });

  // Sidedef numeric field handlers (batch xoff/yoff)
  pContent.querySelectorAll<HTMLInputElement>('[data-multi-side-num]').forEach(el => {
    el.addEventListener('change', () => {
      const field = el.dataset.multiSideNum!;
      const sids = el.dataset.sideIds!.split(',');
      const val = evalMath(el.value);
      el.value = String(val);
      beginAction();
      for (const sid of sids) {
        const sd = maps.sidedefs.get(sid);
        if (sd) {
          record(`map/sidedefs/${sid}`, { ...sd }, { ...sd, [field]: val });
          mapRef('sidedefs').child(sid).update({ [field]: val });
        }
      }
      endAction();
    });
  });

  // Checkbox (flag) handlers
  pContent.querySelectorAll<HTMLInputElement>('[data-multi-bit]').forEach(el => {
    el.addEventListener('change', () => {
      const bit = parseInt(el.dataset.multiBit!, 10);
      beginAction();
      for (const lid of lids) {
        const entity = maps.linedefs.get(lid);
        if (entity) {
          const cur = entity.flags || 0;
          const val = el.checked ? (cur | bit) : (cur & ~bit);
          record(`map/linedefs/${lid}`, { ...entity }, { ...entity, flags: val });
          mapRef('linedefs').child(lid).update({ flags: val });
        }
      }
      endAction();
    });
  });

  // Sidedef texture click handlers
  pContent.querySelectorAll<HTMLElement>('.tex-clickable').forEach(el => {
    el.addEventListener('click', () => {
      const field = el.dataset.sideField!;
      const texType = el.dataset.sideType as 'flat' | 'wall';
      const sids = el.dataset.sideIds!.split(',');
      const currentVal = commonSideVal(sids, field) ?? '';
      openTextureBrowser({
        filter: texType,
        currentValue: currentVal,
        onSelect: (name) => {
          beginAction();
          for (const sid of sids) {
            const sd = maps.sidedefs.get(sid);
            if (sd) {
              record(`map/sidedefs/${sid}`, { ...sd }, { ...sd, [field]: name });
              mapRef('sidedefs').child(sid).update({ [field]: name });
            }
          }
          endAction();
          renderPanel();
        },
      });
    });
  });

  // Mouse wheel on number fields
  pContent.querySelectorAll<HTMLInputElement>('input[data-numeric]').forEach(el => {
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      const delta = e.deltaY < 0 ? snapSize : -snapSize;
      el.value = String(evalMath(el.value) + delta);
      el.dispatchEvent(new Event('change'));
    });
  });

  pContent.querySelectorAll<HTMLInputElement>('input[data-numeric]').forEach(el => {
    el.addEventListener('focus', () => el.select());
  });
}
