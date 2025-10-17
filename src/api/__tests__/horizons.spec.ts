import test from 'node:test';
import assert from 'node:assert/strict';

import type { HorizonsJson } from '../../types/horizons';
import { _internal } from '../fetch_planets';

const { parseHorizonsResult } = _internal;

test('horizons parser yields finite elements for Mars 2025-01-01', async () => {
  const params = new URLSearchParams({
    FORMAT: 'JSON',
    MAKE_EPHEM: 'YES',
    EPHEM_TYPE: 'ELEMENTS',
    COMMAND: "'499'",
    TIME: "'2025-01-01T00:00:00Z'",
  });
  const url = new URL('https://ssd.jpl.nasa.gov/api/horizons.api');
  params.forEach((value, key) => {
    url.searchParams.set(key, value);
  });

  const response = await fetch(url);
  assert.equal(response.ok, true, `Expected Horizons ok response, got ${response.status}`);
  const data = (await response.json()) as HorizonsJson;
  assert.ok(typeof data.result === 'string' && data.result.length > 0, 'Missing Horizons result text');

  const els = parseHorizonsResult(data.result);
  assert.ok(Number.isFinite(els.a), 'semi-major axis not finite');
  assert.ok(Number.isFinite(els.e), 'eccentricity not finite');
  assert.ok(Number.isFinite(els.i), 'inclination not finite');
  assert.ok(Number.isFinite(els.Omega), 'ascending node not finite');
  assert.ok(Number.isFinite(els.omega), 'argument of perihelion not finite');
  assert.ok(Number.isFinite(els.M), 'mean anomaly not finite');
  assert.ok(Number.isFinite(els.epochJD), 'epoch JD not finite');
});
