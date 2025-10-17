import { defineConfig } from 'vite';

export default defineConfig({
  base: '/NASA/',
  build: {
    outDir: 'dist',
    sourcemap: true,
    emptyOutDir: true,
  },
  server: {
    strictPort: true,
    port: 5173,
  },
});
