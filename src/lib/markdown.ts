import { escapeHtml } from './dom';

/**
 * Renders the small markdown dialect the worker emits for CME and EONET
 * reports: headings, blockquotes, flat bullet lists, bold, `[text](url)` links
 * and bare URLs.
 *
 * The source is upstream API text, so everything is HTML-escaped first and only
 * http(s) links are turned into anchors.
 */
export function renderMarkdown(source: string): string {
  const html: string[] = [];
  let listOpen = false;
  let paragraph: string[] = [];

  const closeList = () => {
    if (listOpen) html.push('</ul>');
    listOpen = false;
  };
  const flushParagraph = () => {
    if (paragraph.length) html.push(`<p>${paragraph.join('<br />')}</p>`);
    paragraph = [];
  };

  for (const rawLine of source.replace(/\r\n?/g, '\n').split('\n')) {
    const line = rawLine.trim();
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    const bullet = /^[-*]\s+(.*)$/.exec(line);
    const quote = /^>\s?(.*)$/.exec(line);

    if (bullet) {
      flushParagraph();
      if (!listOpen) html.push('<ul>');
      listOpen = true;
      html.push(`<li>${renderInline(bullet[1])}</li>`);
      continue;
    }
    closeList();

    if (!line) {
      flushParagraph();
    } else if (heading) {
      flushParagraph();
      const level = heading[1].length;
      html.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);
    } else if (quote) {
      flushParagraph();
      html.push(`<blockquote>${renderInline(quote[1])}</blockquote>`);
    } else {
      paragraph.push(renderInline(line));
    }
  }
  closeList();
  flushParagraph();
  return html.join('\n');
}

const LINK_PATTERN = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<)]+)/g;

function anchor(href: string, label: string): string {
  return `<a href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>`;
}

function renderInline(text: string): string {
  // Escaping first means the patterns below only ever see inert text.
  return escapeHtml(text)
    .replace(LINK_PATTERN, (_match, label: string | undefined, target: string | undefined, bare: string | undefined) => {
      if (label && target) return anchor(target, label);
      // Keep trailing sentence punctuation out of bare links.
      const [, url, trailing] = /^(.*?)([.,;:!?]*)$/.exec(bare ?? '') ?? [];
      return `${anchor(url, url)}${trailing}`;
    })
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
}
