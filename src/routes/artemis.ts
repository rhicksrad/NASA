import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { imagesSearch, type NasaImageItem } from '../api/nasaImages';
import '../styles/artemis.css';

type Cleanup = () => void;

type MissionPhase = {
  startDay: number;
  label: string;
  detail: string;
};

type GallerySlot = {
  title: string;
  query: string;
  note: string;
};

const MISSION_START_ISO = '2026-04-01T16:50:00Z';
const MISSION_DURATION_DAYS = 10;
const EARTH_MOON_DISTANCE_KM = 384_400;
const SPEED_OF_LIGHT_KM_S = 299_792;

const PHASES: MissionPhase[] = [
  { startDay: 0, label: 'TLI burn', detail: 'Orion departs parking orbit and commits to translunar trajectory.' },
  { startDay: 1.25, label: 'Deep-space cruise', detail: 'Crew executes systems checks and optical navigation updates.' },
  { startDay: 3.45, label: 'Lunar flyby', detail: 'Perilune pass leverages lunar gravity to target Earth return corridor.' },
  { startDay: 4.6, label: 'Return arc', detail: 'Trajectory correction maneuvers trim entry interface conditions.' },
  { startDay: 9.2, label: 'Entry & recovery', detail: 'Crew configures skip-entry guidance for Pacific splashdown operations.' },
];

const MISSION_FACTS = [
  'Profile: crewed free-return lunar flyby with high-energy Earth re-entry.',
  'Reference frame: Earth-Moon transfer approximation for public mission awareness.',
  'Distance model scales to the mean Earth-Moon separation (384,400 km).',
  'Mission clock and phase transitions update in real time using UTC.',
  'All mission imagery is loaded from NASA public archives via worker-backed search.',
];

const GALLERY_SLOTS: GallerySlot[] = [
  {
    title: 'Earth from Orion',
    query: 'Artemis I Earth view from Orion spacecraft',
    note: 'Orion camera view of Earth during Artemis transit.',
  },
  {
    title: 'Earthrise (Apollo 8)',
    query: 'Apollo 8 Earthrise William Anders',
    note: 'Historic Earthrise photo captured by astronaut William Anders.',
  },
  {
    title: 'Orion near Moon',
    query: 'Artemis Orion spacecraft Moon',
    note: 'Artemis-era Orion imagery around lunar operations.',
  },
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

function getShipPosition(progress: number): THREE.Vector3 {
  const earth = new THREE.Vector3(0, 0, 0);
  const moon = new THREE.Vector3(5.8, 0, 0);

  if (progress <= 0.5) {
    const outbound = progress / 0.5;
    return new THREE.Vector3().lerpVectors(earth, moon, outbound).add(new THREE.Vector3(0, Math.sin(outbound * Math.PI) * 1.55, 0));
  }

  const inbound = (progress - 0.5) / 0.5;
  return new THREE.Vector3().lerpVectors(moon, earth, inbound).add(new THREE.Vector3(0, Math.sin(inbound * Math.PI) * -1.55, 0));
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

function formatUtc(date: Date): string {
  return `${date.toISOString().replace('T', ' ').slice(0, 19)} UTC`;
}

function buildGalleryCard(item: NasaImageItem, slot: GallerySlot): HTMLElement {
  const article = document.createElement('article');
  article.className = 'artemis-gallery-card';

  const image = document.createElement('img');
  image.src = item.thumb;
  image.alt = item.title || slot.title;
  image.loading = 'lazy';
  image.decoding = 'async';

  const content = document.createElement('div');
  const heading = document.createElement('h4');
  heading.textContent = item.title || slot.title;

  const note = document.createElement('p');
  note.textContent = slot.note;

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
  const results = await Promise.all(
    GALLERY_SLOTS.map(async slot => {
      const response = await imagesSearch({ q: slot.query, page: 1 }, { signal });
      return { slot, item: response.items.find(entry => entry.thumb) ?? null };
    }),
  );

  if (signal.aborted) return;

  const cards = results
    .filter((entry): entry is { slot: GallerySlot; item: NasaImageItem } => Boolean(entry.item))
    .map(({ slot, item }) => buildGalleryCard(item, slot));

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
      <p class="artemis-kicker">Artemis mission operations</p>
      <h1>Professional Earth–Moon Mission Console</h1>
      <p class="artemis-subhead">High-contrast 3D situational display, phase timeline, and mission media stream for Artemis operations storytelling.</p>
    </header>

    <div class="artemis-layout">
      <div class="artemis-stage-wrap">
        <div class="artemis-stage" id="artemis-stage"></div>
        <div class="artemis-overlay">
          <div class="artemis-badge">Live</div>
          <p>Earth–Moon transfer visualization (reference profile)</p>
        </div>
      </div>

      <aside class="artemis-panel" aria-live="polite">
        <h2>Mission telemetry</h2>
        <dl>
          <div><dt>Mission clock</dt><dd id="artemis-elapsed">--</dd></div>
          <div><dt>Current phase</dt><dd id="artemis-phase">--</dd></div>
          <div><dt>Phase detail</dt><dd id="artemis-detail">--</dd></div>
          <div><dt>Distance from Earth</dt><dd id="artemis-distance">--</dd></div>
          <div><dt>Downlink light time</dt><dd id="artemis-lighttime">--</dd></div>
          <div><dt>Relative speed</dt><dd id="artemis-speed">--</dd></div>
          <div><dt>UTC now</dt><dd id="artemis-now">--</dd></div>
        </dl>

        <section class="artemis-facts">
          <h3>Mission profile data</h3>
          <ul>${MISSION_FACTS.map(fact => `<li>${fact}</li>`).join('')}</ul>
        </section>

        <section class="artemis-gallery">
          <h3>Mission image sidebar</h3>
          <div id="artemis-gallery-list" class="artemis-gallery-list"></div>
        </section>
      </aside>
    </div>

    <section class="artemis-timeline" id="artemis-timeline">
      ${PHASES.map(phase => `<article class="artemis-phase-card" data-phase="${phase.label}"><h4>${phase.label}</h4><p>T+${phase.startDay.toFixed(1)} days</p><small>${phase.detail}</small></article>`).join('')}
    </section>
  `;

  host.replaceChildren(container);

  const stage = container.querySelector<HTMLElement>('#artemis-stage');
  const elapsedEl = container.querySelector<HTMLElement>('#artemis-elapsed');
  const phaseEl = container.querySelector<HTMLElement>('#artemis-phase');
  const detailEl = container.querySelector<HTMLElement>('#artemis-detail');
  const distanceEl = container.querySelector<HTMLElement>('#artemis-distance');
  const lighttimeEl = container.querySelector<HTMLElement>('#artemis-lighttime');
  const speedEl = container.querySelector<HTMLElement>('#artemis-speed');
  const nowEl = container.querySelector<HTMLElement>('#artemis-now');
  const timelineEl = container.querySelector<HTMLElement>('#artemis-timeline');
  const galleryEl = container.querySelector<HTMLElement>('#artemis-gallery-list');

  if (!stage || !elapsedEl || !phaseEl || !detailEl || !distanceEl || !lighttimeEl || !speedEl || !nowEl || !timelineEl || !galleryEl) {
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
    new THREE.SphereGeometry(1.12, 96, 96),
    new THREE.MeshStandardMaterial({ map: earthTexture, emissive: 0x0f2347, emissiveIntensity: 0.18, roughness: 0.75 }),
  );
  scene.add(earth);

  const atmosphere = new THREE.Mesh(
    new THREE.SphereGeometry(1.2, 64, 64),
    new THREE.MeshBasicMaterial({ color: 0x62b2ff, transparent: true, opacity: 0.18 }),
  );
  scene.add(atmosphere);

  const moon = new THREE.Mesh(
    new THREE.SphereGeometry(0.31, 64, 64),
    new THREE.MeshStandardMaterial({ color: 0xd0d6de, roughness: 0.96, metalness: 0.02 }),
  );
  moon.position.set(5.8, 0, 0);
  scene.add(moon);

  const lunarOrbit = new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints(
      Array.from({ length: 160 }, (_, idx) => {
        const t = (idx / 160) * Math.PI * 2;
        return new THREE.Vector3(Math.cos(t) * 5.8, 0, Math.sin(t) * 0.12);
      }),
    ),
    new THREE.LineBasicMaterial({ color: 0x4fa0d9, transparent: true, opacity: 0.25 }),
  );
  scene.add(lunarOrbit);

  const ship = new THREE.Mesh(
    new THREE.ConeGeometry(0.11, 0.43, 16),
    new THREE.MeshStandardMaterial({ color: 0xf7f9ff, emissive: 0x3f4f7a, emissiveIntensity: 0.45, metalness: 0.35, roughness: 0.3 }),
  );
  ship.rotation.z = Math.PI / 2;
  scene.add(ship);

  const arcPoints: THREE.Vector3[] = [];
  for (let i = 0; i <= 180; i += 1) {
    arcPoints.push(getShipPosition(i / 180));
  }
  const path = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(arcPoints),
    new THREE.LineBasicMaterial({ color: 0x6ce6ff, transparent: true, opacity: 0.9 }),
  );
  scene.add(path);

  const startTs = Date.parse(MISSION_START_ISO);
  const activeCards = Array.from(timelineEl.querySelectorAll<HTMLElement>('.artemis-phase-card'));
  let raf = 0;
  let previousPos = getShipPosition(0);

  const resize = () => {
    const width = stage.clientWidth;
    const height = Math.max(stage.clientHeight, 440);
    renderer.setSize(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };

  const tick = () => {
    const now = new Date();
    const elapsedMs = now.getTime() - startTs;
    const day = elapsedMs / (1000 * 60 * 60 * 24);
    const progress = getShipProgress(day);
    const phase = missionPhaseForDay(day);

    earth.rotation.y += 0.0019;
    moon.rotation.y += 0.0008;
    starfield.rotation.y += 0.00006;

    const pos = getShipPosition(progress);
    ship.position.copy(pos);
    ship.lookAt(pos.clone().add(pos.clone().sub(previousPos).normalize()));

    const distanceKm = (pos.distanceTo(new THREE.Vector3(0, 0, 0)) / 5.8) * EARTH_MOON_DISTANCE_KM;
    const distanceClamped = Math.max(0, distanceKm);
    const lightSeconds = distanceClamped / SPEED_OF_LIGHT_KM_S;
    const speedKmS = Math.max(0, pos.distanceTo(previousPos) * 420);

    elapsedEl.textContent = formatDuration(elapsedMs);
    phaseEl.textContent = phase.label;
    detailEl.textContent = phase.detail;
    distanceEl.textContent = `${Math.round(distanceClamped).toLocaleString()} km`;
    lighttimeEl.textContent = `${lightSeconds.toFixed(2)} s one-way (${(lightSeconds * 2).toFixed(2)} s RTT)`;
    speedEl.textContent = `${speedKmS.toFixed(2)} km/s`;
    nowEl.textContent = formatUtc(now);

    for (const card of activeCards) {
      const isActive = card.dataset.phase === phase.label;
      card.classList.toggle('is-active', isActive);
    }

    previousPos = pos.clone();

    controls.update();
    renderer.render(scene, camera);
    raf = window.requestAnimationFrame(tick);
  };

  resize();
  window.addEventListener('resize', resize);
  raf = window.requestAnimationFrame(tick);

  return () => {
    galleryController.abort();
    window.cancelAnimationFrame(raf);
    window.removeEventListener('resize', resize);
    controls.dispose();
    renderer.dispose();

    [path, lunarOrbit].forEach(line => {
      line.geometry.dispose();
      (line.material as THREE.Material).dispose();
    });

    [earth, atmosphere, moon, ship].forEach(mesh => {
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    });
    earthTexture.dispose();
    starfield.geometry.dispose();
    (starfield.material as THREE.Material).dispose();

    if (host.contains(container)) {
      host.removeChild(container);
    }
  };
}
