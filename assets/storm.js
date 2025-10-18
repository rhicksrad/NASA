const WORKER_BASE = 'https://lively-haze-4b2c.hicksrch.workers.dev';

const $ = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => [...r.querySelectorAll(s)];

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

// minimal markdown renderer good enough for our worker output
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

async function loadById(activityId) {
  if (!activityId) { md.innerHTML = '<p class="error">Enter an Activity ID.</p>'; return; }
  md.innerHTML = 'Loading…';
  try {
    const url = `${WORKER_BASE}/storm/${encodeURIComponent(activityId)}.md`;
    const text = await fetchText(url, 'text/markdown');
    md.innerHTML = renderMarkdown(text);
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

// bootstrap with ?id=
const qs = getQS();
if (qs.id) { idInput.value = qs.id; loadById(qs.id); }
