import { defineConfig, type Plugin } from 'vite';
import { cpSync, existsSync, rmSync, statSync, createReadStream } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function staticStylesPlugin(): Plugin {
  const projectRoot = fileURLToPath(new URL('.', import.meta.url));
  const stylesDir = resolve(projectRoot, 'styles');
  const distDir = resolve(projectRoot, 'dist/styles');
  const prefix = '/NASA/styles/';

  return {
    name: 'static-styles',
    closeBundle() {
      if (!existsSync(stylesDir)) {
        return;
      }
      rmSync(distDir, { recursive: true, force: true });
      cpSync(stylesDir, distDir, { recursive: true });
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url || (req.method && req.method !== 'GET' && req.method !== 'HEAD')) {
          next();
          return;
        }
        const [pathName] = req.url.split('?');
        if (!pathName || !pathName.startsWith(prefix)) {
          next();
          return;
        }
        const relative = pathName.slice(prefix.length);
        if (!relative) {
          next();
          return;
        }
        const filePath = join(stylesDir, decodeURIComponent(relative));
        if (!existsSync(filePath) || !statSync(filePath).isFile()) {
          res.statusCode = 404;
          res.end();
          return;
        }
        res.setHeader('Content-Type', 'text/css; charset=utf-8');
        createReadStream(filePath).pipe(res);
        return;
      });
    },
  };
}

export default defineConfig({
  plugins: [staticStylesPlugin()],
  base: '/NASA/',
  build: {
    outDir: 'dist',
    sourcemap: true,
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: 'index.html',
        neo3d: 'neo3d.html',
        sat3d: 'sat3d.html',
        storm: 'storm.html',
        events: 'events.html',
        exo: 'exo.html',
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
