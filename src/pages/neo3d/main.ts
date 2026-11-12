import '../../styles/main.css';
import type { NeoItem } from '../../api/neo';
import { initSiteNav } from '../../shell/nav';
import { createNeoCatalogLoader } from './catalog';
import { initNeo3D } from './controller';

const NEO_FETCH = { pageSize: 50, limit: 500 } as const;
const CATALOG_ERROR = 'Failed to load NEO catalog. Reload the page to try again.';

async function start(): Promise<void> {
  initSiteNav();

  const host = document.getElementById('neo3d-host');
  if (!host) return;

  let neos: NeoItem[] = [];
  const loadCatalogPage = createNeoCatalogLoader(NEO_FETCH);
  const loadMore = async () => {
    const { items, done } = await loadCatalogPage();
    neos = neos.concat(items);
    return { neos: items, done };
  };

  const controller = await initNeo3D(() => neos, host, { loadMore });

  try {
    const initial = await loadMore();
    controller?.setNeos(neos, { hasMore: !initial.done });
  } catch (error) {
    console.error('[neo3d] failed to load NEOs', error);
    controller?.setNeos([], { hasMore: false });

    const summary = document.getElementById('neo3d-neo-summary');
    if (summary) summary.textContent = CATALOG_ERROR;

    const message = document.createElement('div');
    message.className = 'neo3d-empty';
    message.setAttribute('role', 'listitem');
    message.textContent = CATALOG_ERROR;
    document.getElementById('neo3d-neo-list')?.replaceChildren(message);
  }
}

void start();
