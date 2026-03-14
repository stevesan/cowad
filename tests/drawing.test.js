const { test, expect } = require('@playwright/test');
const { pathToFileURL } = require('url');
const path = require('path');

const PAGE_URL = pathToFileURL(path.resolve(__dirname, '..', 'index.html')).toString();

// Injected before any page script runs — replaces the Firebase SDK with a no-op mock
// so the app initialises without a real network connection.
function firebaseMock() {
  const makeRef = () => {
    const ref = {
      on:          (event, cb) => { if (event === 'value') cb({ val: () => null, numChildren: () => 0 }); return ref; },
      once:        (event, cb) => { cb({ forEach: () => {}, val: () => null }); return ref; },
      push:        ()          => ({ key: Math.random().toString(36).slice(2) }),
      set:         ()          => ref,
      remove:      ()          => ref,
      onDisconnect: ()         => ({ remove: () => {} }),
    };
    return ref;
  };
  window.firebase = {
    initializeApp: () => {},
    database: () => ({ ref: () => makeRef() }),
  };
}

// Returns the number of non-transparent pixels on the canvas.
function countDrawnPixels(page) {
  return page.evaluate(() => {
    const canvas = document.getElementById('canvas');
    const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    let count = 0;
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] > 0) count++;
    }
    return count;
  });
}

// Draw a short diagonal line across the centre of the canvas.
async function drawLine(page) {
  const box = await page.locator('canvas').boundingBox();
  const cx = box.x + box.width  / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx - 60, cy - 40);
  await page.mouse.down();
  await page.mouse.move(cx + 60, cy + 40, { steps: 20 });
  await page.mouse.up();
}

test.beforeEach(async ({ page }) => {
  // Install mock before page scripts, then block the CDN scripts so they
  // can't overwrite window.firebase.
  await page.addInitScript(firebaseMock);
  await page.route('**/gstatic.com/firebasejs/**', route =>
    route.fulfill({ status: 200, contentType: 'application/javascript', body: '' })
  );
  await page.goto(PAGE_URL);
});

// ── Regression: the bug that prompted this test ───────────────────────────────

test('drawn segments survive a window resize', async ({ page }) => {
  await drawLine(page);

  const before = await countDrawnPixels(page);
  expect(before).toBeGreaterThan(0);

  await page.setViewportSize({ width: 900, height: 400 });

  const after = await countDrawnPixels(page);
  expect(after).toBeGreaterThan(0);
});

// ── Related behaviour ─────────────────────────────────────────────────────────

test('canvas is blank before anything is drawn', async ({ page }) => {
  expect(await countDrawnPixels(page)).toBe(0);
});

test('clear wipes the canvas', async ({ page }) => {
  await drawLine(page);
  expect(await countDrawnPixels(page)).toBeGreaterThan(0);

  await page.click('#clearBtn');
  expect(await countDrawnPixels(page)).toBe(0);
});

test('canvas stays blank after clear + resize', async ({ page }) => {
  await drawLine(page);
  await page.click('#clearBtn');

  await page.setViewportSize({ width: 900, height: 400 });
  expect(await countDrawnPixels(page)).toBe(0);
});
