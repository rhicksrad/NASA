import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

const neoHtmlPlugin = (): Plugin => ({
  name: 'neo-html-serve',
  configureServer(server) {
    return () => {
      server.middlewares.use((req, _res, next) => {
        if (req?.url === '/NASA/neo.html') {
          req.url = '/neo.html';
        }
        next();
      });
    };
  },
});

export default defineConfig({
  base: '/NASA/',
  plugins: [neoHtmlPlugin()],
  build: {
    outDir: 'dist',
    sourcemap: true,
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        neo: resolve(__dirname, 'neo.html'),
      },
    },
  },
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
