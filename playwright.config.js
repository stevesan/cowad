const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  webServer: {
    command: 'npx vite --port 5173',
    port: 5173,
    reuseExistingServer: true,
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
