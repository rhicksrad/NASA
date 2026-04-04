import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import '../styles/artemis.css';

type Cleanup = () => void;

type MissionPhase = {
  startDay: number;
  label: string;
  detail: string;
};

const MISSION_START_ISO = '2026-04-01T16:50:00Z';
const MISSION_DURATION_DAYS = 10;
const EARTH_MOON_DISTANCE_KM = 384400;

const PHASES: MissionPhase[] = [
  { startDay: 0, label: 'Trans-lunar injection', detail: 'Orion departs Earth orbit and heads toward lunar distance.' },
  { startDay: 1.5, label: 'Outbound cruise', detail: 'Crew systems checkouts continue during deep-space coast.' },
  { startDay: 3.6, label: 'Lunar flyby', detail: 'Orion swings behind the Moon for gravity-assisted return.' },
  { startDay: 4.5, label: 'Return transit', detail: 'Spacecraft arcs back toward Earth with daily navigation updates.' },
  { startDay: 9.2, label: 'Re-entry prep', detail: 'Entry systems are configured for splashdown operations.' },
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
  const moon = new THREE.Vector3(4.8, 0, 0);

  if (progress <= 0.5) {
    const outbound = progress / 0.5;
    return new THREE.Vector3().lerpVectors(earth, moon, outbound).add(new THREE.Vector3(0, Math.sin(outbound * Math.PI) * 1.1, 0));
  }

  const inbound = (progress - 0.5) / 0.5;
  return new THREE.Vector3().lerpVectors(moon, earth, inbound).add(new THREE.Vector3(0, Math.sin(inbound * Math.PI) * -1.1, 0));
}

export function mountArtemisPage(host: HTMLElement): Cleanup {
  const container = document.createElement('section');
  container.className = 'artemis-page';
  container.innerHTML = `
    <header class="artemis-header">
      <p class="artemis-kicker">Artemis Live Tracker</p>
      <h1>Earth–Moon 3D Mission View</h1>
      <p class="artemis-subhead">A live mission clock with a simplified orbital scene of Earth, Moon, and Orion.</p>
    </header>
    <div class="artemis-layout">
      <div class="artemis-stage" id="artemis-stage"></div>
      <aside class="artemis-panel" aria-live="polite">
        <h2>Current Mission Status</h2>
        <dl>
          <div><dt>Mission clock</dt><dd id="artemis-elapsed">--</dd></div>
          <div><dt>Current phase</dt><dd id="artemis-phase">--</dd></div>
          <div><dt>Phase detail</dt><dd id="artemis-detail">--</dd></div>
          <div><dt>Ship distance from Earth</dt><dd id="artemis-distance">--</dd></div>
          <div><dt>UTC now</dt><dd id="artemis-now">--</dd></div>
        </dl>
      </aside>
    </div>
  `;

  host.replaceChildren(container);

  const stage = container.querySelector<HTMLElement>('#artemis-stage');
  const elapsedEl = container.querySelector<HTMLElement>('#artemis-elapsed');
  const phaseEl = container.querySelector<HTMLElement>('#artemis-phase');
  const detailEl = container.querySelector<HTMLElement>('#artemis-detail');
  const distanceEl = container.querySelector<HTMLElement>('#artemis-distance');
  const nowEl = container.querySelector<HTMLElement>('#artemis-now');

  if (!stage || !elapsedEl || !phaseEl || !detailEl || !distanceEl || !nowEl) {
    return () => undefined;
  }

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  stage.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
  camera.position.set(7, 5, 10);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.target.set(2.2, 0, 0);

  scene.add(new THREE.AmbientLight(0xa7b7ff, 0.9));
  const sunLight = new THREE.DirectionalLight(0xffffff, 1.2);
  sunLight.position.set(10, 8, 7);
  scene.add(sunLight);

  const earth = new THREE.Mesh(
    new THREE.SphereGeometry(1, 48, 48),
    new THREE.MeshStandardMaterial({ color: 0x2e6dff, emissive: 0x0f1f40, roughness: 0.8 }),
  );
  scene.add(earth);

  const moon = new THREE.Mesh(
    new THREE.SphereGeometry(0.27, 32, 32),
    new THREE.MeshStandardMaterial({ color: 0xbfc5cf, roughness: 1 }),
  );
  moon.position.set(4.8, 0, 0);
  scene.add(moon);

  const ship = new THREE.Mesh(
    new THREE.ConeGeometry(0.1, 0.35, 10),
    new THREE.MeshStandardMaterial({ color: 0xf8f8f6, emissive: 0x4a4a4a }),
  );
  ship.rotation.z = Math.PI / 2;
  scene.add(ship);

  const arcPoints: THREE.Vector3[] = [];
  for (let i = 0; i <= 80; i += 1) {
    arcPoints.push(getShipPosition(i / 80));
  }
  const path = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(arcPoints),
    new THREE.LineBasicMaterial({ color: 0x5fd9ff, transparent: true, opacity: 0.6 }),
  );
  scene.add(path);

  const startTs = Date.parse(MISSION_START_ISO);
  let raf = 0;

  const resize = () => {
    const width = stage.clientWidth;
    const height = Math.max(stage.clientHeight, 420);
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

    earth.rotation.y += 0.0023;
    moon.rotation.y += 0.001;

    const pos = getShipPosition(progress);
    ship.position.copy(pos);
    ship.lookAt(pos.clone().add(new THREE.Vector3(0.2, 0, 0)));

    elapsedEl.textContent = formatDuration(elapsedMs);
    phaseEl.textContent = phase.label;
    detailEl.textContent = phase.detail;
    distanceEl.textContent = `${Math.round(pos.length() / 4.8 * EARTH_MOON_DISTANCE_KM).toLocaleString()} km`;
    nowEl.textContent = now.toISOString().replace('T', ' ').slice(0, 19) + ' UTC';

    controls.update();
    renderer.render(scene, camera);
    raf = window.requestAnimationFrame(tick);
  };

  resize();
  window.addEventListener('resize', resize);
  raf = window.requestAnimationFrame(tick);

  return () => {
    window.cancelAnimationFrame(raf);
    window.removeEventListener('resize', resize);
    controls.dispose();
    renderer.dispose();
    path.geometry.dispose();
    (path.material as THREE.Material).dispose();
    earth.geometry.dispose();
    (earth.material as THREE.Material).dispose();
    moon.geometry.dispose();
    (moon.material as THREE.Material).dispose();
    ship.geometry.dispose();
    (ship.material as THREE.Material).dispose();
    if (host.contains(container)) {
      host.removeChild(container);
    }
  };
}
