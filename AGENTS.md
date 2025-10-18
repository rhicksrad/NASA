## Mission Profile

Static Vite + TypeScript orbital visualization portal. GitHub Pages hosts the site; a **single Cloudflare Worker** (`worker.js`) is the only backend/proxy. The Worker fronts:

* **NASA REST** (NEO/EPIC/Mars/Images) at `https://api.nasa.gov` using secret **`NASA_API`**.
* **JPL Horizons** via `/horizons` → `https://ssd.jpl.nasa.gov/api/horizons.api`.
* **JPL SBDB** via `/sbdb` → `https://ssd-api.jpl.nasa.gov/sbdb/api/sbdb`.

The frontend renders a **Three.js** heliocentric ecliptic J2000 scene with:

* Planets sampled from Horizons vectors (interpolated).
* NEOs/comets from SBDB orbital elements propagated by a universal conic solver (elliptic/parabolic/hyperbolic).
* “Add 3I/ATLAS” pulls **C/2025 N1 (ATLAS)** via `/sbdb?sstr=3I`.

**Single origin rule:** the browser only talks to the Worker origin.

```ts
// src/api/base.ts (conceptual)
export const BASE = 'https://<YOUR-WORKER>.workers.dev';
```

---

## Agent Mandates

### SCREENSHOT_AGENT

* Every pull request **must** include a preview screenshot covering the rendered UI alongside the diff summary.
* If generating the screenshot fails because of build or runtime errors, resolve the errors and capture the screenshot before committing or opening the PR.
* No pushes, commits, or PRs are considered complete without the screenshot.

### PLAN_AGENT

* Defines module map across `src/api/`, `src/orbits/`, `src/visuals/neo3d.ts`, `src/utils/`.
* Enforces strict TS config; ships typed stubs for Horizons, SBDB, NASA endpoints.
* Locks physical constants/units: AU, AU/day, UTC, k = 0.01720209895 (AU³/day²).

### PIPELINE_AGENT

* Tooling: Node 20.x, pnpm ≥ 8, Vite 5.x. Canonical scripts:

  * `pnpm install --frozen-lockfile`
  * `pnpm lint`
  * `pnpm build`
  * `pnpm preview`
* Worker healthcheck after build: `curl $WORKER_URL/diag` must show `{ ok:true, hasNASA_API:true }`.

### FETCH_AGENT

* All fetchers live in `src/api/*` and **must** build URLs from `BASE`.
* Normalizes errors to `HttpError(url, status, body)`.
* NASA endpoints: Worker injects `api_key`; NEO **401** is surfaced and treated as non-fatal by UI.
* Caching policy: browser may cache in IndexedDB/localStorage; Worker caches only keyless 2xx (SBDB/Images/Horizons) per its logic.

### UI_AGENT

* Curates controls (Time Scale, UTC Date, Add 3I/ATLAS) and route state under `src/components/` + `src/routes/`.
* Displays status toasts for fetch faults (401, 404, 5xx) without blocking the render loop.

### VIS_AGENT

* Owns **Three.js** renderer (`src/visuals/neo3d.ts`) + `OrbitControls`.
* Planet providers interpolate horizons daily vectors; small bodies use conic propagation.
* Orbit line cache: key on `(segments, spanDays, a,e,i,Ω,ω,M,epoch)`.
* Finite-value guards: non-finite states hide meshes & lines for that frame.
* Camera: oblique 3-view (approx `(6,6,10) * SCALE`), target at `(0,0,0)`.

### ACTIONS_AGENT

* Maintains `.github/workflows/pages.yml` (GitHub Pages deploy).
* Concurrency guard `{ group: deploy, cancel-in-progress: true }`.
* pnpm cache; deterministic artifact verification.
* Post-build Worker healthcheck.

### META_AGENT

* Documents Worker usage, required `NASA_API` secret, and public dataset attributions.
* Ensures SEO/robots minimal footprint; no secrets in repo.

---

## Canonical Stack

* **Runtime:** Node 20.x • **Package:** pnpm ≥ 8 • **Bundler:** Vite 5.x
* **Lang:** TypeScript (strict) • **Renderer:** **Three.js** (OrbitControls)
* **Lint/Format:** eslint + prettier
* **Hosting:** GitHub Pages (`gh-pages` branch)
* **Backend:** Cloudflare Worker (classic) with secret **`NASA_API`**

`vite.config.ts` base path: `/NASA/`
Build output: `dist/` → GitHub Pages

```
src/
  api/
  orbits/
  visuals/
  neo3d/
  components/
  routes/
  styles/
  utils/
assets/
public/
```

---

## Data Pipeline Specification

**Authoritative backend:** Cloudflare Worker. The browser only calls the Worker origin.

### Endpoints (browser → worker)

* `GET /horizons` → forwards to JPL Horizons with a strict allowlist
  Allowed params: `COMMAND, EPHEM_TYPE, CENTER, REF_PLANE, REF_SYSTEM, MAKE_EPHEM, OUT_UNITS, START_TIME, STOP_TIME, STEP_SIZE, TLIST, TLIST_TYPE, OBJ_DATA, CSV_FORMAT, VEC_TABLE, VEC_CORR, TIME_TYPE, TIME_DIGITS`.
  Worker defaults:
  `format=json, MAKE_EPHEM=YES, OBJ_DATA=NO, EPHEM_TYPE=ELEMENTS, CENTER=500@10, REF_PLANE=ECLIPTIC, REF_SYSTEM=J2000, OUT_UNITS=AU-D`.

* `GET /sbdb` → forwards to JPL SBDB.
  **ATLAS:** call **`/sbdb?sstr=3I`** (no client-side alias loops).
  Worker may edge-cache successful 2xx.

* `GET /neo/*`, `/apod`, `/epic/*`, `/mars/*`, `/images/*`
  Worker injects `api_key` from secret for NASA REST; **401** from NEO is passed through.

### Fetch layer

`src/api/nasaClient.ts`, `src/api/neo3dData.ts`, etc. use `BASE` and throw `HttpError` on non-ok responses. IndexedDB/localStorage optional cache on the client; Worker controls edge cache.

---

## Orbital Visualization System

* **Frame:** heliocentric ecliptic **J2000**
* **Units:** distances **AU**, velocities **AU/day**, timestamps **UTC**
* **Planets:** Horizons daily vectors → linear interpolation across bracketing samples.
* **Small bodies (NEOs/comets):** universal conic propagation from SBDB elements.

### Hyperbolic correction (implemented)

For `e > 1`:

* Use `aAbs = |a|` (or derive from `q/(e-1)` if needed)
* Semilatus: `p = aAbs * (e^2 - 1)`
* Radius: `r = aAbs * (e * cosh(H) - 1)`
* Mean motion: `n = sqrt(μ / aAbs^3)` with `μ = k^2`, `k = 0.01720209895`

Elliptic: `p = a * (1 - e^2)`, solve Kepler for `E`.
Parabolic: Barker’s equation for `D`.

Orbit lines are precomputed Float32 buffers (and cached) to keep the render hot.

---

## GitHub Actions Protocol

`.github/workflows/pages.yml`:

1. `actions/checkout@v4`
2. `pnpm/action-setup@v3` (Node 20 + pnpm; enable pnpm cache)
3. `pnpm install --frozen-lockfile`
4. `pnpm lint`
5. `pnpm build`
6. `actions/upload-pages-artifact@v3`
7. `actions/deploy-pages@v4`
8. **Healthcheck:** `curl $WORKER_URL/diag` must yield `{ ok: true, hasNASA_API: true }`

`concurrency: { group: deploy, cancel-in-progress: true }`

---

## Command Charter

* `pnpm dev` – local dev (Vite)
* `pnpm lint` – eslint + prettier
* `pnpm build` – production bundle
* `pnpm preview` – serve `dist/` for QA
* `pnpm typecheck` – TS only (optional)
* `pnpm deploy` – optional manual push to `gh-pages` (must match workflow)

---

## Execution Order

1. **PLAN_AGENT**
2. **PIPELINE_AGENT**
3. **FETCH_AGENT**
4. **UI_AGENT**
5. **VIS_AGENT**
6. **ACTIONS_AGENT**
7. **META_AGENT**

Any failure loops back to **PIPELINE_AGENT** to re-establish a clean, deterministic build.

---

## Simulation Doctrine

* Reference frame: heliocentric ecliptic J2000; UTC timestamps.
* **Anomaly solvers**:

  * Elliptic Kepler via Newton (|ΔE| < 1e-13)
  * Hyperbolic Kepler for `H` (|ΔH| < 1e-13), `M = n(t−tp)`
  * Parabolic Barker with `D = tan(ν/2)`
* Gravitational constant: Gaussian `k = 0.01720209895` (AU³/day²).
* Numerical safeguards: clamp steps, reject non-finite states before render, log vector parse anomalies without blocking UI.

---

## Deployment Doctrine

* GitHub Pages serves static assets (`gh-pages`).
* Cloudflare **Worker** is the only backend; configure secret **`NASA_API`**.
* The site must not leak keys or call NASA/JPL hosts directly from the browser.
* Build outputs must be deterministic (artifact checksums match locally and in CI).

---

## Appendix: Worker Endpoints

* `/` – route samples;
* `/diag` – `{ ok, hasNASA_API, keyLen, usingDemo, now }`
* `/apod` – proxied with key
* `/neo/*` – proxied with key (401 surfaced)
* `/epic/*`, `/mars/*` – proxied with key
* `/images/*` – keyless images API
* `/sbdb` – keyless SBDB
* `/horizons` – keyless Horizons (strict allowlist + defaults)

