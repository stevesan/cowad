export const GRID = 32;
export const SNAP = 8;

export const THINGS = {
  // Players / starts
  1:    { name: 'Player 1 Start',   cat: 'player',  r: 16 },
  2:    { name: 'Player 2 Start',   cat: 'player',  r: 16 },
  3:    { name: 'Player 3 Start',   cat: 'player',  r: 16 },
  4:    { name: 'Player 4 Start',   cat: 'player',  r: 16 },
  11:   { name: 'Deathmatch Start', cat: 'player',  r: 16 },
  // Doom monsters
  3004: { name: 'Zombieman',        cat: 'enemy',   r: 20 },
  9:    { name: 'Shotgun Guy',      cat: 'enemy',   r: 20 },
  3001: { name: 'Imp',             cat: 'enemy',   r: 20 },
  3002: { name: 'Demon',           cat: 'enemy',   r: 30 },
  58:   { name: 'Spectre',         cat: 'enemy',   r: 30 },
  3005: { name: 'Cacodemon',       cat: 'enemy',   r: 31 },
  3003: { name: 'Baron of Hell',   cat: 'enemy',   r: 24 },
  3006: { name: 'Lost Soul',       cat: 'enemy',   r: 16 },
  16:   { name: 'Cyberdemon',      cat: 'enemy',   r: 40 },
  7:    { name: 'Spider Mastermind',cat: 'enemy',   r: 128},
  // Doom 2 monsters
  65:   { name: 'Chaingun Guy',    cat: 'enemy',   r: 20 },
  64:   { name: 'Arch-Vile',       cat: 'enemy',   r: 20 },
  66:   { name: 'Revenant',        cat: 'enemy',   r: 20 },
  67:   { name: 'Mancubus',        cat: 'enemy',   r: 48 },
  68:   { name: 'Arachnotron',     cat: 'enemy',   r: 64 },
  69:   { name: 'Hell Knight',     cat: 'enemy',   r: 24 },
  71:   { name: 'Pain Elemental',  cat: 'enemy',   r: 31 },
  84:   { name: 'Wolfenstein SS',  cat: 'enemy',   r: 20 },
  // Weapons
  2005: { name: 'Chainsaw',        cat: 'weapon',  r: 10 },
  2001: { name: 'Shotgun',         cat: 'weapon',  r: 10 },
  82:   { name: 'Super Shotgun',   cat: 'weapon',  r: 10 },
  2002: { name: 'Chaingun',        cat: 'weapon',  r: 10 },
  2003: { name: 'Rocket Launcher', cat: 'weapon',  r: 10 },
  2004: { name: 'Plasma Rifle',    cat: 'weapon',  r: 10 },
  2006: { name: 'BFG 9000',        cat: 'weapon',  r: 10 },
  // Ammo
  2007: { name: 'Clip',            cat: 'ammo',    r: 10 },
  2048: { name: 'Box of Bullets',  cat: 'ammo',    r: 10 },
  2008: { name: 'Shells',          cat: 'ammo',    r: 10 },
  2049: { name: 'Box of Shells',   cat: 'ammo',    r: 10 },
  2010: { name: 'Rocket',          cat: 'ammo',    r: 10 },
  2046: { name: 'Box of Rockets',  cat: 'ammo',    r: 10 },
  2047: { name: 'Energy Cell',     cat: 'ammo',    r: 10 },
  17:   { name: 'Energy Cell Pack',cat: 'ammo',    r: 10 },
  // Health
  2014: { name: 'Health Bonus',    cat: 'health',  r: 10 },
  2011: { name: 'Stimpack',        cat: 'health',  r: 10 },
  2012: { name: 'Medikit',         cat: 'health',  r: 10 },
  2013: { name: 'Soulsphere',      cat: 'health',  r: 10 },
  83:   { name: 'Megasphere',      cat: 'health',  r: 10 },
  // Armor
  2015: { name: 'Armor Bonus',     cat: 'armor',   r: 10 },
  2018: { name: 'Green Armor',     cat: 'armor',   r: 10 },
  2019: { name: 'Blue Armor',      cat: 'armor',   r: 10 },
  // Keys
  5:    { name: 'Blue Keycard',    cat: 'key',     r: 10 },
  13:   { name: 'Red Keycard',     cat: 'key',     r: 10 },
  6:    { name: 'Yellow Keycard',  cat: 'key',     r: 10 },
  40:   { name: 'Blue Skull Key',  cat: 'key',     r: 10 },
  38:   { name: 'Red Skull Key',   cat: 'key',     r: 10 },
  39:   { name: 'Yellow Skull Key',cat: 'key',     r: 10 },
  // Power-ups
  2022: { name: 'Invulnerability', cat: 'powerup', r: 10 },
  2023: { name: 'Berserk',         cat: 'powerup', r: 10 },
  2024: { name: 'Invisibility',    cat: 'powerup', r: 10 },
  2025: { name: 'Radiation Suit',  cat: 'powerup', r: 10 },
  2026: { name: 'Computer Map',    cat: 'powerup', r: 10 },
  2045: { name: 'Light Goggles',   cat: 'powerup', r: 10 },
};

export const CAT_COLOR = {
  player:  '#0f0',
  enemy:   '#f44',
  weapon:  '#fa0',
  ammo:    '#f80',
  health:  '#4af',
  armor:   '#4ff',
  key:     '#ff4',
  powerup: '#f4f',
};

export const FLAG_BITS = [
  { bit: 1,  label: 'Impassable' },
  { bit: 4,  label: 'Two-Sided'  },
  { bit: 16, label: 'Upper Unpeg'},
  { bit: 32, label: 'Lower Unpeg'},
];
