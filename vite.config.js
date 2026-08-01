import { defineConfig } from 'vite';

// Relative base so the build can be dropped into a CrazyGames / Poki
// subdirectory without rewriting asset URLs.
export default defineConfig({
  base: './',
  build: {
    target: 'es2020',
    outDir: 'dist',
    assetsInlineLimit: 8192,
  },
  server: {
    host: true,
    port: 5173,
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
  },
});
