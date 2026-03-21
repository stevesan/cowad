import { THINGS, CAT_COLOR, THING_SPRITE } from '../config/constants';
import { getSpritePrefixEntry } from '../wad/textureLoader';

let selectedThingType = 1; // default Player 1 Start
let searchQuery = '';
let activeCategory = 'all';

const CAT_LABELS: Record<string, string> = {
  player: 'Players', enemy: 'Enemies', weapon: 'Weapons', ammo: 'Ammo',
  health: 'Health', armor: 'Armor', key: 'Keys', powerup: 'Power-ups',
  decor: 'Decorations', gore: 'Gore',
};

const CAT_ORDER = ['player', 'enemy', 'weapon', 'ammo', 'health', 'armor', 'key', 'powerup', 'decor', 'gore'];

export function getSelectedThingType(): number { return selectedThingType; }
export function setSelectedThingType(type: number): void {
  selectedThingType = type;
  updateToolbarButton();
}

function updateToolbarButton(): void {
  const btn = document.getElementById('thing-type-btn');
  if (!btn) return;
  const info = THINGS[selectedThingType];
  const sprite = THING_SPRITE[selectedThingType];
  const spriteEntry = sprite ? getSpritePrefixEntry(sprite) : null;

  let html = '';
  if (spriteEntry) {
    html += `<img src="${spriteEntry.dataUrl}" width="20" height="20" style="image-rendering:pixelated;vertical-align:middle;margin-right:4px;">`;
  } else {
    const color = CAT_COLOR[info?.cat] || '#888';
    html += `<span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:${color};vertical-align:middle;margin-right:4px;"></span>`;
  }
  html += info?.name || `Type ${selectedThingType}`;
  btn.innerHTML = html;
}

function getModal(): HTMLElement {
  let modal = document.getElementById('thing-browser-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'thing-browser-modal';
    modal.className = 'tex-modal-overlay';
    modal.style.display = 'none';
    modal.innerHTML = `
      <div class="tex-modal-content">
        <div class="tex-modal-header">
          <input type="text" id="thing-search" placeholder="Search things...">
          <div class="tex-tabs" id="thing-cat-tabs">
            <button class="tex-tab active" data-cat="all">All</button>
          </div>
          <button class="tex-modal-close">&times;</button>
        </div>
        <div class="tex-grid" id="thing-grid" style="grid-template-columns: repeat(auto-fill, minmax(90px, 1fr));"></div>
      </div>`;
    document.body.appendChild(modal);

    // Build category tabs
    const tabsEl = modal.querySelector('#thing-cat-tabs')!;
    for (const cat of CAT_ORDER) {
      const btn = document.createElement('button');
      btn.className = 'tex-tab';
      btn.dataset.cat = cat;
      btn.textContent = CAT_LABELS[cat] || cat;
      tabsEl.appendChild(btn);
    }

    // Backdrop click
    modal.addEventListener('click', e => { if (e.target === modal) closeThingBrowser(); });

    // Close button
    modal.querySelector('.tex-modal-close')!.addEventListener('click', closeThingBrowser);

    // Search
    modal.querySelector('#thing-search')!.addEventListener('input', e => {
      searchQuery = (e.target as HTMLInputElement).value;
      renderGrid();
    });

    // Category tabs
    modal.querySelectorAll('.tex-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        activeCategory = (btn as HTMLElement).dataset.cat!;
        modal!.querySelectorAll('.tex-tab').forEach(b => b.classList.toggle('active', b === btn));
        renderGrid();
      });
    });

    // Key events
    modal.addEventListener('keydown', e => {
      if (e.key === 'Escape') closeThingBrowser();
      e.stopPropagation();
    });
    modal.addEventListener('keyup', e => e.stopPropagation());
  }
  return modal;
}

function renderGrid(): void {
  const grid = document.getElementById('thing-grid')!;
  const query = searchQuery.toLowerCase();

  // Collect and filter entries
  const entries: { id: number; name: string; cat: string }[] = [];
  for (const [idStr, info] of Object.entries(THINGS)) {
    const id = parseInt(idStr, 10);
    if (activeCategory !== 'all' && info.cat !== activeCategory) continue;
    if (query && !info.name.toLowerCase().includes(query)) continue;
    entries.push({ id, name: info.name, cat: info.cat });
  }

  // Group by category
  const grouped = new Map<string, typeof entries>();
  for (const cat of CAT_ORDER) {
    const items = entries.filter(e => e.cat === cat);
    if (items.length > 0) grouped.set(cat, items);
  }

  let html = '';
  for (const [cat, items] of grouped) {
    if (activeCategory === 'all') {
      const color = CAT_COLOR[cat] || '#888';
      html += `<div class="thing-cat-header" style="border-left-color:${color}">${CAT_LABELS[cat] || cat}</div>`;
    }
    for (const item of items) {
      const isSelected = item.id === selectedThingType;
      const sprite = THING_SPRITE[item.id];
      const spriteEntry = sprite ? getSpritePrefixEntry(sprite) : null;
      const color = CAT_COLOR[item.cat] || '#888';

      let preview: string;
      if (spriteEntry) {
        preview = `<img src="${spriteEntry.dataUrl}" width="48" height="48" style="image-rendering:pixelated;object-fit:contain;">`;
      } else {
        preview = `<div style="width:48px;height:48px;display:flex;align-items:center;justify-content:center;">
          <span style="display:block;width:24px;height:24px;border-radius:50%;background:${color};border:2px solid ${color}88;"></span></div>`;
      }

      html += `<div class="tex-card thing-card${isSelected ? ' selected' : ''}" data-id="${item.id}" style="border-bottom: 2px solid ${color}44;">
        ${preview}
        <div class="tex-card-name">${item.name}</div>
      </div>`;
    }
  }

  grid.innerHTML = html;

  // Click handlers
  grid.querySelectorAll('.thing-card').forEach(card => {
    card.addEventListener('click', () => {
      const id = parseInt((card as HTMLElement).dataset.id!, 10);
      selectedThingType = id;
      updateToolbarButton();
      closeThingBrowser();
    });
  });
}

export function openThingBrowser(): void {
  const modal = getModal();
  activeCategory = 'all';
  searchQuery = '';

  const search = modal.querySelector('#thing-search') as HTMLInputElement;
  search.value = '';

  modal.querySelectorAll('.tex-tab').forEach(b =>
    b.classList.toggle('active', (b as HTMLElement).dataset.cat === 'all')
  );

  renderGrid();
  modal.style.display = '';
  setTimeout(() => search.focus(), 50);
}

export function closeThingBrowser(): void {
  const modal = document.getElementById('thing-browser-modal');
  if (modal) modal.style.display = 'none';
}
