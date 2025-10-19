// Exoplanet Explorer frontend
// Fetches from your Worker: /exo/ps, /exo/pscomp, /exo/tap
const WORKER_BASE = 'https://lively-haze-4b2c.hicksrch.workers.dev';
const W = WORKER_BASE;

const el = (id) => document.getElementById(id);
const qs = new URLSearchParams(location.search);

const inputs = {
  facility: el('facility'),
  yearMin:  el('yearMin'),
  rMin:     el('rMin'),
  rMax:     el('rMax'),
  tMin:     el('tMin'),
  tMax:     el('tMax'),
};

const btnFetch = el('btnFetch');
const btnShare = el('btnShare');
const btnCSV   = el('btnCSV');
const statusEl = el('status');
const adqlEl   = el('adql');
const rowsEl   = el('rows');
const hintEl   = el('hint');
const exampleButtons = Array.from(document.querySelectorAll('[data-example]'));

const sumCount = el('sumCount');
const sumR = el('sumR');
const sumT = el('sumT');
const sumMass = el('sumMass');
const mrViz = el('mrViz');
const selectedSummary = el('selectedSummary');

let currentRows = [];
let selectedPlanetName = '';
let activeExampleDesc = '';

const EXAMPLE_FILTERS = {
  temperate: {
    filters: { facility: 'TESS', yearMin: 2018, rMin: 0.8, rMax: 1.8, tMin: 180, tMax: 320 },
    description: 'Example: temperate TESS candidates in the super-Earth range.'
  },
  hotJupiter: {
    filters: { facility: '', yearMin: 2000, rMin: 8, rMax: '', tMin: 800, tMax: '' },
    description: 'Example: very large, hot worlds often called “hot Jupiters”.'
  },
  keplerHabZone: {
    filters: { facility: 'Kepler', yearMin: 2009, rMin: 0.7, rMax: 1.6, tMin: 150, tMax: 300 },
    description: 'Example: Kepler discoveries near the classical habitable zone.'
  }
};

initFromURL();
wire();

async function run() {
  const ctrl = new AbortController();
  const q = getState();
  const { where, filtersDesc } = whereClause(q);
  const adql =
`SELECT TOP 1000 pl_name, hostname,
  AVG(pl_rade) AS rade,
  MIN(pl_masse) AS masse,
  MIN(pl_eqt)   AS eqt,
  MIN(pl_orbper) AS period,
  MIN(ra) AS ra, MIN(dec) AS dec,
  MIN(disc_year) AS disc_year
FROM ps
WHERE tran_flag=1${where ? ' AND ' + where : ''}
GROUP BY pl_name, hostname
ORDER BY eqt`;

  adqlEl.textContent = adql;

  const url = new URL('/exo/tap', W);
  url.searchParams.set('adql', adql);
  const t0 = performance.now();
  setStatus('Loading…');
  let data;
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    data = await r.json();
  } catch (e) {
    setStatus('Error');
    console.error(e);
    hintEl.textContent = 'Query failed. Adjust filters or try again.';
    return;
  }
  const rows = normalizeRows(data);
  const dt = (performance.now() - t0).toFixed(0);
  setStatus(`${rows.length} rows in ${dt} ms`);
  const hintText = activeExampleDesc ? `${filtersDesc} • ${activeExampleDesc}` : filtersDesc;
  hintEl.textContent = hintText;

  renderTable(rows);
  renderSummary(rows);
  if (!rows.length) {
    selectPlanet(null);
  } else {
    const existing = currentRows.find(r => r.name === selectedPlanetName);
    selectPlanet(existing ?? rows[0]);
  }
}

function normalizeRows(out) {
  const list = Array.isArray(out?.data) ? out.data : (Array.isArray(out?.rows) ? out.rows : out);
  return (list || [])
    .map(r => ({
      name: r.pl_name,
      host: r.hostname,
      rade: num(r.rade ?? r.pl_rade),
      masse: num(r.masse ?? r.pl_masse),
      eqt: num(r.eqt ?? r.pl_eqt),
      period: num(r.period ?? r.pl_orbper),
      ra: num(r.ra),
      dec: num(r.dec),
      year: r.disc_year ?? r.discyear ?? null
    }))
    .filter(r => r.name && r.host);
}

function renderTable(rows) {
  currentRows = rows;
  rowsEl.innerHTML = rows.map((r, i) => `
    <tr data-index="${i}" tabindex="0">
      <td><button type="button" class="planet-name-btn" data-index="${i}">${esc(r.name)}</button></td>
      <td>${esc(r.host)}</td>
      <td>${fmt(r.rade)}</td>
      <td>${fmt(r.masse)}</td>
      <td>${fmt(r.eqt)}</td>
      <td>${fmt(r.period)}</td>
      <td>${fmt(r.ra, 3)}</td>
      <td>${fmt(r.dec, 3)}</td>
      <td>${esc(r.year ?? '')}</td>
    </tr>
  `).join('');
}

function renderSummary(rows) {
  sumCount.textContent = rows.length;
  const R = rows.map(r => r.rade).filter(x => Number.isFinite(x));
  const T = rows.map(r => r.eqt).filter(x => Number.isFinite(x));
  const M = rows.map(r => r.masse).filter(x => Number.isFinite(x));
  sumR.textContent = median(R)?.toFixed(2) ?? '–';
  sumT.textContent = median(T)?.toFixed(0) ?? '–';
  sumMass.textContent = M.length;
}

function whereClause(q) {
  const clauses = ['tran_flag=1'];
  const desc = [];
  if (q.facility) {
    if (q.facility === 'Ground') {
      clauses.push(`disc_facility not like 'Kepler' and disc_facility not like 'K2' and disc_facility not like 'TESS'`);
      desc.push('Facility: ground-based');
    } else {
      clauses.push(`disc_facility like '${q.facility}'`);
      desc.push(`Facility: ${q.facility}`);
    }
  }
  if (q.yearMin) { clauses.push(`disc_year >= ${+q.yearMin}`); desc.push(`Year ≥ ${+q.yearMin}`); }
  if (q.rMin)    { clauses.push(`pl_rade >= ${+q.rMin}`); desc.push(`Re ≥ ${+q.rMin}`); }
  if (q.rMax)    { clauses.push(`pl_rade <= ${+q.rMax}`); desc.push(`Re ≤ ${+q.rMax}`); }
  if (q.tMin)    { clauses.push(`pl_eqt >= ${+q.tMin}`); desc.push(`Teq ≥ ${+q.tMin} K`); }
  if (q.tMax)    { clauses.push(`pl_eqt <= ${+q.tMax}`); desc.push(`Teq ≤ ${+q.tMax} K`); }
  return { where: clauses.filter(Boolean).join(' AND '), filtersDesc: desc.length ? desc.join(' · ') : 'No additional filters' };
}

function getState() {
  return {
    facility: inputs.facility.value.trim(),
    yearMin:  inputs.yearMin.value.trim(),
    rMin:     inputs.rMin.value.trim(),
    rMax:     inputs.rMax.value.trim(),
    tMin:     inputs.tMin.value.trim(),
    tMax:     inputs.tMax.value.trim(),
  };
}
function setState(obj, { clear = false } = {}) {
  if (clear) {
    for (const key of Object.keys(inputs)) {
      inputs[key].value = '';
    }
  }
  for (const [k,v] of Object.entries(obj)) {
    if (!(k in inputs)) continue;
    inputs[k].value = v == null ? '' : String(v);
  }
}
function initFromURL() {
  const seed = {};
  for (const [k,v] of qs.entries()) {
    if (k in inputs) seed[k] = v;
  }
  setState(seed);
}
function wire() {
  btnFetch.addEventListener('click', () => {
    activeExampleDesc = '';
    syncURL();
    run();
  });
  btnShare.addEventListener('click', async () => {
    syncURL();
    await navigator.clipboard.writeText(location.href);
    setStatus('Link copied');
    setTimeout(()=> setStatus(''), 900);
  });
  btnCSV.addEventListener('click', async () => {
    const rows = Array.from(rowsEl.querySelectorAll('tr')).map(tr => Array.from(tr.children).map(td => td.textContent));
    const header = ['pl_name','hostname','pl_rade','pl_masse','pl_eqt','pl_orbper','ra','dec','disc_year'];
    const csv = [header.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'exoplanets.csv';
    document.body.appendChild(a); a.click(); a.remove();
    setStatus('CSV saved');
    setTimeout(()=> setStatus(''), 900);
  });

  // Enter key triggers run
  Object.values(inputs).forEach(inp => inp.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { syncURL(); run(); }
  }));
  Object.values(inputs).forEach(inp => inp.addEventListener('input', () => {
    activeExampleDesc = '';
  }));

  exampleButtons.forEach((btn) => {
    const key = btn.dataset.example;
    const preset = EXAMPLE_FILTERS[key];
    if (!preset) return;
    btn.title = preset.description;
    btn.addEventListener('click', () => {
      setState(preset.filters, { clear: true });
      activeExampleDesc = preset.description;
      syncURL();
      run();
    });
  });

  // Auto-run on first load
  run();
}

rowsEl.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-index]');
  if (!btn) return;
  const idx = Number(btn.dataset.index);
  const planet = currentRows[idx];
  if (planet) {
    selectPlanet(planet);
  }
});

rowsEl.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const tr = e.target.closest('tr[data-index]');
  if (!tr) return;
  const idx = Number(tr.dataset.index);
  const planet = currentRows[idx];
  if (planet) {
    selectPlanet(planet);
  }
});

function selectPlanet(planet) {
  selectedPlanetName = planet?.name ?? '';
  applySelection();
  renderMassRadiusPanel(planet);
  renderPlanetSummary(planet);
}

function applySelection() {
  const trs = Array.from(rowsEl.querySelectorAll('tr[data-index]'));
  trs.forEach((tr) => {
    const idx = Number(tr.dataset.index);
    const row = currentRows[idx];
    tr.classList.toggle('selected', row?.name === selectedPlanetName);
  });
}

function renderMassRadiusPanel(planet) {
  if (!planet) {
    mrViz.innerHTML = '<p class="mr-placeholder">Select a planet below to view its mass–radius profile.</p>';
    return;
  }
  const { label, description, svgClass, svg } = describePlanetType(planet);
  const metrics = [
    { label: 'Radius (Earth radii)', value: fmtOrDash(planet.rade) },
    { label: 'Mass (Earth masses)', value: fmtOrDash(planet.masse) }
  ];
  const tooltip = `Radius: ${fmtOrDash(planet.rade)} Re\nMass: ${fmtOrDash(planet.masse)} Me`;
  mrViz.innerHTML = `
    <div class="mr-visual" title="${esc(tooltip)}">
      ${svgClass ? svg.replace('<svg', `<svg class="${svgClass}"`) : svg}
      <div class="mr-metrics">
        <div class="label">Classification</div>
        <div style="font-size:20px; font-weight:600">${esc(label)}</div>
        <div style="color:var(--muted); max-width:280px;">${esc(description)}</div>
        <div class="label" style="margin-top:8px;">Mass–radius estimates</div>
        ${metrics.map(m => `<div><span class="label">${esc(m.label)}:</span> <span class="stat">${esc(m.value)}</span></div>`).join('')}
      </div>
    </div>
  `;
}

function renderPlanetSummary(planet) {
  if (!planet) {
    selectedSummary.innerHTML = `
      <h4>Planet details</h4>
      <p style="margin:0; color:var(--muted);">Choose a planet from the table to see its host, orbit, and climate.</p>
    `;
    return;
  }
  selectedSummary.innerHTML = `
    <h4>${esc(planet.name)}</h4>
    <dl>
      <dt>Host star</dt><dd>${esc(planet.host)}</dd>
      <dt>Discovery year</dt><dd>${esc(planet.year ?? '—')}</dd>
      <dt>Orbit period (days)</dt><dd>${fmtOrDash(planet.period)}</dd>
      <dt>Equilibrium temp (K)</dt><dd>${fmtOrDash(planet.eqt, 0)}</dd>
      <dt>Right ascension</dt><dd>${fmtOrDash(planet.ra, 3)}</dd>
      <dt>Declination</dt><dd>${fmtOrDash(planet.dec, 3)}</dd>
    </dl>
  `;
}

function describePlanetType(planet) {
  const r = Number.isFinite(planet.rade) ? planet.rade : null;
  const t = Number.isFinite(planet.eqt) ? planet.eqt : null;
  const m = Number.isFinite(planet.masse) ? planet.masse : null;
  if (r == null) {
    return {
      label: 'Unknown',
      description: 'No radius estimate is available for this world yet.',
      svgClass: 'unknown',
      svg: svgUnknown()
    };
  }
  if (r < 1.5 && t != null && t >= 900) {
    return {
      label: 'Lava world',
      description: 'A tidally roasted world with a magma ocean and vaporized rock atmosphere.',
      svgClass: 'lava-world',
      svg: svgLavaWorld()
    };
  }
  if (r < 0.5) {
    return {
      label: 'Airless dwarf',
      description: 'A tiny, likely airless body scarred by impacts and dominated by bare rock.',
      svgClass: 'airless-dwarf',
      svg: svgAirlessDwarf()
    };
  }
  if (r < 1.5 && t != null && t >= 240 && t <= 330) {
    return {
      label: 'Temperate terrestrial',
      description: 'Earth-sized and receiving clement irradiation that could allow liquid water.',
      svgClass: 'temperate-terrestrial',
      svg: svgTemperateTerrestrial()
    };
  }
  if (r < 1.25) {
    return {
      label: 'Rocky terrestrial',
      description: 'Comparable in size to Earth and likely dominated by silicate rock and metal.',
      svgClass: 'rocky',
      svg: svgRocky()
    };
  }
  if (r < 2 && m != null && m >= 10) {
    return {
      label: 'Mega-Earth',
      description: 'A super-dense terrestrial giant with crushing surface gravity and deep mantles.',
      svgClass: 'mega-earth',
      svg: svgMegaEarth()
    };
  }
  if (r < 2 && t != null && t >= 800) {
    return {
      label: 'Hot super-Earth',
      description: 'A volatile-rich super-Earth orbiting so close that its atmosphere is superheated.',
      svgClass: 'hot-super-earth',
      svg: svgHotSuperEarth()
    };
  }
  if (r < 2) {
    return {
      label: 'Super-Earth',
      description: 'Larger than Earth but smaller than ice giants, potentially with thick atmospheres.',
      svgClass: 'super-earth',
      svg: svgSuperEarth()
    };
  }
  if (r < 4 && t != null && t >= 800) {
    return {
      label: 'Hot sub-Neptune',
      description: 'A volatile sub-Neptune blasted by stellar radiation that puffs up hazy envelopes.',
      svgClass: 'hot-sub-neptune',
      svg: svgHotSubNeptune()
    };
  }
  if (r < 4 && t != null && t <= 200) {
    return {
      label: 'Cold sub-Neptune',
      description: 'An intermediate world orbiting beyond the snow line with frigid upper clouds.',
      svgClass: 'cold-sub-neptune',
      svg: svgColdSubNeptune()
    };
  }
  if (r < 4) {
    return {
      label: 'Sub-Neptune',
      description: 'Intermediate worlds with volatile-rich envelopes atop rocky cores.',
      svgClass: 'sub-neptune',
      svg: svgSubNeptune()
    };
  }
  if (r < 6 && t != null && t >= 700) {
    return {
      label: 'Warm Neptune',
      description: 'An ice giant analogue broiling enough to drive fast winds and dynamic clouds.',
      svgClass: 'warm-neptune',
      svg: svgWarmNeptune()
    };
  }
  if (r < 6) {
    return {
      label: 'Neptune-like',
      description: 'Ice giant analogues with deep atmospheres of hydrogen, helium, and methane.',
      svgClass: 'neptune',
      svg: svgNeptune()
    };
  }
  if (t != null && t >= 1200) {
    return {
      label: 'Ultra-hot Jupiter',
      description: 'A gas giant skimming its star, glowing from iron-vapor skies and supersonic jets.',
      svgClass: 'ultra-hot-jupiter',
      svg: svgUltraHotJupiter()
    };
  }
  if (t != null && t <= 350) {
    return {
      label: 'Cold gas giant',
      description: 'A distant gas giant with muted sunlight and high-altitude ammonia clouds.',
      svgClass: 'cold-gas-giant',
      svg: svgColdGasGiant()
    };
  }
  return {
    label: 'Gas giant',
    description: 'Enormous planets with massive hydrogen-helium envelopes similar to Jupiter or Saturn.',
    svgClass: 'gas-giant',
    svg: svgGasGiant()
  };
}

function syncURL() {
  const q = new URLSearchParams();
  const s = getState();
  for (const [k,v] of Object.entries(s)) if (v != null && v !== '') q.set(k, v);
  const url = `${location.pathname}?${q.toString()}`;
  history.replaceState(null, '', url);
}

function setStatus(t) { statusEl.textContent = t || ''; }
function num(x) { const n = Number(x); return Number.isFinite(n) ? n : null; }
function fmt(x, d=2) { return Number.isFinite(x) ? Number(x).toFixed(d) : ''; }
function fmtOrDash(x, d=2, placeholder='–') {
  const out = fmt(x, d);
  return out === '' ? placeholder : out;
}
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;' }[m])); }
function median(arr) {
  if (!arr.length) return null;
  const a = arr.slice().sort((x,y)=>x-y);
  const i = Math.floor(a.length/2);
  return a.length % 2 ? a[i] : (a[i-1]+a[i])/2;
}

function svgBase(inner, gradient) {
  return `
    <svg viewBox="0 0 160 160" role="img" aria-hidden="true">
      <defs>
        ${gradient || ''}
        <filter id="glow" x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="6" result="coloredBlur"></feGaussianBlur>
          <feMerge>
            <feMergeNode in="coloredBlur"></feMergeNode>
            <feMergeNode in="SourceGraphic"></feMergeNode>
          </feMerge>
        </filter>
      </defs>
      <g filter="url(#glow)">
        ${inner}
      </g>
    </svg>
  `;
}

function svgAirlessDwarf() {
  const gradient = `
    <radialGradient id="airlessGrad" cx="50%" cy="35%" r="65%">
      <stop offset="0%" stop-color="#f7f2ed" />
      <stop offset="70%" stop-color="#b3a79d" />
      <stop offset="100%" stop-color="#6b6058" />
    </radialGradient>
  `;
  const inner = `
    <circle cx="80" cy="80" r="48" fill="url(#airlessGrad)" />
    <g fill="rgba(60,52,46,0.55)">
      <ellipse cx="58" cy="62" rx="10" ry="7" />
      <ellipse cx="94" cy="52" rx="6" ry="4" />
      <ellipse cx="112" cy="88" rx="8" ry="6" />
    </g>
    <g stroke="rgba(255,255,255,0.3)" stroke-width="2" opacity="0.4">
      <path d="M36 96c18-6 36-6 54 0" />
      <path d="M54 116c12-4 24-4 36 0" />
    </g>
  `;
  return svgBase(inner, gradient);
}

function svgLavaWorld() {
  const gradient = `
    <radialGradient id="lavaGrad" cx="48%" cy="38%" r="68%">
      <stop offset="0%" stop-color="#ffd2a8" />
      <stop offset="55%" stop-color="#ff6b2c" />
      <stop offset="100%" stop-color="#6e0d0d" />
    </radialGradient>
  `;
  const inner = `
    <circle cx="80" cy="80" r="58" fill="url(#lavaGrad)" />
    <path d="M30 70c18-12 36-16 54-8s36 2 52-12" stroke="#ffd5b7" stroke-width="5" stroke-linecap="round" opacity="0.35" />
    <path d="M32 108c22-10 46-8 70 4s34 12 50 0" stroke="#2b0202" stroke-width="6" stroke-linecap="round" opacity="0.45" />
    <path d="M40 54c8 6 14 10 18 12" stroke="#ffd5b7" stroke-width="4" stroke-linecap="round" opacity="0.45" />
  `;
  return svgBase(inner, gradient);
}

function svgTemperateTerrestrial() {
  const gradient = `
    <radialGradient id="temperateGrad" cx="42%" cy="35%" r="70%">
      <stop offset="0%" stop-color="#d6f9ff" />
      <stop offset="55%" stop-color="#62c2a8" />
      <stop offset="100%" stop-color="#1b5e4c" />
    </radialGradient>
  `;
  const inner = `
    <circle cx="80" cy="80" r="60" fill="url(#temperateGrad)" />
    <path d="M18 92c32-18 66-22 104-8" stroke="#f3fff5" stroke-width="5" stroke-linecap="round" opacity="0.4" />
    <path d="M24 66c18 12 40 12 62 2" stroke="#0e3f34" stroke-width="6" stroke-linecap="round" opacity="0.35" />
  `;
  return svgBase(inner, gradient);
}

function svgMegaEarth() {
  const gradient = `
    <radialGradient id="megaGrad" cx="54%" cy="40%" r="62%">
      <stop offset="0%" stop-color="#d7f1ff" />
      <stop offset="60%" stop-color="#3173c2" />
      <stop offset="100%" stop-color="#122746" />
    </radialGradient>
  `;
  const inner = `
    <circle cx="80" cy="80" r="64" fill="url(#megaGrad)" />
    <ellipse cx="80" cy="82" rx="70" ry="20" fill="rgba(255,255,255,0.18)" />
    <path d="M26 60c26 16 54 20 82 12" stroke="#0a2a55" stroke-width="8" stroke-linecap="round" opacity="0.5" />
    <path d="M46 106c20-6 42-6 64 0" stroke="#6fb8ff" stroke-width="6" stroke-linecap="round" opacity="0.35" />
  `;
  return svgBase(inner, gradient);
}

function svgHotSuperEarth() {
  const gradient = `
    <radialGradient id="hotSeGrad" cx="50%" cy="32%" r="68%">
      <stop offset="0%" stop-color="#ffe6ff" />
      <stop offset="60%" stop-color="#ff55a5" />
      <stop offset="100%" stop-color="#5b0035" />
    </radialGradient>
  `;
  const inner = `
    <circle cx="80" cy="80" r="62" fill="url(#hotSeGrad)" />
    <path d="M24 90c30-16 60-18 90-6" stroke="#ffd6f4" stroke-width="5" stroke-linecap="round" opacity="0.45" />
    <path d="M38 58c20 10 42 8 66-4" stroke="#6a003b" stroke-width="7" stroke-linecap="round" opacity="0.4" />
  `;
  return svgBase(inner, gradient);
}

function svgHotSubNeptune() {
  const gradient = `
    <radialGradient id="hotSnGrad" cx="55%" cy="38%" r="65%">
      <stop offset="0%" stop-color="#fff5d9" />
      <stop offset="55%" stop-color="#ff9f4f" />
      <stop offset="100%" stop-color="#c22c62" />
    </radialGradient>
  `;
  const inner = `
    <circle cx="80" cy="80" r="66" fill="url(#hotSnGrad)" />
    <ellipse cx="80" cy="68" rx="72" ry="18" fill="rgba(255,255,255,0.2)" />
    <ellipse cx="80" cy="96" rx="60" ry="16" fill="rgba(144,16,70,0.45)" />
  `;
  return svgBase(inner, gradient);
}

function svgColdSubNeptune() {
  const gradient = `
    <radialGradient id="coldSnGrad" cx="48%" cy="36%" r="65%">
      <stop offset="0%" stop-color="#f4fbff" />
      <stop offset="60%" stop-color="#6fbbff" />
      <stop offset="100%" stop-color="#1c3f7f" />
    </radialGradient>
  `;
  const inner = `
    <circle cx="80" cy="80" r="66" fill="url(#coldSnGrad)" />
    <ellipse cx="80" cy="70" rx="74" ry="18" fill="rgba(255,255,255,0.3)" />
    <path d="M24 108c32-10 64-10 96 0" stroke="#0f2d5a" stroke-width="6" stroke-linecap="round" opacity="0.35" />
  `;
  return svgBase(inner, gradient);
}

function svgWarmNeptune() {
  const gradient = `
    <radialGradient id="warmNepGrad" cx="52%" cy="38%" r="64%">
      <stop offset="0%" stop-color="#f0e3ff" />
      <stop offset="60%" stop-color="#9a6bff" />
      <stop offset="100%" stop-color="#3a1f7f" />
    </radialGradient>
  `;
  const inner = `
    <circle cx="80" cy="80" r="68" fill="url(#warmNepGrad)" />
    <path d="M18 86c42-16 78-18 120-4" stroke="#f4e9ff" stroke-width="6" stroke-linecap="round" opacity="0.35" />
    <ellipse cx="80" cy="80" rx="88" ry="26" fill="none" stroke="rgba(186,144,255,0.5)" stroke-width="6" />
  `;
  return svgBase(inner, gradient);
}

function svgUltraHotJupiter() {
  const gradient = `
    <radialGradient id="uhjGrad" cx="50%" cy="36%" r="70%">
      <stop offset="0%" stop-color="#fff8d1" />
      <stop offset="55%" stop-color="#ffb347" />
      <stop offset="100%" stop-color="#ff433f" />
    </radialGradient>
  `;
  const inner = `
    <circle cx="80" cy="80" r="74" fill="url(#uhjGrad)" />
    <g stroke-width="9" stroke-linecap="round" opacity="0.4">
      <path d="M12 66c48-24 100-24 148 0" stroke="#ffe7a6" />
      <path d="M24 94c40-18 80-18 120 0" stroke="#d82a3c" />
    </g>
    <path d="M50 36c8 10 22 18 44 20" stroke="#fff5d7" stroke-width="6" stroke-linecap="round" opacity="0.5" />
  `;
  return svgBase(inner, gradient);
}

function svgColdGasGiant() {
  const gradient = `
    <radialGradient id="coldGasGrad" cx="54%" cy="40%" r="68%">
      <stop offset="0%" stop-color="#f0f7ff" />
      <stop offset="60%" stop-color="#4e89d8" />
      <stop offset="100%" stop-color="#0c2046" />
    </radialGradient>
  `;
  const inner = `
    <circle cx="80" cy="80" r="72" fill="url(#coldGasGrad)" />
    <g stroke-width="9" stroke-linecap="round" opacity="0.35">
      <path d="M16 70c44-18 92-18 136 0" stroke="#d7eaff" />
      <path d="M28 98c36-14 72-14 108 0" stroke="#1e4f91" />
    </g>
    <ellipse cx="80" cy="96" rx="96" ry="28" fill="none" stroke="rgba(100,164,238,0.45)" stroke-width="7" />
  `;
  return svgBase(inner, gradient);
}

function svgRocky() {
  const gradient = `
    <radialGradient id="rockyGrad" cx="50%" cy="45%" r="60%">
      <stop offset="0%" stop-color="#ffd7a3" />
      <stop offset="60%" stop-color="#d58a5a" />
      <stop offset="100%" stop-color="#7a4b34" />
    </radialGradient>
  `;
  const inner = `
    <circle cx="80" cy="80" r="60" fill="url(#rockyGrad)" />
    <path d="M25 70c10-8 22-12 34-10s26 4 36-4" stroke="#5b2e1f" stroke-width="4" stroke-linecap="round" opacity="0.4" />
    <path d="M40 100c8 6 18 9 28 8s22-4 32 2" stroke="#ffe0b8" stroke-width="3" stroke-linecap="round" opacity="0.3" />
  `;
  return svgBase(inner, gradient);
}

function svgSuperEarth() {
  const gradient = `
    <radialGradient id="seGrad" cx="45%" cy="35%" r="65%">
      <stop offset="0%" stop-color="#b8f2ff" />
      <stop offset="70%" stop-color="#3b7fd5" />
      <stop offset="100%" stop-color="#1c3463" />
    </radialGradient>
  `;
  const inner = `
    <circle cx="80" cy="80" r="62" fill="url(#seGrad)" />
    <path d="M18 84c28-18 58-26 90-16" stroke="#ffffff" stroke-width="5" stroke-linecap="round" opacity="0.25" />
    <path d="M30 56c18 6 42 4 66-6" stroke="#0b3f8f" stroke-width="6" stroke-linecap="round" opacity="0.3" />
  `;
  return svgBase(inner, gradient);
}

function svgSubNeptune() {
  const gradient = `
    <radialGradient id="snGrad" cx="55%" cy="40%" r="60%">
      <stop offset="0%" stop-color="#d5f4ff" />
      <stop offset="80%" stop-color="#5fb3ff" />
      <stop offset="100%" stop-color="#215fbd" />
    </radialGradient>
  `;
  const inner = `
    <circle cx="80" cy="80" r="65" fill="url(#snGrad)" />
    <ellipse cx="80" cy="70" rx="70" ry="16" fill="rgba(255,255,255,0.18)" />
    <ellipse cx="80" cy="94" rx="60" ry="14" fill="rgba(14,68,150,0.25)" />
  `;
  return svgBase(inner, gradient);
}

function svgNeptune() {
  const gradient = `
    <radialGradient id="nepGrad" cx="50%" cy="40%" r="60%">
      <stop offset="0%" stop-color="#d1e7ff" />
      <stop offset="75%" stop-color="#4f7bd9" />
      <stop offset="100%" stop-color="#243d8f" />
    </radialGradient>
  `;
  const inner = `
    <circle cx="80" cy="80" r="66" fill="url(#nepGrad)" />
    <path d="M15 88c40-20 72-24 110-10" stroke="#ffffff" stroke-width="6" stroke-linecap="round" opacity="0.2" />
    <ellipse cx="80" cy="80" rx="80" ry="24" fill="none" stroke="rgba(170,210,255,0.55)" stroke-width="6" />
  `;
  return svgBase(inner, gradient);
}

function svgGasGiant() {
  const gradient = `
    <radialGradient id="gasGrad" cx="55%" cy="42%" r="65%">
      <stop offset="0%" stop-color="#fff1d6" />
      <stop offset="70%" stop-color="#f7a861" />
      <stop offset="100%" stop-color="#c25f28" />
    </radialGradient>
  `;
  const inner = `
    <circle cx="80" cy="80" r="70" fill="url(#gasGrad)" />
    <g stroke-width="10" stroke-linecap="round" opacity="0.35">
      <path d="M10 66c46-22 96-22 140 0" stroke="#fff5e3" />
      <path d="M20 90c40-18 80-18 120 0" stroke="#ac4a1b" />
    </g>
    <ellipse cx="80" cy="92" rx="96" ry="30" fill="none" stroke="rgba(255,194,120,0.45)" stroke-width="8" />
  `;
  return svgBase(inner, gradient);
}

function svgUnknown() {
  const inner = `
    <circle cx="80" cy="80" r="56" fill="#1c2734" stroke="#314354" stroke-width="4" />
    <text x="80" y="90" text-anchor="middle" font-size="48" fill="#4c637c">?</text>
  `;
  return svgBase(inner);
}
