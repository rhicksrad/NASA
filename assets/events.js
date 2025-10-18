/* global L */

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

// Map rendering (Leaflet)
let leafletMap;
let markersLayer;
const markerIndex = new Map();
let activeEventId = null;

function ensureLeafletMap(){
  if (leafletMap) return;
  if (typeof L === 'undefined'){
    throw new Error('Leaflet failed to load');
  }
  leafletMap = L.map(mapEl, {
    worldCopyJump: true,
    zoomControl: true,
    attributionControl: true
  }).setView([20, 0], 2);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 8,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  }).addTo(leafletMap);

  markersLayer = L.layerGroup().addTo(leafletMap);
}

function getEventLatLon(ev){
  const g = ev.geometry?.[ev.geometry.length - 1];
  if (!g) return null;
  const coords = Array.isArray(g.coordinates) ? g.coordinates : null;
  if (coords && typeof coords[0] === 'number'){
    return { lon: +coords[0], lat: +coords[1] };
  }
  if (coords && Array.isArray(coords[0]) && Array.isArray(coords[0][0])){
    const [lon, lat] = coords[0][0];
    return { lon: +lon, lat: +lat };
  }
  return null;
}

function renderMapPins(events){
  ensureLeafletMap();
  markersLayer.clearLayers();
  markerIndex.clear();

  const bounds = [];
  const uniqCats = new Map();

  events.forEach(ev => {
    const coords = getEventLatLon(ev);
    if (!coords) return;
    const { lat, lon } = coords;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;

    const catId = ev.categories?.[0]?.id || 'other';
    const baseStyle = {
      radius: 6,
      weight: 1.5,
      color: '#0b0f14',
      opacity: 1,
      fillColor: colorFor(catId),
      fillOpacity: 0.9
    };

    const marker = L.circleMarker([lat, lon], baseStyle);
    const catName = ev.categories?.map(c => c.title).join(', ') || 'Uncategorized';
    const last = ev.geometry?.[ev.geometry.length - 1]?.date || '';
    marker.bindPopup(`<strong>${ev.title || ev.id}</strong><br />${catName}${last ? `<br />${last}` : ''}`);
    marker.bindTooltip(ev.title || ev.id, { direction: 'top' });
    marker.on('click', () => selectEvent(ev, { centerOnMap: false, openPopup: true }));
    marker.addTo(markersLayer);

    const eventId = String(ev.id);
    markerIndex.set(eventId, { marker, baseStyle });
    bounds.push([lat, lon]);

    const firstCat = ev.categories?.[0];
    if (firstCat) uniqCats.set(firstCat.id, firstCat.title);
  });

  if (bounds.length){
    const latLngBounds = L.latLngBounds(bounds);
    leafletMap.fitBounds(latLngBounds, { padding: [36, 36], maxZoom: 6 });
  } else {
    leafletMap.setView([20, 0], 2);
  }

  const bits = [...uniqCats.entries()].slice(0, 8)
    .map(([id, title]) => `<span class="badge"><span class="swatch" style="background:${colorFor(id)}"></span>${title}</span>`);
  legendEl.innerHTML = bits.join(' ') || '<span class="small">No categories</span>';

  highlightMarkers();
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
    li.dataset.eventId = String(ev.id);
    li.tabIndex = 0;
    if (activeEventId === String(ev.id)) li.classList.add('active');
    const activate = () => selectEvent(ev, { centerOnMap: true, openPopup: true });
    li.addEventListener('click', activate);
    li.addEventListener('keydown', (e)=>{
      if (e.key === 'Enter' || e.key === ' '){
        e.preventDefault();
        activate();
      }
    });
    listEl.appendChild(li);
  });
  highlightList();
}

function highlightList(){
  const items = listEl.querySelectorAll('li[data-event-id]');
  items.forEach(item => {
    item.classList.toggle('active', item.dataset.eventId === activeEventId);
  });
}

function highlightMarkers(){
  markerIndex.forEach(({ marker, baseStyle }, id) => {
    const isActive = id === activeEventId;
    marker.setStyle({
      ...baseStyle,
      radius: isActive ? baseStyle.radius * 1.4 : baseStyle.radius,
      weight: isActive ? 3 : baseStyle.weight,
      fillOpacity: isActive ? 1 : baseStyle.fillOpacity
    });
    if (isActive){
      marker.bringToFront();
    } else {
      marker.closePopup();
    }
  });
}

// Detail rendering
async function selectEvent(ev, options = {}){
  if (!ev) return;
  const eventId = String(ev.id);
  activeEventId = eventId;
  highlightList();
  highlightMarkers();

  const { centerOnMap = true, openPopup = true } = options;
  const coords = getEventLatLon(ev);
  const entry = markerIndex.get(eventId);

  if (centerOnMap && coords && leafletMap){
    const targetZoom = Math.max(leafletMap.getZoom(), 4);
    leafletMap.flyTo([coords.lat, coords.lon], targetZoom, { duration: 0.65 });
  }

  if (openPopup && entry){
    entry.marker.openPopup();
  }

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
    .replace(/^> (.*)$/gm,'<blockquote>$1</blockquote>')
    .replace(/^- (.*)$/gm,'<li>$1</li>')
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
  const eventIds = new Set(events.map(ev => String(ev.id)));
  if (activeEventId && !eventIds.has(activeEventId)){
    activeEventId = null;
    detailTitle.textContent = 'Event Detail';
    detailEl.textContent = 'Pick an event.';
  }
  renderMapPins(events);
  renderList(events);
}

// Init
filtersForm.addEventListener('submit', (e)=>{ e.preventDefault(); load(); });
window.addEventListener('resize', ()=>{
  if (leafletMap){
    leafletMap.invalidateSize();
  }
});

(async function bootstrap(){
  await loadCategories().catch(()=>{});
  await load().catch(err => { listEl.innerHTML = `<li class="small">Error: ${err.message}</li>`; });
})();
