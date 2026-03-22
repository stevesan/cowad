/** Screen-pixel radii for hit-testing and hover visuals (divide by zoom for world units). */
export const VERTEX_PICK_PX = 12;
export const LINEDEF_PICK_PX = 16;
export const THING_PICK_PX = 48;

export const GRID = 32;

export const CAT_COLOR: Record<string, string> = {
  player:  '#0f0',
  enemy:   '#f44',
  weapon:  '#fa0',
  ammo:    '#f80',
  health:  '#4af',
  armor:   '#4ff',
  key:     '#ff4',
  powerup: '#f4f',
  decor:   '#888',
  gore:    '#a44',
};
