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
      const btn = document.createElement('button');
      btn.id='densityToggle'; btn.className='btn btn--ghost'; btn.textContent='Density';
      btn.setAttribute('aria-pressed', document.body.classList.contains('compact')?'true':'false');
      btn.addEventListener('click', ()=>{
        const on = document.body.classList.toggle('compact');
        btn.setAttribute('aria-pressed', on?'true':'false');
        try { localStorage.setItem('ui:density', on ? 'compact' : 'regular'); } catch(e){}
      });
      header.appendChild(btn);
      try {
        const pref = localStorage.getItem('ui:density');
        if (pref === 'compact') document.body.classList.add('compact');
      } catch(e){}
    }
  });
})();
/* === END PHASE2: UI ACCESSIBILITY === */
