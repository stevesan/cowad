const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
