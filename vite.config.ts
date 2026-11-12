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

/** Public address of the deployed site; absolute URLs in the head are built from it. */
const SITE_URL = (process.env.SITE_URL ?? 'https://lively-haze-4b2c.hicksrch.workers.dev').replace(/\/+$/, '');

/** What each page says about itself to search engines and link previews. */
const PAGE_META: Record<string, { path: string; description: string }> = {
  'index.html': {
    path: '/',
    description:
      'Today from NASA and JPL: the astronomy picture of the day, where the space station is, asteroids passing Earth, open natural events and this week\u2019s solar eruptions.',
  },
  'neo3d.html': {
    path: '/neo3d',
    description:
      'The solar system in 3D with the asteroids and comets passing Earth, propagated from JPL orbital elements. Look up any numbered asteroid or comet in JPL\u2019s small-body database.',
  },
  'sat3d.html': {
    path: '/sat3d',
    description:
      'Live positions of the International Space Station and tracked satellites around a day and night Earth, computed in the browser from current orbital elements.',
  },
  'storm.html': {
    path: '/storm',
    description:
      'Coronal mass ejections from NASA\u2019s DONKI catalogue: speed, direction, predicted arrival at Earth and the geomagnetic storm that followed.',
  },
  'events.html': {
    path: '/events',
    description:
      'Wildfires, storms, volcanoes and icebergs under watch right now, mapped from NASA\u2019s Earth Observatory Natural Event Tracker.',
  },
  'exo.html': {
    path: '/exo',
    description:
      'Every confirmed exoplanet in the NASA Exoplanet Archive: filter by size, orbit and discovery method, and compare worlds on a mass and radius chart.',
  },
  '404.html': { path: '/404', description: 'This page does not exist.' },
};

const escapeAttr = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/**
 * Adds the description, canonical address and link-preview tags to each page,
 * taking the title from the page's own `<title>`.
 */
function pageMeta(): Plugin {
  return {
    name: 'page-meta',
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        const file = ctx.filename.split(/[\\/]/).pop() ?? '';
        const meta = PAGE_META[file];
        if (!meta) return html;
        const title = /<title>([^<]*)<\/title>/.exec(html)?.[1].trim() ?? 'NASA Open APIs Visualization Hub';
        const url = `${SITE_URL}${meta.path}`;
        const description = escapeAttr(meta.description);
        const tags = [
          `<meta name="description" content="${description}" />`,
          `<meta name="theme-color" content="#0b0b0c" />`,
          ...(file === '404.html'
            ? [`<meta name="robots" content="noindex" />`]
            : [
                `<link rel="canonical" href="${url}" />`,
                `<meta property="og:type" content="website" />`,
                `<meta property="og:site_name" content="NASA Open APIs Visualization Hub" />`,
                `<meta property="og:title" content="${escapeAttr(title)}" />`,
                `<meta property="og:description" content="${description}" />`,
                `<meta property="og:url" content="${url}" />`,
                `<meta property="og:image" content="${SITE_URL}/og.jpg" />`,
                `<meta property="og:image:width" content="1200" />`,
                `<meta property="og:image:height" content="630" />`,
                `<meta property="og:image:alt" content="Earth rising over the Moon, painted in flat colour." />`,
                `<meta name="twitter:card" content="summary_large_image" />`,
              ]),
        ];
        // The two faces every page sets text in. Preloading them means headings and
        // body copy paint in their own type instead of swapping a moment later.
        const base = process.env.SITE_BASE ?? '/NASA/';
        for (const name of Object.keys(ctx.bundle ?? {})) {
          if (/(archivo-latin-wdth-normal|source-serif-4-latin-opsz-normal)-[\w-]+\.woff2$/.test(name)) {
            tags.push(`<link rel="preload" href="${base}${name}" as="font" type="font/woff2" crossorigin />`);
          }
        }
        return html.replace('</head>', `    ${tags.join('\n    ')}\n  </head>`);
      },
    },
  };
}

export default defineConfig({
  plugins: [htmlPartials(), pageMeta()],
  // GitHub Pages serves the site under /NASA/; the Cloudflare build sets SITE_BASE=/.
  base: process.env.SITE_BASE ?? '/NASA/',
  build: {
    outDir: 'dist',
    sourcemap: true,
    emptyOutDir: true,
    // three.js alone is ~520 kB minified and is only loaded by the two 3D pages. Rollup
    // splits shared code by itself; naming a vendor chunk by hand once pulled React
    // into pages that never use it.
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      input: {
        index: 'index.html',
        neo3d: 'neo3d.html',
        sat3d: 'sat3d.html',
        storm: 'storm.html',
        events: 'events.html',
        exo: 'exo.html',
        notFound: '404.html',
      },
    },
  },
  server: {
    strictPort: true,
    port: 5173,
  },
});
