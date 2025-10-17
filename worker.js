const NASA_HOST = 'api.nasa.gov';
const NASA_BASE = `https://${NASA_HOST}`;
const API_ORIGIN = NASA_BASE;

let NASA_API = '';

function secHeaders() {
  return {
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'X-XSS-Protection': '1; mode=block',
    'Cross-Origin-Resource-Policy': 'cross-origin',
  };
}

function corsHeaders(origin) {
  const allowOrigin = origin || '*';
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Accept',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

function redactKey(u) {
  const copy = new URL(u.toString());
  if (copy.searchParams.has('api_key')) copy.searchParams.set('api_key', '***');
  return copy.toString();
}

function forceApiKey(u, key) {
  if (u.host === NASA_HOST) {
    u.searchParams.delete('api_key');
    if (key) u.searchParams.set('api_key', key);
  }
}

async function fwd(target, request, origin, debug, cf, extraHeaders = {}) {
  forceApiKey(target, NASA_API);

  const outReq = new Request(target.toString(), {
    method: 'GET',
    headers: {
      'User-Agent': 'cf-worker-nasa-proxy',
      Accept: 'application/json, image/*, */*;q=0.1',
    },
  });

  const fetchInit = cf ? { cf } : undefined;
  const resp = await fetch(outReq, fetchInit);

  const headers = { ...secHeaders(), ...corsHeaders(origin), ...extraHeaders };
  if (debug) headers['x-upstream-url-redacted'] = redactKey(target);

  const contentType = resp.headers.get('Content-Type') || 'application/octet-stream';
  if (contentType) headers['Content-Type'] = contentType;

  if (!('Cache-Control' in headers)) {
    const cacheControl = resp.headers.get('Cache-Control');
    if (cacheControl) headers['Cache-Control'] = cacheControl;
  }

  return new Response(resp.body, {
    status: resp.status,
    statusText: resp.statusText,
    headers,
  });
}

function buildTargetUrl(url) {
  const target = new URL(url.pathname, NASA_BASE);
  for (const [key, value] of url.searchParams.entries()) {
    if (key === 'debug' || key === 'api_key') continue;
    target.searchParams.set(key, value);
  }
  return target;
}

function methodNotAllowed(origin) {
  return new Response('Method Not Allowed', {
    status: 405,
    headers: { ...secHeaders(), ...corsHeaders(origin) },
  });
}

function optionsResponse(origin, request) {
  const headers = { ...secHeaders(), ...corsHeaders(origin) };
  const acrh = request.headers.get('Access-Control-Request-Headers');
  if (acrh) headers['Access-Control-Allow-Headers'] = acrh;
  return new Response(null, { status: 204, headers });
}

async function handleRequest(request) {
  const origin = request.headers.get('Origin') || '';

  if (request.method === 'OPTIONS') return optionsResponse(origin, request);
  if (request.method !== 'GET') return methodNotAllowed(origin);

  const url = new URL(request.url);
  const debug = url.searchParams.get('debug') === '1';

  if (url.pathname === '/health') {
    const headers = { 'Content-Type': 'application/json; charset=utf-8', ...secHeaders(), ...corsHeaders(origin) };
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
  }

  // APOD
  if (url.pathname === '/apod') {
    const target = new URL('/planetary/apod' + url.search, API_ORIGIN);
    target.searchParams.delete('debug');
    const cf = { cacheEverything: true, cacheTtl: 600 }; // 10 min edge cache
    const headers = {
      'Cache-Control': 'public, max-age=300, s-maxage=600, stale-while-revalidate=86400',
    };
    return fwd(target, request, origin, debug, cf, headers);
  }

  if (url.pathname === '/horizons') {
    const base = new URL('https://ssd.jpl.nasa.gov/api/horizons.api');
    const allow = new Set([
      'COMMAND',
      'EPHEM_TYPE',
      'CENTER',
      'REF_PLANE',
      'REF_SYSTEM',
      'MAKE_EPHEM',
      'OUT_UNITS',
      'FORMAT',
      'START_TIME',
      'STOP_TIME',
      'STEP_SIZE',
      'TIME',
      'TLIST',
      'TLIST_TYPE',
      'OBJ_DATA',
      'CSV_FORMAT',
      'VEC_TABLE',
      'VEC_CORR',
      'TIME_TYPE',
      'TIME_DIGITS',
    ]);
    let forwarded = 0;
    for (const [key, value] of url.searchParams) {
      if (key === 'debug') continue;
      if (allow.has(key)) {
        base.searchParams.append(key, value);
        forwarded += 1;
      }
    }
    const baseHeaders = { ...secHeaders(), 'Access-Control-Allow-Origin': '*', Vary: 'Origin' };
    if (forwarded === 0) {
      const headers = {
        'Content-Type': 'application/json; charset=utf-8',
        ...baseHeaders,
      };
      return new Response(JSON.stringify({ ok: false, message: 'no valid Horizons params' }), {
        status: 400,
        headers,
      });
    }
    if (!base.searchParams.has('FORMAT')) base.searchParams.set('FORMAT', 'JSON');
    if (!base.searchParams.has('MAKE_EPHEM')) base.searchParams.set('MAKE_EPHEM', 'YES');
    if (!base.searchParams.has('OBJ_DATA')) base.searchParams.set('OBJ_DATA', 'NO');
    if (!base.searchParams.has('EPHEM_TYPE')) base.searchParams.set('EPHEM_TYPE', 'ELEMENTS');
    if (!base.searchParams.has('CENTER')) base.searchParams.set('CENTER', '500@10');
    if (!base.searchParams.has('REF_PLANE')) base.searchParams.set('REF_PLANE', 'ECLIPTIC');
    if (!base.searchParams.has('REF_SYSTEM')) base.searchParams.set('REF_SYSTEM', 'J2000');
    if (!base.searchParams.has('OUT_UNITS')) base.searchParams.set('OUT_UNITS', 'AU-D');
    const cf = { cacheEverything: true, cacheTtl: 600 };
    try {
      const r = await fetch(base.toString(), { cf });
      if (!r.ok) {
        const errorHeaders = {
          'Content-Type': 'application/json',
          ...baseHeaders,
        };
        return new Response(
          JSON.stringify({ ok: false, status: r.status, url: base.toString() }),
          { status: r.status, headers: errorHeaders },
        );
      }
      const body = await r.text();
      const successHeaders = {
        'Content-Type': r.headers.get('content-type') || 'application/json; charset=utf-8',
        ...baseHeaders,
      };
      return new Response(body, { status: 200, headers: successHeaders });
    } catch (err) {
      const errorHeaders = {
        'Content-Type': 'application/json',
        ...baseHeaders,
      };
      return new Response(
        JSON.stringify({ ok: false, status: 502, url: base.toString() }),
        { status: 502, headers: errorHeaders },
      );
    }
  }

  if (!NASA_API) {
    const headers = { 'Content-Type': 'application/json; charset=utf-8', ...secHeaders(), ...corsHeaders(origin) };
    return new Response(JSON.stringify({ error: 'NASA_API secret not configured' }), { status: 500, headers });
  }

  if (url.pathname === '/sbdb') {
    const t = new URL('https://ssd-api.jpl.nasa.gov/sbdb.api');
    for (const [key, value] of url.searchParams.entries()) {
      t.searchParams.set(key, value);
    }
    const cf = { cacheEverything: true, cacheTtl: 600 };
    const headers = { 'Cache-Control': 'public, max-age=300, s-maxage=600' };
    return fwd(t, request, origin, debug, cf, headers);
  }

  const target = buildTargetUrl(url);

  return fwd(target, request, origin, debug);
}

export default {
  async fetch(request, env) {
    NASA_API = env?.NASA_API || '';
    return handleRequest(request);
  },
};
