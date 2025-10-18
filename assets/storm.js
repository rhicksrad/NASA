// CME Explorer client — BADASS edition
// Talks to the existing Cloudflare Worker endpoints.
// Replaces any prior assets/storm.js entirely.

const WORKER_BASE = 'https://lively-haze-4b2c.hicksrch.workers.dev';

const $ = (s, r=document) => r.querySelector(s);

const idInput = $('#id');
const idForm = $('#idForm');
const findForm = $('#findForm');
const results = $('#results');
const md = $('#md');

function getQS() {
  const p = new URLSearchParams(location.search);
  return { id: p.get('id') || '' };
}
function setQS(id) {
  const u = new URL(location.href);
  if (id) u.searchParams.set('id', id); else u.searchParams.delete('id');
  history.replaceState(null, '', u);
}

async function fetchText(url, accept='text/markdown') {
  const res = await fetch(url, { headers: { 'Accept': accept } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}
async function fetchJSON(url) {
  const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// Minimal markdown -> HTML for Worker output
function renderMarkdown(s) {
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

// ---------- Core load ----------
async function loadById(activityId) {
  if (!activityId) { md.innerHTML = '<p class="error">Enter an Activity ID.</p>'; return; }
  md.innerHTML = 'Loading…';
  try {
    const base = `${WORKER_BASE}/storm/${encodeURIComponent(activityId)}`;
    const [text, data] = await Promise.all([
      fetchText(base + '.md', 'text/markdown'),
      fetchJSON(base + '.json')
    ]);

    md.innerHTML = renderMarkdown(text);

    // Insert badass UI below the markdown
    const panel = document.createElement('section');
    panel.className = 'badass';

    const row1 = document.createElement('div');
    row1.className = 'badass-row';
    panel.appendChild(row1);

    // Badges + Kp gauge + Timeline
    const badges = document.createElement('div');
    badges.className = 'badges card';
    row1.appendChild(badges);
    renderBadges(badges, data);

    const gauge = document.createElement('div');
    gauge.className = 'kp card';
    row1.appendChild(gauge);
    renderKpGauge(gauge, data);

    const timelineWrap = document.createElement('div');
    timelineWrap.className = 'timeline card';
    row1.appendChild(timelineWrap);
    renderTimeline(timelineWrap, data);

    // Aurora map + media strip
    const row2 = document.createElement('div');
    row2.className = 'badass-row';
    panel.appendChild(row2);

    const aurora = document.createElement('div');
    aurora.className = 'aurora card';
    row2.appendChild(aurora);
    renderAuroraBands(aurora, data);

    const media = document.createElement('div');
    media.className = 'media card';
    row2.appendChild(media);
    renderMedia(media, activityId);

    md.appendChild(panel);

    setQS(activityId);
  } catch (e) {
    md.innerHTML = `<p class="error">Failed to load report (${e.message}).</p>`;
  }
}

// ---------- Find form wiring ----------
idForm.addEventListener('submit', (e) => {
  e.preventDefault();
  loadById(idInput.value.trim());
});
findForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const start = $('#start').value;
  const end = $('#end').value;
  if (!start || !end) return;
  results.innerHTML = 'Searching…';
  try {
    const url = `${WORKER_BASE}/storm/find?start=${start}&end=${end}`;
    const data = await fetchJSON(url);
    results.innerHTML = '';
    if (!data.items || data.items.length === 0) {
      results.innerHTML = '<li>No CMEs found in range.</li>';
      return;
    }
    data.items.forEach(item => {
      const li = document.createElement('li');
      const a = document.createElement('a');
      a.href = '#';
      a.textContent = item.activityID;
      a.addEventListener('click', (ev) => {
        ev.preventDefault();
        idInput.value = item.activityID;
        loadById(item.activityID);
      });
      const meta = document.createElement('div');
      meta.className = 'meta';
      meta.textContent = `${item.startTime || ''}${item.note ? ' — ' + item.note.slice(0,80) : ''}`;
      li.appendChild(a);
      li.appendChild(meta);
      results.appendChild(li);
    });
  } catch (e2) {
    results.innerHTML = `<li class="error">Search failed (${e2.message})</li>`;
  }
});

// ---------- Helpers ----------
const parseTime = s => s ? new Date(s) : null;
const fmtH = ms => (ms/3600000).toFixed(1);

// Speed category + halo-ish width bucket, tiny heuristic fun
function classify(analyses, gst) {
  const a0 = analyses?.[0] || {};
  const speed = a0.speed ?? a0.cmeSpeed ?? null;
  const half = a0.halfAngle ?? null;
  const width = half ? half*2 : (a0.angularWidth ?? null);
  let speedBand = speed==null ? 'unknown' :
    speed >= 2000 ? 'hyper' :
    speed >= 1500 ? 'very fast' :
    speed >= 1000 ? 'fast' :
    speed >= 700  ? 'moderate' : 'slow';
  let widthBand = width==null ? 'unknown' :
    width >= 260 ? 'full-halo-ish' :
    width >= 180 ? 'broad' :
    width >= 120 ? 'wide' : 'narrow';
  const peakKp = Math.max(0, ...((gst||[]).flatMap(g => (g.allKpIndex||[]).map(x => x.kpIndex))));
  return { speed, width, speedBand, widthBand, peakKp: isFinite(peakKp)?peakKp:null };
}

// ---------- Badges ----------
function renderBadges(root, data) {
  const { analyses, gst, enlil, ips, cme } = data;
  const cls = classify(analyses, gst);
  const ipsEarth = (ips||[]).find(s => (s.location||'').toLowerCase()==='earth');
  const predArrivals = (enlil||[]).flatMap(r => (r.estimatedShockArrivals || r.impactList || [])).map(a=>parseTime(a.arrivalTime)).filter(Boolean).sort((a,b)=>a-b);
  const mae = (ipsEarth && predArrivals.length) ? Math.min(...predArrivals.map(p=>Math.abs(p - parseTime(ipsEarth.eventTime)))) : null;

  root.innerHTML = `
    <div class="badges-row">
      <span class="pill">${cls.speedBand.toUpperCase()}</span>
      <span class="pill alt">${cls.widthBand.toUpperCase()}</span>
      ${isFinite(cls.peakKp) ? `<span class="pill kp">PEAK Kp ${cls.peakKp}</span>` : ``}
      ${mae!=null ? `<span class="pill delta">Δ forecast ${fmtH(mae)} h</span>` : ``}
      ${cme?.activeRegionNum ? `<span class="pill muted">AR ${cme.activeRegionNum}</span>` : ``}
    </div>
    ${cme?.sourceLocation ? `<div class="subtext">Source: ${cme.sourceLocation}</div>` : ``}
  `;
}

// ---------- Kp gauge (SVG) ----------
function renderKpGauge(root, data) {
  const peakKp = Math.max(0, ...((data.gst||[]).flatMap(g => (g.allKpIndex||[]).map(x => x.kpIndex))));
  const val = isFinite(peakKp) ? peakKp : 0;
  const svgNS = 'http://www.w3.org/2000/svg';
  const w=240,h=140,cx=120,cy=120,r=90;
  const svg = document.createElementNS(svgNS,'svg');
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  const arc = (start,end,color)=>{
    const a0=(Math.PI* (1+start/9)), a1=(Math.PI*(1+end/9));
    const x0=cx+r*Math.cos(a0), y0=cy+r*Math.sin(a0);
    const x1=cx+r*Math.cos(a1), y1=cy+r*Math.sin(a1);
    const large = (a1-a0)>Math.PI?1:0;
    const p=`M ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1}`;
    const path=document.createElementNS(svgNS,'path');
    path.setAttribute('d',p); path.setAttribute('stroke',color);
    path.setAttribute('fill','none'); path.setAttribute('stroke-width','14'); return path;
  };
  // bands 0-3,3-6,6-9
  svg.appendChild(arc(0,3,'#6aa96a'));
  svg.appendChild(arc(3,6,'#d2b55b'));
  svg.appendChild(arc(6,9,'#cf6a6a'));
  // tick labels
  for(let k=0;k<=9;k++){
    const a=(Math.PI*(1+k/9)); const x=cx+(r+16)*Math.cos(a), y=cy+(r+16)*Math.sin(a);
    const t=document.createElementNS(svgNS,'text');
    t.setAttribute('x',x); t.setAttribute('y',y);
    t.setAttribute('text-anchor','middle'); t.setAttribute('font-size','10'); t.setAttribute('fill','#cdd6e3');
    t.textContent=String(k); svg.appendChild(t);
  }
  // needle
  const aNeedle = Math.PI*(1+ (Math.min(9,val)/9));
  const nx=cx+(r-10)*Math.cos(aNeedle), ny=cy+(r-10)*Math.sin(aNeedle);
  const needle=document.createElementNS(svgNS,'line');
  needle.setAttribute('x1',cx); needle.setAttribute('y1',cy);
  needle.setAttribute('x2',nx); needle.setAttribute('y2',ny);
  needle.setAttribute('stroke','#e6e6e6'); needle.setAttribute('stroke-width','2');
  svg.appendChild(needle);
  // text
  const label=document.createElementNS(svgNS,'text');
  label.setAttribute('x',cx); label.setAttribute('y',cy-10);
  label.setAttribute('text-anchor','middle'); label.setAttribute('font-size','14'); label.setAttribute('fill','#e6e6e6');
  label.textContent = isFinite(val) ? `Peak Kp ${val}` : 'Peak Kp n/a';
  svg.appendChild(label);

  root.innerHTML = `<h3 class="card-title">Kp Gauge</h3>`;
  root.appendChild(svg);
}

// ---------- Timeline (pred vs observed) ----------
function renderTimeline(root, data) {
  const events = [];
  // Predicted arrivals (ENLIL)
  (data.enlil || []).forEach(r => {
    const arrivals = (r.estimatedShockArrivals || r.impactList || [])
      .map(a => ({ t: parseTime(a.arrivalTime), kind:'pred', label:(a.location||'Target'), kp: r.kp_90||r.kp90||r.maxKp||null }));
    arrivals.forEach(ev => ev.t && events.push(ev));
  });
  // Observed IPS at Earth
  (data.ips || []).forEach(s => {
    if ((s.location||'').toLowerCase() === 'earth') {
      events.push({ t: parseTime(s.eventTime || s.time), kind:'ips', label:'Observed shock' });
    }
  });
  // GST start + Kp points
  (data.gst || []).forEach(g => {
    const start = parseTime(g.startTime);
    if (start) events.push({ t:start, kind:'gst', label:'GST start' });
    (g.allKpIndex || []).forEach(x => {
      const tt = parseTime(x.observedTime);
      tt && events.push({ t: tt, kind:'kp', kp: x.kpIndex });
    });
  });
  if (!events.length) { root.innerHTML = ''; return; }

  const minT = new Date(Math.min(...events.map(e=>e.t)) - 6*3600e3);
  const maxT = new Date(Math.max(...events.map(e=>e.t)) + 6*3600e3);

  const w = Math.min(900, md.clientWidth - 32), h = 160, pad = 34;
  const x = t => pad + ((t - minT) / (maxT - minT)) * (w - pad*2);

  const svgNS='http://www.w3.org/2000/svg';
  const svg=document.createElementNS(svgNS,'svg');
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  svg.classList.add('timeline-svg');

  // axis
  const axis = document.createElementNS(svgNS,'line');
  axis.setAttribute('x1', pad); axis.setAttribute('x2', w-pad);
  axis.setAttribute('y1', h/2); axis.setAttribute('y2', h/2);
  axis.setAttribute('stroke', '#2a3a4e');
  svg.appendChild(axis);

  // ticks
  const tickMs=6*3600e3;
  for(let t=minT.getTime(); t<=maxT.getTime(); t+=tickMs){
    const lx=x(t);
    const tick=document.createElementNS(svgNS,'line');
    tick.setAttribute('x1',lx); tick.setAttribute('x2',lx);
    tick.setAttribute('y1',h/2-4); tick.setAttribute('y2',h/2+4);
    tick.setAttribute('stroke','#32465f'); svg.appendChild(tick);
    const dt=new Date(t);
    const label=document.createElementNS(svgNS,'text');
    label.setAttribute('x',lx+2); label.setAttribute('y',h/2-8);
    label.setAttribute('fill','#8ea2bb'); label.setAttribute('font-size','9');
    label.textContent = dt.toISOString().slice(5,16).replace('T',' ');
    svg.appendChild(label);
  }

  // draw
  const addText=(tx,ty,str)=>{
    const txt=document.createElementNS(svgNS,'text');
    txt.setAttribute('x',tx); txt.setAttribute('y',ty);
    txt.setAttribute('fill','#cdd6e3'); txt.setAttribute('font-size','10');
    txt.textContent=str; svg.appendChild(txt);
  };
  events.sort((a,b)=>a.t-b.t).forEach(e=>{
    const cx=x(e.t);
    if (e.kind==='pred'){
      const y=h/2-16; const tri=document.createElementNS(svgNS,'polygon');
      tri.setAttribute('points', `${cx},${y} ${cx-6},${y+10} ${cx+6},${y+10}`);
      tri.setAttribute('fill','#5ac8fa'); svg.appendChild(tri);
      addText(cx+8, y+10, `${e.label}${e.kp?` · Kp90:${e.kp}`:''}`);
    } else if (e.kind==='ips'){
      const circ=document.createElementNS(svgNS,'circle');
      circ.setAttribute('cx',cx); circ.setAttribute('cy',h/2);
      circ.setAttribute('r',5); circ.setAttribute('fill','#ffd166'); svg.appendChild(circ);
      addText(cx+8, h/2-6, 'Observed shock');
    } else if (e.kind==='gst'){
      const rect=document.createElementNS(svgNS,'rect');
      rect.setAttribute('x',cx-6); rect.setAttribute('y',h/2+10);
      rect.setAttribute('width',12); rect.setAttribute('height',8);
      rect.setAttribute('fill','#ef476f'); svg.appendChild(rect);
      addText(cx+8, h/2+18, 'GST start');
    } else if (e.kind==='kp'){
      const dot=document.createElementNS(svgNS,'circle');
      dot.setAttribute('cx',cx); dot.setAttribute('cy',h/2+40 - Math.min(9, e.kp)*3);
      dot.setAttribute('r',2.5); dot.setAttribute('fill','#c0cbdc'); svg.appendChild(dot);
    }
  });

  // metrics
  const preds = events.filter(e=>e.kind==='pred').map(e=>e.t.getTime()).sort((a,b)=>a-b);
  const obs = events.find(e=>e.kind==='ips')?.t?.getTime();
  const gstStart = events.find(e=>e.kind==='gst')?.t?.getTime();
  const mae = (obs && preds.length) ? Math.min(...preds.map(p=>Math.abs(p-obs))) : null;
  const lead = (obs && gstStart) ? (gstStart - obs) : null;

  root.innerHTML = `<h3 class="card-title">Arrival & Impact Timeline (UTC)</h3>`;
  root.appendChild(svg);
  const box = document.createElement('div');
  box.className = 'metrics';
  box.innerHTML = `
    ${mae!==null ? `|predicted−observed|: <strong>${fmtH(mae)} h</strong>` : ''}
    ${lead!==null ? ` &nbsp; IPS→GST: <strong>${fmtH(lead)} h</strong>` : ''}
  `;
  root.appendChild(box);
}

// ---------- Aurora visibility map (lat bands by Kp) ----------
function renderAuroraBands(root, data) {
  const peakKp = Math.max(0, ...((data.gst||[]).flatMap(g => (g.allKpIndex||[]).map(x => x.kpIndex))));
  const kp = isFinite(peakKp) ? peakKp : 0;

  // Approximate equatorward boundary latitude vs Kp (NOAA rule-of-thumb)
  // Kp: 3→~65°, 5→~58°, 7→~50°, 8→~47°, 9→~45°
  const eqLat = kp>=9?45: kp>=8?47: kp>=7?50: kp>=6?54: kp>=5?58: kp>=4?61: kp>=3?65: 67;

  const svgNS='http://www.w3.org/2000/svg';
  const w=480,h=240;
  const svg=document.createElementNS(svgNS,'svg');
  svg.setAttribute('viewBox',`0 0 ${w} ${h}`);
  svg.classList.add('aurora-svg');

  // Simple plate carrée grid with bands; we don’t draw land to keep it light.
  const band=document.createElementNS(svgNS,'rect');
  const y = (90 - eqLat) / 180 * h;
  band.setAttribute('x',0); band.setAttribute('y',0);
  band.setAttribute('width',w); band.setAttribute('height', y);
  band.setAttribute('fill','#7fbf7f22'); band.setAttribute('stroke','#7fbf7f66');
  svg.appendChild(band);

  const mirror=document.createElementNS(svgNS,'rect');
  mirror.setAttribute('x',0); mirror.setAttribute('y', h - y);
  mirror.setAttribute('width',w); mirror.setAttribute('height', y);
  mirror.setAttribute('fill','#7fbf7f22'); mirror.setAttribute('stroke','#7fbf7f66');
  svg.appendChild(mirror);

  // Latitude ticks
  for (let lat= -60; lat<=60; lat+=30) {
    const ly=(90 - lat)/180*h;
    const line=document.createElementNS(svgNS,'line');
    line.setAttribute('x1',0); line.setAttribute('x2',w);
    line.setAttribute('y1',ly); line.setAttribute('y2',ly);
    line.setAttribute('stroke','#2a3a4e');
    svg.appendChild(line);
    const t=document.createElementNS(svgNS,'text');
    t.setAttribute('x',4); t.setAttribute('y',ly-2);
    t.setAttribute('fill','#8ea2bb'); t.setAttribute('font-size','10');
    t.textContent=`${lat}°`; svg.appendChild(t);
  }

  root.innerHTML = `<h3 class="card-title">Aurora Visibility Bands (rule-of-thumb)</h3>
  <div class="subtext">Peak Kp ${isFinite(kp)?kp:'n/a'} → aurora potentially visible down to ~${Math.round(eqLat)}° geomagnetic lat.</div>`;
  root.appendChild(svg);
}

// ---------- Related media via NASA Images (through Worker /images/search) ----------
async function renderMedia(root, activityId) {
  // Extract date for better hits
  const m = activityId.match(/^(\d{4})-(\d{2})-(\d{2})/);
  const year = m ? m[1] : '';
  const q = encodeURIComponent('coronal mass ejection LASCO SDO');
  const url = `${WORKER_BASE}/images/search?q=${q}&media_type=image${year?`&year_start=${year}&year_end=${year}`:''}`;

  root.innerHTML = `<h3 class="card-title">Related Media</h3><div class="strip">Loading…</div>`;

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const items = (data?.collection?.items || []).slice(0, 8);
    const strip = root.querySelector('.strip');
    strip.innerHTML = '';
    items.forEach(it => {
      const link = it.links?.[0]?.href || '';
      const href = it.href || '';
      const a = document.createElement('a');
      a.href = href || link || '#';
      a.target = '_blank'; a.rel='noopener';
      const img = document.createElement('img');
      img.loading='lazy';
      img.src = link; img.alt = it.data?.[0]?.title || 'NASA media';
      a.appendChild(img);
      strip.appendChild(a);
    });
    if (!items.length) strip.textContent = 'No media found for this date window.';
  } catch (e) {
    root.querySelector('.strip').innerHTML = `<div class="error">Media search failed (${e.message}).</div>`;
  }
}

// ---------- Bootstrap ----------
const qs = getQS();
if (qs.id) { idInput.value = qs.id; loadById(qs.id); }
