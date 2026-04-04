#!/usr/bin/env node
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const readline = require('readline');

// When packaged with pkg, __dirname points to a snapshot filesystem that isn't
// writable. Use the directory where the executable lives instead for config and
// temp files.
const APP_DIR = process.pkg ? path.dirname(process.execPath) : __dirname;
const CONFIG_PATH = path.join(APP_DIR, 'config.json');
const PORT = 3666;

// ── WAD parsing ──

function detectMap(wadBuffer) {
  // WAD header: 4 bytes id, 4 bytes numLumps, 4 bytes dirOffset (all little-endian)
  if (wadBuffer.length < 12) return { game: 'doom2', mapName: 'MAP01' };

  const numLumps = wadBuffer.readUInt32LE(4);
  const dirOffset = wadBuffer.readUInt32LE(8);

  // Each directory entry: 4 bytes offset, 4 bytes size, 8 bytes name
  for (let i = 0; i < numLumps; i++) {
    const entryOffset = dirOffset + i * 16;
    if (entryOffset + 16 > wadBuffer.length) break;

    const nameRaw = wadBuffer.slice(entryOffset + 8, entryOffset + 16);
    const name = nameRaw.toString('ascii').replace(/\0+$/, '').toUpperCase();

    if (/^E\dM\d$/.test(name)) return { game: 'doom1', mapName: name };
    if (/^MAP\d\d$/.test(name)) return { game: 'doom2', mapName: name };
  }

  return { game: 'doom2', mapName: 'MAP01' }; // default fallback
}

// ── Config ──

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch {
    return null;
  }
}

function saveConfig(cfg) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2) + '\n');
}

function cleanPath(p) {
  return p.replace(/^["']+|["']+$/g, '');
}

async function promptRaw(rl, question, defaultVal) {
  return new Promise(resolve => {
    const suffix = defaultVal ? ` [${defaultVal}]` : '';
    rl.question(question + suffix + ': ', answer => {
      resolve(answer.trim() || defaultVal || '');
    });
  });
}

async function promptPath(rl, question, defaultVal, allowBlank) {
  while (true) {
    const raw = await promptRaw(rl, question, defaultVal);
    const p = cleanPath(raw);
    if (!p && allowBlank) return '';
    if (!p) {
      console.error('  Path is required — try again.');
      continue;
    }
    if (!fs.existsSync(p)) {
      console.error(`  Not found: ${p} — try again.`);
      continue;
    }
    try {
      fs.accessSync(p, fs.constants.R_OK);
    } catch {
      console.error(`  Cannot read: ${p} — check permissions and try again.`);
      continue;
    }
    return p;
  }
}

async function configure() {
  const existing = loadConfig() || {};
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  console.log('\n=== DOOM Launcher Configuration ===\n');

  const cfg = {};
  cfg.portPath = await promptPath(rl, 'Path to GZDoom (or other source port)', existing.portPath, false);
  cfg.doom1Wad = await promptPath(rl, 'Path to DOOM 1 IWAD (doom.wad, blank to skip)', existing.doom1Wad, true);
  cfg.doom2Wad = await promptPath(rl, 'Path to DOOM 2 IWAD (doom2.wad, blank to skip)', existing.doom2Wad, true);

  rl.close();

  saveConfig(cfg);
  console.log(`\nConfig saved to ${CONFIG_PATH}\n`);
  return cfg;
}

// ── Launch ──

let childProc = null;

function launch(cfg, wadBuffer, spawnPos) {
  const { game, mapName } = detectMap(wadBuffer);
  const iwad = game === 'doom1' ? cfg.doom1Wad : cfg.doom2Wad;
  console.log(`Detected: ${game} ${mapName} | IWAD: ${path.basename(iwad)}`);

  const tempWad = path.join(APP_DIR, crypto.randomUUID() + '.wad');
  fs.writeFileSync(tempWad, wadBuffer);

  // Kill previous instance if still running
  if (childProc && !childProc.killed) {
    console.log('Killing previous GZDoom instance...');
    childProc.kill();
  }

  const args = ['-iwad', iwad, '-file', tempWad, '+map', mapName];
  if (spawnPos) {
    args.push(`+warp ${spawnPos.x} ${spawnPos.y}`);
    console.log(`Spawn position: ${spawnPos.x}, ${spawnPos.y}`);
  }
  console.log(`Launching: ${cfg.portPath} ${args.join(' ')}`);

  childProc = execFile(cfg.portPath, args, (err) => {
    if (err && err.killed) return; // we killed it
    if (err) console.error('Launch error:', err.message);
    else console.log('GZDoom exited.');
    try { fs.unlinkSync(tempWad); } catch {}
  });

  childProc.unref();
}

// ── Server ──

function startServer(cfg) {
  const server = http.createServer((req, res) => {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const parsedUrl = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === 'POST' && parsedUrl.pathname === '/launch') {
      const chunks = [];
      req.on('data', chunk => chunks.push(chunk));
      req.on('end', () => {
        const wadBuffer = Buffer.concat(chunks);
        console.log(`\nReceived WAD: ${wadBuffer.length} bytes`);

        // Parse optional spawn position from query string
        const qx = parsedUrl.searchParams.get('x');
        const qy = parsedUrl.searchParams.get('y');
        const spawnPos = qx != null && qy != null ? { x: parseInt(qx, 10), y: parseInt(qy, 10) } : null;

        try {
          const { game, mapName } = detectMap(wadBuffer);
          launch(cfg, wadBuffer, spawnPos);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, game, mapName }));
        } catch (err) {
          console.error('Launch failed:', err.message);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: err.message }));
        }
      });
      return;
    }

    // Health check
    if (req.method === 'GET' && req.url === '/status') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    res.writeHead(404);
    res.end('Not found');
  });

  server.listen(PORT, '127.0.0.1', () => {
    console.log(`DOOM launcher listening on http://127.0.0.1:${PORT}`);
    console.log('Waiting for WADs...\n');
  });
}

// ── Main ──

async function main() {
  const reconfigure = process.argv.includes('--config');
  let cfg = loadConfig();

  if (!cfg || reconfigure) {
    cfg = await configure();
  } else {
    console.log('Using saved config. Run with --config to reconfigure.\n');
  }

  startServer(cfg);
}

main();
