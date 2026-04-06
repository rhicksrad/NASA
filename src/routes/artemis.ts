import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { imagesSearch, type NasaImageItem } from '../api/nasaImages';
import { getArtemisArticle, getArtemisTimeline, getArtemisTrack, type ArtemisTrackResponse, type ArtemisVectorRow } from '../api/artemis';
import '../styles/artemis.css';

type Cleanup = () => void;

type MissionPhase = {
  startDay: number;
  label: string;
  detail: string;
};

type TrackSample = {
  timeMs: number;
  orionKm: THREE.Vector3;
  moonKm: THREE.Vector3;
  speedKmS: number;
};

const MISSION_START_ISO = '2026-04-01T16:50:00Z';
const MISSION_DURATION_DAYS = 10;
const EARTH_MOON_DISTANCE_KM = 384_400;
const SPEED_OF_LIGHT_KM_S = 299_792;
const AU_TO_KM = 149_597_870.7;
const EARTH_RADIUS_KM = 6_371;
const MOON_RADIUS_KM = 1_737.4;
const SCENE_EARTH_MOON_DISTANCE = 12;
const KM_TO_SCENE = SCENE_EARTH_MOON_DISTANCE / EARTH_MOON_DISTANCE_KM;
const EARTH_RADIUS_SCENE = EARTH_RADIUS_KM * KM_TO_SCENE;
const MOON_RADIUS_SCENE = MOON_RADIUS_KM * KM_TO_SCENE;
const ATMOSPHERE_RADIUS_SCENE = EARTH_RADIUS_SCENE * 1.06;

const PHASES: MissionPhase[] = [
  { startDay: 0, label: 'Takeoff & TLI burn', detail: 'Launch stack insertion and trans-lunar injection burn depart Earth parking orbit.' },
  { startDay: 1.25, label: 'Outbound coast', detail: 'Crew checks life support, optics and navigation while climbing toward lunar encounter.' },
  { startDay: 3.45, label: 'Moon slingshot', detail: 'Perilune pass uses lunar gravity assist to bend the trajectory into a free-return Earth corridor.' },
  { startDay: 4.6, label: 'Earth-return arc', detail: 'Return leg tracks re-entry corridor with correction burns as needed.' },
  { startDay: 9.2, label: 'Entry & recovery', detail: 'Skip-entry guidance and parachute sequence target Pacific splashdown and recovery.' },
];

function formatDuration(totalMs: number): string {
  const absoluteMs = Math.max(0, totalMs);
  const totalSeconds = Math.floor(absoluteMs / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  return `${days}d ${hours}h ${minutes}m`;
}

function missionPhaseForDay(day: number): MissionPhase {
  let current = PHASES[0];
  for (const phase of PHASES) {
    if (day >= phase.startDay) current = phase;
  }
  return current;
}

function makePlanetTexture(base: string, accent: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  if (!ctx) return new THREE.CanvasTexture(canvas);

  const grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
  grad.addColorStop(0, accent);
  grad.addColorStop(0.45, base);
  grad.addColorStop(1, '#021022');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  for (let i = 0; i < 1200; i += 1) {
    const x = Math.random() * canvas.width;
    const y = Math.random() * canvas.height;
    const r = 1 + Math.random() * 9;
    ctx.globalAlpha = 0.08 + Math.random() * 0.12;
    ctx.fillStyle = i % 3 ? '#7ec8ff' : '#3b6fd9';
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function createStarfield(): THREE.Points {
  const count = 3600;
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    const radius = 110 + Math.random() * 260;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    const idx = i * 3;
    positions[idx] = radius * Math.sin(phi) * Math.cos(theta);
    positions[idx + 1] = radius * Math.cos(phi);
    positions[idx + 2] = radius * Math.sin(phi) * Math.sin(theta);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  return new THREE.Points(
    geometry,
    new THREE.PointsMaterial({
      color: 0xa8d9ff,
      size: 0.35,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
    }),
  );
}

function createShipModel(): THREE.Group {
  const ship = new THREE.Group();

  const serviceModule = new THREE.Mesh(
    new THREE.CylinderGeometry(0.05, 0.06, 0.22, 20),
    new THREE.MeshStandardMaterial({ color: 0xc8d2e6, roughness: 0.35, metalness: 0.62, emissive: 0x1f2a40, emissiveIntensity: 0.2 }),
  );
  serviceModule.rotation.z = Math.PI / 2;

  const crewCapsule = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.055, 0.11, 8, 16),
    new THREE.MeshStandardMaterial({ color: 0xf4f7ff, roughness: 0.2, metalness: 0.45, emissive: 0x2d3956, emissiveIntensity: 0.28 }),
  );
  crewCapsule.rotation.z = Math.PI / 2;
  crewCapsule.position.x = 0.13;

  const panelMaterial = new THREE.MeshStandardMaterial({ color: 0x32589a, roughness: 0.46, metalness: 0.14, emissive: 0x172a57, emissiveIntensity: 0.45 });
  const leftPanel = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.18, 0.08), panelMaterial);
  leftPanel.position.set(-0.05, 0.16, 0);
  const rightPanel = leftPanel.clone();
  rightPanel.position.y = -0.16;

  ship.add(serviceModule, crewCapsule, leftPanel, rightPanel);
  ship.scale.setScalar(0.32);
  return ship;
}

function formatUtc(date: Date): string {
  return `${date.toISOString().replace('T', ' ').slice(0, 19)} UTC`;
}

function formatDateTimeInput(date: Date): string {
  return date.toISOString().slice(0, 16);
}

function parseInputDateTime(value: string, fallback: Date): Date {
  const parsed = new Date(value.includes('T') ? value : value.replace(' ', 'T'));
  return Number.isFinite(parsed.getTime()) ? parsed : fallback;
}

function addMinutesToDate(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}

function vectorMagnitudeKm(v: THREE.Vector3 | undefined): number | null {
  if (!v) return null;
  return Number.isFinite(v.length()) ? v.length() : null;
}

function vectorDistanceKm(a: THREE.Vector3 | undefined, b: THREE.Vector3 | undefined): number | null {
  if (!a || !b) return null;
  const dist = a.distanceTo(b);
  return Number.isFinite(dist) ? dist : null;
}

function parseCalendarUtcToMs(value: string): number | null {
  const normalized = value
    .replace(/^A\.D\.\s*/i, '')
    .replace(/\s+/g, ' ')
    .replace(/([A-Za-z]{3})-(\d{2})\s/, '$1 $2, ')
    .trim();
  const parsed = Date.parse(`${normalized} UTC`);
  return Number.isFinite(parsed) ? parsed : null;
}

function toTrackSample(row: ArtemisVectorRow): TrackSample | null {
  const timeMs = parseCalendarUtcToMs(row.calendarUtc);
  if (!Number.isFinite(timeMs)) return null;
  const orionKm = new THREE.Vector3(row.x * AU_TO_KM, row.y * AU_TO_KM, row.z * AU_TO_KM);
  const speedKmS = (Math.sqrt(row.vx ** 2 + row.vy ** 2 + row.vz ** 2) * AU_TO_KM) / 86400;
  if (![orionKm.x, orionKm.y, orionKm.z, speedKmS].every(Number.isFinite)) return null;
  return { timeMs, orionKm, moonKm: new THREE.Vector3(), speedKmS };
}

function pairTrackSamples(track: ArtemisTrackResponse): TrackSample[] {
  const orionRows = track.parsed?.orion ?? [];
  const moonRows = track.parsed?.moon ?? [];
  const count = Math.min(orionRows.length, moonRows.length);
  const samples: TrackSample[] = [];

  for (let i = 0; i < count; i += 1) {
    const base = toTrackSample(orionRows[i]);
    if (!base) continue;
    const moon = moonRows[i];
    const moonKm = new THREE.Vector3(moon.x * AU_TO_KM, moon.y * AU_TO_KM, moon.z * AU_TO_KM);
    if (![moonKm.x, moonKm.y, moonKm.z].every(Number.isFinite)) continue;
    samples.push({ ...base, moonKm });
  }

  return samples.sort((a, b) => a.timeMs - b.timeMs);
}

function sampleTrackAt(samples: TrackSample[], targetMs: number): TrackSample | null {
  if (!samples.length) return null;
  if (targetMs <= samples[0].timeMs) return samples[0];
  if (targetMs >= samples[samples.length - 1].timeMs) return samples[samples.length - 1];

  let hi = 1;
  while (hi < samples.length && samples[hi].timeMs < targetMs) hi += 1;
  const lo = hi - 1;
  const a = samples[lo];
  const b = samples[hi];
  const span = b.timeMs - a.timeMs;
  const t = span > 0 ? (targetMs - a.timeMs) / span : 0;
  return {
    timeMs: targetMs,
    orionKm: a.orionKm.clone().lerp(b.orionKm, t),
    moonKm: a.moonKm.clone().lerp(b.moonKm, t),
    speedKmS: a.speedKmS + (b.speedKmS - a.speedKmS) * t,
  };
}

function kmVectorToScene(v: THREE.Vector3): THREE.Vector3 {
  return v.clone().multiplyScalar(KM_TO_SCENE);
}

function buildGalleryCard(item: NasaImageItem): HTMLElement {
  const article = document.createElement('article');
  article.className = 'artemis-gallery-card';

  const image = document.createElement('img');
  image.src = item.thumb;
  image.alt = item.title || 'Mission image';
  image.loading = 'lazy';
  image.decoding = 'async';

  const content = document.createElement('div');
  const heading = document.createElement('h4');
  heading.textContent = item.title || 'Mission image';

  const note = document.createElement('p');
  note.textContent = item.description?.slice(0, 132) || 'NASA archive image related to Artemis mission operations.';

  const meta = document.createElement('small');
  const date = item.date_created ? new Date(item.date_created).toISOString().slice(0, 10) : 'Archive';
  const credit = item.photographer ? `Credit: ${item.photographer}` : 'Credit: NASA';
  meta.textContent = `${date} • ${credit}`;

  content.append(heading, note, meta);
  article.append(image, content);
  return article;
}

async function loadGallery(galleryEl: HTMLElement, signal: AbortSignal): Promise<void> {
  galleryEl.innerHTML = '<p class="artemis-gallery-loading">Loading mission imagery…</p>';
  const [page1, page2] = await Promise.all([
    imagesSearch({ q: 'Artemis Orion Moon mission', page: 1 }, { signal }),
    imagesSearch({ q: 'Artemis Orion Moon mission', page: 2 }, { signal }),
  ]);

  if (signal.aborted) return;

  const cards = [...page1.items, ...page2.items]
    .filter(item => Boolean(item.thumb))
    .sort((a, b) => Date.parse(b.date_created ?? '1900-01-01') - Date.parse(a.date_created ?? '1900-01-01'))
    .slice(0, 8)
    .map(item => buildGalleryCard(item));

  if (cards.length) {
    galleryEl.replaceChildren(...cards);
    return;
  }
  galleryEl.innerHTML = '<p class="artemis-gallery-loading">Mission imagery is temporarily unavailable.</p>';
}

export function mountArtemisPage(host: HTMLElement): Cleanup {
  const container = document.createElement('section');
  container.className = 'artemis-page';
  container.innerHTML = `
    <header class="artemis-header">
      <h1>Artemis Console</h1>
      <p class="artemis-subhead">Live Worker vectors drive a true-to-scale Earth–Moon frame: Earth and Moon radii are scaled to the same Earth-Moon baseline as the trajectory.</p>
    </header>

    <div class="artemis-layout">
      <div class="artemis-stage-wrap">
        <div class="artemis-stage" id="artemis-stage"></div>
        <div class="artemis-overlay">
          <div class="artemis-badge">To-scale Earth–Moon Frame</div>
          <label class="artemis-overlay-control">
            <span id="artemis-scrub-date">Timeline day</span>
            <input id="artemis-scrub" dir="ltr" type="range" min="0" max="${MISSION_DURATION_DAYS}" step="0.01" value="0" />
          </label>
          <button id="artemis-live" class="artemis-live-button" type="button" title="Jump to live mission time and keep tracking">Go live</button>
        </div>
      </div>

      <aside class="artemis-panel artemis-image-sidebar">
        <section class="artemis-gallery">
          <h3>Mission image sidebar</h3>
          <div id="artemis-gallery-list" class="artemis-gallery-list"></div>
        </section>
      </aside>
    </div>

    <section class="artemis-panel artemis-mission-info" aria-live="polite">
      <h2>Mission telemetry</h2>
      <dl>
        <div><dt>Mission clock</dt><dd id="artemis-elapsed">--</dd></div>
        <div><dt>Time remaining</dt><dd id="artemis-remaining">--</dd></div>
        <div><dt>Current phase</dt><dd id="artemis-phase">--</dd></div>
        <div><dt>Phase detail</dt><dd id="artemis-detail">--</dd></div>
        <div><dt>Distance from Earth</dt><dd id="artemis-distance">--</dd></div>
        <div><dt>Distance to Moon</dt><dd id="artemis-moon-distance">--</dd></div>
        <div><dt>Downlink light time</dt><dd id="artemis-lighttime">--</dd></div>
        <div><dt>Relative speed</dt><dd id="artemis-speed">--</dd></div>
        <div><dt>UTC now</dt><dd id="artemis-now">--</dd></div>
      </dl>

      <section class="artemis-timeline-inline" id="artemis-timeline-inline">
        ${PHASES.map(phase => `<button class="artemis-phase-dot" type="button" data-phase="${phase.label}" data-start-day="${phase.startDay}" title="${phase.label} • T+${phase.startDay.toFixed(1)} days" aria-label="${phase.label} at T+${phase.startDay.toFixed(1)} days"></button>`).join('')}
      </section>
    </section>

    <section class="artemis-panel artemis-worker-panel" aria-live="polite">
      <h2>Live Worker feed</h2>
      <p id="artemis-worker-status" class="artemis-worker-status">Connecting to Artemis worker routes…</p>
      <div class="artemis-worker-controls">
        <label>Start UTC <input id="artemis-track-start" type="datetime-local" step="60" /></label>
        <label>Stop UTC <input id="artemis-track-stop" type="datetime-local" step="60" /></label>
        <label>Step <input id="artemis-track-step" type="text" value="30 m" /></label>
        <button id="artemis-track-refresh" type="button">Refresh telemetry</button>
      </div>
      <dl class="artemis-worker-grid">
        <div><dt>Mission</dt><dd id="artemis-worker-mission">--</dd></div>
        <div><dt>Article</dt><dd id="artemis-worker-article">--</dd></div>
        <div><dt>Track window</dt><dd id="artemis-worker-window">--</dd></div>
        <div><dt>Samples</dt><dd id="artemis-worker-samples">--</dd></div>
        <div><dt>Orion from Earth</dt><dd id="artemis-worker-earth-dist">--</dd></div>
        <div><dt>Orion to Moon</dt><dd id="artemis-worker-moon-dist">--</dd></div>
      </dl>
    </section>
  `;

  host.replaceChildren(container);

  const stage = container.querySelector<HTMLElement>('#artemis-stage');
  const elapsedEl = container.querySelector<HTMLElement>('#artemis-elapsed');
  const remainingEl = container.querySelector<HTMLElement>('#artemis-remaining');
  const phaseEl = container.querySelector<HTMLElement>('#artemis-phase');
  const detailEl = container.querySelector<HTMLElement>('#artemis-detail');
  const distanceEl = container.querySelector<HTMLElement>('#artemis-distance');
  const moonDistanceEl = container.querySelector<HTMLElement>('#artemis-moon-distance');
  const lighttimeEl = container.querySelector<HTMLElement>('#artemis-lighttime');
  const speedEl = container.querySelector<HTMLElement>('#artemis-speed');
  const nowEl = container.querySelector<HTMLElement>('#artemis-now');
  const timelineEl = container.querySelector<HTMLElement>('#artemis-timeline-inline');
  const galleryEl = container.querySelector<HTMLElement>('#artemis-gallery-list');
  const scrubber = container.querySelector<HTMLInputElement>('#artemis-scrub');
  const scrubDateEl = container.querySelector<HTMLElement>('#artemis-scrub-date');
  const liveButton = container.querySelector<HTMLButtonElement>('#artemis-live');
  const workerStatusEl = container.querySelector<HTMLElement>('#artemis-worker-status');
  const workerMissionEl = container.querySelector<HTMLElement>('#artemis-worker-mission');
  const workerArticleEl = container.querySelector<HTMLElement>('#artemis-worker-article');
  const workerWindowEl = container.querySelector<HTMLElement>('#artemis-worker-window');
  const workerSamplesEl = container.querySelector<HTMLElement>('#artemis-worker-samples');
  const workerEarthDistEl = container.querySelector<HTMLElement>('#artemis-worker-earth-dist');
  const workerMoonDistEl = container.querySelector<HTMLElement>('#artemis-worker-moon-dist');
  const trackStartInput = container.querySelector<HTMLInputElement>('#artemis-track-start');
  const trackStopInput = container.querySelector<HTMLInputElement>('#artemis-track-stop');
  const trackStepInput = container.querySelector<HTMLInputElement>('#artemis-track-step');
  const trackRefreshButton = container.querySelector<HTMLButtonElement>('#artemis-track-refresh');

  if (!stage || !elapsedEl || !remainingEl || !phaseEl || !detailEl || !distanceEl || !moonDistanceEl || !lighttimeEl || !speedEl || !nowEl || !timelineEl || !galleryEl || !scrubber || !scrubDateEl || !liveButton || !workerStatusEl || !workerMissionEl || !workerArticleEl || !workerWindowEl || !workerSamplesEl || !workerEarthDistEl || !workerMoonDistEl || !trackStartInput || !trackStopInput || !trackStepInput || !trackRefreshButton) {
    return () => undefined;
  }

  const galleryController = new AbortController();
  const telemetryController = new AbortController();
  loadGallery(galleryEl, galleryController.signal).catch(() => {
    if (!galleryController.signal.aborted) galleryEl.innerHTML = '<p class="artemis-gallery-loading">Mission imagery could not be loaded right now.</p>';
  });

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;
  stage.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x020816, 0.01);

  const camera = new THREE.PerspectiveCamera(42, 1, 0.05, 1400);
  camera.position.set(14, 8.5, 16);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.04;
  controls.target.set(5, 0, 0);

  scene.add(new THREE.AmbientLight(0x9eb8ff, 0.72));
  scene.add(new THREE.HemisphereLight(0x88b5ff, 0x06080f, 0.55));
  const sunLight = new THREE.DirectionalLight(0xffffff, 1.5);
  sunLight.position.set(18, 12, 10);
  scene.add(sunLight);

  const starfield = createStarfield();
  scene.add(starfield);

  const earthTexture = makePlanetTexture('#1f4bbd', '#6ec8ff');
  const earth = new THREE.Mesh(
    new THREE.SphereGeometry(EARTH_RADIUS_SCENE, 80, 80),
    new THREE.MeshStandardMaterial({ map: earthTexture, emissive: 0x0f2347, emissiveIntensity: 0.18, roughness: 0.75 }),
  );
  scene.add(earth);

  const atmosphere = new THREE.Mesh(
    new THREE.SphereGeometry(ATMOSPHERE_RADIUS_SCENE, 48, 48),
    new THREE.MeshBasicMaterial({ color: 0x62b2ff, transparent: true, opacity: 0.22 }),
  );
  scene.add(atmosphere);

  const moon = new THREE.Mesh(
    new THREE.SphereGeometry(MOON_RADIUS_SCENE, 64, 64),
    new THREE.MeshStandardMaterial({ color: 0xd0d6de, roughness: 0.96, metalness: 0.02 }),
  );
  moon.position.set(SCENE_EARTH_MOON_DISTANCE, 0, 0);
  scene.add(moon);

  const ship = createShipModel();
  scene.add(ship);

  const trajectoryLine = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0.3, 0, 0)]),
    new THREE.LineBasicMaterial({ color: 0x8ad7ff, transparent: true, opacity: 0.9 }),
  );
  scene.add(trajectoryLine);

  const futureLine = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0.3, 0, 0)]),
    new THREE.LineDashedMaterial({ color: 0xcf89ff, transparent: true, opacity: 0.8, dashSize: 0.22, gapSize: 0.15 }),
  );
  futureLine.computeLineDistances();
  scene.add(futureLine);

  const moonOrbitLine = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(SCENE_EARTH_MOON_DISTANCE, 0, 0)]),
    new THREE.LineBasicMaterial({ color: 0xff7fd0, transparent: true, opacity: 0.82 }),
  );
  scene.add(moonOrbitLine);

  const timelineMarkers = PHASES.map(phase => {
    const marker = new THREE.Mesh(
      new THREE.SphereGeometry(0.08, 16, 16),
      new THREE.MeshBasicMaterial({ color: 0x9fdcff, transparent: true, opacity: 0.85 }),
    );
    scene.add(marker);
    return { phase, marker };
  });

  const missionStartMs = Date.parse(MISSION_START_ISO);
  const missionStopMs = missionStartMs + MISSION_DURATION_DAYS * 86400000;
  trackStartInput.value = formatDateTimeInput(new Date(missionStartMs));
  trackStopInput.value = formatDateTimeInput(new Date(missionStopMs));

  let trackSamples: TrackSample[] = [];
  let simulatedDay: number | null = null;
  let missionDurationMs = MISSION_DURATION_DAYS * 86400000;
  const activeCards = Array.from(timelineEl.querySelectorAll<HTMLButtonElement>('.artemis-phase-dot'));
  let raf = 0;
  let previousScenePos = new THREE.Vector3();

  function updateTrackGeometry(samples: TrackSample[]) {
    if (samples.length < 2) return;
    const orbitPoints = samples.map(sample => kmVectorToScene(sample.moonKm));
    moonOrbitLine.geometry.dispose();
    moonOrbitLine.geometry = new THREE.BufferGeometry().setFromPoints(orbitPoints);

    const shipPoints = samples.map(sample => kmVectorToScene(sample.orionKm));
    trajectoryLine.geometry.dispose();
    trajectoryLine.geometry = new THREE.BufferGeometry().setFromPoints(shipPoints);

    const maxExtent = shipPoints.reduce((max, p) => Math.max(max, p.length()), 0);
    camera.position.set(maxExtent * 1.45 + 2.8, maxExtent * 0.8 + 1.2, maxExtent * 1.2 + 3.4);
    controls.target.set(maxExtent * 0.42, 0, 0);
  }

  function dayToMs(day: number) {
    return missionStartMs + day * 86400000;
  }

  const refreshTelemetry = async () => {
    workerStatusEl.textContent = 'Fetching /artemis/timeline, /artemis/article and /artemis/track…';
    workerStatusEl.classList.remove('is-error');

    const startUtc = parseInputDateTime(trackStartInput.value, new Date(missionStartMs));
    const stopUtc = parseInputDateTime(trackStopInput.value, addMinutesToDate(startUtc, 60));
    const step = trackStepInput.value.trim() || '30 m';

    try {
      const [timeline, article, track] = await Promise.all([
        getArtemisTimeline(telemetryController.signal),
        getArtemisArticle(telemetryController.signal),
        getArtemisTrack({
          start: startUtc.toISOString().replace('T', ' ').slice(0, 19),
          stop: stopUtc.toISOString().replace('T', ' ').slice(0, 19),
          step,
          format: 'text',
        }, telemetryController.signal),
      ]);

      trackSamples = pairTrackSamples(track);
      if (trackSamples.length >= 2) {
        const dataStart = trackSamples[0].timeMs;
        const dataStop = trackSamples[trackSamples.length - 1].timeMs;
        missionDurationMs = Math.max(60_000, dataStop - dataStart);
        scrubber.max = (missionDurationMs / 86400000).toFixed(3);
        scrubber.value = '0';
        simulatedDay = null;
        updateTrackGeometry(trackSamples);
      }

      const latest = trackSamples.at(-1);
      const earthDistKm = vectorMagnitudeKm(latest?.orionKm);
      const moonDistKm = vectorDistanceKm(latest?.orionKm, latest?.moonKm);

      workerMissionEl.textContent = timeline.mission?.name || track.mission?.name || 'Artemis II';
      workerArticleEl.innerHTML = article.post?.link
        ? `<a href="${article.post.link}" target="_blank" rel="noopener noreferrer">${article.post.title || article.post.slug}</a>`
        : 'No article metadata';
      workerWindowEl.textContent = `${track.window.start} → ${track.window.stop} (${track.window.step})`;
      workerSamplesEl.textContent = `${trackSamples.length} synced samples`;
      workerEarthDistEl.textContent = earthDistKm != null ? `${Math.round(earthDistKm).toLocaleString()} km` : '--';
      workerMoonDistEl.textContent = moonDistKm != null ? `${Math.round(moonDistKm).toLocaleString()} km` : '--';
      workerStatusEl.textContent = `Live telemetry updated at ${formatUtc(new Date())}.`;
    } catch (error) {
      workerStatusEl.classList.add('is-error');
      workerStatusEl.textContent = `Worker telemetry fetch failed: ${error instanceof Error ? error.message : String(error)}`;
    }
  };

  trackRefreshButton.addEventListener('click', () => {
    void refreshTelemetry();
  });
  void refreshTelemetry();

  const resize = () => {
    const width = stage.clientWidth;
    const height = Math.max(stage.clientHeight, 440);
    renderer.setSize(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };

  function realtimeMissionDay(): number {
    return (Date.now() - missionStartMs) / 86400000;
  }

  const tick = () => {
    const realtimeDay = realtimeMissionDay();
    const day = simulatedDay ?? realtimeDay;
    const elapsedMs = day * 86400000;
    const clampedDay = Math.max(0, day);
    const phase = missionPhaseForDay(clampedDay);

    earth.rotation.y += 0.0019;
    moon.rotation.y += 0.0008;
    starfield.rotation.y += 0.00006;

    const targetTimeMs = dayToMs(clampedDay);
    const sampled = sampleTrackAt(trackSamples, targetTimeMs);

    const shipPos = sampled ? kmVectorToScene(sampled.orionKm) : new THREE.Vector3(0.3, 0.1, 0);
    const moonPos = sampled ? kmVectorToScene(sampled.moonKm) : new THREE.Vector3(SCENE_EARTH_MOON_DISTANCE, 0, 0);
    moon.position.copy(moonPos);

    ship.position.copy(shipPos);
    const dir = shipPos.clone().sub(previousScenePos);
    ship.lookAt(shipPos.clone().add(dir.lengthSq() > 1e-8 ? dir.normalize() : new THREE.Vector3(1, 0, 0)));

    if (trackSamples.length > 1 && sampled) {
      const passed = trackSamples
        .filter(sample => sample.timeMs <= sampled.timeMs)
        .map(sample => kmVectorToScene(sample.orionKm));
      if (passed.length >= 2) {
        trajectoryLine.geometry.dispose();
        trajectoryLine.geometry = new THREE.BufferGeometry().setFromPoints(passed);
      }

      const ahead = trackSamples
        .filter(sample => sample.timeMs >= sampled.timeMs)
        .map(sample => kmVectorToScene(sample.orionKm));
      if (ahead.length >= 2) {
        futureLine.geometry.dispose();
        futureLine.geometry = new THREE.BufferGeometry().setFromPoints(ahead);
        futureLine.computeLineDistances();
      }
    }

    const distanceKm = vectorMagnitudeKm(sampled?.orionKm) ?? 0;
    const moonDistanceKm = vectorDistanceKm(sampled?.orionKm, sampled?.moonKm) ?? 0;
    const lightSeconds = Math.max(0, distanceKm) / SPEED_OF_LIGHT_KM_S;
    const speedKmS = sampled?.speedKmS ?? previousScenePos.distanceTo(shipPos) * 25;

    elapsedEl.textContent = formatDuration(Math.max(0, elapsedMs));
    remainingEl.textContent = formatDuration(Math.max(0, missionDurationMs - elapsedMs));
    phaseEl.textContent = phase.label;
    detailEl.textContent = phase.detail;
    distanceEl.textContent = `${Math.round(distanceKm).toLocaleString()} km`;
    moonDistanceEl.textContent = `${Math.round(moonDistanceKm).toLocaleString()} km`;
    lighttimeEl.textContent = `${lightSeconds.toFixed(2)} s one-way (${(lightSeconds * 2).toFixed(2)} s RTT)`;
    speedEl.textContent = `${Math.max(0, speedKmS).toFixed(2)} km/s`;
    nowEl.textContent = formatUtc(new Date(dayToMs(clampedDay)));
    scrubDateEl.textContent = `${formatUtc(new Date(dayToMs(clampedDay))).slice(0, 16)} • T+${clampedDay.toFixed(2)}d`;
    liveButton.classList.toggle('is-live', simulatedDay === null);
    if (simulatedDay === null) scrubber.value = String(Math.max(0, Math.min(Number(scrubber.max), clampedDay)));

    for (const { phase: phasePoint, marker } of timelineMarkers) {
      const markerSample = sampleTrackAt(trackSamples, dayToMs(phasePoint.startDay));
      marker.position.copy(markerSample ? kmVectorToScene(markerSample.orionKm) : new THREE.Vector3(0, 0, 0));
      marker.material.opacity = clampedDay >= phasePoint.startDay ? 0.95 : 0.28;
    }

    for (const card of activeCards) {
      const startDay = Number(card.dataset.startDay ?? Number.NaN);
      card.classList.toggle('is-active', card.dataset.phase === phase.label);
      card.classList.toggle('is-complete', Number.isFinite(startDay) && clampedDay >= startDay);
    }

    previousScenePos = shipPos.clone();

    controls.update();
    renderer.render(scene, camera);
    raf = window.requestAnimationFrame(tick);
  };

  resize();
  window.addEventListener('resize', resize);
  scrubber.addEventListener('input', () => {
    simulatedDay = Number(scrubber.value);
  });
  scrubber.addEventListener('change', () => {
    if (Math.abs(Number(scrubber.value) - realtimeMissionDay()) < 0.05) simulatedDay = null;
  });
  liveButton.addEventListener('click', () => {
    simulatedDay = null;
    scrubber.value = String(Math.max(0, Math.min(Number(scrubber.max), realtimeMissionDay())));
  });
  activeCards.forEach(card => {
    card.addEventListener('click', () => {
      const startDay = Number(card.dataset.startDay ?? Number.NaN);
      if (!Number.isFinite(startDay)) return;
      simulatedDay = startDay;
      scrubber.value = String(startDay);
    });
  });
  raf = window.requestAnimationFrame(tick);

  return () => {
    galleryController.abort();
    telemetryController.abort();
    window.cancelAnimationFrame(raf);
    window.removeEventListener('resize', resize);
    controls.dispose();
    renderer.dispose();

    [trajectoryLine, futureLine, moonOrbitLine].forEach(line => {
      line.geometry.dispose();
      (line.material as THREE.Material).dispose();
    });

    timelineMarkers.forEach(({ marker }) => {
      marker.geometry.dispose();
      (marker.material as THREE.Material).dispose();
    });

    [earth, atmosphere, moon].forEach(mesh => {
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    });

    ship.traverse(obj => {
      const mesh = obj as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.geometry.dispose();
        const material = mesh.material;
        if (Array.isArray(material)) material.forEach(m => m.dispose());
        else material.dispose();
      }
    });

    earthTexture.dispose();
    starfield.geometry.dispose();
    (starfield.material as THREE.Material).dispose();

    if (host.contains(container)) host.removeChild(container);
  };
}
