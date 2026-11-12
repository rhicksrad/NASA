This codebase is yours; what it's for and how it's built are your call, and you'll keep building on it.

# NASA Open APIs Visualization Hub

A static, multi-page site that turns public NASA and JPL data into interactive explorers. GitHub
Pages serves the site from `/NASA/`. One Cloudflare Worker (`worker.js`) is the only backend: it
holds the NASA API key, proxies NASA/JPL/DONKI/EONET/TLE/Exoplanet Archive, and renders a few
Markdown reports. The browser talks to the Worker and nothing else, with one deliberate exception
(EPIC falls back to `epic.gsfc.nasa.gov` when the Worker route fails).

## Commands

| Command | What it does |
| --- | --- |
| `pnpm dev` | Vite dev server on :5173 |
| `pnpm typecheck` | `tsc --noEmit` (strict, no unused locals or parameters) |
| `pnpm lint` | ESLint over the repo |
| `pnpm build` | Production bundle in `dist/` |
| `pnpm test` | Playwright smoke test of every page against mocked network |
| `pnpm screenshots` | Same run, also writing a PNG per page to `artifacts/screenshots/` |
| `pnpm check` | typecheck, lint, build and test, in that order |

Node 20+, pnpm 9+. CI (`.github/workflows/ci.yml`) runs `pnpm check` on every pull request;
`pages.yml` builds and deploys `main`.

## Layout

```
*.html              One entry per page. Shared head and header come from partials/.
partials/           HTML fragments pulled in with <!-- @include name current="id" -->
                    (expanded by the htmlPartials plugin in vite.config.ts).
src/api/            Typed clients, one per upstream. Everything goes through api/worker.ts.
src/lib/            Small shared helpers: dom, markdown, toast, julian, icons, persistentCache.
src/orbits/         Kepler and universal-conic propagation (AU, days, heliocentric ecliptic J2000).
src/shell/          Site navigation behaviour shared by every page.
src/pages/<page>/   One folder per page; main.ts is the entry the HTML loads.
  hub/              index.html: hash router for home (home/), Images Explorer, EPIC, Mars, About.
  neo3d/            Heliocentric scene (scene/), SBDB search (sbdb/, React), panel logic.
  sat3d/            SGP4 satellite tracker around a day/night Earth.
  storm/ events/ exo/   CME reports, EONET map (Leaflet), exoplanet archive queries.
src/styles/         All CSS. base.css (tokens, theme, components) loads on every page.
tests/              smoke.spec.ts plus support/mockApi.ts, the fixture server for every upstream.
data/sbdb-source/   Raw MPC dumps used by scripts/build_sbdb_index.py. Never shipped.
src/assets/         Generated data modules (world land outline from scripts/build_world_land.mjs).
public/             Copied verbatim into the build (favicon, sbdb-index.json).
public/art/         Illustration set (WebP): one plate and one icon per explorer, bg/ backgrounds,
                    ui/ empty and offline states. Flat gouache, five colours (ink, bone, NASA red,
                    insignia blue, ochre). New art must match that set; `stateArt()` in src/lib/dom.ts
                    renders the ui/ states and `.page-banner` (src/styles/header.css) the page plates.
tools/ci/           Self-hosted runner setup and the CI manual (README.md). The repo variable
                    CI_RUNNER=local sends trusted jobs to Ryan's PCs; unset means GitHub's runners.
worker.js           Cloudflare Worker source. Deployed by hand; not part of the site build.
```

## Conventions

- **Network:** never call `fetch` from a page. Add or extend a client in `src/api/` and use
  `fetchJson` / `fetchText` from `api/worker.ts`, which give you timeouts, abort signals and
  `HttpError(url, status, bodyText)`. Pass an `AbortSignal` for anything a newer request can
  supersede.
- **Untrusted text:** API strings go through `escapeHtml` (or `textContent`) before reaching the
  DOM. `renderMarkdown` escapes first and then formats.
- **Coordinate frames:** three.js is Y-up; the physics is Z-up. NEO 3D converts in `toScene`
  (`scene/types.ts`). Satellite 3D takes ECI positions and rotates them inside `EarthScene`
  (`eciGroup`). Do not hand-swap axes anywhere else.
- **Units:** heliocentric work is AU and days with Gaussian `k = 0.01720209895`; satellite work is
  km and km/s; timestamps are UTC.
- **Debug handles** (`window.__neo3d`, `window.__wow`) exist only in dev builds.
- **New page:** add `<name>.html` using the two partial includes, a `src/pages/<name>/main.ts`
  that calls `initSiteNav()`, an input in `vite.config.ts`, a nav link in
  `partials/site-header.html`, fixtures in `tests/support/mockApi.ts` and a case in
  `tests/smoke.spec.ts`.

## Testing

The smoke tests fail on any uncaught page error and on any request that has no fixture, so a new
endpoint needs a fixture in `mockApi.ts`. They do not hit the real Worker; check a change that
depends on live data against the deployed site as well.

## Pull requests

Every pull request includes a screenshot of the rendered UI it touches. `pnpm screenshots`
produces them; refresh `docs/preview.png` when the overall look changes.

## Worker

`worker.js` is a classic service-worker script deployed manually to
`https://lively-haze-4b2c.hicksrch.workers.dev` with the secret `NASA_API`. Routes: `/apod`,
`/neo/*`, `/mars/*`, `/epic/*`, `/images/*`, `/nasa/*`, `/storm/find`, `/storm/{id}.json|.md`,
`/eonet/*`, `/event/{id}.md`, `/horizons`, `/sbdb`, `/sbdb/object|suggest|search`, `/tle/search`,
`/tle/{id}`, `/exo/tap`, `/diag`. Changing it means redeploying it in Cloudflare; merging to
`main` does not.
