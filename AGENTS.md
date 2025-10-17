# NASA Open APIs Visualization Hub — Master Orchestration

## Mission Profile
Static Vite + TypeScript orbital visualization portal for api.nasa.gov and JPL Horizons data, deployed to GitHub Pages via gh-pages branch using Cloudflare Worker proxy (`worker.js`) with secret NASA_API. Scope now spans full solar system mapping (planets, moons) via Horizons, near-Earth/comet objects via SBDB + orbital propagation, and heliocentric/geocentric transformations feeding the 3D canvas.

## Agent Mandates
- **PLAN_AGENT** defines module map covering `src/api/`, `src/orbits/`, `src/neo3d/`, `src/visuals/`, and `src/api/horizonsClient.ts`; delivers deterministic numerical propagation scaffolding, strict tsconfig, and typed stubs for Horizons, SBDB, and NASA endpoints.
- **PIPELINE_AGENT** locks toolchain (Node 20.x, pnpm ≥8, Vite 5.x), wires canonical scripts, and enforces deterministic builds for app and worker (`pnpm install --frozen-lockfile` → `pnpm lint` → `pnpm build` → `pnpm preview`). Runs smoke calls against `/horizons` and `/sbdb` to validate worker pipeline.
- **FETCH_AGENT** authors modular fetchers under `src/api/`, enforcing Cloudflare Worker exclusivity (`/horizons`, `/sbdb`, `/neo/browse`, `/images/search`), normalizing responses in `src/api/nasaClient.ts`, and securing the NASA key. Rejects unauthenticated NEO browse with `{ ok: false, status: 401 }` while allowing UI continuity.
- **UI_AGENT** curates navigation, route state, and visual controls in `src/routes/`, `src/components/`, and `src/styles/`, managing inputs for Add ATLAS, Time Scale, and UTC Date selection.
- **VIS_AGENT** expands D3-based systems under `src/visuals/` and `src/neo3d/`, adds `neo3d.ts` for orbit rendering, interpolation, and camera tracking, and integrates the error-tolerant Horizons vector parser.
- **ACTIONS_AGENT** maintains `.github/workflows/pages.yml`, GitHub Actions concurrency guard, pnpm cache, deterministic artifact verification, and worker healthcheck (`curl $WORKER_URL`).
- **META_AGENT** governs repository documents, adds Worker proxy documentation, Horizons/SBDB references, and ensures SEO compliance with NASA open data policy.

## Canonical Stack
- Node 20.x runtime; pnpm ≥8; Vite 5.x; TypeScript strict mode; D3 v7+; eslint + prettier using NBA Intelligence Hub presets.
- Base path in `vite.config.ts`: `/NASA/`.
- Build output folder: `dist/`; deployment branch: `gh-pages`.
- Canonical structure:

```text
src/
  api/
  orbits/
  neo3d/
  visuals/
  components/
  routes/
  styles/
  utils/
assets/
public/
```

- Planetary and NEO vectors expressed in AU with velocities in AU/day; timestamps in UTC.

## Data Pipeline Specification
- Cloudflare Worker (`worker.js`) is authoritative for all external calls: `/horizons`, `/sbdb`, `/neo/browse`, `/images/search`, and legacy NASA endpoints. Worker parses Horizons `EPHEM_TYPE=VECTORS`, extracting `X,Y,Z,VX,VY,VZ` between `$$SOE` / `$$EOE` with `'YYYY-MM-DD HH:MM:SS'` timestamps.
- Worker enforces NASA_API secrecy and rejects unauthenticated `/neo/browse` with graceful `{ ok:false, status:401 }` responses. UI treats 401 as non-blocking event.
- SBDB comet requests default fallback `sstr=3I` (3I/ATLAS) when specific targets fail; responses normalized before returning to the client.
- `src/api/nasaClient.ts` centralizes fetch, error handling, rate limiting, caching (IndexedDB preferred, localStorage fallback), and response normalization.
- Endpoint-specific modules import the client, expose typed functions, and store deterministic payloads for visualization and propagation.

## Orbital Visualization System
- Palette: NASA Blue `#0B3D91`, Jet Black `#000000`, White `#FFFFFF`, Light Gray `#D9E3F0`.
- Typography: Inter, Segoe UI, Helvetica Neue, system sans-serif fallback.
- Layout: responsive CSS grid with flexbox fallback; spacing documented in `src/styles/tokens.css` (create if absent).
- 3D canvas renders heliocentric ecliptic J2000 coordinates; D3 modules export pure render/update functions, accept configuration objects, and avoid global state. Animations limited to transform/opacity; enforce finite-value guards before drawing segments.

## GitHub Actions Protocol
- `.github/workflows/pages.yml` executes: `actions/checkout@v4` → `pnpm/action-setup@v3` (Node 20 + pnpm) → `pnpm install --frozen-lockfile` → `pnpm lint` → `pnpm build` → `actions/upload-pages-artifact@v3` → `actions/deploy-pages@v4`.
- Add `concurrency: { group: deploy, cancel-in-progress: true }`.
- Cache path: `~/.pnpm-store` via pnpm/action-setup caching.
- Include Worker healthcheck `curl $WORKER_URL` post-build; verify deterministic dist/ checksums.
- Workflow triggers: push to `main`, manual dispatch; deployment outputs to GitHub Pages environment.

## Command Charter
- `pnpm dev` → local development with Vite.
- `pnpm lint` → eslint + prettier.
- `pnpm build` → production bundle (deterministic).
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

Each agent commits its scope, runs `pnpm build`, validates worker healthcheck, and hands off. Failures requeue to PIPELINE_AGENT before proceeding.

## Deployment Doctrine
- GitHub Pages hosts final assets; no Cloudflare Pages usage.
- Worker proxy remains the single backend; ensure NASA_API secret configured via Cloudflare dashboard and referenced in `worker.js`.
- `pnpm build` must produce deterministic output for GitHub Actions artifact and align with local checksum.

## Simulation Doctrine
- Orbital reference frame: heliocentric ecliptic J2000, UTC timestamps.
- Horizons vectors and SBDB orbital elements feed the universal conic propagator. Static vector mode renders raw Horizons state vectors; dynamic Keplerian mode propagates SBDB elements via conic solver.
- Propagation supports elliptic (0 < e < 1), parabolic (e = 1), and hyperbolic (e > 1) orbits, computing E, D, or H anomalies accordingly before converting to heliocentric coordinates. Heliocentric states transform to geocentric when required for UI overlays.

## Future Extensions
- PLAN_AGENT tracks roadmap items: mission timelines (Voyager, Artemis, Webb), Mapbox/Cesium orbital layers, real-time ISS data, `/labs` experimental route, JSON data snapshots, and adaptive light/dark themes.

## Mathematical Appendix
- Gaussian gravitational constant `k = 0.01720209895` (AU³/day²) for universal conic propagation.
- Units: distances in astronomical units, velocities in AU/day, timestamps `'YYYY-MM-DD HH:MM:SS'` UTC.
- Numerical safeguards: reject NaN/∞ states prior to render, clamp propagation steps to finite intervals, and log vector parse anomalies without blocking UI updates.

