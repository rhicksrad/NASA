/* global Chart */
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

let mrChart;
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
  await renderChart(rows);
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
  rowsEl.innerHTML = rows.map(r => `
    <tr>
      <td><a href="https://exoplanetarchive.ipac.caltech.edu/overview/${encodeURIComponent(r.name)}" target="_blank" rel="noreferrer">${esc(r.name)}</a></td>
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

async function renderChart(rows) {
  const pts = rows.filter(r => Number.isFinite(r.rade) && Number.isFinite(r.masse));
  const data = {
    datasets: [{
      label: 'Planets',
      data: pts.map(p => ({ x: p.rade, y: p.masse, r: 3, name: p.name, host: p.host })),
      parsing: false,
      pointRadius: 3
    }]
  };
  const cfg = {
    type: 'scatter',
    data,
    options: {
      responsive: true,
      animation: false,
      scales: {
        x: { type: 'logarithmic', title: { text: 'Radius (Re)', display: true }, min: 0.5, max: 4 },
        y: { type: 'logarithmic', title: { text: 'Mass (Me)', display: true }, min: 0.2, max: 100 }
      },
      plugins: {
        tooltip: {
          callbacks: {
            label(ctx) {
              const d = ctx.raw;
              return `${d.name} around ${d.host} — Re ${ctx.parsed.x.toFixed(2)}, Me ${ctx.parsed.y.toFixed(2)}`;
            }
          }
        },
        legend: { display: false }
      }
    }
  };
  const ctx = document.getElementById('mrChart').getContext('2d');
  if (mrChart) { mrChart.destroy(); }
  mrChart = new Chart(ctx, cfg);
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
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;' }[m])); }
function median(arr) {
  if (!arr.length) return null;
  const a = arr.slice().sort((x,y)=>x-y);
  const i = Math.floor(a.length/2);
  return a.length % 2 ? a[i] : (a[i-1]+a[i])/2;
}
