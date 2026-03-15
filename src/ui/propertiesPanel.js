import { maps, selected } from '../state/appState.js';
import { mapRef } from '../config/firebase.js';
import { THINGS, FLAG_BITS } from '../config/constants.js';
import { deleteSelected } from '../map/mapActions.js';

function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

export function renderPanel() {
  const pEmpty   = document.getElementById('panel-empty');
  const pContent = document.getElementById('panel-content');

  if (!selected) {
    pEmpty.style.display = ''; pContent.style.display = 'none'; pContent.innerHTML = ''; return;
  }
  pEmpty.style.display = 'none'; pContent.style.display = '';

  const { type, id } = selected;
  const col    = type + 's';
  const entity = maps[col] && maps[col].get(id);
  if (!entity) { pContent.innerHTML = '<div id="panel-empty">Not found.</div>'; return; }

  let html = `<div class="panel-title">${type} <span style="color:#444">${id.slice(-6)}</span></div>`;

  function numField(label, path, val, step = 1) {
    return `<div class="prop-row"><label>${label}</label>
      <input type="number" data-path="${path}" value="${val ?? 0}" step="${step}"></div>`;
  }
  function txtField(label, path, val) {
    return `<div class="prop-row"><label>${label}</label>
      <input type="text" data-path="${path}" value="${esc(val ?? '')}"></div>`;
  }
  function chkField(label, bitmaskPath, bit, flags) {
    const checked = (flags & bit) ? 'checked' : '';
    return `<div class="prop-row"><label>${label}</label>
      <input type="checkbox" data-bitmask="${bitmaskPath}" data-bit="${bit}" ${checked}></div>`;
  }
  function sidedefBlock(title, sdid) {
    const sd = maps.sidedefs.get(sdid);
    if (!sd) return '';
    const p = id => `sidedefs/${sdid}/${id}`;
    return `<div class="prop-section">
      <div class="panel-title">${title}</div>
      ${txtField('Sector', p('sector'), sd.sector)}
      ${numField('X Off',  p('xoff'),  sd.xoff)}
      ${numField('Y Off',  p('yoff'),  sd.yoff)}
      ${txtField('Upper',  p('upper'), sd.upper)}
      ${txtField('Mid',    p('mid'),   sd.mid)}
      ${txtField('Lower',  p('lower'), sd.lower)}
    </div>`;
  }

  if (type === 'vertex') {
    const p = f => `vertices/${id}/${f}`;
    html += numField('X', p('x'), entity.x) + numField('Y', p('y'), entity.y);

  } else if (type === 'linedef') {
    const p = f => `linedefs/${id}/${f}`;
    html += numField('Special', p('special'), entity.special)
          + numField('Tag',     p('tag'),     entity.tag);
    html += `<div class="prop-section"><div class="panel-title">Flags</div>`;
    for (const { bit, label } of FLAG_BITS)
      html += chkField(label, `linedefs/${id}/flags`, bit, entity.flags || 0);
    html += `</div>`;
    if (entity.frontSide) html += sidedefBlock('Front Sidedef', entity.frontSide);
    if (entity.backSide)  html += sidedefBlock('Back Sidedef',  entity.backSide);

  } else if (type === 'sector') {
    const p = f => `sectors/${id}/${f}`;
    html += numField('Floor H',   p('floor'),    entity.floor)
          + numField('Ceil H',    p('ceiling'),  entity.ceiling)
          + txtField('Floor Tex', p('floorTex'), entity.floorTex || 'FLOOR4_8')
          + txtField('Ceil Tex',  p('ceilTex'),  entity.ceilTex  || 'CEIL3_5')
          + numField('Light',     p('light'),    entity.light)
          + numField('Special',   p('special'),  entity.special)
          + numField('Tag',       p('tag'),      entity.tag);

  } else if (type === 'thing') {
    const p = f => `things/${id}/${f}`;
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

  // Bind inputs: data-path="col/id/field"
  pContent.querySelectorAll('[data-path]').forEach(el => {
    el.addEventListener('change', () => {
      const [c, i, f] = el.dataset.path.split('/');
      const val = (el.type === 'number') ? (parseFloat(el.value) || 0)
                : (el.tagName === 'SELECT') ? (isNaN(el.value) ? el.value : +el.value)
                : el.value;
      mapRef(c).child(i).update({ [f]: val });
    });
  });

  // Bind bitmask checkboxes: data-bitmask="col/id/field" data-bit="N"
  pContent.querySelectorAll('[data-bitmask]').forEach(el => {
    el.addEventListener('change', () => {
      const [c, i, f] = el.dataset.bitmask.split('/');
      const bit = parseInt(el.dataset.bit, 10);
      const cur = (maps[c].get(i) || {})[f] || 0;
      const val = el.checked ? (cur | bit) : (cur & ~bit);
      mapRef(c).child(i).update({ [f]: val });
    });
  });

  document.getElementById('del-btn').addEventListener('click', deleteSelected);
}
