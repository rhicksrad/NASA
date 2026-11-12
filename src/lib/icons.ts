const BASE_ATTRS =
  'stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" fill="none"';

const ICONS = {
  search: `<circle cx="11" cy="11" r="6" ${BASE_ATTRS} /><path d="m15.5 15.5 3.5 3.5" ${BASE_ATTRS} />`,
  plus: `<path d="M12 5v14" ${BASE_ATTRS} /><path d="M5 12h14" ${BASE_ATTRS} />`,
  minus: `<path d="M5 12h14" ${BASE_ATTRS} />`,
  sort: `<path d="m8 5-3 3 3 3" ${BASE_ATTRS} /><path d="M5 8h6" ${BASE_ATTRS} /><path d="m16 19 3-3-3-3" ${BASE_ATTRS} /><path d="M13 16h6" ${BASE_ATTRS} />`,
  collection: `<path d="M4.5 7h5l1.5 2h8.5a1.5 1.5 0 0 1 1.5 1.5V17a2 2 0 0 1-2 2h-13A2 2 0 0 1 4 17V8.5A1.5 1.5 0 0 1 5.5 7Z" ${BASE_ATTRS} />`,
  play: `<path d="M9.5 7.75v8.5l6.5-4.25-6.5-4.25Z" fill="currentColor" />`,
  pause: `<path d="M10 7.5v9" ${BASE_ATTRS} /><path d="M14 7.5v9" ${BASE_ATTRS} />`,
  calendar: `<path d="M7 4v3" ${BASE_ATTRS} /><path d="M17 4v3" ${BASE_ATTRS} /><rect x="4.5" y="5.5" width="15" height="14" rx="2" ${BASE_ATTRS} /><path d="M4.5 10h15" ${BASE_ATTRS} />`,
  download: `<path d="M12 5v9.5" ${BASE_ATTRS} /><path d="m8.5 11.5 3.5 3.5 3.5-3.5" ${BASE_ATTRS} /><path d="M5.5 18.5h13" ${BASE_ATTRS} />`,
  speed: `<path d="M20 13a8 8 0 1 0-2.34 5.66" ${BASE_ATTRS} /><path d="M15.5 8.5 12 12" ${BASE_ATTRS} />`,
  camera: `<path d="M5.5 7h3l1-1.5h5l1 1.5h3a1.5 1.5 0 0 1 1.5 1.5v8A1.5 1.5 0 0 1 19.5 18h-14A1.5 1.5 0 0 1 4 16.5v-8A1.5 1.5 0 0 1 5.5 7Z" ${BASE_ATTRS} /><circle cx="12" cy="13" r="3" ${BASE_ATTRS} />`,
  sparkle: `<path d="M6 5.5 7.25 8 6 10.5 3.5 11.75 6 13l1.25 2.5L8.5 13l2.5-1.25L8.5 10.5 7.25 8 6 5.5Z" fill="currentColor" /><path d="m17.5 5 1.5 3 3 1.5-3 1.5-1.5 3-1.5-3-3-1.5 3-1.5 1.5-3Z" fill="currentColor" /><path d="m14 15 1 2 2 1-2 1-1 2-1-2-2-1 2-1 1-2Z" fill="currentColor" />`,
  arrowLeft: `<path d="M6.5 12h11" ${BASE_ATTRS} /><path d="m10.5 8-4 4 4 4" ${BASE_ATTRS} />`,
  arrowRight: `<path d="M17.5 12h-11" ${BASE_ATTRS} /><path d="m13.5 8 4 4-4 4" ${BASE_ATTRS} />`,
  arrowUp: `<path d="M12 6.5v11" ${BASE_ATTRS} /><path d="m8 10.5 4-4 4 4" ${BASE_ATTRS} />`,
  arrowDown: `<path d="M12 17.5v-11" ${BASE_ATTRS} /><path d="m16 13.5-4 4-4-4" ${BASE_ATTRS} />`,
  close: `<path d="m8.5 8.5 7 7" ${BASE_ATTRS} /><path d="m15.5 8.5-7 7" ${BASE_ATTRS} />`,
  image: `<rect x="4.5" y="5.5" width="15" height="13" rx="2" ${BASE_ATTRS} /><path d="m8.5 13.5 2.5-2.5 3 3 2.5-2.5" ${BASE_ATTRS} /><circle cx="9" cy="9" r="1.5" ${BASE_ATTRS} />`,
  earth: `<circle cx="12" cy="12" r="7" ${BASE_ATTRS} /><path d="M8 11.5c1.5-1 2.5-.5 3.5-2.5 1 2 .5 2 2 2.5 1.5.5 1.5 1.5 1 2.5-.5 1-1.5.5-2.5 1s-1 .5-1.5 1.5" ${BASE_ATTRS} />`,
  orbit: `<ellipse cx="12" cy="12" rx="8" ry="5.5" ${BASE_ATTRS} /><circle cx="12" cy="12" r="2" fill="currentColor" /><circle cx="18" cy="9" r="1.1" fill="currentColor" />`,
  sun: `<circle cx="12" cy="12" r="4" ${BASE_ATTRS} /><path d="M12 3v2.5M12 18.5V21M4.5 12H7M17 12h2.5M6.2 6.2 7.9 7.9M16.1 16.1l1.7 1.7M16.1 7.9l1.7-1.7M6.2 17.8 7.9 16.1" ${BASE_ATTRS} />`,
  alert: `<path d="M12 5.5 4.5 18h15L12 5.5Z" ${BASE_ATTRS} /><path d="M12 10.5v3" ${BASE_ATTRS} /><circle cx="12" cy="16.5" r="0.9" fill="currentColor" />`,
  ringed: `<path d="M12 6.5a5.5 5.5 0 1 1-5.5 5.5A5.5 5.5 0 0 1 12 6.5Z" ${BASE_ATTRS} /><path d="M4 12c0-1.5 3.6-3.5 8-3.5s8 2 8 3.5-3.6 3.5-8 3.5-8-2-8-3.5Z" ${BASE_ATTRS} />`,
  mars: `<circle cx="12" cy="12" r="7" ${BASE_ATTRS} /><path d="M8.5 9c1.5-.5 2 0 3 .5s1.5.5 2-.5M9 14.5c1 .5 2 .5 3 0s1.5-.5 2.5 0" ${BASE_ATTRS} /><circle cx="9" cy="9" r="0.9" fill="currentColor" />`,
  external: `<path d="M7.5 7.5h9v9" ${BASE_ATTRS} /><path d="m7.5 16.5 9-9" ${BASE_ATTRS} />`,
  info: `<circle cx="12" cy="12" r="7.5" ${BASE_ATTRS} /><path d="M12 10.5v4" ${BASE_ATTRS} /><circle cx="12" cy="8" r="0.9" fill="currentColor" />`,
  eye: `<path d="M3 12s3.5-5 9-5 9 5 9 5-3.5 5-9 5-9-5-9-5Z" ${BASE_ATTRS} /><circle cx="12" cy="12" r="2.6" ${BASE_ATTRS} /><circle cx="12" cy="12" r="1.1" fill="currentColor" />`,
  clock: `<circle cx="12" cy="12" r="7.5" ${BASE_ATTRS} /><path d="M12 8v4.2l2.8 1.8" ${BASE_ATTRS} />`,
  target: `<circle cx="12" cy="12" r="7.5" ${BASE_ATTRS} /><path d="M12 4.5v3" ${BASE_ATTRS} /><path d="M12 19.5v-3" ${BASE_ATTRS} /><path d="M4.5 12h3" ${BASE_ATTRS} /><path d="M19.5 12h-3" ${BASE_ATTRS} />`,
} as const;

export type IconName = keyof typeof ICONS;

export type IconOptions = {
  label?: string;
  className?: string;
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function icon(name: IconName, options: IconOptions = {}): string {
  const body = ICONS[name];
  if (!body) {
    throw new Error(`Unknown icon: ${name}`);
  }
  const { label, className } = options;
  const aria = label
    ? `role="img" aria-label="${escapeHtml(label)}"`
    : 'aria-hidden="true" role="presentation"';
  const title = label ? `<title>${escapeHtml(label)}</title>` : '';
  const classes = ['ui-icon'];
  if (className?.trim()) {
    classes.push(className.trim());
  }
  return `<svg class="${classes.join(' ')}" ${aria} viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">${title}${body}</svg>`;
}

