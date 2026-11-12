import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

const root = fileURLToPath(new URL('.', import.meta.url));

/**
 * Expands `<!-- @include name key="value" -->` comments in the HTML entry
 * points with the matching file from `partials/`, so every page shares one
 * copy of the document head and site header.
 *
 * `current="<id>"` marks the nav link with id `nav-<id>` as the active page.
 */
function htmlPartials(): Plugin {
  const partialsDir = resolve(root, 'partials');
  const pattern = /<!--\s*@include\s+([\w-]+)((?:\s+[\w-]+="[^"]*")*)\s*-->/g;

  return {
    name: 'html-partials',
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        return html.replace(pattern, (_match, name: string, rawAttrs: string) => {
          let partial = readFileSync(resolve(partialsDir, `${name}.html`), 'utf8').trimEnd();
          const current = /current="([^"]*)"/.exec(rawAttrs)?.[1];
          if (current) {
            partial = partial.replace(`id="nav-${current}"`, `id="nav-${current}" aria-current="page"`);
          }
          return partial;
        });
      },
    },
    handleHotUpdate({ file, server }) {
      if (file.startsWith(partialsDir)) {
        server.ws.send({ type: 'full-reload' });
      }
    },
  };
}

export default defineConfig({
  plugins: [htmlPartials()],
  base: '/NASA/',
  build: {
    outDir: 'dist',
    sourcemap: true,
    emptyOutDir: true,
    // three.js alone is ~520 kB minified and is only loaded by the two 3D pages.
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('/node_modules/three/')) return 'three';
          if (/\/node_modules\/(react|react-dom|scheduler)\//.test(id)) return 'react';
          return undefined;
        },
      },
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
  },
});
