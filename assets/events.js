const WORKER_BASE = 'https://lively-haze-4b2c.hicksrch.workers.dev';

const $ = (s, r=document) => r.querySelector(s);

const catSelect = $('#category');
const statusSelect = $('#status');
const startInput = $('#start');
const endInput = $('#end');
const filtersForm = $('#filters');
const listEl = $('#list');
const mapEl = $('#map');
const legendEl = $('#legend');
const detailEl = $('#detail');
const detailTitle = $('#detailTitle');

const catColors = {
  wildfires:'#ff6b6b', severeStorms:'#5ac8fa', volcanoes:'#ffb703',
  floods:'#56d364', seaLakeIce:'#8ea2bb', dustHaze:'#b088f5',
  landslides:'#d19a66', snow:'#c0cbdc', waterColor:'#7fbf7f', temperatureExtremes:'#e07a5f'
};

function colorFor(catId){ return catColors[catId] || '#c0cbdc'; }

function todayISO(offsetDays=0){
  const d=new Date(); d.setUTCDate(d.getUTCDate()+offsetDays);
  return d.toISOString().slice(0,10);
}

// Defaults: past 7 days
startInput.value = todayISO(-7);
endInput.value = todayISO(0);

// Fetch helpers
async function getJSON(url){
  const r = await fetch(url, { headers:{'Accept':'application/json'} });
  if(!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}
async function getText(url){
  const r = await fetch(url, { headers:{'Accept':'text/markdown'} });
  if(!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.text();
}

// Load categories into select
async function loadCategories(){
  const data = await getJSON(`${WORKER_BASE}/eonet/categories`);
  const cats = (data?.categories || data || []).map(c => ({ id: c.id || c.category_id || c, title: c.title || String(c) }));
  cats.sort((a,b)=>a.title.localeCompare(b.title));
  cats.forEach(c=>{
    const opt=document.createElement('option');
    opt.value=c.id; opt.textContent=c.title;
    catSelect.appendChild(opt);
  });
}

// Map rendering (plate carrée, pure SVG)
const svgNS = 'http://www.w3.org/2000/svg';
let svg;
function lonLatToXY(lon, lat, w, h){
  const x = (lon + 180) / 360 * w;
  const y = (90 - lat) / 180 * h;
  return [x,y];
}
function renderMapPins(events){
  mapEl.innerHTML = '';
  svg = document.createElementNS(svgNS,'svg');
  svg.classList.add('canvas');
  svg.setAttribute('viewBox', `0 0 ${mapEl.clientWidth} ${mapEl.clientHeight}`);
  mapEl.appendChild(svg);

  // Graticule
  const w = mapEl.clientWidth, h = mapEl.clientHeight;
  for (let lon=-180; lon<=180; lon+=30){
    const x = (lon+180)/360*w;
    const line=document.createElementNS(svgNS,'line');
    line.setAttribute('x1',x); line.setAttribute('x2',x);
    line.setAttribute('y1',0); line.setAttribute('y2',h);
    line.setAttribute('stroke','#1e2a38'); svg.appendChild(line);
  }
  for (let lat=-60; lat<=60; lat+=30){
    const y = (90-lat)/180*h;
    const line=document.createElementNS(svgNS,'line');
    line.setAttribute('x1',0); line.setAttribute('x2',w);
    line.setAttribute('y1',y); line.setAttribute('y2',y);
    line.setAttribute('stroke','#1e2a38'); svg.appendChild(line);
  }

  // Pins
  events.forEach(ev=>{
    const g = ev.geometry?.[ev.geometry.length-1];
    if (!g) return;
    const coords = Array.isArray(g.coordinates) ? g.coordinates : null;
    let lon, lat;
    if (coords && typeof coords[0]==='number'){ [lon,lat] = coords; }
    else if (coords && Array.isArray(coords[0]) && Array.isArray(coords[0][0])) { [lon,lat] = coords[0][0]; }
    else return;

    const [x,y]=lonLatToXY(+lon, +lat, w, h);
    const pin=document.createElementNS(svgNS,'circle');
    pin.setAttribute('cx',x); pin.setAttribute('cy',y);
    pin.setAttribute('r','4.5');
    const catId = (ev.categories?.[0]?.id)||'other';
    pin.setAttribute('fill', colorFor(catId));
    pin.setAttribute('stroke','#0b0f14');
    pin.setAttribute('stroke-width','1.5');
    pin.style.cursor='pointer';
    pin.addEventListener('click', ()=> selectEvent(ev));
    svg.appendChild(pin);
  });

  // Legend
  const uniqCats = new Map();
  events.forEach(ev=>{
    const c = ev.categories?.[0];
    if (c) uniqCats.set(c.id, c.title);
  });
  const bits = [...uniqCats.entries()].slice(0,8).map(([id,title])=>`<span class="badge" style="border-color:${colorFor(id)};background-color:#0f1520">${title}</span>`);
  legendEl.innerHTML = bits.join(' ') || '<span class="small">No categories</span>';
}

// List rendering
function renderList(events){
  listEl.innerHTML = '';
  if (!events.length){ listEl.innerHTML = '<li class="small">No events in range.</li>'; return; }
  events.forEach(ev=>{
    const li = document.createElement('li');
    const title = document.createElement('div');
    title.textContent = ev.title || ev.id;
    const meta = document.createElement('div');
    const catName = ev.categories?.map(c=>c.title).join(', ') || 'Uncategorized';
    const last = ev.geometry?.[ev.geometry.length-1]?.date || '';
    meta.className='meta';
    meta.textContent = `${catName} • ${last}`;
    li.appendChild(title); li.appendChild(meta);
    li.addEventListener('click', ()=> selectEvent(ev));
    listEl.appendChild(li);
  });
}

// Detail rendering
async function selectEvent(ev){
  detailTitle.textContent = ev.title || ev.id;
  detailEl.textContent = 'Loading…';
  try{
    const md = await getText(`${WORKER_BASE}/event/${encodeURIComponent(ev.id)}.md`);
    detailEl.innerHTML = renderMarkdown(md);
  }catch(e){
    detailEl.innerHTML = `<p class="error">Failed to load event (${e.message}).</p>`;
  }
}

// Minimal markdown-to-HTML (same style as CME page)
function renderMarkdown(s){
  return s
    .replace(/^### (.*)$/gm,'<h3>$1</h3>')
    .replace(/^## (.*)$/gm,'<h2>$1</h2>')
    .replace(/^# (.*)$/gm,'<h1>$1</h1>')
    .replace(/^\> (.*)$/gm,'<blockquote>$1</blockquote>')
    .replace(/^\- (.*)$/gm,'<li>$1</li>')
    .replace(/(?:\n<li>.*<\/li>)+/gs, m=> `<ul>${m}</ul>`)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(https?:\/\/[^\s)]+)(?![^<]*>)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>')
    .replace(/\n{2,}/g, '\n\n');
}

// Load loop
async function load(){
  const status = statusSelect.value;
  const category = catSelect.value;
  const start = startInput.value;
  const end = endInput.value;
  if (!start || !end) return;

  const url = new URL(`${WORKER_BASE}/eonet/events`);
  url.searchParams.set('status', status);
  url.searchParams.set('start', start);
  url.searchParams.set('end', end);
  url.searchParams.set('limit', '500');
  if (category) url.searchParams.set('category', category);

  // Fetch and render
  const data = await getJSON(url.toString());
  const events = data.events || [];
  events.sort((a,b)=>{
    const ta = a.geometry?.[a.geometry.length-1]?.date || '';
    const tb = b.geometry?.[b.geometry.length-1]?.date || '';
    return String(tb).localeCompare(String(ta));
  });
  renderMapPins(events);
  renderList(events);
}

// Init
filtersForm.addEventListener('submit', (e)=>{ e.preventDefault(); load(); });
window.addEventListener('resize', ()=>{ // re-render svg to fit new width
  // re-trigger load to redraw pins at new sizes based on last data
  // simple approach: submit form again
  load().catch(()=>{});
});

(async function bootstrap(){
  await loadCategories().catch(()=>{});
  await load().catch(err => { listEl.innerHTML = `<li class="small">Error: ${err.message}</li>`; });
})();
