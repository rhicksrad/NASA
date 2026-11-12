/** The landing page: today's astronomy picture, what is happening right now, and an index of explorers. */
import '../../../styles/home.css';
import { apodImageUrl, fetchApod } from '../../../api/apod';
import { buildEpicImageUrl, fetchEpicLatest } from '../../../api/epic';
import { getHourlyHighlight } from './hourlyHighlight';
import { mountIssTile } from './issTile';
import { mountLiveTiles } from './liveTiles';

const longDate = new Intl.DateTimeFormat('en-GB', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});
const shortDate = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

interface LeadPhoto {
  url: string;
  link: string;
  /** Caption parts: a bold lead-in, body text and a credit line. */
  title: string;
  text: string;
  credit: string;
}

/** The first sentences of a passage, up to roughly `limit` characters. */
function leadSentences(text: string, limit = 260): string {
  const sentences = text.replace(/\s+/g, ' ').trim().match(/[^.!?]+[.!?]+/g) ?? [];
  let lead = '';
  for (const sentence of sentences) {
    if (lead && lead.length + sentence.length > limit) break;
    lead += sentence;
  }
  return lead.trim();
}

/** Today's APOD, or the hourly archive pick when APOD has no still image or is down. */
async function pickLeadPhoto(signal: AbortSignal): Promise<LeadPhoto | null> {
  try {
    const apod = await fetchApod(signal);
    const url = apodImageUrl(apod);
    if (url) {
      return {
        url,
        link: 'https://apod.nasa.gov/apod/astropix.html',
        title: apod.title,
        text: leadSentences(apod.explanation ?? ''),
        credit: `Astronomy Picture of the Day${apod.copyright ? `, © ${apod.copyright.replace(/\s+/g, ' ').trim()}` : ''}`,
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
      link: `#/images/explorer?${query}`,
      title: highlight.item.title,
      text: leadSentences(highlight.item.description ?? ''),
      credit: 'From the NASA Image and Video Library',
    };
  } catch {
    return null;
  }
}

function showPhoto(frame: HTMLElement, url: string, alt: string): void {
  const img = new Image();
  img.alt = alt;
  img.decoding = 'async';
  img.addEventListener('load', () => frame.classList.add('is-loaded'), { once: true });
  img.src = url;
  frame.replaceChildren(img);
}

async function mountLeadPhoto(host: HTMLElement, signal: AbortSignal): Promise<void> {
  const frame = host.querySelector<HTMLAnchorElement>('#hero-media');
  const caption = host.querySelector<HTMLElement>('#hero-caption');
  if (!frame || !caption) return;
  const photo = await pickLeadPhoto(signal);
  if (signal.aborted) return;
  if (!photo) {
    caption.textContent = 'Today’s picture is not available right now.';
    return;
  }

  showPhoto(frame, photo.url, photo.title);
  frame.href = photo.link;
  if (photo.link.startsWith('#')) frame.removeAttribute('target');

  const title = document.createElement('strong');
  title.textContent = photo.title;
  const credit = document.createElement('span');
  credit.className = 'home-photo__credit';
  credit.textContent = photo.credit;
  caption.replaceChildren(title, photo.text ? ` ${photo.text} ` : ' ', credit);
}

async function mountEarth(host: HTMLElement, signal: AbortSignal): Promise<void> {
  const frame = host.querySelector<HTMLElement>('#earth-media');
  const caption = host.querySelector<HTMLElement>('#earth-caption');
  if (!frame) return;
  const items = await fetchEpicLatest(signal);
  const latest = items[items.length - 1];
  if (!latest || signal.aborted) return;
  showPhoto(frame, buildEpicImageUrl(latest, 'jpg'), 'The sunlit side of Earth');
  const taken = new Date(`${latest.date.replace(' ', 'T')}Z`);
  if (caption && !Number.isNaN(taken.getTime())) {
    caption.textContent = `Earth on ${shortDate.format(taken)}, photographed by the DSCOVR spacecraft from 1.5 million km sunward. There is a new set every day.`;
  }
}

/** Shows today's date and a UTC clock, the time base every feed on the page uses. */
function mountDateline(host: HTMLElement, signal: AbortSignal): void {
  const date = host.querySelector<HTMLElement>('#home-date');
  const clock = host.querySelector<HTMLElement>('#home-clock');
  if (!date || !clock) return;
  const tick = () => {
    const now = new Date();
    // Weekday on its own line, so the headline never breaks mid-date.
    const [weekday, ...rest] = longDate.format(now).split(', ');
    const text = `${weekday}\n${rest.join(', ')}`;
    if (date.textContent !== text) date.textContent = text;
    clock.textContent = `${now.toISOString().slice(11, 19)} UTC`;
  };
  tick();
  const timer = window.setInterval(tick, 1000);
  signal.addEventListener('abort', () => window.clearInterval(timer), { once: true });
}

/**
 * Wires up the landing view. Expects the home markup to already be in `host`;
 * returns a cleanup that cancels requests and timers when the visitor navigates away.
 */
export function mountHome(host: HTMLElement): () => void {
  const controller = new AbortController();
  const { signal } = controller;
  document.body.classList.add('is-home');

  mountDateline(host, signal);
  void mountLeadPhoto(host, signal);
  void mountEarth(host, signal).catch(() => undefined);
  mountLiveTiles(host, signal);

  const iss = host.querySelector<HTMLElement>('#tile-iss');
  if (iss) {
    mountIssTile(iss, signal).catch(() => {
      if (signal.aborted) return;
      iss.classList.add('is-unavailable');
      const caption = iss.querySelector('figcaption');
      if (caption) caption.textContent = 'The station’s orbit data is not answering right now.';
    });
  }

  return () => {
    controller.abort();
    document.body.classList.remove('is-home');
  };
}
