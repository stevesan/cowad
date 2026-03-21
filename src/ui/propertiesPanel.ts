import { maps, selected, activeSide, snapSize, multiSelected, multiSelectType } from '../state/appState';
import { mapRef } from '../config/firebase';
import { THINGS, FLAG_BITS } from '../config/constants';
import { deleteSelected } from '../map/mapActions';
import { beginAction, record, endAction } from '../history/undoRedo';
import { getTextureDataUrl, isWadLoaded } from '../wad/textureLoader';
import { openTextureBrowser } from './textureBrowser';

function esc(s: string | number | null | undefined): string {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

export function renderPanel(): void {
  const pEmpty   = document.getElementById('panel-empty')!;
  const pContent = document.getElementById('panel-content')!;

  if (multiSelectType === 'sector' && multiSelected.size > 0) {
    pEmpty.style.display = 'none'; pContent.style.display = '';
    renderMultiSectorPanel(pContent);
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
      <input type="number" data-path="${path}" value="${val ?? 0}" step="${step}"></div>`;
  }
  function txtField(label: string, path: string, val: string | undefined): string {
    return `<div class="prop-row"><label>${label}</label>
      <input type="text" data-path="${path}" value="${esc(val ?? '')}"></div>`;
  }
  function texField(label: string, path: string, val: string | undefined, texType: 'flat' | 'wall'): string {
    const v = val ?? '';
    const dataUrl = isWadLoaded() ? getTextureDataUrl(v) : null;
    const preview = dataUrl
      ? `<img class="tex-preview tex-clickable" src="${dataUrl}" width="24" height="24" data-path="${path}" data-tex-type="${texType}">`
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
      const val = (el.type === 'number') ? (parseFloat(el.value) || 0)
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
  pContent.querySelectorAll<HTMLInputElement>('input[type="number"]').forEach(el => {
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      const delta = e.deltaY < 0 ? snapSize : -snapSize;
      el.value = String((parseFloat(el.value) || 0) + delta);
      el.dispatchEvent(new Event('change'));
    });
  });

  // Select all text on click for easy editing
  pContent.querySelectorAll<HTMLInputElement>('input[type="text"], input[type="number"]').forEach(el => {
    el.addEventListener('focus', () => el.select());
  });

  document.getElementById('del-btn')!.addEventListener('click', deleteSelected);
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
      <input type="number" data-multi-field="${field}" value="${display}" step="${step}" placeholder="mixed"></div>`;
  }

  function multiTexField(label: string, field: string, val: string | null, texType: 'flat' | 'wall'): string {
    const v = val ?? '';
    const dataUrl = v && isWadLoaded() ? getTextureDataUrl(v) : null;
    const preview = dataUrl
      ? `<img class="tex-preview tex-clickable" src="${dataUrl}" width="24" height="24" data-multi-field="${field}" data-tex-type="${texType}">`
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
      const val = (el.type === 'number') ? (parseFloat(el.value) || 0) : el.value;
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
  pContent.querySelectorAll<HTMLInputElement>('input[type="number"]').forEach(el => {
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      const delta = e.deltaY < 0 ? snapSize : -snapSize;
      el.value = String((parseFloat(el.value) || 0) + delta);
      el.dispatchEvent(new Event('change'));
    });
  });

  pContent.querySelectorAll<HTMLInputElement>('input[type="number"]').forEach(el => {
    el.addEventListener('focus', () => el.select());
  });
}
