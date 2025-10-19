// Exoplanet Explorer frontend
// Fetches from your Worker: /exo/ps, /exo/pscomp, /exo/tap
const WORKER_BASE = 'https://lively-haze-4b2c.hicksrch.workers.dev';
const W = WORKER_BASE;

const el = (id) => document.getElementById(id);
const qs = new URLSearchParams(location.search);

const inputs = {
  facility: el('facility'),
  yearMin: el('yearMin'),
  rMin: el('rMin'),
  rMax: el('rMax'),
  tMin: el('tMin'),
  tMax: el('tMax'),
};

const btnFetch = el('btnFetch');
const btnShare = el('btnShare');
const btnCSV = el('btnCSV');
const statusEl = el('status');
const adqlEl = el('adql');
const rowsEl = el('rows');
const hintEl = el('hint');
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

const EXAMPLE_PRESETS = [{
    key: 'lavaWorlds',
    label: 'Lava worlds',
    filters: { facility: '', yearMin: 2000, rMin: 0.4, rMax: 1.5, tMin: Math.round(kelvinToFahrenheit(900)), tMax: '' },
    description: 'Curated sample: tidally roasted worlds with magma oceans and vaporized rock skies.'
  },
  {
    key: 'airlessDwarfs',
    label: 'Airless dwarfs',
    filters: { facility: '', yearMin: 1995, rMin: '', rMax: 0.5, tMin: '', tMax: Math.round(kelvinToFahrenheit(1200)) },
    description: 'Curated sample: tiny, likely airless bodies dominated by bare rock surfaces.'
  },
  {
    key: 'temperateTerrestrials',
    label: 'Temperate terrestrials',
    filters: { facility: '', yearMin: 2009, rMin: 0.7, rMax: 1.5, tMin: Math.round(kelvinToFahrenheit(240)), tMax: Math.round(kelvinToFahrenheit(330)) },
    description: 'Curated sample: Earth-sized planets receiving clement stellar irradiation.'
  },
  {
    key: 'rockyTerrestrials',
    label: 'Rocky terrestrials',
    filters: { facility: '', yearMin: 1995, rMin: 0.5, rMax: 1.3, tMin: Math.round(kelvinToFahrenheit(120)), tMax: Math.round(kelvinToFahrenheit(750)) },
    description: 'Curated sample: compact rocky worlds similar in scale to the inner Solar System.'
  },
  {
    key: 'megaEarths',
    label: 'Mega-Earths',
    filters: { facility: '', yearMin: 2005, rMin: 1.4, rMax: 2, tMin: '', tMax: Math.round(kelvinToFahrenheit(600)) },
    description: 'Curated sample: massive terrestrial giants with extreme surface gravity.'
  },
  {
    key: 'hotSuperEarths',
    label: 'Hot super-Earths',
    filters: { facility: '', yearMin: 2005, rMin: 1, rMax: 2, tMin: Math.round(kelvinToFahrenheit(800)), tMax: '' },
    description: 'Curated sample: volatile-rich super-Earths orbiting scorchingly close to their stars.'
  },
  {
    key: 'superEarths',
    label: 'Super-Earths',
    filters: { facility: '', yearMin: 2009, rMin: 1, rMax: 2, tMin: Math.round(kelvinToFahrenheit(200)), tMax: Math.round(kelvinToFahrenheit(700)) },
    description: 'Curated sample: larger-than-Earth worlds with substantial atmospheres.'
  },
  {
    key: 'hotSubNeptunes',
    label: 'Hot sub-Neptunes',
    filters: { facility: '', yearMin: 2000, rMin: 2, rMax: 4, tMin: Math.round(kelvinToFahrenheit(800)), tMax: '' },
    description: 'Curated sample: volatile sub-Neptunes puffed up by intense stellar heating.'
  },
  {
    key: 'coldSubNeptunes',
    label: 'Cold sub-Neptunes',
    filters: { facility: '', yearMin: 1995, rMin: 1.5, rMax: 4, tMin: '', tMax: Math.round(kelvinToFahrenheit(200)) },
    description: 'Curated sample: intermediate worlds orbiting beyond the snow line.'
  },
  {
    key: 'temperateSubNeptunes',
    label: 'Temperate sub-Neptunes',
    filters: { facility: '', yearMin: 2009, rMin: 1.5, rMax: 4, tMin: Math.round(kelvinToFahrenheit(200)), tMax: Math.round(kelvinToFahrenheit(650)) },
    description: 'Curated sample: sub-Neptunes with moderate climates and thick envelopes.'
  },
  {
    key: 'warmNeptunes',
    label: 'Warm Neptunes',
    filters: { facility: '', yearMin: 2000, rMin: 3.5, rMax: 6, tMin: Math.round(kelvinToFahrenheit(700)), tMax: '' },
    description: 'Curated sample: ice giant analogues broiling enough to drive fierce winds.'
  },
  {
    key: 'neptuneLikes',
    label: 'Neptune-like worlds',
    filters: { facility: '', yearMin: 1995, rMin: 3.5, rMax: 6, tMin: Math.round(kelvinToFahrenheit(200)), tMax: Math.round(kelvinToFahrenheit(650)) },
    description: 'Curated sample: classic ice giants with deep hydrogen-helium atmospheres.'
  },
  {
    key: 'ultraHotJupiters',
    label: 'Ultra-hot Jupiters',
    filters: { facility: '', yearMin: 2000, rMin: 6, rMax: '', tMin: Math.round(kelvinToFahrenheit(1200)), tMax: '' },
    description: 'Curated sample: gas giants skimming their stars with iron-vapor skies.'
  },
  {
    key: 'coldGasGiants',
    label: 'Cold gas giants',
    filters: { facility: '', yearMin: 1995, rMin: 6, rMax: '', tMin: '', tMax: Math.round(kelvinToFahrenheit(350)) },
    description: 'Curated sample: distant gas giants bathed in muted sunlight and ammonia clouds.'
  },
  {
    key: 'gasGiants',
    label: 'Gas giants',
    filters: { facility: '', yearMin: 1995, rMin: 6, rMax: '', tMin: Math.round(kelvinToFahrenheit(350)), tMax: Math.round(kelvinToFahrenheit(1200)) },
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
<td>${fmtTemperature(r.eqt)}</td>
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
  const medianKelvin = median(T);
  sumT.textContent = medianKelvin == null ? '–' : fmtTemperature(medianKelvin, 0);
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
  if (q.rMin) { clauses.push(`pl_rade >= ${+q.rMin}`); desc.push(`Re ≥ ${+q.rMin}`); }
  if (q.rMax) { clauses.push(`pl_rade <= ${+q.rMax}`); desc.push(`Re ≤ ${+q.rMax}`); }
  if (q.tMin) {
    const fMin = num(q.tMin);
    const kMin = fMin == null ? null : fahrenheitToKelvin(fMin);
    if (kMin != null) {
      clauses.push(`pl_eqt >= ${kMin.toFixed(2)}`);
      desc.push(`Teq ≥ ${fMin} °F`);
    }
  }
  if (q.tMax) {
    const fMax = num(q.tMax);
    const kMax = fMax == null ? null : fahrenheitToKelvin(fMax);
    if (kMax != null) {
      clauses.push(`pl_eqt <= ${kMax.toFixed(2)}`);
      desc.push(`Teq ≤ ${fMax} °F`);
    }
  }
  return { where: clauses.filter(Boolean).join(' AND '), filtersDesc: desc.length ? desc.join(' · ') : 'No additional filters' };
}

function getState() {
  return {
    facility: inputs.facility.value.trim(),
    yearMin: inputs.yearMin.value.trim(),
    rMin: inputs.rMin.value.trim(),
    rMax: inputs.rMax.value.trim(),
    tMin: inputs.tMin.value.trim(),
    tMax: inputs.tMax.value.trim(),
  };
}

function setState(obj, { clear = false } = {}) {
  if (clear) {
    for (const key of Object.keys(inputs)) {
      inputs[key].value = '';
    }
  }
  for (const [k, v] of Object.entries(obj)) {
    if (!(k in inputs)) continue;
    inputs[k].value = v == null ? '' : String(v);
  }
}

function initFromURL() {
  const seed = {};
  for (const [k, v] of qs.entries()) {
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
    setTimeout(() => setStatus(''), 900);
  });
  btnCSV.addEventListener('click', async () => {
    const rows = Array.from(rowsEl.querySelectorAll('tr')).map(tr => Array.from(tr.children).map(td => td.textContent));
    const header = ['pl_name', 'hostname', 'pl_rade', 'pl_masse', 'pl_eqt_f', 'pl_orbper', 'ra', 'dec', 'disc_year'];
    const csv = [header.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'exoplanets.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setStatus('CSV saved');
    setTimeout(() => setStatus(''), 900);
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
<dt>Equilibrium temp (°F)</dt><dd>${fmtTemperatureOrDash(planet.eqt, 0)}</dd>
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
  for (const [k, v] of Object.entries(s)) if (v != null && v !== '') q.set(k, v);
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

function fmt(x, d = 2) { return Number.isFinite(x) ? Number(x).toFixed(d) : ''; }

function fmtTemperature(kelvin, d = 0) {
  const f = kelvinToFahrenheit(kelvin);
  return f == null ? '' : Number(f).toFixed(d);
}

function fmtOrDash(x, d = 2, placeholder = '–') {
  const out = fmt(x, d);
  return out === '' ? placeholder : out;
}

function fmtTemperatureOrDash(kelvin, d = 0, placeholder = '–') {
  const out = fmtTemperature(kelvin, d);
  return out === '' ? placeholder : out;
}

function esc(s) { return String(s ?? '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' }[m])); }

function median(arr) {
  if (!arr.length) return null;
  const a = arr.slice().sort((x, y) => x - y);
  const i = Math.floor(a.length / 2);
  return a.length % 2 ? a[i] : (a[i - 1] + a[i]) / 2;
}

function kelvinToFahrenheit(kelvin) {
  return Number.isFinite(kelvin) ? (kelvin - 273.15) * 9 / 5 + 32 : null;
}

function fahrenheitToKelvin(fahrenheit) {
  return Number.isFinite(fahrenheit) ? (fahrenheit - 32) * 5 / 9 + 273.15 : null;
}

function svgBase(inner, gradient, defs = '') {
  return `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160" role="img" aria-hidden="true">
  <defs>
    ${gradient || ''}
    ${defs}
    <!-- Rim light and atmosphere glow -->
    <filter id="atmo" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur in="SourceAlpha" stdDeviation="3" result="blur" />
      <feSpecularLighting in="blur" surfaceScale="5" specularConstant="1" specularExponent="20" lighting-color="#ffffff" result="specOut">
        <fePointLight x="-500" y="-100" z="300" />
      </feSpecularLighting>
      <feComposite in="specOut" in2="SourceAlpha" operator="in" result="specOut" />
      <feComposite in="SourceGraphic" in2="specOut" operator="arithmetic" k1="0" k2="1" k3="1" k4="0" result="litPaint" />
      <feGaussianBlur in="SourceGraphic" stdDeviation="10" result="ambientGlow" />
      <feMerge>
        <feMergeNode in="ambientGlow" />
        <feMergeNode in="litPaint" />
      </feMerge>
    </filter>
    <clipPath id="planetClip">
      <circle cx="80" cy="80" r="78" />
    </clipPath>
  </defs>
  <g filter="url(#atmo)">
    ${inner}
  </g>
</svg>
`;
}

function svgAirlessDwarf() {
  const gradient = `
<radialGradient id="airlessGrad" cx="60%" cy="40%" r="75%">
  <stop offset="0%" stop-color="#e0d8cf" />
  <stop offset="60%" stop-color="#8a7f73" />
  <stop offset="100%" stop-color="#423a35" />
</radialGradient>
`;
  const inner = `
<circle cx="80" cy="80" r="50" fill="url(#airlessGrad)" />
<!-- Craters -->
<g fill="rgba(0,0,0,0.25)" stroke="rgba(255,255,255,0.1)" stroke-width="1">
  <ellipse cx="60" cy="65" rx="10" ry="8" transform="rotate(-15 60 65)" />
  <ellipse cx="95" cy="55" rx="7" ry="5" />
  <ellipse cx="110" cy="90" rx="8" ry="6" transform="rotate(20 110 90)" />
  <circle cx="85" cy="105" r="4" />
  <circle cx="45" cy="90" r="3" />
</g>
`;
  return svgBase(inner, gradient);
}

function svgLavaWorld() {
  const gradient = `
<radialGradient id="lavaGrad" cx="50%" cy="50%" r="65%" fx="40%" fy="40%">
  <stop offset="0%" stop-color="#ff4d00" />
  <stop offset="50%" stop-color="#8c2200" />
  <stop offset="100%" stop-color="#2b0a00" />
</radialGradient>
`;
  const inner = `
<circle cx="80" cy="80" r="60" fill="#3d1a1a" />
<!-- Molten Cracks -->
<g stroke-linecap="round" fill="none" filter="blur(0.5px)">
  <path d="M30 70 Q 50 100, 90 90 T 140 80" stroke="#ff9100" stroke-width="5" opacity="0.8"/>
  <path d="M30 70 Q 50 100, 90 90 T 140 80" stroke="#ffff00" stroke-width="2" />
  
  <path d="M60 30 Q 80 60, 110 50" stroke="#ff5500" stroke-width="4" opacity="0.7" />
  <path d="M60 30 Q 80 60, 110 50" stroke="#ffcc00" stroke-width="1.5" />
  
  <path d="M50 120 Q 90 110, 120 130" stroke="#ff2a00" stroke-width="6" opacity="0.6" />
  <path d="M50 120 Q 90 110, 120 130" stroke="#ff8800" stroke-width="2" />
</g>
<circle cx="80" cy="80" r="60" fill="url(#lavaGrad)" opacity="0.5" style="mix-blend-mode: overlay;" />
`;
  return svgBase(inner, gradient);
}

function svgTemperateTerrestrial() {
  const gradient = `
<radialGradient id="oceanGrad" cx="50%" cy="50%" r="70%" fx="30%" fy="30%">
  <stop offset="0%" stop-color="#4facfe" />
  <stop offset="100%" stop-color="#003a7d" />
</radialGradient>
`;
  const inner = `
<circle cx="80" cy="80" r="62" fill="url(#oceanGrad)" />
<!-- Continents -->
<g fill="#3a7d44" opacity="0.9" clip-path="url(#planetClip)">
   <path d="M50 40 Q 70 20, 100 50 T 140 60 L 150 100 Q 100 120, 60 100 T 30 70 Z" />
   <path d="M10 90 Q 30 80, 50 110 T 40 150 L 10 140 Z" fill="#5a4d3a"/>
</g>
<!-- Clouds -->
<g fill="#ffffff" opacity="0.4" filter="blur(2px)">
  <path d="M20 80 Q 50 60, 90 85 T 150 70" stroke="#fff" stroke-width="12" fill="none"/>
  <path d="M40 40 Q 70 30, 110 45" stroke="#fff" stroke-width="8" fill="none"/>
  <path d="M30 120 Q 80 130, 130 115" stroke="#fff" stroke-width="10" fill="none"/>
</g>
`;
  return svgBase(inner, gradient);
}

function svgMegaEarth() {
  const gradient = `
<radialGradient id="megaGrad" cx="50%" cy="50%" r="70%" fx="25%" fy="25%">
  <stop offset="0%" stop-color="#8ecae6" />
  <stop offset="100%" stop-color="#023047" />
</radialGradient>
`;
  const inner = `
<circle cx="80" cy="80" r="70" fill="url(#megaGrad)" />
<!-- Thick Atmosphere Bands -->
<g opacity="0.2" fill="none" stroke="#fff" stroke-width="20" clip-path="url(#planetClip)">
  <path d="M-20 60 Q 80 80, 180 60" />
  <path d="M-20 100 Q 80 120, 180 100" />
</g>
<circle cx="80" cy="80" r="68" fill="none" stroke="#ffffff" stroke-width="2" opacity="0.3" />
`;
  return svgBase(inner, gradient);
}

function svgHotSuperEarth() {
  const gradient = `
<linearGradient id="dayNight" x1="0%" y1="50%" x2="100%" y2="50%">
  <stop offset="30%" stop-color="#fff5e0" /> <!-- Day side -->
  <stop offset="50%" stop-color="#ff5e62" /> <!-- Terminator -->
  <stop offset="85%" stop-color="#240b36" /> <!-- Night side -->
</linearGradient>
`;
  const inner = `
<circle cx="80" cy="80" r="65" fill="url(#dayNight)" transform="rotate(-30 80 80)"/>
<!-- Evaporating atmosphere tail hint -->
<path d="M 30 30 Q 0 0, -20 -20" stroke="#fff5e0" stroke-width="10" opacity="0.1" filter="blur(5px)"/>
`;
  return svgBase(inner, gradient);
}

function svgHotSubNeptune() {
  const gradient = `
<radialGradient id="hotSnGrad" cx="50%" cy="50%" r="65%" fx="40%" fy="30%">
  <stop offset="0%" stop-color="#ffecd2" />
  <stop offset="50%" stop-color="#fcb69f" />
  <stop offset="100%" stop-color="#c72c48" />
</radialGradient>
`;
  const inner = `
<circle cx="80" cy="80" r="68" fill="url(#hotSnGrad)" />
<!-- Puffed up haze layers -->
<circle cx="80" cy="80" r="68" fill="none" stroke="#ffecd2" stroke-width="4" opacity="0.2" />
<circle cx="80" cy="80" r="64" fill="none" stroke="#fcb69f" stroke-width="4" opacity="0.1" />
`;
  return svgBase(inner, gradient);
}

function svgColdSubNeptune() {
  const gradient = `
<radialGradient id="coldSnGrad" cx="50%" cy="50%" r="70%" fx="30%" fy="30%">
  <stop offset="0%" stop-color="#e0f7fa" />
  <stop offset="100%" stop-color="#006064" />
</radialGradient>
`;
  const inner = `
<circle cx="80" cy="80" r="68" fill="url(#coldSnGrad)" />
<!-- Methane clouds -->
<g fill="#b2ebf2" opacity="0.3" filter="blur(3px)" clip-path="url(#planetClip)">
  <ellipse cx="60" cy="50" rx="40" ry="10" />
  <ellipse cx="100" cy="80" rx="50" ry="12" />
  <ellipse cx="70" cy="110" rx="40" ry="8" />
</g>
`;
  return svgBase(inner, gradient);
}

function svgWarmNeptune() {
  const gradient = `
<radialGradient id="warmNepGrad" cx="50%" cy="40%" r="70%">
  <stop offset="0%" stop-color="#d1c4e9" />
  <stop offset="60%" stop-color="#7e57c2" />
  <stop offset="100%" stop-color="#311b92" />
</radialGradient>
`;
  const inner = `
<circle cx="80" cy="80" r="70" fill="url(#warmNepGrad)" />
<!-- Dark Spot -->
<ellipse cx="110" cy="60" rx="15" ry="8" fill="#311b92" opacity="0.6" filter="blur(1px)" transform="rotate(-10 110 60)" />
<!-- High wispy clouds -->
<path d="M40 90 Q 80 100, 120 90" stroke="#ede7f6" stroke-width="3" fill="none" opacity="0.4" filter="blur(1px)" />
`;
  return svgBase(inner, gradient);
}

function svgUltraHotJupiter() {
  const gradient = `
<radialGradient id="uhjGrad" cx="30%" cy="30%" r="80%">
  <stop offset="0%" stop-color="#fff9c4" />
  <stop offset="40%" stop-color="#fbc02d" />
  <stop offset="100%" stop-color="#bf360c" />
</radialGradient>
`;
  const inner = `
<circle cx="80" cy="80" r="75" fill="url(#uhjGrad)" />
<!-- Intense heat bands representing supersonic winds -->
<g stroke-width="2" stroke="#fff" opacity="0.2" fill="none">
  <path d="M0 60 Q 80 60, 160 60" />
  <path d="M0 100 Q 80 100, 160 100" />
  <path d="M0 80 Q 80 80, 160 80" />
</g>
`;
  return svgBase(inner, gradient);
}

function svgColdGasGiant() {
  const gradient = `
<radialGradient id="coldGasGrad" cx="40%" cy="40%" r="70%">
  <stop offset="0%" stop-color="#b3e5fc" />
  <stop offset="100%" stop-color="#01579b" />
</radialGradient>
`;
  const inner = `
<circle cx="80" cy="80" r="72" fill="url(#coldGasGrad)" />
<!-- Subtle bands -->
<g fill="none" stroke="#0288d1" stroke-width="8" opacity="0.15" clip-path="url(#planetClip)">
  <rect x="0" y="40" width="160" height="20" />
  <rect x="0" y="100" width="160" height="20" />
</g>
<!-- Ring system -->
<g transform="rotate(-20 80 80)" opacity="0.8">
  <ellipse cx="80" cy="80" rx="95" ry="25" fill="none" stroke="#e1f5fe" stroke-width="2" opacity="0.4"/>
  <ellipse cx="80" cy="80" rx="90" ry="20" fill="none" stroke="#b3e5fc" stroke-width="6" opacity="0.6"/>
  <!-- Mask part of ring behind planet -->
  <path d="M 15 80 A 65 25 0 0 0 145 80" stroke="#b3e5fc" stroke-width="6" fill="none" opacity="0.6" />
</g>
<!-- Redraw planet top half over back ring -->
<path d="M 10 80 A 70 70 0 0 1 150 80" fill="url(#coldGasGrad)" clip-path="url(#planetClip)" transform="rotate(-20 80 80)"/>
`;
  return svgBase(inner, gradient);
}

function svgRocky() {
  const gradient = `
<radialGradient id="rockyGrad" cx="60%" cy="40%" r="70%">
  <stop offset="0%" stop-color="#d7ccc8" />
  <stop offset="60%" stop-color="#8d6e63" />
  <stop offset="100%" stop-color="#3e2723" />
</radialGradient>
`;
  const inner = `
<circle cx="80" cy="80" r="58" fill="url(#rockyGrad)" />
<!-- Tectonic features -->
<path d="M50 40 Q 70 60, 40 90 T 70 130" stroke="#5d4037" stroke-width="2" fill="none" opacity="0.5" />
<path d="M100 30 Q 120 70, 100 110" stroke="#3e2723" stroke-width="3" fill="none" opacity="0.3" />
`;
  return svgBase(inner, gradient);
}

function svgSuperEarth() {
  const gradient = `
<radialGradient id="seGrad" cx="40%" cy="40%" r="75%">
  <stop offset="0%" stop-color="#80deea" />
  <stop offset="100%" stop-color="#006064" />
</radialGradient>
`;
  const inner = `
<circle cx="80" cy="80" r="64" fill="url(#seGrad)" />
<!-- Swirling cloud patterns -->
<g stroke="#e0f7fa" stroke-width="4" fill="none" opacity="0.3" filter="blur(2px)">
   <path d="M30 50 C 50 30, 110 30, 130 50" />
   <path d="M20 80 C 60 60, 100 100, 140 80" />
   <path d="M40 110 C 60 130, 100 130, 120 110" />
</g>
`;
  return svgBase(inner, gradient);
}

function svgSubNeptune() {
  const gradient = `
<radialGradient id="snGrad" cx="50%" cy="45%" r="70%">
  <stop offset="0%" stop-color="#b39ddb" />
  <stop offset="100%" stop-color="#4527a0" />
</radialGradient>
`;
  const inner = `
<circle cx="80" cy="80" r="66" fill="url(#snGrad)" />
<!-- Hazy bands -->
<rect x="0" y="60" width="160" height="40" fill="#673ab7" opacity="0.2" clip-path="url(#planetClip)" />
`;
  return svgBase(inner, gradient);
}

function svgNeptune() {
  const gradient = `
<radialGradient id="nepGrad" cx="50%" cy="50%" r="70%" fx="30%" fy="30%">
  <stop offset="0%" stop-color="#448aff" />
  <stop offset="100%" stop-color="#1a237e" />
</radialGradient>
`;
  const inner = `
<circle cx="80" cy="80" r="68" fill="url(#nepGrad)" />
<!-- Great Dark Spot & Clouds -->
<ellipse cx="50" cy="100" rx="12" ry="8" fill="#1a237e" opacity="0.5" filter="blur(1px)" />
<path d="M80 40 Q 110 30, 140 45" stroke="#fff" stroke-width="3" fill="none" opacity="0.5" filter="blur(1px)"/>
<path d="M90 60 Q 120 55, 150 65" stroke="#fff" stroke-width="2" fill="none" opacity="0.3" filter="blur(1px)"/>
`;
  return svgBase(inner, gradient);
}

function svgGasGiant() {
  const gradient = `
<radialGradient id="gasGrad" cx="40%" cy="40%" r="72%">
  <stop offset="0%" stop-color="#ffe0b2" />
  <stop offset="100%" stop-color="#e65100" />
</radialGradient>
`;
  const defs = `
<linearGradient id="bands" x1="0" x2="0" y1="0" y2="1">
  <stop offset="0%" stop-color="#ffcc80" />
  <stop offset="20%" stop-color="#ef6c00" />
  <stop offset="40%" stop-color="#ffe0b2" />
  <stop offset="50%" stop-color="#e65100" />
  <stop offset="60%" stop-color="#ffe0b2" />
  <stop offset="80%" stop-color="#ef6c00" />
  <stop offset="100%" stop-color="#ffcc80" />
</linearGradient>
`;
  const inner = `
<circle cx="80" cy="80" r="72" fill="url(#bands)" transform="rotate(-15 80 80)" />
<circle cx="80" cy="80" r="72" fill="url(#gasGrad)" opacity="0.5" style="mix-blend-mode: multiply;" />
<!-- Great Red Spot -->
<ellipse cx="110" cy="100" rx="18" ry="10" fill="#bf360c" opacity="0.8" transform="rotate(-15 110 100)" />
`;
  return svgBase(inner, gradient, defs);
}

function svgUnknown() {
  const inner = `
<circle cx="80" cy="80" r="56" fill="#263238" stroke="#37474f" stroke-width="4" />
<text x="80" y="100" text-anchor="middle" font-size="60" font-family="sans-serif" font-weight="bold" fill="#546e7a">?</text>
`;
  return svgBase(inner);
}
