import { initMarsPage } from './mars_page';

type RouteHandler = (host: HTMLElement) => void;

export function initRouter() {
  const host = document.getElementById('page-host');
  if (!(host instanceof HTMLElement)) {
    return;
  }

  const marsLink = document.querySelector<HTMLAnchorElement>('#nav-mars');
  const homeHtml = host.innerHTML;

  const routes: Record<string, RouteHandler> = {
    '/mars': container => initMarsPage(container),
  };

  const restoreHome = () => {
    host.innerHTML = homeHtml;
  };

  const setActive = (path: string) => {
    if (marsLink) {
      if (path === '/mars') {
        marsLink.setAttribute('aria-current', 'page');
      } else {
        marsLink.removeAttribute('aria-current');
      }
    }
  };

  const dispatch = () => {
    const hash = window.location.hash || '#/';
    const path = hash.startsWith('#') ? hash.slice(1) : hash;
    const handler = routes[path];
    if (handler) {
      handler(host);
    } else {
      restoreHome();
    }
    setActive(path);
  };

  window.addEventListener('hashchange', dispatch);
  dispatch();
}
