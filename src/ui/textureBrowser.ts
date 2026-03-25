import { getTextures, type TextureEntry } from '../wad/textureLoader';

let onSelectCallback: ((name: string) => void) | null = null;
let activeFilter: 'all' | 'flat' | 'wall' = 'all';
let searchQuery = '';
let currentValue = '';

function getModal(): HTMLElement {
  let modal = document.getElementById('texture-browser-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'texture-browser-modal';
    modal.className = 'tex-modal-overlay';
    modal.style.display = 'none';
    modal.innerHTML = `
      <div class="tex-modal-content">
        <div class="tex-modal-header">
          <input type="text" id="tex-search" placeholder="Search textures...">
          <div class="tex-tabs">
            <button class="tex-tab active" data-filter="all">All</button>
            <button class="tex-tab" data-filter="flat">Flats</button>
            <button class="tex-tab" data-filter="wall">Walls</button>
          </div>
          <button class="tex-modal-close">&times;</button>
        </div>
        <div class="tex-grid" id="tex-grid"></div>
      </div>`;
    document.body.appendChild(modal);

    // Backdrop click
    modal.addEventListener('click', e => {
      if (e.target === modal) closeTextureBrowser();
    });

    // Close button
    modal.querySelector('.tex-modal-close')!.addEventListener('click', closeTextureBrowser);

    // Search
    modal.querySelector('#tex-search')!.addEventListener('input', e => {
      searchQuery = (e.target as HTMLInputElement).value;
      renderGrid();
    });

    // Tabs
    modal.querySelectorAll('.tex-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        activeFilter = (btn as HTMLElement).dataset.filter as any;
        modal!.querySelectorAll('.tex-tab').forEach(b => b.classList.toggle('active', b === btn));
        renderGrid();
      });
    });

    // Stop all key events from reaching canvas/3D handlers
    modal.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        closeTextureBrowser();
      }
      e.stopPropagation();
    });
    modal.addEventListener('keyup', e => e.stopPropagation());
  }
  return modal;
}

function renderGrid(): void {
  const grid = document.getElementById('tex-grid')!;
  const textures = getTextures();
  const query = searchQuery.toUpperCase();

  const filtered: TextureEntry[] = [];
  textures.forEach(tex => {
    if (activeFilter !== 'all' && tex.type !== activeFilter) return;
    if (query && !tex.name.includes(query)) return;
    filtered.push(tex);
  });

  // Sort alphabetically
  filtered.sort((a, b) => a.name.localeCompare(b.name));

  grid.innerHTML = filtered.map(tex => {
    const aspect = (tex.width && tex.height) ? tex.width / tex.height : 1;
    return `
    <div class="tex-card${tex.name === currentValue.toUpperCase() ? ' selected' : ''}" data-name="${tex.name}">
      <img src="${tex.dataUrl}" style="aspect-ratio:${aspect};image-rendering:pixelated">
      <div class="tex-card-name">${tex.name}</div>
    </div>`;
  }).join('');

  // Click handlers
  grid.querySelectorAll('.tex-card').forEach(card => {
    card.addEventListener('click', () => {
      const name = (card as HTMLElement).dataset.name!;
      if (onSelectCallback) onSelectCallback(name);
      closeTextureBrowser();
    });
  });
}

export function openTextureBrowser(options: {
  filter?: 'flat' | 'wall' | 'all';
  currentValue?: string;
  onSelect: (textureName: string) => void;
}): void {
  const modal = getModal();
  onSelectCallback = options.onSelect;
  activeFilter = options.filter ?? 'all';
  currentValue = options.currentValue ?? '';
  searchQuery = '';

  const search = modal.querySelector('#tex-search') as HTMLInputElement;
  search.value = '';

  // Update tab highlights
  modal.querySelectorAll('.tex-tab').forEach(b =>
    b.classList.toggle('active', (b as HTMLElement).dataset.filter === activeFilter)
  );

  renderGrid();
  modal.style.display = '';

  // Focus search
  setTimeout(() => search.focus(), 50);
}

export function closeTextureBrowser(): void {
  const modal = document.getElementById('texture-browser-modal');
  if (modal) modal.style.display = 'none';
  onSelectCallback = null;
}
