import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { request } from '../api/nasaClient';
import { imagesSearch, type NasaImageItem } from '../api/nasaImages';
import '../styles/artemis.css';

type Cleanup = () => void;

type MissionPhase = {
  startDay: number;
  label: string;
  detail: string;
};

type HorizonsResponse = {
  result?: string;
  error?: string;
};

const MISSION_START_ISO = '2026-04-01T16:50:00Z';
const MISSION_DURATION_DAYS = 10;
const EARTH_MOON_DISTANCE_KM = 384_400;
const SPEED_OF_LIGHT_KM_S = 299_792;
const AU_TO_KM = 149_597_870.7;
const SCENE_MOON_RADIUS = 5.8;
const EARTH_RADIUS_SCENE = 0.82;
const ATMOSPHERE_RADIUS_SCENE = 0.9;

const PHASES: MissionPhase[] = [
  { startDay: 0, label: 'Takeoff & TLI burn', detail: 'Launch stack insertion and trans-lunar injection burn depart Earth parking orbit.' },
  { startDay: 1.25, label: 'Outbound coast', detail: 'Crew checks life support, optics and navigation while climbing toward lunar encounter.' },
  { startDay: 3.45, label: 'Moon slingshot', detail: 'Perilune pass uses lunar gravity assist to bend the trajectory into a free-return Earth corridor.' },
  { startDay: 4.6, label: 'Earth-return arc', detail: 'Return leg tracks re-entry corridor with correction burns as needed.' },
  { startDay: 9.2, label: 'Entry & recovery', detail: 'Skip-entry guidance and parachute sequence target Pacific splashdown and recovery.' },
];


function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

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
    if (day >= phase.startDay) {
      current = phase;
    }
  }
  return current;
}

function getShipProgress(day: number): number {
  return clamp01(day / MISSION_DURATION_DAYS);
}

function getShipPosition(progress: number, path: THREE.Vector3[]): THREE.Vector3 {
  const idx = Math.round(clamp01(progress) * Math.max(0, path.length - 1));
  return path[Math.min(path.length - 1, Math.max(0, idx))].clone();
}

function makePlanetTexture(base: string, accent: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return new THREE.CanvasTexture(canvas);
  }

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
  const count = 3000;
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    const radius = 80 + Math.random() * 220;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    const idx = i * 3;
    positions[idx] = radius * Math.sin(phi) * Math.cos(theta);
    positions[idx + 1] = radius * Math.cos(phi);
    positions[idx + 2] = radius * Math.sin(phi) * Math.sin(theta);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({
    color: 0xa8d9ff,
    size: 0.35,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
  });
  return new THREE.Points(geometry, material);
}

function createShipModel(): THREE.Group {
  const ship = new THREE.Group();

  const serviceModule = new THREE.Mesh(
    new THREE.CylinderGeometry(0.09, 0.1, 0.42, 20),
    new THREE.MeshStandardMaterial({ color: 0xc8d2e6, roughness: 0.35, metalness: 0.62, emissive: 0x1f2a40, emissiveIntensity: 0.2 }),
  );
  serviceModule.rotation.z = Math.PI / 2;

  const crewCapsule = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.095, 0.2, 8, 16),
    new THREE.MeshStandardMaterial({ color: 0xf4f7ff, roughness: 0.2, metalness: 0.45, emissive: 0x2d3956, emissiveIntensity: 0.28 }),
  );
  crewCapsule.rotation.z = Math.PI / 2;
  crewCapsule.position.x = 0.25;

  const nose = new THREE.Mesh(
    new THREE.ConeGeometry(0.075, 0.14, 16),
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.22, metalness: 0.28 }),
  );
  nose.rotation.z = -Math.PI / 2;
  nose.position.x = 0.42;

  const panelMaterial = new THREE.MeshStandardMaterial({ color: 0x32589a, roughness: 0.46, metalness: 0.14, emissive: 0x172a57, emissiveIntensity: 0.45 });
  const leftPanel = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.34, 0.12), panelMaterial);
  leftPanel.position.set(-0.08, 0.25, 0);
  const rightPanel = leftPanel.clone();
  rightPanel.position.y = -0.25;

  const plume = new THREE.Mesh(
    new THREE.ConeGeometry(0.048, 0.18, 16),
    new THREE.MeshBasicMaterial({ color: 0x61d6ff, transparent: true, opacity: 0.55 }),
  );
  plume.rotation.z = Math.PI / 2;
  plume.position.x = -0.32;

  ship.add(serviceModule, crewCapsule, nose, leftPanel, rightPanel, plume);
  return ship;
}

function formatUtc(date: Date): string {
  return `${date.toISOString().replace('T', ' ').slice(0, 19)} UTC`;
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

async function fetchMoonOrbitPoints(startIso: string, stopIso: string): Promise<THREE.Vector3[]> {
  const response = await request<HorizonsResponse>('/horizons', {
    COMMAND: "'301'",
    EPHEM_TYPE: 'VECTORS',
    START_TIME: `'${startIso.slice(0, 10)}'`,
    STOP_TIME: `'${stopIso.slice(0, 10)}'`,
    STEP_SIZE: "'6 HOURS'",
    CENTER: "'500@399'",
    REF_PLANE: 'ECLIPTIC',
    REF_SYSTEM: 'J2000',
    OUT_UNITS: 'AU-D',
    VEC_TABLE: '2',
    VEC_CORR: 'NONE',
    CSV_FORMAT: 'NO',
    MAKE_EPHEM: 'YES',
    OBJ_DATA: 'NO',
    TIME_TYPE: 'UT',
  });

  if (response.error) {
    throw new Error(response.error);
  }
  const result = response.result;
  if (!result) {
    throw new Error('Missing Horizons vectors result');
  }

  const blockStart = result.indexOf('$$SOE');
  const blockEnd = result.indexOf('$$EOE', blockStart + 5);
  if (blockStart === -1 || blockEnd === -1) {
    throw new Error('Missing Horizons block markers');
  }

  const block = result.slice(blockStart + 5, blockEnd);
  const matches = [...block.matchAll(/X\s*=\s*([+-]?\d+(?:\.\d+)?(?:E[+-]?\d+)?)\s+Y\s*=\s*([+-]?\d+(?:\.\d+)?(?:E[+-]?\d+)?)\s+Z\s*=\s*([+-]?\d+(?:\.\d+)?(?:E[+-]?\d+)?)/gi)];

  const points = matches
    .map(match => {
      const x = Number(match[1]);
      const y = Number(match[2]);
      const z = Number(match[3]);
      if (![x, y, z].every(Number.isFinite)) {
        return null;
      }
      const kmX = x * AU_TO_KM;
      const kmY = y * AU_TO_KM;
      const kmZ = z * AU_TO_KM;
      const s = SCENE_MOON_RADIUS / EARTH_MOON_DISTANCE_KM;
      return new THREE.Vector3(kmX * s, kmY * s, kmZ * s);
    })
    .filter((value): value is THREE.Vector3 => Boolean(value));

  if (points.length < 2) {
    throw new Error('Too few moon orbit points');
  }

  return points;
}

function getMoonPositionForDay(day: number, moonOrbitPoints: THREE.Vector3[]): THREE.Vector3 {
  if (!moonOrbitPoints.length) return new THREE.Vector3();
  if (moonOrbitPoints.length === 1) return moonOrbitPoints[0].clone();

  const synodicMonthDays = 27.321661;
  const normalizedDay = ((day % synodicMonthDays) + synodicMonthDays) % synodicMonthDays;
  const progress = normalizedDay / synodicMonthDays;
  const cursor = progress * moonOrbitPoints.length;
  const idx = Math.floor(cursor) % moonOrbitPoints.length;
  const nextIdx = (idx + 1) % moonOrbitPoints.length;
  const t = cursor - Math.floor(cursor);

  return moonOrbitPoints[idx].clone().lerp(moonOrbitPoints[nextIdx], t);
}

function buildMissionPathPoints(moonOrbitPoints: THREE.Vector3[], samples = 320): THREE.Vector3[] {
  const moonAtFlyby = getMoonPositionForDay(3.45, moonOrbitPoints);
  const perigeeOut = moonAtFlyby.clone().multiplyScalar(0.86);
  const returnAnchor = moonAtFlyby.clone().multiplyScalar(0.72).setY(moonAtFlyby.y - 0.8);
  const departureRadius = EARTH_RADIUS_SCENE + 0.18;

  const control = [
    new THREE.Vector3(departureRadius, 0.24, 0.08),
    new THREE.Vector3(2.2, 1.0, 0.18),
    perigeeOut,
    moonAtFlyby.clone(),
    returnAnchor,
    new THREE.Vector3(1.55, -0.72, -0.1),
    new THREE.Vector3(0.6, -0.4, 0.01),
  ];

  return new THREE.CatmullRomCurve3(control, false, 'centripetal', 0.42).getPoints(samples);
}

export function mountArtemisPage(host: HTMLElement): Cleanup {
  const container = document.createElement('section');
  container.className = 'artemis-page';
  container.innerHTML = `
    <header class="artemis-header">
      <h1>Artemis Console</h1>
    </header>

    <div class="artemis-layout">
      <div class="artemis-stage-wrap">
        <div class="artemis-stage" id="artemis-stage"></div>
        <div class="artemis-overlay">
          <div class="artemis-badge">Earth–Moon View</div>
          <label class="artemis-overlay-control">
            <span id="artemis-scrub-date">Timeline day</span>
            <input id="artemis-scrub" type="range" min="0" max="${MISSION_DURATION_DAYS}" step="0.01" value="0" />
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

  if (!stage || !elapsedEl || !remainingEl || !phaseEl || !detailEl || !distanceEl || !moonDistanceEl || !lighttimeEl || !speedEl || !nowEl || !timelineEl || !galleryEl || !scrubber || !scrubDateEl || !liveButton) {
    return () => undefined;
  }

  const galleryController = new AbortController();
  loadGallery(galleryEl, galleryController.signal).catch(() => {
    if (!galleryController.signal.aborted) {
      galleryEl.innerHTML = '<p class="artemis-gallery-loading">Mission imagery could not be loaded right now.</p>';
    }
  });

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  stage.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x020816, 0.012);

  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 1200);
  camera.position.set(8.5, 5.2, 11.5);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.04;
  controls.target.set(2.7, 0.4, 0);
  controls.autoRotate = true;
  controls.autoRotateSpeed = 0.2;

  scene.add(new THREE.AmbientLight(0x9eb8ff, 0.7));
  scene.add(new THREE.HemisphereLight(0x88b5ff, 0x06080f, 0.55));
  const sunLight = new THREE.DirectionalLight(0xffffff, 1.6);
  sunLight.position.set(15, 10, 9);
  scene.add(sunLight);

  const starfield = createStarfield();
  scene.add(starfield);

  const earthTexture = makePlanetTexture('#1f4bbd', '#6ec8ff');
  const earth = new THREE.Mesh(
    new THREE.SphereGeometry(EARTH_RADIUS_SCENE, 96, 96),
    new THREE.MeshStandardMaterial({ map: earthTexture, emissive: 0x0f2347, emissiveIntensity: 0.18, roughness: 0.75 }),
  );
  scene.add(earth);

  const atmosphere = new THREE.Mesh(
    new THREE.SphereGeometry(ATMOSPHERE_RADIUS_SCENE, 64, 64),
    new THREE.MeshBasicMaterial({ color: 0x62b2ff, transparent: true, opacity: 0.18 }),
  );
  scene.add(atmosphere);

  const moon = new THREE.Mesh(
    new THREE.SphereGeometry(0.31, 64, 64),
    new THREE.MeshStandardMaterial({ color: 0xd0d6de, roughness: 0.96, metalness: 0.02 }),
  );
  moon.position.set(SCENE_MOON_RADIUS, 0, 0);
  scene.add(moon);

  const fallbackMoonOrbitPoints = Array.from({ length: 220 }, (_, idx) => {
    const t = (idx / 220) * Math.PI * 2;
    return new THREE.Vector3(Math.cos(t) * SCENE_MOON_RADIUS, Math.sin(t) * 0.18, Math.sin(t) * 0.14);
  });
  const moonOrbitGeom = new THREE.BufferGeometry().setFromPoints(fallbackMoonOrbitPoints);
  let moonOrbitPoints = [...fallbackMoonOrbitPoints];
  const lunarOrbit = new THREE.LineLoop(
    moonOrbitGeom,
    new THREE.LineBasicMaterial({ color: 0xff7fd0, transparent: true, opacity: 0.95 }),
  );
  scene.add(lunarOrbit);

  const ship = createShipModel();
  scene.add(ship);

  let missionPathPoints = buildMissionPathPoints(moonOrbitPoints, 320);
  const pastPath = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([missionPathPoints[0], missionPathPoints[1]]),
    new THREE.LineBasicMaterial({ color: 0x6ce6ff, transparent: true, opacity: 0.92 }),
  );
  scene.add(pastPath);

  const futurePath = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(missionPathPoints),
    new THREE.LineDashedMaterial({ color: 0x8ac8ff, transparent: true, opacity: 0.82, dashSize: 0.26, gapSize: 0.16 }),
  );
  futurePath.computeLineDistances();
  scene.add(futurePath);

  const timelineMarkers = PHASES.map(phase => {
    const marker = new THREE.Mesh(
      new THREE.SphereGeometry(0.06, 16, 16),
      new THREE.MeshBasicMaterial({ color: 0x9fdcff, transparent: true, opacity: 0.85 }),
    );
    scene.add(marker);
    return { phase, marker };
  });

  const startTs = Date.parse(MISSION_START_ISO);
  const activeCards = Array.from(timelineEl.querySelectorAll<HTMLButtonElement>('.artemis-phase-dot'));
  let raf = 0;
  let previousPos = getShipPosition(0, missionPathPoints);
  let simulatedDay: number | null = null;

  const resize = () => {
    const width = stage.clientWidth;
    const height = Math.max(stage.clientHeight, 440);
    renderer.setSize(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };

  fetchMoonOrbitPoints(new Date(startTs - 3 * 86400000).toISOString(), new Date(startTs + 30 * 86400000).toISOString())
    .then(points => {
      if (points.length > 1) {
        moonOrbitPoints = points;
        moonOrbitGeom.setFromPoints(points);
        missionPathPoints = buildMissionPathPoints(points, 320);
      }
    })
    .catch(() => {
      /* keep fallback orbit */
    });

  const tick = () => {
    const now = new Date();
    const realtimeDay = (now.getTime() - startTs) / (1000 * 60 * 60 * 24);
    const day = simulatedDay ?? realtimeDay;
    const elapsedMs = day * 86400000;
    const progress = getShipProgress(day);
    const phase = missionPhaseForDay(day);

    earth.rotation.y += 0.0019;
    moon.rotation.y += 0.0008;
    starfield.rotation.y += 0.00006;

    moon.position.copy(getMoonPositionForDay(day, moonOrbitPoints));

    const pos = getShipPosition(progress, missionPathPoints);
    ship.position.copy(pos);
    const dir = pos.clone().sub(previousPos);
    ship.lookAt(pos.clone().add(dir.lengthSq() > 0 ? dir.normalize() : new THREE.Vector3(1, 0, 0)));

    const pathIndex = Math.max(1, Math.floor(progress * (missionPathPoints.length - 1)));
    const pastPoints = missionPathPoints.slice(0, pathIndex + 1);
    (pastPath.geometry as THREE.BufferGeometry).setFromPoints(pastPoints);

    const futurePoints = missionPathPoints.slice(Math.max(0, pathIndex - 1));
    (futurePath.geometry as THREE.BufferGeometry).setFromPoints(futurePoints.length > 1 ? futurePoints : missionPathPoints.slice(-2));
    futurePath.computeLineDistances();

    const earthOrigin = new THREE.Vector3(0, 0, 0);
    const distanceKm = (pos.distanceTo(earthOrigin) / SCENE_MOON_RADIUS) * EARTH_MOON_DISTANCE_KM;
    const moonDistanceKm = (pos.distanceTo(moon.position) / SCENE_MOON_RADIUS) * EARTH_MOON_DISTANCE_KM;
    const distanceClamped = Math.max(0, distanceKm);
    const moonDistanceClamped = Math.max(0, moonDistanceKm);
    const lightSeconds = distanceClamped / SPEED_OF_LIGHT_KM_S;
    const speedKmS = Math.max(0, pos.distanceTo(previousPos) * 180);

    elapsedEl.textContent = formatDuration(elapsedMs);
    remainingEl.textContent = formatDuration((MISSION_DURATION_DAYS - day) * 86400000);
    phaseEl.textContent = phase.label;
    detailEl.textContent = phase.detail;
    distanceEl.textContent = `${Math.round(distanceClamped).toLocaleString()} km`;
    moonDistanceEl.textContent = `${Math.round(moonDistanceClamped).toLocaleString()} km`;
    lighttimeEl.textContent = `${lightSeconds.toFixed(2)} s one-way (${(lightSeconds * 2).toFixed(2)} s RTT)`;
    speedEl.textContent = `${speedKmS.toFixed(2)} km/s`;
    nowEl.textContent = formatUtc(new Date(startTs + elapsedMs));
    scrubDateEl.textContent = `${formatUtc(new Date(startTs + day * 86400000)).slice(0, 16)} • T+${Math.max(0, day).toFixed(2)}d`;
    liveButton.classList.toggle('is-live', simulatedDay === null);
    if (simulatedDay === null) scrubber.value = String(Math.max(0, Math.min(MISSION_DURATION_DAYS, day)));

    for (const { phase: phasePoint, marker } of timelineMarkers) {
      const markerProgress = getShipProgress(phasePoint.startDay);
      marker.position.copy(getShipPosition(markerProgress, missionPathPoints));
      marker.material.opacity = progress >= markerProgress ? 0.95 : 0.28;
    }

    for (const card of activeCards) {
      const startDay = Number(card.dataset.startDay ?? Number.NaN);
      card.classList.toggle('is-active', card.dataset.phase === phase.label);
      card.classList.toggle('is-complete', Number.isFinite(startDay) && day >= startDay);
    }

    previousPos = pos.clone();

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
    if (Math.abs(Number(scrubber.value) - realtimeMissionDay()) < 0.05) {
      simulatedDay = null;
    }
  });
  liveButton.addEventListener('click', () => {
    simulatedDay = null;
    scrubber.value = String(Math.max(0, Math.min(MISSION_DURATION_DAYS, realtimeMissionDay())));
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

  function realtimeMissionDay(): number {
    return (Date.now() - startTs) / 86400000;
  }

  return () => {
    galleryController.abort();
    window.cancelAnimationFrame(raf);
    window.removeEventListener('resize', resize);
    controls.dispose();
    renderer.dispose();

    [pastPath, futurePath, lunarOrbit].forEach(line => {
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
        if (Array.isArray(material)) {
          material.forEach(m => m.dispose());
        } else {
          material.dispose();
        }
      }
    });

    earthTexture.dispose();
    starfield.geometry.dispose();
    (starfield.material as THREE.Material).dispose();

    if (host.contains(container)) {
      host.removeChild(container);
    }
  };
}
