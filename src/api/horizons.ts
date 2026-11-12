/** JPL Horizons state vectors (heliocentric ecliptic J2000, AU and AU/day). */
import { jdFromDate } from '../lib/julian';
import { fetchText } from './worker';

export type VectorSample = {
  t: Date;
  jd: number;
  posAU: [number, number, number];
  velAUPerDay: [number, number, number];
};

function normalizeIso(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid ISO date: ${iso}`);
  }
  return `${date.toISOString().slice(0, 19)}Z`;
}

export async function horizonsVectors(spk: number | string, iso: string, signal?: AbortSignal) {
  const tlist = normalizeIso(iso).replace('T', ' ').replace(/Z$/, '');
  // Horizons wants its string arguments wrapped in single quotes.
  const resultText = await fetchText('/horizons', {
    signal,
    params: {
      COMMAND: `'${spk}'`,
      EPHEM_TYPE: 'VECTORS',
      TLIST: `'${tlist}'`,
      OBJ_DATA: 'NO',
      OUT_UNITS: 'AU-D',
      TIME_TYPE: 'UT',
      format: 'json',
      MAKE_EPHEM: 'YES',
      CENTER: '500@10',
      REF_PLANE: 'ECLIPTIC',
      REF_SYSTEM: 'J2000',
    },
  });

  const block = extractHorizonsBlock(resultText);
  const pos = extractVector(block, 'X', 'Y', 'Z');
  const vel = extractVector(block, 'VX', 'VY', 'VZ');
  return { posAU: pos, velAUPerDay: vel };
}

function extractHorizonsBlock(resultText: string): string {
  const start = resultText.indexOf('$$SOE');
  const end = resultText.indexOf('$$EOE', start + 5);
  if (start === -1 || end === -1) {
    throw new Error('Horizons: missing $$SOE/$$EOE block');
  }
  return resultText.slice(start + 5, end).trim();
}

function extractVector(block: string, a: string, b: string, c: string): [number, number, number] {
  const numberPattern = String.raw`([+-]?\d+(?:\.\d+)?(?:E[+-]?\d+)?)`;
  const pattern = new RegExp(
    String.raw`${a}\s*=\s*${numberPattern}\s*${b}\s*=\s*${numberPattern}\s*${c}\s*=\s*${numberPattern}`,
    'i',
  );
  const match = block.replace(/\s+/g, ' ').match(pattern);
  if (!match) {
    throw new Error(`Horizons: missing ${a}/${b}/${c} vector`);
  }
  const vec: [number, number, number] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (!vec.every(Number.isFinite)) {
    throw new Error('Horizons: non-finite vectors');
  }
  return vec;
}

export async function horizonsDailyVectors(
  spk: number | string,
  startIso: string,
  days: number,
): Promise<VectorSample[]> {
  const normalized = normalizeIso(startIso);
  const startDate = new Date(normalized);
  const samples: VectorSample[] = [];
  for (let i = 0; i < days; i += 1) {
    const date = new Date(startDate.getTime() + i * 86400000);
    const iso = `${date.toISOString().slice(0, 19)}Z`;
    const state = await horizonsVectors(spk, iso);
    const t = new Date(iso);
    samples.push({ t, jd: jdFromDate(t), posAU: state.posAU, velAUPerDay: state.velAUPerDay });
  }
  return samples;
}
