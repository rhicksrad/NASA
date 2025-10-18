import { initMarsPage } from './mars_page';
import { initImagesPage } from './images';
import { initImagesExplorerPage } from './imagesExplorer';

type RouteHandler = (host: HTMLElement) => void | (() => void);

export function initRouter() {
  const host = document.getElementById('page-host');
  if (!(host instanceof HTMLElement)) {
    return;
  }

  const marsLink = document.querySelector<HTMLAnchorElement>('#nav-mars');
  const imagesLink = document.querySelector<HTMLAnchorElement>('#nav-images');
  const imagesExplorerLink = document.querySelector<HTMLAnchorElement>('#nav-images-explorer');
  const homeHtml = host.innerHTML;

  const routes: Record<string, RouteHandler> = {
    '/mars': container => {
      initMarsPage(container);
    },
    '/images': container => initImagesPage(container),
    '/images/explorer': container => initImagesExplorerPage(container),
  };

  const normalizePathname = (value: string): string => {
    const trimmed = value.trim();
    if (!trimmed) return '/';
    const withSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
    const withoutTrailing = withSlash.replace(/\/+$/, '');
    return withoutTrailing ? withoutTrailing.toLowerCase() : '/';
  };

  let cleanup: (() => void) | undefined;

  const restoreHome = () => {
    cleanup?.();
    cleanup = undefined;
    host.innerHTML = homeHtml;
  };

  const setActive = (path: string) => {
    const pathname = normalizePathname(path);
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
    if (imagesExplorerLink) {
      if (pathname === '/images/explorer') {
        imagesExplorerLink.setAttribute('aria-current', 'page');
      } else {
        imagesExplorerLink.removeAttribute('aria-current');
      }
    }
  };

  const dispatch = () => {
    const hash = window.location.hash || '#/';
    const path = hash.startsWith('#') ? hash.slice(1) : hash;
    const [rawPathname] = path.split('?');
    const normalizedPath = normalizePathname(rawPathname);
    const handler = routes[normalizedPath];
    if (handler) {
      cleanup?.();
      const result = handler(host);
      cleanup = typeof result === 'function' ? result : undefined;
    } else {
      restoreHome();
    }
    setActive(normalizedPath);
  };

  window.addEventListener('hashchange', dispatch);
  dispatch();
}
