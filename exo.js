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
const examplesWrap = el('exampleButtons');
let exampleButtons = [];

const sumCount = el('sumCount');
const sumR = el('sumR');
const sumT = el('sumT');
const sumMass = el('sumMass');
const mrViz = el('mrViz');
const selectedSummary = el('selectedSummary');

let currentRows = [];
let selectedPlanetName = '';
let activeExampleDesc = '';

const EXAMPLE_PRESETS = [
  {
    key: 'lavaWorlds',
    label: 'Lava worlds',
    filters: { facility: '', yearMin: 2000, rMin: 0.4, rMax: 1.5, tMin: 900, tMax: '' },
    description: 'Curated sample: tidally roasted worlds with magma oceans and vaporized rock skies.'
  },
  {
    key: 'airlessDwarfs',
    label: 'Airless dwarfs',
    filters: { facility: '', yearMin: 1995, rMin: '', rMax: 0.5, tMin: '', tMax: 1200 },
    description: 'Curated sample: tiny, likely airless bodies dominated by bare rock surfaces.'
  },
  {
    key: 'temperateTerrestrials',
    label: 'Temperate terrestrials',
    filters: { facility: '', yearMin: 2009, rMin: 0.7, rMax: 1.5, tMin: 240, tMax: 330 },
    description: 'Curated sample: Earth-sized planets receiving clement stellar irradiation.'
  },
  {
    key: 'rockyTerrestrials',
    label: 'Rocky terrestrials',
    filters: { facility: '', yearMin: 1995, rMin: 0.5, rMax: 1.3, tMin: 120, tMax: 750 },
    description: 'Curated sample: compact rocky worlds similar in scale to the inner Solar System.'
  },
  {
    key: 'megaEarths',
    label: 'Mega-Earths',
    filters: { facility: '', yearMin: 2005, rMin: 1.4, rMax: 2, tMin: '', tMax: 600 },
    description: 'Curated sample: massive terrestrial giants with extreme surface gravity.'
  },
  {
    key: 'hotSuperEarths',
    label: 'Hot super-Earths',
    filters: { facility: '', yearMin: 2005, rMin: 1, rMax: 2, tMin: 800, tMax: '' },
    description: 'Curated sample: volatile-rich super-Earths orbiting scorchingly close to their stars.'
  },
  {
    key: 'superEarths',
    label: 'Super-Earths',
    filters: { facility: '', yearMin: 2009, rMin: 1, rMax: 2, tMin: 200, tMax: 700 },
    description: 'Curated sample: larger-than-Earth worlds with substantial atmospheres.'
  },
  {
    key: 'hotSubNeptunes',
    label: 'Hot sub-Neptunes',
    filters: { facility: '', yearMin: 2000, rMin: 2, rMax: 4, tMin: 800, tMax: '' },
    description: 'Curated sample: volatile sub-Neptunes puffed up by intense stellar heating.'
  },
  {
    key: 'coldSubNeptunes',
    label: 'Cold sub-Neptunes',
    filters: { facility: '', yearMin: 1995, rMin: 1.5, rMax: 4, tMin: '', tMax: 200 },
    description: 'Curated sample: intermediate worlds orbiting beyond the snow line.'
  },
  {
    key: 'temperateSubNeptunes',
    label: 'Temperate sub-Neptunes',
    filters: { facility: '', yearMin: 2009, rMin: 1.5, rMax: 4, tMin: 200, tMax: 650 },
    description: 'Curated sample: sub-Neptunes with moderate climates and thick envelopes.'
  },
  {
    key: 'warmNeptunes',
    label: 'Warm Neptunes',
    filters: { facility: '', yearMin: 2000, rMin: 3.5, rMax: 6, tMin: 700, tMax: '' },
    description: 'Curated sample: ice giant analogues broiling enough to drive fierce winds.'
  },
  {
    key: 'neptuneLikes',
    label: 'Neptune-like worlds',
    filters: { facility: '', yearMin: 1995, rMin: 3.5, rMax: 6, tMin: 200, tMax: 650 },
    description: 'Curated sample: classic ice giants with deep hydrogen-helium atmospheres.'
  },
  {
    key: 'ultraHotJupiters',
    label: 'Ultra-hot Jupiters',
    filters: { facility: '', yearMin: 2000, rMin: 6, rMax: '', tMin: 1200, tMax: '' },
    description: 'Curated sample: gas giants skimming their stars with iron-vapor skies.'
  },
  {
    key: 'coldGasGiants',
    label: 'Cold gas giants',
    filters: { facility: '', yearMin: 1995, rMin: 6, rMax: '', tMin: '', tMax: 350 },
    description: 'Curated sample: distant gas giants bathed in muted sunlight and ammonia clouds.'
  },
  {
    key: 'gasGiants',
    label: 'Gas giants',
    filters: { facility: '', yearMin: 1995, rMin: 6, rMax: '', tMin: 350, tMax: 1200 },
    description: 'Curated sample: Jupiter and Saturn analogues with massive hydrogen envelopes.'
  }
];

const EXAMPLE_FILTERS = Object.fromEntries(EXAMPLE_PRESETS.map((preset) => [preset.key, preset]));

buildExampleButtons();

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

function buildExampleButtons() {
  if (!examplesWrap) return;
  examplesWrap.innerHTML = '';
  exampleButtons = [];
  EXAMPLE_PRESETS.forEach((preset) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'example';
    btn.dataset.example = preset.key;
    btn.textContent = preset.label;
    btn.title = preset.description;
    examplesWrap.appendChild(btn);
    exampleButtons.push(btn);
  });
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

// Enhanced SVG base with ambient glow and better lighting
function svgBase(inner, gradient) {
  return `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160" role="img" aria-hidden="true">
      <defs>
        ${gradient || ''}
        <!-- Ambient glow filter -->
        <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="6" result="blur"/>
          <feMerge>
            <feMergeNode in="blur"/>
            <feMergeNode in="SourceGraphic"/>
          </feMerge>
        </filter>
        <!-- Subtle cloud animation -->
        <style>
          @keyframes drift { from { transform: translateX(0); } to { transform: translateX(-8px); } }
          .cloud { animation: drift 4s infinite alternate ease-in-out; }
        </style>
      </defs>
      <g filter="url(#glow)">
        ${inner}
      </g>
    </svg>
  `;
}

// Improved SVGs with texture, lighting, and realism
function svgAirlessDwarf() {
  const gradient = `
    <radialGradient id="airlessGrad" cx="45%" cy="40%" r="65%">
      <stop offset="0%" stop-color="#f5f0e8" />
      <stop offset="60%" stop-color="#c0b5a8" />
      <stop offset="100%" stop-color="#7a6e63" />
    </radialGradient>
  `;
  const inner = `
    <circle cx="80" cy="80" r="48" fill="url(#airlessGrad)" />
    <g fill="rgba(60,52,46,0.6)">
      <ellipse cx="56" cy="60" rx="12" ry="8" />
      <ellipse cx="98" cy="50" rx="8" ry="5" />
      <ellipse cx="114" cy="90" rx="10" ry="7" />
    </g>
    <path d="M40 100 Q60 80 80 100 T120 100" stroke="#8a8075" stroke-width="3" fill="none" opacity="0.4"/>
  `;
  return svgBase(inner, gradient);
}

function svgLavaWorld() {
  const gradient = `
    <radialGradient id="lavaGrad" cx="50%" cy="35%" r="70%">
      <stop offset="0%" stop-color="#ffe0a0" />
      <stop offset="50%" stop-color="#ff6b2c" />
      <stop offset="100%" stop-color="#8b0f0f" />
    </radialGradient>
  `;
  const inner = `
    <circle cx="80" cy="80" r="60" fill="url(#lavaGrad)" />
    <path d="M30 70 C50 50 70 55 90 60 S130 65 150 75" stroke="#fff" stroke-width="4" fill="none" opacity="0.3" />
    <path d="M25 110 C50 100 75 105 100 100 S140 95 155 110" stroke="#400000" stroke-width="5" fill="none" opacity="0.4"/>
    <circle cx="60" cy="50" r="4" fill="#ffe6b0" opacity="0.7">
      <animate attributeName="r" values="4;5;4" dur="2s" repeatCount="indefinite"/>
    </circle>
  `;
  return svgBase(inner, gradient);
}

function svgTemperateTerrestrial() {
  const gradient = `
    <radialGradient id="temperateGrad" cx="40%" cy="35%" r="70%">
      <stop offset="0%" stop-color="#d0f0ff" />
      <stop offset="50%" stop-color="#4a9a70" />
      <stop offset="100%" stop-color="#154a35" />
    </radialGradient>
  `;
  const inner = `
    <circle cx="80" cy="80" r="60" fill="url(#temperateGrad)" />
    <path d="M20 90 C60 70 100 75 140 90" stroke="#e0f8ff" stroke-width="6" fill="none" opacity="0.4"/>
    <path d="M30 60 C70 80 110 70 150 65" stroke="#0a3528" stroke-width="5" fill="none" opacity="0.3"/>
    <path d="M60 40 C70 50 90 50 100 40" stroke="#e0f8ff" stroke-width="3" fill="none" opacity="0.5"/>
  `;
  return svgBase(inner, gradient);
}

function svgMegaEarth() {
  const gradient = `
    <radialGradient id="megaGrad" cx="55%" cy="40%" r="65%">
      <stop offset="0%" stop-color="#e0f5ff" />
      <stop offset="60%" stop-color="#2c70c0" />
      <stop offset="100%" stop-color="#0f2040" />
    </radialGradient>
  `;
  const inner = `
    <circle cx="80" cy="80" r="66" fill="url(#megaGrad)" />
    <ellipse cx="80" cy="80" rx="74" ry="20" fill="rgba(255,255,255,0.15)" />
    <path d="M20 70 C60 50 100 55 140 70" stroke="#082c5a" stroke-width="8" fill="none" opacity="0.5"/>
    <path d="M40 105 C80 95 120 95 160 105" stroke="#60a8f0" stroke-width="6" fill="none" opacity="0.3"/>
  `;
  return svgBase(inner, gradient);
}

function svgHotSuperEarth() {
  const gradient = `
    <radialGradient id="hotSeGrad" cx="50%" cy="35%" r="70%">
      <stop offset="0%" stop-color="#ffe8ff" />
      <stop offset="60%" stop-color="#ff50a0" />
      <stop offset="100%" stop-color="#600030" />
    </radialGradient>
  `;
  const inner = `
    <circle cx="80" cy="80" r="64" fill="url(#hotSeGrad)" />
    <path d="M20 85 C60 65 100 70 140 85" stroke="#ffd0f0" stroke-width="6" fill="none" opacity="0.4"/>
    <path d="M30 55 C70 70 110 60 150 55" stroke="#600035" stroke-width="7" fill="none" opacity="0.4"/>
    <circle cx="60" cy="60" r="5" fill="rgba(255,255,255,0.2)">
      <animate attributeName="opacity" values="0.2;0.5;0.2" dur="3s" repeatCount="indefinite"/>
    </circle>
  `;
  return svgBase(inner, gradient);
}

function svgHotSubNeptune() {
  const gradient = `
    <radialGradient id="hotSnGrad" cx="55%" cy="35%" r="70%">
      <stop offset="0%" stop-color="#fff0d0" />
      <stop offset="60%" stop-color="#ff9040" />
      <stop offset="100%" stop-color="#b02050" />
    </radialGradient>
  `;
  const inner = `
    <circle cx="80" cy="80" r="68" fill="url(#hotSnGrad)" />
    <ellipse cx="80" cy="70" rx="76" ry="18" fill="rgba(255,255,255,0.2)" />
    <ellipse cx="80" cy="96" rx="64" ry="16" fill="rgba(130,10,60,0.4)" />
    <path d="M30 100 C70 95 110 95 150 100" stroke="#d04060" stroke-width="5" fill="none" opacity="0.3"/>
  `;
  return svgBase(inner, gradient);
}

function svgColdSubNeptune() {
  const gradient = `
    <radialGradient id="coldSnGrad" cx="48%" cy="35%" r="68%">
      <stop offset="0%" stop-color="#f0f8ff" />
      <stop offset="60%" stop-color="#50a0ff" />
      <stop offset="100%" stop-color="#103070" />
    </radialGradient>
  `;
  const inner = `
    <circle cx="80" cy="80" r="68" fill="url(#coldSnGrad)" />
    <ellipse cx="80" cy="70" rx="78" ry="18" fill="rgba(255,255,255,0.3)" />
    <path d="M20 110 C60 105 100 105 140 110" stroke="#002050" stroke-width="6" fill="none" opacity="0.3"/>
    <path d="M40 50 C80 60 120 55 160 50" stroke="#a0d0ff" stroke-width="4" fill="none" opacity="0.2"/>
  `;
  return svgBase(inner, gradient);
}

function svgWarmNeptune() {
  const gradient = `
    <radialGradient id="warmNepGrad" cx="52%" cy="38%" r="66%">
      <stop offset="0%" stop-color="#f0e0ff" />
      <stop offset="60%" stop-color="#8060ff" />
      <stop offset="100%" stop-color="#201070" />
    </radialGradient>
  `;
  const inner = `
    <circle cx="80" cy="80" r="70" fill="url(#warmNepGrad)" />
    <path d="M15 85 C60 65 100 70 145 85" stroke="#f0d0ff" stroke-width="6" fill="none" opacity="0.3"/>
    <ellipse cx="80" cy="80" rx="90" ry="26" fill="none" stroke="rgba(180,140,255,0.5)" stroke-width="6"/>
  `;
  return svgBase(inner, gradient);
}

function svgUltraHotJupiter() {
  const gradient = `
    <radialGradient id="uhjGrad" cx="50%" cy="35%" r="72%">
      <stop offset="0%" stop-color="#fff5d0" />
      <stop offset="55%" stop-color="#ffb040" />
      <stop offset="100%" stop-color="#ff3030" />
    </radialGradient>
  `;
  const inner = `
    <circle cx="80" cy="80" r="76" fill="url(#uhjGrad)" />
    <g stroke-width="10" stroke-linecap="round" opacity="0.4">
      <path d="M10 65 C60 45 100 50 150 65" stroke="#ffe0a0" />
      <path d="M20 90 C60 75 100 75 140 90" stroke="#cc2020" />
    </g>
    <circle cx="50" cy="40" r="6" fill="#ffe6b0">
      <animate attributeName="r" values="6;7;6" dur="1.5s" repeatCount="indefinite"/>
    </circle>
  `;
  return svgBase(inner, gradient);
}

function svgColdGasGiant() {
  const gradient = `
    <radialGradient id="coldGasGrad" cx="55%" cy="40%" r="70%">
      <stop offset="0%" stop-color="#e8f4ff" />
      <stop offset="60%" stop-color="#4080d0" />
      <stop offset="100%" stop-color="#0a1a40" />
    </radialGradient>
  `;
  const inner = `
    <circle cx="80" cy="80" r="74" fill="url(#coldGasGrad)" />
    <g stroke-width="10" stroke-linecap="round" opacity="0.35">
      <path d="M15 70 C60 50 100 55 145 70" stroke="#d0e8ff" />
      <path d="M25 95 C60 80 100 80 135 95" stroke="#104080" />
    </g>
    <ellipse cx="80" cy="96" rx="100" ry="30" fill="none" stroke="rgba(100,160,240,0.4)" stroke-width="7"/>
  `;
  return svgBase(inner, gradient);
}

function svgRocky() {
  const gradient = `
    <radialGradient id="rockyGrad" cx="50%" cy="45%" r="62%">
      <stop offset="0%" stop-color="#f0d0a0" />
      <stop offset="60%" stop-color="#c07040" />
      <stop offset="100%" stop-color="#603020" />
    </radialGradient>
  `;
  const inner = `
    <circle cx="80" cy="80" r="62" fill="url(#rockyGrad)" />
    <path d="M25 70 C40 60 55 65 70 60 S110 55 125 70" stroke="#402010" stroke-width="4" fill="none" opacity="0.4"/>
    <path d="M35 100 C50 110 70 105 85 110 S125 105 140 100" stroke="#f8e0b0" stroke-width="3" fill="none" opacity="0.3"/>
  `;
  return svgBase(inner, gradient);
}

function svgSuperEarth() {
  const gradient = `
    <radialGradient id="seGrad" cx="45%" cy="35%" r="68%">
      <stop offset="0%" stop-color="#b0e0ff" />
      <stop offset="70%" stop-color="#3070d0" />
      <stop offset="100%" stop-color="#102050" />
    </radialGradient>
  `;
  const inner = `
    <circle cx="80" cy="80" r="64" fill="url(#seGrad)" />
    <path d="M20 85 C60 65 100 70 140 85" stroke="#ffffff" stroke-width="5" fill="none" opacity="0.25"/>
    <path d="M30 55 C70 75 110 65 150 55" stroke="#003080" stroke-width="6" fill="none" opacity="0.3"/>
    <ellipse cx="80" cy="80" rx="70" ry="20" fill="rgba(255,255,255,0.1)" />
  `;
  return svgBase(inner, gradient);
}

function svgSubNeptune() {
  const gradient = `
    <radialGradient id="snGrad" cx="55%" cy="40%" r="65%">
      <stop offset="0%" stop-color="#d0f0ff" />
      <stop offset="75%" stop-color="#40a0ff" />
      <stop offset="100%" stop-color="#1040b0" />
    </radialGradient>
  `;
  const inner = `
    <circle cx="80" cy="80" r="67" fill="url(#snGrad)" />
    <ellipse cx="80" cy="70" rx="74" ry="18" fill="rgba(255,255,255,0.2)" />
    <ellipse cx="80" cy="94" rx="64" ry="14" fill="rgba(10,60,140,0.25)" />
    <path d="M25 105 C65 100 95 100 135 105" stroke="#2070d0" stroke-width="5" fill="none" opacity="0.2"/>
  `;
  return svgBase(inner, gradient);
}

function svgNeptune() {
  const gradient = `
    <radialGradient id="nepGrad" cx="50%" cy="40%" r="65%">
      <stop offset="0%" stop-color="#d0e8ff" />
      <stop offset="75%" stop-color="#3070d0" />
      <stop offset="100%" stop-color="#102060" />
    </radialGradient>
  `;
  const inner = `
    <circle cx="80" cy="80" r="68" fill="url(#nepGrad)" />
    <path d="M15 88 C60 68 100 72 145 88" stroke="#ffffff" stroke-width="6" fill="none" opacity="0.2"/>
    <ellipse cx="80" cy="80" rx="84" ry="26" fill="none" stroke="rgba(160,200,255,0.5)" stroke-width="6"/>
  `;
  return svgBase(inner, gradient);
}

function svgGasGiant() {
  const gradient = `
    <radialGradient id="gasGrad" cx="55%" cy="42%" r="68%">
      <stop offset="0%" stop-color="#fff0d0" />
      <stop offset="70%" stop-color="#f5a050" />
      <stop offset="100%" stop-color="#b04020" />
    </radialGradient>
  `;
  const inner = `
    <circle cx="80" cy="80" r="72" fill="url(#gasGrad)" />
    <g stroke-width="10" stroke-linecap="round" opacity="0.35">
      <path d="M10 65 C60 45 100 50 150 65" stroke="#ffe0b0" />
      <path d="M20 90 C60 75 100 75 140 90" stroke="#a03010" />
    </g>
    <ellipse cx="80" cy="94" rx="100" ry="32" fill="none" stroke="rgba(255,180,100,0.4)" stroke-width="8"/>
    <circle cx="110" cy="60" r="8" fill="rgba(255,255,255,0.3)" class="cloud"/>
  `;
  return svgBase(inner, gradient);
}

function svgUnknown() {
  const inner = `
    <circle cx="80" cy="80" r="56" fill="#1c2734" stroke="#314354" stroke-width="4" />
    <text x="80" y="90" text-anchor="middle" font-size="48" fill="#4c637c" font-family="sans-serif">?</text>
  `;
  return svgBase(inner);
}
