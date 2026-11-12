// Runs worker.js in a sandbox with a fake upstream, cache and clock.
//   node --test tests/worker.node.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

const SOURCE = readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
const KEY = 'SECRETKEY123';

function boot({ upstream }) {
  const store = new Map();
  const state = { now: Date.UTC(2026, 10, 12), calls: [], assets: [], upstream };
  let handler;
  class FakeDate extends Date {
    static now() { return state.now; }
  }
  const context = vm.createContext({
    addEventListener: (_type, fn) => { handler = fn; },
    caches: {
      default: {
        match: async (req) => store.get(req.url)?.clone() ?? undefined,
        put: async (req, res) => { store.set(req.url, res.clone()); },
      },
    },
    fetch: async (url) => {
      state.calls.push(String(url));
      return state.upstream(new URL(String(url)));
    },
    ASSETS: {
      fetch: async (req) => {
        state.assets.push(new URL(req.url).pathname);
        return new Response('<h1>Nothing at this address</h1>', { status: 404, headers: { 'Content-Type': 'text/html' } });
      },
    },
    NASA_API: KEY,
    Date: FakeDate,
    Response, Request, Headers, URL, URLSearchParams, AbortController,
    setTimeout, clearTimeout, console, Math, JSON, Promise, Object, Array, String, Number, Set, Map, Error,
    encodeURIComponent, decodeURIComponent, parseInt, parseFloat, isNaN, isFinite,
  });
  vm.runInContext(SOURCE, context, { filename: 'worker.js' });

  async function get(path, init = {}) {
    let answer;
    const pending = [];
    handler({
      request: new Request(`https://site.test${path}`, init),
      respondWith: (p) => { answer = p; },
      waitUntil: (p) => { pending.push(p); },
    });
    const res = await answer;
    await Promise.all(pending);
    return res;
  }
  return { get, state };
}

const neoBody = (url) => JSON.stringify({ links: { self: url.toString() }, near_earth_objects: [] });
const okJson = (body, type = 'application/json') => new Response(body, { status: 200, headers: { 'Content-Type': type } });

test('the NASA key never leaves the Worker', async () => {
  const { get } = boot({ upstream: (url) => okJson(neoBody(url)) });
  const res = await get('/api/neo/browse?size=1');
  const text = await res.text();
  assert.equal(res.status, 200);
  assert.ok(text.includes('api_key=REDACTED'));
  for (const [name, value] of res.headers) assert.ok(!value.includes(KEY), `header ${name}`);
  assert.ok(!text.includes(KEY));
});

test('an upstream failure is reported without the key', async () => {
  const { get } = boot({ upstream: (url) => new Response(`bad request for ${url}`, { status: 400 }) });
  const res = await get('/api/neo/browse?size=1');
  const text = await res.text();
  assert.equal(res.status, 400);
  assert.ok(!text.includes(KEY));
});

test('a second request inside the ttl is answered from the cache', async () => {
  const { get, state } = boot({ upstream: (url) => okJson(neoBody(url)) });
  const first = await get('/api/neo/feed?start_date=2026-11-12&end_date=2026-11-12');
  assert.equal(first.headers.get('x-cache'), 'miss');
  state.now += 10 * 60 * 1000;
  const second = await get('/api/neo/feed?end_date=2026-11-12&start_date=2026-11-12');
  assert.equal(second.headers.get('x-cache'), 'hit');
  assert.equal(second.headers.get('age'), '600');
  assert.equal(state.calls.length, 1);
  assert.equal(await second.text(), await first.text());
});

test('after the ttl the upstream is asked again', async () => {
  const { get, state } = boot({ upstream: (url) => okJson(neoBody(url)) });
  await get('/api/neo/feed?start_date=2026-11-12');
  state.now += 61 * 60 * 1000;
  const res = await get('/api/neo/feed?start_date=2026-11-12');
  assert.equal(res.headers.get('x-cache'), 'miss');
  assert.equal(state.calls.length, 2);
});

test('a stale copy is served while the upstream is down', async () => {
  const { get, state } = boot({ upstream: (url) => okJson(neoBody(url)) });
  const first = await (await get('/api/neo/feed?start_date=2026-11-12')).text();
  state.now += 3 * 60 * 60 * 1000;
  state.upstream = () => new Response('rate limited', { status: 429 });
  const res = await get('/api/neo/feed?start_date=2026-11-12');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('x-cache'), 'stale');
  assert.equal(await res.text(), first);
});

test('a failure is not cached', async () => {
  const { get, state } = boot({ upstream: () => new Response('down', { status: 503 }) });
  const first = await get('/api/eonet/events?status=open');
  assert.equal(first.status, 503);
  state.upstream = () => okJson('{"events":[]}');
  const second = await get('/api/eonet/events?status=open');
  assert.equal(second.status, 200);
  assert.equal(second.headers.get('x-cache'), 'miss');
});

test('EONET JSON is labelled as JSON', async () => {
  const { get } = boot({ upstream: () => okJson('{"events":[]}', 'application/rss+xml') });
  const res = await get('/api/eonet/events?status=open');
  assert.match(res.headers.get('content-type'), /^application\/json/);
});

test('unknown API routes answer JSON, unknown pages get the site 404', async () => {
  const { get, state } = boot({ upstream: () => okJson('{}') });
  const api = await get('/api/nope');
  assert.equal(api.status, 404);
  assert.match(api.headers.get('content-type'), /json/);
  const page = await get('/nope');
  assert.equal(page.status, 404);
  assert.match(await page.text(), /Nothing at this address/);
  assert.deepEqual(state.assets, ['/nope']);
});

test('preflight requests are allowed', async () => {
  const { get } = boot({ upstream: () => okJson('{}') });
  const res = await get('/api/apod', { method: 'OPTIONS', headers: { Origin: 'https://example.org' } });
  assert.equal(res.status, 204);
  assert.equal(res.headers.get('access-control-allow-origin'), 'https://example.org');
});
