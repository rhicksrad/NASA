# Bug-fix TODO (audit 2026-07-07)

Full site audit: every module reviewed against code + live worker probes.
`worker.js` in this repo has been REWRITTEN as the canonical source — **paste it into the
Cloudflare dashboard** (see item 1). The repo copy exists only for code maintenance.

## P0 — broken in production

- [ ] **1. Deploy the new worker.js to Cloudflare** (unblocks CME Explorer, EONET Explorer, /neo/feed)
  - Repo `worker.js` was rewritten (2026-07-07) from the actual deployed source, adding:
    - `/storm/find?start&end`, `/storm/{activityID}.json`, `/storm/{activityID}.md` (DONKI CME — helpers existed, routes were missing)
    - `/eonet/*` passthrough + `/event/{id}.md` (EONET — helpers existed, routes were missing)
    - `/neo/feed` fix (was proxied to `neo/rest/v1/neo/feed` → 404; feed lives at `neo/rest/v1/feed`)
    - TLE origin http→https
    - All Artemis routes/helpers REMOVED (page is being deleted, see item 2)
  - Action: paste worker.js into Cloudflare, then verify:
    `/storm/find?start=2024-05-08&end=2024-05-12` → items; `/eonet/categories` → list; `/event/{id}.md` → markdown.

- [ ] **2. DELETE the Artemis Tracker page entirely** (mission ended 2026-04-10; Horizons has no
  Orion ephemeris after that date — "live" tracking can never work again; page currently shows
  day 97 of a 10-day mission)
  - Remove nav link `#/artemis` from `index.html` (id `nav-artemis`)
  - Remove `/artemis` route registration in `src/routes/index.ts`
  - Delete `src/routes/artemis.ts`, `src/api/artemis.ts`
  - Delete `tests/artemis.spec.ts`, remove `shot:artemis` script from `package.json`,
    remove Artemis mentions from `README.md`, delete `public/dev-shots/artemis-console.png` if present
  - (Worker side already handled: new worker.js has no /artemis routes)

- [ ] **3. Sat3D: satellites rendered 90° off the globe** — SGP4 output is ECI **Z-up**, Earth
  sphere is **Y-up**, no axis remap (`src/earth_scene.ts:579`, `src/sat3d_main.ts:755-759`).
  Remap ECI→three.js (`[x, z, -y]` or rotate parent group −90° about X) for satellites, orbit
  lines, AND the sun vector. Same fix area: `setSunDirectionFromDate` (`earth_scene.ts:582-597`)
  also omits the ~280° solar ecliptic longitude at J2000 → seasons shifted ~3 months.

## P1 — modules work but misbehave

- [ ] **4. Hub: hourly highlight stuck on loading skeleton** after hash-navigating away and back
  (`src/main.ts:173-176`, `src/routes/index.ts:45-49` `restoreHome()` repaints the captured
  skeleton and `initIndexPage` never re-runs). Also: abort in-flight highlight fetch on route
  change (currently only on pagehide, `main.ts:100`); Escape-close of mobile nav leaks a document
  keydown listener (`main.ts:145-161`); About page injects nested `<main>` (`src/routes/about.ts:8`).

- [ ] **5. EPIC viewer teardown + fps + CORS**
  - `/epic` route returns no cleanup (`src/routes/index.ts:26-31`); EpicViewer has no `dispose()` —
    rAF loop runs forever after navigating away (`EpicViewer.ts:322-338`). Add dispose, return it.
  - `play()` captures `stepMs` once — Speed select ignored mid-play (`EpicViewer.ts:326`).
  - `src/api/epic.ts:18-20` fetches epic.gsfc.nasa.gov directly; route through worker `/epic` proxy.

- [ ] **6. Images Explorer: full-res modal broken/wrong**
  - `largestAssetUrl` (`src/api/nasaImages.ts:160-162`): returns `http://` hrefs (mixed content,
    blocked) and sorts by URL length so it picks `~medium.jpg`, never `~orig.jpg`. Upgrade to https
    + rank by size suffix (orig > large > medium > small > thumb).
  - Preset buttons don't clear year/keyword filters (`imagesExplorer.tsx:383-388`).
  - Low: sessionStorage search cache has no TTL (`nasaImages.ts:80-140`).

- [ ] **7. Mars Images**
  - Pagination: `pageSize = result.items.length || 100` inflates totalPages on partial pages →
    "Next" fetches empty pages (`src/routes/marsImages.ts:487-490`).
  - Sol/instrument controls are keyword-search-only, not real filters (`marsImages.ts:37-46`).
    Now that the worker `/mars/{rover}/photos` route works, either wire to the real rover-photos
    API or relabel as keyword hints.
  - `src/api/imagesClient.ts:26-32` uses `VITE_WORKER_URL` env with a broken relative fallback;
    standardize on `WORKER_BASE` from `src/api/base.ts`.

- [ ] **8. NEO3D**
  - Global "w" keydown toggles Wow! overlay while typing in the SBDB search box
    (`src/routes/neo3d.ts:601-607`) — guard on event.target.
  - `neo.absolute_magnitude_h.toFixed(1)` unguarded (`neo3d.ts:1402`) — null H throws and silently
    aborts the rest of the render batch.
  - SBDB fallback pairs `ma` with `tp` as epoch (`neo3d.ts:1490-1532`) — object drawn at wrong
    orbit position when SBDB omits `epoch`.
  - Gate the hardcoded Horizons self-test (`neo3d.ts:1744-1751`) behind `import.meta.env.DEV`.
  - Speed slider default `value="4"` labeled "1 day/s" but preset[4] is 1 wk/s (`neo3d.html:185`).

- [ ] **9. Sat3D UX**
  - Bad/decayed TLE: success toast + empty scene, no error (`src/sat3d_main.ts:433-441`).
  - Earth textures hot-linked from threejs.org, no onError → silent black globe
    (`src/earth_scene.ts:54-55,386-389`). Self-host or add fallback.
  - Selection fires on pointerdown — camera drags reselect satellites (`sat3d_main.ts:862`).
  - Trail timer resets even when selected sat skipped in >400-sat batches (`sat3d_main.ts:724-735`).
  - Sample-sat epoch `new Date(entry.date)` without null guard → "TLE age: NaN days"
    (`sat3d_main.ts:400` vs guard at `tle_client.ts:80`).

## P2 — polish and debt

- [ ] **10. CME/EONET page fixes** (after worker deploy)
  - `renderMarkdown` in both `assets/storm.js:38-49` and `assets/events.js:238-249` doesn't render
    `[text](url)` links (shows literal brackets).
  - Escape API strings before innerHTML (storm.js:63,194-203; events.js:125,231).
  - events.js manual filter submit has no .catch / loading state (`events.js:285`).
  - Verify EONET v3 honors the `category` query param on /events (dropdown may silently not filter).

- [ ] **11. Exo page**
  - CSV export corrupts rows for distances ≥1000 ly — `toLocaleString` commas + unquoted CSV
    (`exo.js:716-722`, `420-422`). Quote/escape fields.
  - AbortController created but never cancels prior request → stale results race (`exo.js:175,200`).
  - Duplicate `tran_flag=1 AND tran_flag=1` in WHERE (`exo.js:188,343`).

- [ ] **12. TypeScript + CI** — `npx tsc --noEmit` fails with ~60 errors; CI never typechecks.
  - Install `@types/three`, `@types/d3`; add `"vite/client"` to tsconfig types.
  - Fix real type bugs: `src/api/mars.ts:56,90`, `src/api/sbdb.ts:506-513`,
    `src/components/sbdb/*`, `src/data/manualSbdb.ts:50,57`, `src/routes/neo3d.ts:107-211,1546`
    (artemis.ts errors disappear with item 2).
  - Add `typecheck` script; run typecheck + eslint in `.github/workflows/pages.yml` before build.

- [ ] **13. Repo hygiene**
  - `public/` ships 262 MB of `mpcorb_extended.json_*.gz` / `allcometels.json.gz` on every deploy;
    only `scripts/build_sbdb_index.py` reads them. Move out of `public/` (gitignore or LFS) and fix
    the `[1]` Windows-download names.
  - Delete nested duplicate `NASA/src/` shim directory (pure re-import stubs).
  - Delete unreachable legacy NEO route chain: `src/routes/neo.ts` + `neo.html` (drags Three.js/d3
    into the hub bundle via `src/main.ts:4,178-190`), `src/lib/neo-client.ts` (calls dead
    `/cad.api`, `/sbdb_query.api`), `src/visuals/neo*.ts` 2D charts, `src/utils/neo.ts`,
    `src/api/images.ts`, `src/components/MarsGallery.ts`, `src/routes/neo3d.html` (orphaned ids →
    dead collapse-panel branch at `routes/neo3d.ts:548-650`).
  - `src/api/fetch_planets.ts:143-144`: `'A'` regex matches the `MA=` line first → mean anomaly
    returned as semi-major axis. Fix regex or delete file (only a live-network test uses it).
  - Neo3D class + WowSignalLayer have no dispose path; `onDateChange` writes DOM 60×/s while
    paused (`src/visuals/neo3d.ts:2056-2068,2151-2153`).

## Verification notes
- Build: `pnpm build` passes (verified 2026-07-07). Typecheck fails (item 12).
- Live worker probes (2026-07-07): 404 on `/storm/*`, `/eonet/*`, `/event/*`, `/neo/feed`,
  `/mars/*`, `/health`, `/cad.api`; 200 on `/artemis/*`, `/images/*`, `/neo/browse`, `/apod`,
  `/exo/tap`, `/tle/*`, `/sbdb`, `/epic/*`, `/horizons`.
