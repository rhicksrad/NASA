import { defineConfig } from 'vite';

export default defineConfig({
  base: '/NASA/',
  build: { outDir: 'dist', sourcemap: true, emptyOutDir: true },
  server: {
    strictPort: true,
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
        rewrite: p => p.replace(/^\/api/, ''),
      },
    },
  },
});
