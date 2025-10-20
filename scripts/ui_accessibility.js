/* === BEGIN PHASE2: UI ACCESSIBILITY === */
(function(){
  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.segment').forEach(seg => {
      const btns = Array.from(seg.querySelectorAll('button'));
      function update(active){
        btns.forEach((b,k) => {
          const on = k === active;
          b.setAttribute('aria-pressed', on ? 'true' : 'false');
          b.setAttribute('tabindex', on ? '0' : '-1');
        });
      }
      btns.forEach((b,i) => {
        if(!b.hasAttribute('aria-pressed')) b.setAttribute('aria-pressed', i===0 ? 'true':'false');
        if(!b.hasAttribute('tabindex')) b.setAttribute('tabindex', b.getAttribute('aria-pressed')==='true' ? '0':'-1');
        b.addEventListener('click', () => update(i));
        b.addEventListener('keydown', e => {
          if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
            e.preventDefault();
            const dir = e.key === 'ArrowRight' ? 1 : -1;
            const j = (i + dir + btns.length) % btns.length;
            btns[j].focus(); update(j);
          }
        });
      });
    });
    // Optional density toggle injection if .site-header exists
    const header = document.querySelector('.site-header .site-nav');
    if (header && !document.querySelector('#densityToggle')){
      let storedPref = null;
      try {
        storedPref = localStorage.getItem('ui:density');
      } catch (_error) {
        storedPref = null;
      }
      if (storedPref === 'compact') {
        document.body.classList.add('compact');
      }

      const btn = document.createElement('button');
      btn.id = 'densityToggle';
      btn.type = 'button';
      btn.className = 'site-nav__action';
      btn.setAttribute('aria-label', 'Toggle compact spacing');
      btn.setAttribute('title', 'Toggle compact spacing');
      btn.setAttribute('aria-pressed', document.body.classList.contains('compact') ? 'true' : 'false');
      btn.innerHTML = `
        <span class="sr-only">Toggle compact spacing</span>
        <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" class="ui-icon">
          <g fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
            <path d="M7 7h10" />
            <path d="M7 12h10" />
            <path d="M7 17h10" />
            <path d="M9.5 4.5 7 7l2.5 2.5" />
            <path d="M14.5 4.5 17 7l-2.5 2.5" />
            <path d="M9.5 14.5 7 17l2.5 2.5" />
            <path d="M14.5 14.5 17 17l-2.5 2.5" />
          </g>
        </svg>
      `;
      btn.addEventListener('click', () => {
        const on = document.body.classList.toggle('compact');
        btn.setAttribute('aria-pressed', on ? 'true' : 'false');
        try {
          localStorage.setItem('ui:density', on ? 'compact' : 'regular');
        } catch (_error) {
          // ignore storage failures
        }
      });
      header.appendChild(btn);
    }
  });
})();
/* === END PHASE2: UI ACCESSIBILITY === */
