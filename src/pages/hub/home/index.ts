/** The landing page: an Astronomy Picture of the Day hero, live tiles and a card per explorer. */
import '../../../styles/home.css';
import { apodImageUrl, fetchApod } from '../../../api/apod';
import { buildEpicImageUrl, fetchEpicLatest } from '../../../api/epic';
import { searchImages } from '../../../api/images';
import { getHourlyHighlight } from './hourlyHighlight';
import { mountIssTile } from './issTile';
import { mountLiveTiles } from './liveTiles';

interface HeroImage {
  url: string;
  caption: string;
  link: string;
}

/** Today's APOD, or the hourly archive pick when APOD is a video without a still or is down. */
async function pickHeroImage(signal: AbortSignal): Promise<HeroImage | null> {
  try {
    const apod = await fetchApod(signal);
    const url = apodImageUrl(apod);
    if (url) {
      const credit = apod.copyright ? ` · © ${apod.copyright.trim().replace(/\s+/g, ' ')}` : '';
      return {
        url,
        caption: `Astronomy Picture of the Day: ${apod.title}${credit}`,
        link: 'https://apod.nasa.gov/apod/astropix.html',
      };
    }
  } catch {
    if (signal.aborted) return null;
  }
  try {
    const highlight = await getHourlyHighlight(new Date(), signal);
    const query = new URLSearchParams({ preset: 'custom', q: highlight.query, page: String(highlight.page) });
    return {
      url: highlight.assetUrl,
      caption: `From the NASA archive: ${highlight.item.title}`,
      link: `#/images/explorer?${query}`,
    };
  } catch {
    return null;
  }
}

async function mountHero(host: HTMLElement, signal: AbortSignal): Promise<void> {
  const media = host.querySelector<HTMLElement>('#hero-media');
  const credit = host.querySelector<HTMLAnchorElement>('#hero-credit');
  if (!media) return;
  const hero = await pickHeroImage(signal);
  if (!hero || signal.aborted) return;

  const img = new Image();
  img.alt = '';
  img.decoding = 'async';
  img.addEventListener('load', () => media.classList.add('is-loaded'), { once: true });
  img.src = hero.url;
  media.replaceChildren(img);

  if (credit) {
    credit.textContent = hero.caption;
    credit.href = hero.link;
    if (hero.link.startsWith('#')) credit.removeAttribute('target');
    credit.hidden = false;
  }
}

/** Swaps an explorer card's icon art for a real photo once one is available. */
function setCardPreview(host: HTMLElement, name: string, url: string | null | undefined, alt: string): void {
  const media = host.querySelector<HTMLElement>(`.explorer-card[data-preview="${name}"] .explorer-card__media`);
  if (!media || !url) return;
  const img = new Image();
  img.alt = alt;
  img.loading = 'lazy';
  img.decoding = 'async';
  img.addEventListener('load', () => media.classList.add('has-photo'), { once: true });
  img.src = url;
  media.append(img);
}

function mountCardPreviews(host: HTMLElement, signal: AbortSignal): void {
  const quietly = (task: Promise<void>) => void task.catch(() => undefined);
  const hourIndex = Math.floor(Date.now() / 3_600_000);

  quietly(
    fetchEpicLatest(signal).then((items) => {
      const latest = items[items.length - 1];
      if (latest) setCardPreview(host, 'epic', buildEpicImageUrl(latest, 'jpg'), 'Earth from the DSCOVR spacecraft');
    }),
  );
  quietly(
    searchImages({ q: 'James Webb Space Telescope nebula', page: 1 }, { signal }).then(({ items }) => {
      const pick = items[hourIndex % Math.max(1, items.length)];
      setCardPreview(host, 'images', pick?.thumb, pick?.title ?? 'NASA archive image');
    }),
  );
  quietly(
    searchImages({ q: 'Curiosity Mastcam', page: 1 }, { signal }).then(({ items }) => {
      const pick = items[hourIndex % Math.max(1, items.length)];
      setCardPreview(host, 'mars', pick?.thumb, pick?.title ?? 'Mars rover image');
    }),
  );
}

/**
 * Wires up the landing view. Expects the home markup to already be in `host`;
 * returns a cleanup that cancels requests and timers when the visitor navigates away.
 */
export function mountHome(host: HTMLElement): () => void {
  const controller = new AbortController();
  const { signal } = controller;
  document.body.classList.add('is-home');

  void mountHero(host, signal);
  mountLiveTiles(host, signal);
  mountCardPreviews(host, signal);

  const issTile = host.querySelector<HTMLElement>('#tile-iss');
  if (issTile) {
    mountIssTile(issTile, signal).catch(() => {
      if (!signal.aborted) issTile.classList.add('is-unavailable');
    });
  }

  return () => {
    controller.abort();
    document.body.classList.remove('is-home');
  };
}
