# NASA Open APIs Visualization Hub — Master Orchestration

## Mission Profile
Static Vite + TypeScript visualization portal for api.nasa.gov data, deployed to GitHub Pages via gh-pages branch using Cloudflare Worker proxy (worker.js) with secret NASA_API.

## Agent Mandates
- **PLAN_AGENT** establishes src layout, module taxonomy, and strict TypeScript schemas for each NASA endpoint (APOD, Mars Rover, EPIC, NEO, TechPort, Images, ISS, etc.). Output: architecture map, updated tsconfig, typed stubs in `src/types/nasa.ts`.
- **PIPELINE_AGENT** locks toolchain (Node 20.x, pnpm ≥8, Vite 5.x), provisions pnpm workspace config if needed, wires canonical scripts, and enforces build order: `pnpm install --frozen-lockfile` → `pnpm lint` → `pnpm build` → `pnpm preview` (smoke). Retries failed builds for downstream agents.
- **FETCH_AGENT** authors modular fetchers under `src/api/` that call the Cloudflare Worker proxy exclusively, normalizing responses via `src/api/nasaClient.ts`, registering client-side caching (IndexedDB preferred, localStorage fallback).
- **UI_AGENT** curates navigation, routes, layout scaffolding in `src/routes/`, `src/components/`, and `src/styles/`, using vanilla TypeScript, DOM APIs, and system sans-serif typography.
- **VIS_AGENT** delivers reusable D3 visual modules in `src/visuals/` implementing: APOD fade viewer, Mars rover gallery grid, NEO orbit SVG, EPIC rotator, TechPort timeline. Animations limited to transform/opacity; enforce responsive grids.
- **ACTIONS_AGENT** maintains `.github/workflows/pages.yml` with canonical GitHub Pages pipeline (checkout, pnpm setup, install, build, upload artifact, deploy) plus concurrency gate and pnpm cache.
- **META_AGENT** governs repository documents: `README.md`, `sitemap.xml`, `robots.txt`, canonical meta tags, and SEO compliance with NASA open data policy.

## Canonical Stack
- Node 20.x runtime; pnpm ≥8 as the package manager; Vite 5.x bundler; TypeScript strict mode; latest D3.js; eslint + prettier rules matching NBA Intelligence Hub presets.
- Base path in `vite.config.ts`: `/NASA/`.
- Build output folder: `dist/`; deployment branch: `gh-pages`.

```text
src/
  api/
  components/
  visuals/
  routes/
  styles/
  utils/
assets/
public/
```

## Data Pipeline Specification
- Worker proxy endpoints (e.g., `/apod`, `/mars/curiosity/photos`, `/neo/feed`, `/epic/natural`, `/images/search`, `/techport/api/projects`) are the sole data source.
- `src/api/nasaClient.ts` centralizes fetch, error handling, rate limiting, and caching strategy registration.
- Endpoint-specific fetch modules (e.g., `fetch_apod.ts`, `fetch_mars.ts`) import the client, expose typed functions, and persist data in IndexedDB; fall back to localStorage for static assets.
- Define comprehensive TypeScript interfaces and enums in `src/types/nasa.ts` with strict mode enabled; synchronize with Worker response schemas.

## Visual System
- Palette: NASA Blue `#0B3D91`, Jet Black `#000000`, White `#FFFFFF`, Light Gray `#D9E3F0`.
- Typography: Inter, Segoe UI, Helvetica Neue, system sans-serif fallback.
- Layout: responsive CSS grid with flexbox fallback; spacing and rhythm documented in `src/styles/tokens.css` (create if absent).
- D3 modules export pure render/update functions, accept configuration objects, and avoid global state. Only transform/opacity animations permitted.

## GitHub Actions Protocol
- `.github/workflows/pages.yml` executes: `actions/checkout@v4` → `pnpm/action-setup@v3` (Node 20 + pnpm) → `pnpm install --frozen-lockfile` → `pnpm lint` → `pnpm build` → `actions/upload-pages-artifact@v3` → `actions/deploy-pages@v4`.
- Add `concurrency: group: deploy, cancel-in-progress: true`.
- Cache path: `~/.pnpm-store` using pnpm/action-setup caching.
- Workflow triggers: push to `main`, manual dispatch; deployment outputs to GitHub Pages environment.

## Command Charter
- `pnpm dev` → local development with Vite.
- `pnpm lint` → eslint + prettier.
- `pnpm build` → production bundle.
- `pnpm preview` → serve `dist/` for QA.
- `pnpm deploy` → optional manual push to gh-pages (must align with workflow expectations).

## Execution Order
1. PLAN_AGENT
2. PIPELINE_AGENT
3. FETCH_AGENT
4. UI_AGENT
5. VIS_AGENT
6. ACTIONS_AGENT
7. META_AGENT

Each agent commits its scope, runs `pnpm build`, and hands off. Failures requeue to PIPELINE_AGENT before proceeding.

## Deployment Doctrine
- GitHub Pages hosts final assets; no Cloudflare Pages usage.
- Worker proxy remains the single backend; ensure NASA_API secret configured via Cloudflare dashboard and referenced in `worker.js`.
- `pnpm build` must produce deterministic output for GitHub Actions artifact.

## Future Extensions
- PLAN_AGENT tracks roadmap items: mission timelines (Voyager, Artemis, Webb), Mapbox/Cesium orbital layers, real-time ISS data, `/labs` experimental route, JSON data snapshots. Schedule only after baseline visualizations stable.

