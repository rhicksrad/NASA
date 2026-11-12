/**
 * Behaviour for the shared site header (markup lives in partials/site-header.html).
 * Every page entry point calls this once.
 */
export function initSiteNav(): void {
  const toggle = document.querySelector<HTMLButtonElement>('[data-nav-toggle]');
  const nav = document.querySelector<HTMLElement>('[data-primary-nav]');
  if (!toggle || !nav) return;

  const isOpen = () => nav.dataset.open === 'true';
  const setOpen = (open: boolean) => {
    nav.dataset.open = open ? 'true' : 'false';
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  };

  toggle.addEventListener('click', () => setOpen(!isOpen()));

  nav.addEventListener('click', (event) => {
    if (event.target instanceof Element && event.target.closest('a')) setOpen(false);
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && isOpen()) {
      setOpen(false);
      toggle.focus();
    }
  });

  setOpen(false);
}

/** Marks the nav link with the given id as the current page (or clears it with `null`). */
export function setCurrentNav(linkId: string | null): void {
  for (const link of document.querySelectorAll<HTMLAnchorElement>('[data-primary-nav] a')) {
    if (link.id === linkId) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
}
