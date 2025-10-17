import type { Apod } from '../types/nasa';

export function renderApod(container: HTMLElement, apod: Apod): void {
  container.replaceChildren();
  if (apod.media_type === 'image') {
    const img = document.createElement('img');
    img.alt = apod.title || 'Astronomy Picture of the Day';
    img.loading = 'lazy';
    img.src = apod.hdurl || apod.url;
    container.appendChild(img);
  } else if (apod.media_type === 'video') {
    const frame = document.createElement('iframe');
    frame.src = apod.url;
    frame.title = apod.title || 'APOD Video';
    frame.setAttribute('allowfullscreen', 'true');
    frame.setAttribute('referrerpolicy', 'no-referrer');
    frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-popups');
    container.appendChild(frame);
  } else {
    container.textContent = 'Unsupported media type';
  }
}
