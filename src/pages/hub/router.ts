import { setCurrentNav } from '../../shell/nav';
import { mountHome } from './home/index';

/** A view fills the host element and may return a teardown function. */
type View = (host: HTMLElement) => void | (() => void);

interface Route {
  /** Fetches the view's code and styles the first time the route is opened. */
  load: () => Promise<View>;
  /** id of the header link to mark as current. */
  navId: string;
}

// Only the home view ships with the page. Each explorer is its own chunk, so the
// landing page does not download React (Images) or the EPIC and Mars viewers.
const ROUTES: Record<string, Route> = {
  '/images/explorer': {
    load: () => import('./imagesExplorer').then((m) => m.initImagesExplorerPage),
    navId: 'nav-images-explorer',
  },
  '/epic': { load: () => import('./epic').then((m) => m.mountEpicPage), navId: 'nav-epic' },
  '/mars': { load: () => import('./mars').then((m) => m.mountMarsPage), navId: 'nav-mars' },
  '/about': { load: () => import('./about').then((m) => m.mountAboutPage), navId: 'nav-about' },
};

const REDIRECTS: Record<string, string> = {
  '/images': '/images/explorer',
};

function currentPath(): string {
  const [rawPath] = window.location.hash.replace(/^#/, '').split('?');
  const path = `/${rawPath.trim().replace(/^\/+|\/+$/g, '')}`.toLowerCase();
  return path;
}

/**
 * Hash router for the hub page (`index.html`). Unknown hashes show the home
 * view, whose markup ships in the HTML so it paints before any script runs.
 */
export function initRouter(): void {
  const host = document.getElementById('page-host');
  if (!host) return;

  const homeMarkup = host.innerHTML;
  let teardown: (() => void) | void;
  let activePath: string | null = null;
  // Bumped on every navigation, so a view that finishes loading late is dropped.
  let navigation = 0;

  const dispatch = () => {
    const path = currentPath();
    const redirect = REDIRECTS[path];
    if (redirect) {
      window.location.replace(`#${redirect}`);
      return;
    }
    // Views own their query string (filters, paging), so only remount when the path changes.
    if (path === activePath) return;

    teardown?.();
    teardown = undefined;
    const previousPath = activePath;
    const route = ROUTES[path];
    const current = ++navigation;
    activePath = path;
    setCurrentNav(route?.navId ?? null);

    if (!route) {
      if (previousPath !== null) host.innerHTML = homeMarkup;
      teardown = mountHome(host);
      return;
    }
    route
      .load()
      .then((view) => {
        if (current === navigation) teardown = view(host);
      })
      .catch((error: unknown) => {
        // A chunk that will not load (offline, or a deploy replaced it): let the next
        // navigation try again rather than leaving the route marked as shown.
        if (current === navigation) activePath = null;
        console.error(error);
      });
  };

  window.addEventListener('hashchange', dispatch);
  dispatch();
}
