// CME Explorer client — with Arrival & Impact Timeline
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

// minimal markdown → HTML good enough for Worker output
function renderMarkdown(s) {
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

async function loadById(activityId) {
  if (!activityId) { md.innerHTML = '<p class="error">Enter an Activity ID.</p>'; return; }
  md.innerHTML = 'Loading…';
  try {
    // Activity IDs contain colons which must remain unescaped for the worker
    // route; encodeURI preserves them while still protecting spaces/other
    // disallowed characters.
    const safeId = encodeURI(activityId);
    const base = `${WORKER_BASE}/storm/${safeId}`;
    const [text, jsonStr] = await Promise.all([
      fetchText(base + '.md', 'text/markdown'),
      fetchText(base + '.json', 'application/json')
    ]);
    md.innerHTML = renderMarkdown(text);

    // Render the Arrival & Impact Timeline under the markdown
    const data = JSON.parse(jsonStr);
    renderTimeline(data);

    setQS(activityId);
  } catch (e) {
    md.innerHTML = `<p class="error">Failed to load report (${e.message}).</p>`;
  }
}

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
    const res = await fetch(url, { headers: { 'Accept':'application/json' }});
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
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

// ===== Arrival & Impact Timeline =====
function renderTimeline(data) {
  const parse = s => s ? new Date(s) : null;
  const events = [];
  // Predicted arrivals (ENLIL)
  (data.enlil || []).forEach(r => {
    const arrivals = (r.estimatedShockArrivals || r.impactList || [])
      .map(a => ({ t: parse(a.arrivalTime), kind:'pred', label:(a.location||'Target'), kp: r.kp_90||r.kp90||r.maxKp||null }));
    arrivals.forEach(ev => ev.t && events.push(ev));
  });
  // Observed IPS at Earth
  (data.ips || []).forEach(s => {
    if ((s.location||'').toLowerCase() === 'earth') {
      events.push({ t: parse(s.eventTime || s.time), kind:'ips', label:'IPS Earth' });
    }
  });
  // GST start + Kp points
  (data.gst || []).forEach(g => {
    const start = parse(g.startTime);
    if (start) events.push({ t:start, kind:'gst', label:'GST start' });
    const kpArr = (g.allKpIndex || []).map(x => ({ t: parse(x.observedTime), kind:'kp', kp:x.kpIndex }));
    kpArr.forEach(ev => ev.t && events.push(ev));
  });

  if (!events.length) return;

  // Axis domain: pad by 6h either side
  const minT = new Date(Math.min(...events.map(e=>e.t.getTime())) - 6*3600e3);
  const maxT = new Date(Math.max(...events.map(e=>e.t.getTime())) + 6*3600e3);

  // Build SVG
  const w = Math.min(900, md.clientWidth - 32), h = 140, pad = 34;
  const scale = (t) => pad + ((t - minT) / (maxT - minT)) * (w - pad*2);
  const svgNS = 'http://www.w3.org/2000/svg';

  const svg = document.createElementNS(svgNS,'svg');
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  svg.style.display = 'block';
  svg.style.marginTop = '12px';
  svg.style.background = '#0f1520';
  svg.style.border = '1px solid #1c2735';
  svg.style.borderRadius = '8px';

  // Axis
  const axis = document.createElementNS(svgNS,'line');
  axis.setAttribute('x1', pad); axis.setAttribute('x2', w-pad);
  axis.setAttribute('y1', h/2); axis.setAttribute('y2', h/2);
  axis.setAttribute('stroke', '#2a3a4e'); axis.setAttribute('stroke-width','1');
  svg.appendChild(axis);

  // Ticks every 6h
  const tickMs = 6*3600e3;
  for (let t = minT.getTime(); t <= maxT.getTime(); t += tickMs) {
    const x = scale(t);
    const tick = document.createElementNS(svgNS,'line');
    tick.setAttribute('x1', x); tick.setAttribute('x2', x);
    tick.setAttribute('y1', h/2 - 4); tick.setAttribute('y2', h/2 + 4);
    tick.setAttribute('stroke', '#32465f');
    svg.appendChild(tick);

    const dt = new Date(t);
    const label = document.createElementNS(svgNS,'text');
    label.setAttribute('x', x+2); label.setAttribute('y', h/2 - 8);
    label.setAttribute('fill', '#8ea2bb'); label.setAttribute('font-size','9');
    label.textContent = dt.toISOString().slice(5,16).replace('T',' ');
    svg.appendChild(label);
  }

  const addText = (tx, ty, str) => {
    const txt = document.createElementNS(svgNS,'text');
    txt.setAttribute('x', tx); txt.setAttribute('y', ty);
    txt.setAttribute('fill', '#cdd6e3'); txt.setAttribute('font-size','10');
    txt.textContent = str; svg.appendChild(txt);
  };

  // Sort and plot
  events.sort((a,b)=>a.t-b.t).forEach(e => {
    const cx = scale(e.t);
    if (e.kind === 'pred') {
      const tri = document.createElementNS(svgNS,'polygon');
      const y = h/2 - 16;
      tri.setAttribute('points', `${cx},${y} ${cx-6},${y+10} ${cx+6},${y+10}`);
      tri.setAttribute('fill', '#5ac8fa');
      svg.appendChild(tri);
      addText(cx+8, y+10, `${e.label}${e.kp?` · Kp90:${e.kp}`:''}`);
    } else if (e.kind === 'ips') {
      const circ = document.createElementNS(svgNS,'circle');
      circ.setAttribute('cx', cx); circ.setAttribute('cy', h/2);
      circ.setAttribute('r', 5); circ.setAttribute('fill', '#ffd166');
      svg.appendChild(circ);
      addText(cx+8, h/2 - 6, 'Observed shock');
    } else if (e.kind === 'gst') {
      const rect = document.createElementNS(svgNS,'rect');
      rect.setAttribute('x', cx-6); rect.setAttribute('y', h/2 + 10);
      rect.setAttribute('width', 12); rect.setAttribute('height', 8);
      rect.setAttribute('fill', '#ef476f');
      svg.appendChild(rect);
      addText(cx+8, h/2 + 18, 'GST start');
    } else if (e.kind === 'kp') {
      const dot = document.createElementNS(svgNS,'circle');
      dot.setAttribute('cx', cx); dot.setAttribute('cy', h/2 + 36 - Math.min(9, e.kp)*2);
      dot.setAttribute('r', 2.5); dot.setAttribute('fill', '#c0cbdc');
      svg.appendChild(dot);
    }
  });

  // Title
  addText(pad, 14, 'Arrival & Impact Timeline (UTC)');

  // Mount + metrics
  const wrap = document.createElement('section');
  wrap.className = 'timeline';
  wrap.appendChild(svg);

  const preds = events.filter(e=>e.kind==='pred').map(e=>e.t.getTime()).sort((a,b)=>a-b);
  const obs = events.find(e=>e.kind==='ips')?.t?.getTime();
  const gstStart = events.find(e=>e.kind==='gst')?.t?.getTime();
  const mae = (obs && preds.length) ? Math.min(...preds.map(p=>Math.abs(p-obs))) : null;
  const lead = (obs && gstStart) ? (gstStart - obs) : null;
  const peakKp = Math.max(0, ...events.filter(e=>e.kind==='kp').map(e=>e.kp||0));

  const box = document.createElement('div');
  box.style.marginTop = '6px';
  box.innerHTML = `<small>
    ${mae!==null ? `|predicted−observed|: <strong>${(mae/3600000).toFixed(1)} h</strong> &nbsp;` : ''}
    ${lead!==null ? `IPS→GST: <strong>${(lead/3600000).toFixed(1)} h</strong> &nbsp;` : ''}
    Peak Kp: <strong>${isFinite(peakKp)?peakKp:'n/a'}</strong>
  </small>`;
  wrap.appendChild(box);

  md.appendChild(wrap);
}

// bootstrap with ?id=
const qs = getQS();
if (qs.id) { idInput.value = qs.id; loadById(qs.id); }
