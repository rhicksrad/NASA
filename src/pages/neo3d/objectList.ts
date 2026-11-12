/** The object list beside the viewport: catalogue NEOs plus anything added from SBDB. */
import type { NeoItem } from '../../api/neo';
import { loadSBDBConic } from '../../api/sbdb';
import { escapeHtml } from '../../lib/dom';
import { icon, type IconName } from '../../lib/icons';
import { jdFromDate } from '../../lib/julian';
import { toast, toastError } from '../../lib/toast';
import { propagateConic, type ConicElements } from '../../orbits/conic';
import type { Keplerian } from '../../orbits/kepler';
import {
  createNeoCandidate,
  formatNeoSize,
  formatNextApproach,
  getNeoDisplayName,
  normalizeEntryKey,
  orbitColorFromEccentricity,
  type NeoCandidate,
} from './neoCandidates';
import type { Neo3D, SmallBodySpec } from './scene/Neo3D';

const NEO_BATCH_SIZE = 50;

const isFinite3 = (v: readonly number[]): boolean => v.length === 3 && v.every(Number.isFinite);

export type NeoLoadMoreResponse = { neos?: NeoItem[]; done?: boolean } | NeoItem[] | null | undefined;

export interface InitNeo3DOptions {
  loadMore?: () => Promise<NeoLoadMoreResponse>;
}

export interface ObjectList {
  setNeos(neos: NeoItem[], options?: { hasMore?: boolean }): void;
  /** Looks an object up in SBDB and adds it to the scene. */
  addSbdbObject(query: string): Promise<void>;
}

export function createObjectList(simulation: Neo3D, options: InitNeo3DOptions = {}): ObjectList {
  const neoAllToggle = document.getElementById('neo3d-toggle-neos') as HTMLInputElement | null;
  const neoHazardToggle = document.getElementById('neo3d-hazard') as HTMLInputElement | null;
  const neoLoadMore = document.getElementById('neo3d-load-more') as HTMLButtonElement | null;
  const neoList = document.getElementById('neo3d-neo-list') as HTMLElement | null;
  const neoSummary = document.getElementById('neo3d-neo-summary') as HTMLElement | null;
  const sbdbLoaded = document.getElementById('sbdb-loaded') as HTMLDivElement | null;
  const sbdbLoadedEmpty = document.getElementById('sbdb-loaded-empty') as HTMLElement | null;

  const loadMoreHandler = options.loadMore ?? null;
  let loadMoreDone = loadMoreHandler ? false : true;
  let loadMoreInFlight = false;
  let pendingLoad: Promise<boolean> | null = null;

  type EntrySource = 'neo' | 'sbdb';

  type NeoEntry = {
    spec: SmallBodySpec;
    enabled: boolean;
    checkbox: HTMLInputElement | null;
    element: HTMLDivElement;
    normalizedKeys: string[];
    source: EntrySource;
  };

  const neoEntries = new Map<string, NeoEntry>();
  const entryKeyIndex = new Map<string, string>();
  let allNeos: NeoCandidate[] = [];
  let activeNeos: NeoCandidate[] = [];
  let hazardOnly = neoHazardToggle?.checked ?? false;
  let nextNeoIndex = 0;

  const isHazardousCandidate = (candidate: NeoCandidate): boolean =>
    candidate.neo.is_potentially_hazardous_asteroid === true;

  const recomputeActiveNeos = () => {
    activeNeos = hazardOnly ? allNeos.filter((candidate) => isHazardousCandidate(candidate)) : [...allNeos];
    nextNeoIndex = 0;
  };
  let sbdbCounter = 0;
  type LoadedSbdbEntry = {
    spec: SmallBodySpec;
    chip: HTMLSpanElement | null;
    entryId: string;
    keys: Set<string>;
    primaryKey: string;
    label: string;
  };
  const sbdbEntries = new Map<string, LoadedSbdbEntry>();
  const sbdbAliasIndex = new Map<string, string>();

  function makeColorFor(label: string): number {
    if (/atlas/i.test(label)) return 0xf87171;
    let hash = 0;
    for (let i = 0; i < label.length; i += 1) {
      hash = ((hash << 5) - hash + label.charCodeAt(i)) | 0;
    }
    const hues = [0x22d3ee, 0x34d399, 0xf59e0b, 0x818cf8, 0x60a5fa, 0x10b981, 0xeab308];
    return hues[Math.abs(hash) % hues.length];
  }

  const clearEmptyState = () => {
    if (!neoList) return;
    const empty = neoList.querySelector('.neo3d-empty');
    empty?.remove();
  };

  const renderNeoEmptyState = () => {
    if (!neoList || neoEntries.size > 0) return;
    neoList.innerHTML = '';
    const empty = document.createElement('div');
    empty.className = 'neo3d-empty';
    empty.setAttribute('role', 'listitem');
    empty.textContent = hazardOnly
      ? 'None of the loaded objects is classed as potentially hazardous.'
      : 'NEOs with orbital data will appear here when available.';
    neoList.appendChild(empty);
  };

  const getRemainingNeos = () => Math.max(0, activeNeos.length - nextNeoIndex);

  const appendNeoCandidates = (neos: NeoItem[]): boolean => {
    let appended = false;
    for (const neo of neos) {
      const candidate = createNeoCandidate(neo);
      if (candidate) {
        allNeos.push(candidate);
        if (!hazardOnly || isHazardousCandidate(candidate)) {
          activeNeos.push(candidate);
        }
        appended = true;
      }
    }
    return appended;
  };

  const normalizeLoadMoreResult = (result: NeoLoadMoreResponse): { neos: NeoItem[]; done: boolean } => {
    if (!result) {
      return { neos: [], done: true };
    }
    if (Array.isArray(result)) {
      return { neos: result, done: false };
    }
    const { neos, done } = result;
    return { neos: Array.isArray(neos) ? neos : [], done: done === true };
  };

  const requestAdditionalNeos = async (): Promise<boolean> => {
    if (!loadMoreHandler || loadMoreDone) {
      return false;
    }
    if (pendingLoad) {
      return pendingLoad;
    }
    loadMoreInFlight = true;
    updateLoadMoreState();
    const loadPromise = (async () => {
      try {
        const raw = await loadMoreHandler();
        const { neos: newNeos, done } = normalizeLoadMoreResult(raw);
        const appended = newNeos.length ? appendNeoCandidates(newNeos) : false;
        if (done) {
          loadMoreDone = true;
        }
        return appended;
      } catch (error) {
        console.error('[neo3d] failed to load additional NEOs', error);
        toastError('Failed to load more NEOs.');
        return false;
      } finally {
        loadMoreInFlight = false;
        updateLoadMoreState();
        pendingLoad = null;
      }
    })();
    pendingLoad = loadPromise;
    return loadPromise;
  };

  const updateSbdbLoadedState = () => {
    if (sbdbLoadedEmpty) {
      sbdbLoadedEmpty.hidden = sbdbEntries.size > 0;
    }
    if (sbdbLoaded && sbdbEntries.size === 0) {
      sbdbLoaded.innerHTML = '';
    }
  };

  updateSbdbLoadedState();

  const setLoadMoreContent = (text: string, iconName: IconName, iconLabel: string) => {
    if (!neoLoadMore) return;
    neoLoadMore.innerHTML = `${icon(iconName, { label: iconLabel })}<span>${text}</span>`;
  };

  const updateLoadMoreState = () => {
    if (!neoLoadMore) return;
    const remaining = getRemainingNeos();
    const hasLocal = remaining > 0;
    const canFetchMore = Boolean(loadMoreHandler) && !loadMoreDone;
    const shouldShow = hasLocal || canFetchMore;
    neoLoadMore.hidden = !shouldShow;
    if (!shouldShow) {
      neoLoadMore.disabled = true;
      return;
    }
    if (loadMoreInFlight) {
      neoLoadMore.disabled = true;
      setLoadMoreContent('Loading…', 'orbit', 'Loading more NEOs');
      return;
    }
    neoLoadMore.disabled = false;
    if (hasLocal) {
      const nextCount = Math.min(NEO_BATCH_SIZE, remaining);
      setLoadMoreContent(`Add ${nextCount} more`, 'plus', 'Add more NEOs to the scene');
    } else {
      setLoadMoreContent(`Add ${NEO_BATCH_SIZE} more`, 'plus', 'Request additional NEOs');
    }
  };

  const registerEntryKeys = (id: string, keys: string[]) => {
    for (const key of keys) {
      if (key) {
        entryKeyIndex.set(key, id);
      }
    }
  };

  const unregisterEntryKeys = (id: string) => {
    for (const [key, value] of entryKeyIndex.entries()) {
      if (value === id) {
        entryKeyIndex.delete(key);
      }
    }
  };

  const insertEntryElement = (entry: NeoEntry, anchor?: Element | null) => {
    if (!neoList) return;
    if (anchor && anchor.parentElement === neoList) {
      neoList.insertBefore(entry.element, anchor);
    } else {
      if (entry.source === 'neo') {
        const sbdbAnchor = neoList.querySelector('[data-source="sbdb"]');
        if (sbdbAnchor) {
          neoList.insertBefore(entry.element, sbdbAnchor);
          return;
        }
      }
      neoList.appendChild(entry.element);
    }
  };

  const addEntry = (id: string, entry: NeoEntry, anchor?: Element | null) => {
    registerEntryKeys(id, entry.normalizedKeys);
    neoEntries.set(id, entry);
    clearEmptyState();
    insertEntryElement(entry, anchor);
  };

  const removeEntry = (id: string) => {
    const entry = neoEntries.get(id);
    if (!entry) return;
    if (entry.source === 'sbdb') {
      const sbdbEntry = sbdbEntries.get(id);
      if (sbdbEntry) {
        for (const aliasKey of sbdbEntry.keys) {
          sbdbAliasIndex.delete(aliasKey);
        }
        sbdbEntry.chip?.remove();
        sbdbEntry.chip = null;
        sbdbEntries.delete(id);
      }
      updateSbdbLoadedState();
    }
    unregisterEntryKeys(id);
    entry.element.remove();
    neoEntries.delete(id);
    if (neoEntries.size === 0) {
      renderNeoEmptyState();
    }
  };

  const removeEntriesBySource = (source: EntrySource) => {
    const ids = Array.from(neoEntries.entries())
      .filter(([, entry]) => entry.source === source)
      .map(([id]) => id);
    for (const id of ids) {
      removeEntry(id);
    }
  };

  const countEntries = () => {
    let neoCount = 0;
    let sbdbCount = 0;
    let enabledCount = 0;
    for (const entry of neoEntries.values()) {
      if (entry.source === 'neo') {
        neoCount += 1;
      } else {
        sbdbCount += 1;
      }
      if (entry.enabled) {
        enabledCount += 1;
      }
    }
    return { neoCount, sbdbCount, enabledCount, total: neoCount + sbdbCount };
  };

  const updateAllToggleState = () => {
    if (!neoAllToggle) return;
    const { total, enabledCount } = countEntries();
    if (total === 0) {
      neoAllToggle.checked = false;
      neoAllToggle.indeterminate = false;
      neoAllToggle.disabled = true;
      return;
    }
    neoAllToggle.disabled = false;
    neoAllToggle.checked = enabledCount === total;
    neoAllToggle.indeterminate = enabledCount > 0 && enabledCount < total;
  };

  const updateNeoSummary = () => {
    if (!neoSummary) return;
    const counts = countEntries();
    const activeCount = activeNeos.length;
    const remaining = getRemainingNeos();
    const canFetchMore = Boolean(loadMoreHandler) && !loadMoreDone;

    if (counts.total === 0) {
      if (activeCount === 0) {
        if (hazardOnly) {
          if (allNeos.length > 0) {
            neoSummary.textContent = 'None of the loaded objects is classed as potentially hazardous.';
          } else if (canFetchMore) {
            neoSummary.textContent = 'Fetching the catalogue.';
          } else {
            neoSummary.textContent = 'None of the loaded objects is classed as potentially hazardous.';
          }
        } else if (!allNeos.length) {
          neoSummary.textContent = canFetchMore ? 'Fetching the catalogue.' : 'No near-Earth objects with orbit data are available.';
        } else if (remaining > 0 || canFetchMore) {
          neoSummary.textContent = 'Add more to put them in the scene.';
        } else {
          neoSummary.textContent = 'No near-Earth objects with orbit data are available.';
        }
      } else {
        neoSummary.textContent = 'Add more to put them in the scene.';
      }
      return;
    }

    if (hazardOnly && counts.neoCount === 0) {
      neoSummary.textContent =
        counts.sbdbCount > 0
          ? 'None of the loaded near-Earth objects is classed as potentially hazardous. The ones you added are still shown.'
          : 'None of the loaded objects is classed as potentially hazardous.';
      return;
    }

    const parts: string[] = [];
    if (counts.enabledCount === 0) parts.push(`All ${counts.total} objects are hidden.`);
    else if (counts.enabledCount === counts.total) parts.push(`${counts.total} objects in the scene.`);
    else parts.push(`${counts.enabledCount} of ${counts.total} objects in the scene.`);
    if (counts.sbdbCount > 0) parts.push(`${counts.sbdbCount} added from the Small-Body Database.`);
    if (hazardOnly) parts.push('Only potentially hazardous ones are listed.');
    if (remaining > 0) parts.push(`${remaining} more are ready to add.`);
    else if (canFetchMore) parts.push('More can be fetched.');
    const message = parts.join(' ');
    neoSummary.textContent = message;
  };

  const refreshNeoUi = () => {
    updateAllToggleState();
    updateNeoSummary();
    updateLoadMoreState();
  };

  const formatDiameterValue = (km: number | undefined | null): string | null => {
    if (!(typeof km === 'number' && Number.isFinite(km)) || km <= 0) return null;
    if (km >= 1) return `${km.toFixed(1)} km`;
    const meters = km * 1000;
    if (meters >= 1) return `${meters.toFixed(0)} m`;
    return `${(meters * 100).toFixed(0)} cm`;
  };

  function updateSmallBodies() {
    const bodies: SmallBodySpec[] = [];
    for (const entry of neoEntries.values()) {
      if (entry.enabled) {
        bodies.push(entry.spec);
      }
    }
    simulation.setSmallBodies(bodies);
  }

  interface ListEntryOptions {
    id: string;
    spec: SmallBodySpec;
    name: string;
    metaParts: string[];
    hazard?: string | null;
    defaultEnabled: boolean;
    normalizedKeys: string[];
    source: EntrySource;
  }

  const createListEntry = ({
    id,
    spec,
    name,
    metaParts,
    hazard,
    defaultEnabled,
    normalizedKeys,
    source,
  }: ListEntryOptions): NeoEntry => {
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = defaultEnabled;
    checkbox.id = `neo3d-entry-${id}`;
    checkbox.className = 'neo3d-neo-checkbox';

    const item = document.createElement('div');
    item.className = 'neo3d-neo-item';
    item.dataset.entryId = id;
    item.dataset.source = source;
    item.setAttribute('role', 'listitem');

    const label = document.createElement('label');
    label.className = 'neo3d-neo-entry';

    const nameRow = document.createElement('span');
    nameRow.className = 'neo3d-neo-name';

    const colorDot = document.createElement('span');
    colorDot.className = 'neo3d-neo-color';
    const eccentricity = spec.els && typeof spec.els.e === 'number' ? spec.els.e : undefined;
    const orbitColor = orbitColorFromEccentricity(eccentricity);
    if (typeof eccentricity === 'number' && Number.isFinite(eccentricity)) {
      item.dataset.e = eccentricity.toString();
    }
    item.style.setProperty('--orbit-c', orbitColor);
    label.style.setProperty('--orbit-c', orbitColor);
    colorDot.style.setProperty('--orbit-c', orbitColor);
    colorDot.style.background = 'var(--orbit-c)';

    nameRow.appendChild(checkbox);
    nameRow.appendChild(colorDot);
    const nameText = document.createElement('span');
    nameText.textContent = name;
    nameRow.appendChild(nameText);

    const meta = document.createElement('span');
    meta.className = 'neo3d-neo-meta';
    const filteredMeta = metaParts.filter((part) => part && part.trim().length > 0);
    meta.textContent = filteredMeta.length ? filteredMeta.join(' · ') : '–';

    label.appendChild(nameRow);
    label.appendChild(meta);

    if (hazard) {
      const hazardTag = document.createElement('span');
      hazardTag.className = 'neo3d-neo-hazard';
      hazardTag.textContent = hazard;
      label.appendChild(hazardTag);
    }

    item.appendChild(label);

    const removeButton = document.createElement('button');
    removeButton.type = 'button';
    removeButton.className = 'neo3d-neo-remove';
    removeButton.setAttribute('aria-label', `Remove ${name} from the scene`);
    removeButton.title = 'Remove';
    removeButton.textContent = '×';
    removeButton.addEventListener('click', (event) => {
      event.stopPropagation();
      event.preventDefault();
      removeEntry(id);
      updateSmallBodies();
      refreshNeoUi();
    });
    item.appendChild(removeButton);

    const entry: NeoEntry = {
      spec,
      enabled: defaultEnabled,
      checkbox,
      element: item,
      normalizedKeys,
      source,
    };

    checkbox.addEventListener('change', () => {
      entry.enabled = checkbox.checked;
      updateSmallBodies();
      refreshNeoUi();
    });

    return entry;
  };

  const loadNextNeos = async (batchSize = NEO_BATCH_SIZE) => {
    const anchor = neoList?.querySelector('[data-source="sbdb"]') ?? null;
    let added = 0;

    while (added < batchSize) {
      if (nextNeoIndex >= activeNeos.length) {
        const fetched = await requestAdditionalNeos();
        if (!fetched) {
          break;
        }
        continue;
      }

      const candidate = activeNeos[nextNeoIndex];
      nextNeoIndex += 1;

      let normalizedKeys = [...candidate.normalizedKeys];
      if (candidate.allowWeakName && candidate.nameKey) {
        const existingId = entryKeyIndex.get(candidate.nameKey);
        if (existingId) {
          const existingEntry = neoEntries.get(existingId);
          if (existingEntry?.source === 'neo') {
            normalizedKeys = normalizedKeys.filter((key) => key !== candidate.nameKey);
          }
        }
      }

      if (normalizedKeys.length === 0) {
        continue;
      }

      if (normalizedKeys.some((key) => entryKeyIndex.has(key))) {
        continue;
      }

      const defaultEnabled =
        neoAllToggle && !neoAllToggle.disabled && !neoAllToggle.indeterminate
          ? neoAllToggle.checked
          : true;

      const { neo, spec } = candidate;
      const metaParts: string[] = [];
      const sizeLabel = formatNeoSize(neo);
      if (sizeLabel) metaParts.push(`About ${sizeLabel} across`);
      const nextApproach = formatNextApproach(neo);
      if (nextApproach) {
        metaParts.push(`next passes Earth ${nextApproach}`);
      } else if (neo.next === null) {
        metaParts.push('no close pass of Earth on record ahead');
      }

      const entryId = `neo:${neo.id}`;
      const entry = createListEntry({
        id: entryId,
        spec,
        name: getNeoDisplayName(neo),
        metaParts,
        hazard: neo.is_potentially_hazardous_asteroid ? 'Potentially hazardous' : null,
        defaultEnabled,
        normalizedKeys,
        source: 'neo',
      });
      addEntry(entryId, entry, anchor);
      added += 1;
    }

    if (added === 0 && neoEntries.size === 0) {
      renderNeoEmptyState();
    }

    updateSmallBodies();
    refreshNeoUi();
  };

  async function addSBDBObject(raw: string): Promise<void> {
    const query = raw.trim();
    if (!query) return;
    const key = normalizeEntryKey(query);
    if (sbdbAliasIndex.has(key)) {
      const existingId = sbdbAliasIndex.get(key);
      const existing = existingId ? sbdbEntries.get(existingId) : undefined;
      const label = existing?.label ?? query;
      toastError(`Already added: ${label}`);
      return;
    }

    try {
      const { conic, label, row, aliases } = await loadSBDBConic(query);

      const aliasSet = new Set<string>();
      const pushAlias = (value: string | null | undefined) => {
        if (typeof value !== 'string') return;
        const normalized = normalizeEntryKey(value);
        if (!normalized) return;
        if (normalized.length <= 1) return;
        aliasSet.add(normalized);
      };

      pushAlias(query);
      pushAlias(label);
      if (row?.id) pushAlias(row.id);
      if (row?.name) pushAlias(row.name);
      for (const alias of aliases) {
        pushAlias(alias);
      }

      const candidateKeys = Array.from(aliasSet);
      if (candidateKeys.length === 0) {
        candidateKeys.push(key);
      }

      for (const candidate of candidateKeys) {
        if (!candidate) continue;
        const existingId = entryKeyIndex.get(candidate);
        if (existingId) {
          const existing = neoEntries.get(existingId);
          const existingLabel = existing?.spec.label ?? existing?.spec.name ?? label;
          toastError(`${label} is already loaded as ${existingLabel}.`);
          return;
        }
        const existingSbdbId = sbdbAliasIndex.get(candidate);
        if (existingSbdbId) {
          const existing = sbdbEntries.get(existingSbdbId);
          const existingLabel = existing?.label ?? label;
          toastError(`${label} is already loaded as ${existingLabel}.`);
          return;
        }
      }

      const color = makeColorFor(label);
      // Mean anomaly is only meaningful at the osculation epoch. Without both,
      // anchor the orbit at perihelion passage, where the mean anomaly is zero.
      const hasEpochAnomaly = Number.isFinite(conic.epoch) && Number.isFinite(conic.ma);
      const epochJD = hasEpochAnomaly ? (conic.epoch as number) : conic.tp;
      const meanAnomaly = hasEpochAnomaly ? (conic.ma as number) : 0;
      const conicForProp: ConicElements = {
        a: conic.a,
        e: conic.e,
        inc: conic.i,
        Omega: conic.Omega,
        omega: conic.omega,
        epochJD,
        M0: meanAnomaly,
        tp_jd: conic.tp,
        q: conic.q,
      };
      const spanDays = conic.e > 1 ? 3200 : undefined;
      const segments = conic.e > 1 ? 1600 : 720;

      const probe = propagateConic(conicForProp, jdFromDate(simulation.getCurrentDate()));
      if (!isFinite3(probe.posAU)) {
        throw new Error('SBDB propagation returned non-finite state');
      }

      const sample: NonNullable<SmallBodySpec['sample']> = (date) => {
        try {
          const state = propagateConic(conicForProp, jdFromDate(date));
          return isFinite3(state.posAU) ? state : null;
        } catch (error) {
          console.warn('[sbdb] propagate failed', error);
          return null;
        }
      };

      const keplerEls: Keplerian = {
        a: conic.a,
        e: conic.e,
        i: conic.i,
        Omega: conic.Omega,
        omega: conic.omega,
        M: meanAnomaly,
        epochJD,
      };

      const entryId = `sbdb:${(sbdbCounter += 1)}`;
      const spec: SmallBodySpec = {
        id: entryId,
        name: label,
        label,
        color,
        els: keplerEls,
        sample,
        orbit: { color, segments, spanDays },
        absMag: typeof row?.H === 'number' ? row.H : undefined,
        diameterKm: typeof row?.estDiameterKm === 'number' ? row.estDiameterKm : undefined,
        bodyType: row?.type,
        orbitClass: row?.orbitClass,
        kindHint: row?.type,
      };

      const normalizedKeys = candidateKeys.length > 0 ? candidateKeys : [key];
      const defaultEnabled =
        neoAllToggle && !neoAllToggle.disabled && !neoAllToggle.indeterminate
          ? neoAllToggle.checked
          : true;

      const metaParts: string[] = [];
      if (row?.type) {
        metaParts.push(row.type.charAt(0).toUpperCase() + row.type.slice(1));
      }
      const sizeLabel = formatDiameterValue(row?.estDiameterKm ?? null);
      if (sizeLabel) {
        metaParts.push(`about ${sizeLabel} across`);
      }
      metaParts.push(`comes within ${conic.q.toFixed(2)} AU of the Sun`);
      metaParts.push(`eccentricity ${conic.e.toFixed(2)}`);

      const primaryKey =
        (row?.id && aliasSet.has(normalizeEntryKey(row.id)) ? normalizeEntryKey(row.id) : null) ??
        (aliasSet.has(normalizeEntryKey(label)) ? normalizeEntryKey(label) : null) ??
        normalizedKeys[0] ?? key;

      const entryInfo: LoadedSbdbEntry = {
        spec,
        chip: null,
        entryId,
        keys: new Set(normalizedKeys),
        primaryKey,
        label,
      };

      const entry = createListEntry({
        id: entryId,
        spec,
        name: label,
        metaParts,
        hazard: null,
        defaultEnabled,
        normalizedKeys: Array.from(entryInfo.keys),
        source: 'sbdb',
      });

      sbdbEntries.set(entryId, entryInfo);
      for (const aliasKey of entryInfo.keys) {
        sbdbAliasIndex.set(aliasKey, entryId);
      }

      addEntry(entryId, entry);

      updateSmallBodies();
      refreshNeoUi();

      let chip: HTMLSpanElement | null = null;
      const sbdbOrbitColor = orbitColorFromEccentricity(conic.e);
      if (sbdbLoaded) {
        chip = document.createElement('span');
        chip.className = 'sbdb-chip';
        chip.dataset.key = entryInfo.primaryKey;
        chip.style.setProperty('--orbit-c', sbdbOrbitColor);
        chip.innerHTML = `<span class="sbdb-chip__dot"></span><span>${escapeHtml(label)}</span><button type="button" aria-label="Remove ${escapeHtml(label)}">×</button>`;
        const removeBtn = chip.querySelector('button');
        removeBtn?.addEventListener('click', () => {
          removeEntry(entryId);
          updateSmallBodies();
          refreshNeoUi();
        });
        sbdbLoaded.appendChild(chip);
      }

      entryInfo.chip = chip;
      toast(`Added SBDB: ${label}`);
      updateSbdbLoadedState();
    } catch (error) {
      console.error('[sbdb] add failed', error);
      const message = error instanceof Error && error.message ? error.message : 'SBDB add failed';
      toastError(message);
    }
  }

  if (neoLoadMore) {
    neoLoadMore.addEventListener('click', () => {
      void loadNextNeos(NEO_BATCH_SIZE);
    });
  }

  if (neoAllToggle) {
    neoAllToggle.disabled = true;
    neoAllToggle.indeterminate = false;
    neoAllToggle.addEventListener('change', () => {
      const enabled = neoAllToggle.checked;
      for (const entry of neoEntries.values()) {
        entry.enabled = enabled;
        if (entry.checkbox) {
          entry.checkbox.checked = enabled;
        }
      }
      updateSmallBodies();
      refreshNeoUi();
    });
  }

  if (neoHazardToggle) {
    neoHazardToggle.addEventListener('change', () => {
      hazardOnly = neoHazardToggle.checked;
      recomputeActiveNeos();
      removeEntriesBySource('neo');
      updateSmallBodies();
      refreshNeoUi();
      if (!activeNeos.length) {
        if (neoEntries.size === 0) {
          renderNeoEmptyState();
        }
        return;
      }
      void loadNextNeos(NEO_BATCH_SIZE);
    });
  }

  const applyNeos = (neos: NeoItem[], applyOptions?: { hasMore?: boolean }) => {
    const candidates = neos
      .map((neo) => createNeoCandidate(neo))
      .filter((candidate): candidate is NeoCandidate => candidate !== null);
    allNeos = candidates;
    recomputeActiveNeos();
    if (typeof applyOptions?.hasMore === 'boolean') {
      loadMoreDone = !applyOptions.hasMore;
    } else if (!loadMoreHandler) {
      loadMoreDone = true;
    } else {
      loadMoreDone = false;
    }
    removeEntriesBySource('neo');
    updateSmallBodies();
    refreshNeoUi();
    if (!activeNeos.length) {
      if (neoEntries.size === 0) {
        renderNeoEmptyState();
      }
      return;
    }
    void loadNextNeos(NEO_BATCH_SIZE);
  };


  return { setNeos: applyNeos, addSbdbObject: addSBDBObject };
}
