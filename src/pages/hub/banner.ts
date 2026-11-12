/** The title block that opens each explorer inside the hub page: heading, a line of text and the page's plate. */
export function hubBanner(title: string, text: string, art: string): HTMLElement {
  const banner = document.createElement('section');
  banner.className = 'page-banner';

  const copy = document.createElement('div');
  copy.className = 'page-banner__text';
  const heading = document.createElement('h1');
  heading.textContent = title;
  const paragraph = document.createElement('p');
  paragraph.textContent = text;
  copy.append(heading, paragraph);

  const img = document.createElement('img');
  img.src = `${import.meta.env.BASE_URL}art/${art}.webp`;
  img.alt = '';
  img.width = 1536;
  img.height = 1024;
  img.decoding = 'async';

  banner.append(copy, img);
  return banner;
}
