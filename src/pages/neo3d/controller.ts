/** Wires the NEO 3D page: scene, planets, playback, the Wow! overlay and the object list. */
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { NeoItem } from '../../api/neo';
import { isTypingTarget } from '../../lib/dom';
import { toastError } from '../../lib/toast';
import '../../styles/sbdbSearch.css';
import { createObjectList, type InitNeo3DOptions } from './objectList';
import { PLANET_CONFIG, PlanetManager } from './planets';
import { initPlaybackControls, SPEED_PRESETS } from './playback';
import { SBDBSearch } from './sbdb/SBDBSearch';
import { Neo3D } from './scene/Neo3D';
import { createWowSignalLayer } from './scene/WowSignalLayer';
import { initViewControls } from './viewControls';

export type { InitNeo3DOptions, NeoLoadMoreResponse } from './objectList';

const DAY_MS = 86_400_000;
const DEFAULT_RANGE_DAYS = 120;

export interface Neo3DController {
  setNeos(neos: NeoItem[], options?: { hasMore?: boolean }): void;
}

/** Toggle for the Wow! Signal overlay: a checkbox plus the "W" keyboard shortcut. */
function initWowToggle(setLayerVisible: (visible: boolean) => void): void {
  const checkbox = document.getElementById('neo3d-wow-toggle') as HTMLInputElement | null;
  let visible = true;
  const apply = (next: boolean) => {
    visible = next;
    setLayerVisible(next);
    if (checkbox) checkbox.checked = next;
  };
  apply(true);

  checkbox?.addEventListener('change', () => apply(checkbox.checked));
  window.addEventListener('keydown', (event) => {
    if (event.key.toLowerCase() !== 'w' || event.ctrlKey || event.metaKey || event.altKey) return;
    // Don't hijack the letter while someone is typing in the SBDB search box.
    if (isTypingTarget(event.target)) return;
    apply(!visible);
  });
}

export async function initNeo3D(
  getSelectedNeos: () => NeoItem[],
  host: HTMLElement,
  options: InitNeo3DOptions = {},
): Promise<Neo3DController> {
  const now = new Date();
  const rangeStart = new Date(now.getTime() - (DEFAULT_RANGE_DAYS / 2) * DAY_MS);
  const rangeEnd = new Date(now.getTime() + (DEFAULT_RANGE_DAYS / 2) * DAY_MS);
  const timeLabel = document.getElementById('neo3d-time-label');

  // The scene reports clock ticks before the playback controls exist, so route through a late-bound hook.
  let onDateChange: (date: Date) => void = () => undefined;
  const simulation = new Neo3D({
    host,
    initialDate: now,
    minDate: rangeStart,
    maxDate: rangeEnd,
    onDateChange: (date) => onDateChange(date),
  });

  const planets = new PlanetManager(PLANET_CONFIG, (name) => toastError(`${name} Horizons unavailable`));
  await planets.prime(now);
  simulation.setPlanets(planets.providers());

  simulation.setTimeScale(SPEED_PRESETS[SPEED_PRESETS.length - 1].seconds);
  simulation.setPaused(true);
  simulation.start();

  const wowLayer = createWowSignalLayer({
    scene: simulation.getScene(),
    camera: simulation.getCamera(),
    renderer: simulation.getRenderer(),
    host: simulation.getHostElement(),
    celestialRadius: simulation.getCelestialRadius(),
  });
  simulation.addOverlay(wowLayer.group);
  initWowToggle((visible) => wowLayer.setVisible(visible));

  if (import.meta.env.DEV) {
    // Handy in the console while developing; never shipped.
    Object.assign(window, { __neo3d: simulation });
  }

  initViewControls(simulation);
  onDateChange = initPlaybackControls(simulation, { rangeStart, rangeEnd, timeLabel }).onDateChange;

  const objectList = createObjectList(simulation, options);

  const sbdbHost = document.getElementById('sbdb-explorer-host');
  if (sbdbHost) {
    createRoot(sbdbHost).render(
      createElement(SBDBSearch, { onAdd: (identifier) => void objectList.addSbdbObject(identifier) }),
    );
  }

  objectList.setNeos(getSelectedNeos(), { hasMore: Boolean(options.loadMore) });

  return { setNeos: objectList.setNeos };
}
