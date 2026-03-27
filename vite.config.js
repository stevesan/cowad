import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  server: { port: 5173 },
  test: {
    setupFiles: ['tests/unit/setup.ts'],
  },
});
