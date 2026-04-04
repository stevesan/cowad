import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  root: '.',
  server: { port: 5173 },
  test: {
    setupFiles: ['tests/unit/setup.ts'],
  },
});
