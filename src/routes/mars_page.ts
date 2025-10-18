// src/routes/mars_page.ts
import { MarsGallery } from '../components/MarsGallery';

export function initMarsPage(host?: HTMLElement | null) {
  const container = host ?? document.getElementById('page-host');
  if (!(container instanceof HTMLElement)) return;

  const root = document.createElement('div');
  root.id = 'mars-host';
  root.style.padding = '12px';
  container.replaceChildren(root);

  // Title
  const h1 = document.createElement('h1');
  h1.textContent = 'Mars Rover Gallery';
  h1.style.margin = '8px 0 16px';
  root.appendChild(h1);

  const app = document.createElement('div');
  root.appendChild(app);

  new MarsGallery(app);
}
