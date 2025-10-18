import { initMarsPage } from './mars_page';
import { initImagesPage } from './images';

type RouteHandler = (host: HTMLElement) => void | (() => void);

export function initRouter() {
  const host = document.getElementById('page-host');
  if (!(host instanceof HTMLElement)) {
    return;
  }

  const marsLink = document.querySelector<HTMLAnchorElement>('#nav-mars');
  const imagesLink = document.querySelector<HTMLAnchorElement>('#nav-images');
  const homeHtml = host.innerHTML;

  const routes: Record<string, RouteHandler> = {
    '/mars': container => {
      initMarsPage(container);
    },
    '/images': container => initImagesPage(container),
  };

  let cleanup: (() => void) | undefined;

  const restoreHome = () => {
    cleanup?.();
    cleanup = undefined;
    host.innerHTML = homeHtml;
  };

  const setActive = (path: string) => {
    const pathname = path.split('?')[0];
    if (marsLink) {
      if (pathname === '/mars') {
        marsLink.setAttribute('aria-current', 'page');
      } else {
        marsLink.removeAttribute('aria-current');
      }
    }
    if (imagesLink) {
      if (pathname === '/images') {
        imagesLink.setAttribute('aria-current', 'page');
      } else {
        imagesLink.removeAttribute('aria-current');
      }
    }
  };

  const dispatch = () => {
    const hash = window.location.hash || '#/';
    const path = hash.startsWith('#') ? hash.slice(1) : hash;
    const [pathname] = path.split('?');
    const handler = routes[pathname];
    if (handler) {
      cleanup?.();
      const result = handler(host);
      cleanup = typeof result === 'function' ? result : undefined;
    } else {
      restoreHome();
    }
    setActive(path);
  };

  window.addEventListener('hashchange', dispatch);
  dispatch();
}
