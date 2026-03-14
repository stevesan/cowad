const { test, expect } = require('@playwright/test');
const { pathToFileURL } = require('url');
const path = require('path');

const PAGE_URL = pathToFileURL(path.resolve(__dirname, '..', 'index.html')).toString();

// Injected before page scripts. Replaces Firebase with a mock that:
//  - stores listeners at window._on[path][event]
//  - fires child_added synchronously when push() is called
//  - returns Promises from push/set/remove so .catch() handlers work
function firebaseMock() {
  window._on = {};

  const makeRef = (refPath) => {
    const ref = {
      on: (event, cb) => {
        if (!window._on[refPath]) window._on[refPath] = {};
        window._on[refPath][event] = cb;
        if (event === 'value') {
          if (refPath === '.info/connected') cb({ val: () => true });
          else cb({ val: () => null, numChildren: () => 0 });
        }
        return ref;
      },
      push: (data) => {
        const key = 'k' + Math.random().toString(36).slice(2, 8);
        const cb  = window._on[refPath] && window._on[refPath]['child_added'];
        if (cb) cb({ key, val: () => data });
        return Promise.resolve({ key });
      },
      set:    () => Promise.resolve(),
      remove: () => Promise.resolve(),
      onDisconnect: () => ({ remove: () => {} }),
    };
    return ref;
  };

  window.firebase = {
    initializeApp: () => {},
    database: () => ({ ref: (p) => makeRef(p || '') }),
  };
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(firebaseMock);
  // Use a function matcher to reliably catch all Firebase CDN URLs regardless of version/path.
  await page.route(/firebasejs/, route =>
    route.fulfill({ status: 200, contentType: 'application/javascript', body: '' })
  );
  await page.goto(PAGE_URL);
  // Wait until the app's inline script has run and registered the Firebase listeners.
  await page.waitForFunction(() =>
    window._on && window._on['todos'] && typeof window._on['todos']['child_added'] === 'function'
  );
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function injectTodo(page, key, text, done = false) {
  return page.evaluate(({ key, text, done }) => {
    window._on['todos']['child_added']({ key, val: () => ({ text, done, createdAt: 1 }) });
  }, { key, text, done });
}

function remoteChange(page, key, text, done = false) {
  return page.evaluate(({ key, text, done }) => {
    window._on['todos']['child_changed']({ key, val: () => ({ text, done, createdAt: 2 }) });
  }, { key, text, done });
}

// ── Regression: concurrent edit ───────────────────────────────────────────────

test('shows remote edit after user cancels their own local edit', async ({ page }) => {
  await injectTodo(page, 'todo1', 'original text');

  // User A starts editing
  await page.dblclick('.todo-text');
  await expect(page.locator('.todo-edit')).toBeVisible();

  // User B commits a change while A is still in the edit input
  await remoteChange(page, 'todo1', 'updated by B');

  // User A cancels — should see B's version, not "original text"
  await page.keyboard.press('Escape');
  await expect(page.locator('.todo-text')).toHaveText('updated by B');
});

test('shows remote edit immediately when nobody is editing', async ({ page }) => {
  await injectTodo(page, 'todo1', 'original text');
  await remoteChange(page, 'todo1', 'updated by B');
  await expect(page.locator('.todo-text')).toHaveText('updated by B');
});

// ── Basic todo behaviour ───────────────────────────────────────────────────────

test('shows empty state before any todos', async ({ page }) => {
  await expect(page.locator('#empty')).toBeVisible();
});

test('adding a todo makes it appear in the list', async ({ page }) => {
  await page.fill('#add-input', 'buy milk');
  await page.press('#add-input', 'Enter');
  await expect(page.locator('.todo-text')).toHaveText('buy milk');
  await expect(page.locator('#empty')).toBeHidden();
});

test('input is cleared after adding a todo', async ({ page }) => {
  await page.fill('#add-input', 'buy milk');
  await page.press('#add-input', 'Enter');
  await expect(page.locator('#add-input')).toHaveValue('');
});
