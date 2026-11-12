import { setCurrentNav } from '../../shell/nav';
import { mountAboutPage } from './about';
import { mountEpicPage } from './epic';
import { mountHome } from './home';
import { initImagesExplorerPage } from './imagesExplorer';
import { mountMarsPage } from './mars';

/** A view fills the host element and may return a teardown function. */
type View = (host: HTMLElement) => void | (() => void);

interface Route {
  view: View;
  /** id of the header link to mark as current. */
  navId: string;
}

const ROUTES: Record<string, Route> = {
  '/images/explorer': { view: initImagesExplorerPage, navId: 'nav-images-explorer' },
  '/epic': { view: mountEpicPage, navId: 'nav-epic' },
  '/mars': { view: mountMarsPage, navId: 'nav-mars' },
  '/about': { view: mountAboutPage, navId: 'nav-about' },
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
    const route = ROUTES[path];
    if (route) {
      teardown = route.view(host);
    } else {
      if (activePath !== null) host.innerHTML = homeMarkup;
      teardown = mountHome(host);
    }
    activePath = path;
    setCurrentNav(route?.navId ?? null);
  };

  window.addEventListener('hashchange', dispatch);
  dispatch();
}
