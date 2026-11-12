/**
 * Inline SVG illustrations, one per planet class, in the flat five-colour manner of the site's
 * plates: a disc, a few cut-paper shapes across it, and one flat shadow. Pure string builders
 * with no DOM access; every shape is generated, so the set stays consistent.
 */

const INK = '#0b0c10';
const BONE = '#f0ece2';
const RED = '#f0431f';
const BLUE = '#1f4fa3';
const SKY = '#6aa5f8';
const OCHRE = '#d9a441';
const UMBER = '#a8742a';
const EMBER = '#4a1a12';

interface Recipe {
  /** Disc radius in a 160-unit box; bigger classes get bigger discs. */
  radius: number;
  base: string;
  /** Wavy stripes across the disc: [centre y as a fraction of the diameter, thickness, colour]. */
  bands?: Array<[number, number, string]>;
  /** Irregular patches (land, clouds, lava): [x, y, size, colour], in disc fractions from the centre. */
  patches?: Array<[number, number, number, string]>;
  /** Round marks such as craters or storms: [x, y, size, colour]. */
  spots?: Array<[number, number, number, string]>;
  ring?: string;
}

const RECIPES = {
  'lava-world': {
    radius: 44,
    base: EMBER,
    patches: [[-0.35, -0.3, 0.5, RED], [0.3, 0.1, 0.62, RED], [-0.2, 0.5, 0.4, RED], [0.25, 0.05, 0.3, OCHRE], [-0.38, -0.32, 0.22, OCHRE]],
  },
  'airless-dwarf': {
    radius: 34,
    base: BONE,
    spots: [[-0.35, -0.25, 0.3, '#c9c2b2'], [0.3, 0.05, 0.22, '#c9c2b2'], [-0.05, 0.45, 0.18, '#c9c2b2'], [0.2, -0.5, 0.12, '#c9c2b2']],
  },
  'temperate-terrestrial': {
    radius: 46,
    base: BLUE,
    patches: [[-0.3, -0.15, 0.6, OCHRE], [0.4, 0.35, 0.42, OCHRE], [0.1, -0.55, 0.36, BONE], [-0.2, 0.55, 0.42, BONE], [0.5, -0.1, 0.24, BONE]],
  },
  rocky: {
    radius: 42,
    base: OCHRE,
    patches: [[-0.25, -0.2, 0.55, UMBER], [0.35, 0.3, 0.5, UMBER], [0, -0.8, 0.4, BONE]],
    spots: [[0.3, -0.3, 0.14, UMBER]],
  },
  'mega-earth': {
    radius: 56,
    base: UMBER,
    patches: [[-0.3, 0.1, 0.7, '#7a531c'], [0.4, -0.3, 0.5, OCHRE], [0.1, 0.6, 0.4, OCHRE]],
    bands: [[0.2, 0.05, BONE]],
  },
  'hot-super-earth': {
    radius: 52,
    base: RED,
    bands: [[0.3, 0.07, BONE], [0.62, 0.05, BONE]],
    patches: [[-0.2, 0, 0.5, OCHRE], [0.4, 0.45, 0.3, EMBER]],
  },
  'super-earth': {
    radius: 52,
    base: BLUE,
    bands: [[0.28, 0.08, BONE], [0.7, 0.06, BONE]],
    patches: [[0.1, 0.05, 0.5, SKY]],
  },
  'hot-sub-neptune': {
    radius: 60,
    base: OCHRE,
    bands: [[0.22, 0.1, RED], [0.48, 0.07, BONE], [0.72, 0.12, RED]],
  },
  'cold-sub-neptune': {
    radius: 60,
    base: BONE,
    bands: [[0.25, 0.1, SKY], [0.5, 0.08, BLUE], [0.75, 0.1, SKY]],
  },
  'sub-neptune': {
    radius: 60,
    base: BLUE,
    bands: [[0.3, 0.1, SKY], [0.58, 0.06, BONE], [0.78, 0.08, SKY]],
  },
  'warm-neptune': {
    radius: 64,
    base: BLUE,
    bands: [[0.26, 0.09, OCHRE], [0.5, 0.06, BONE], [0.74, 0.1, OCHRE]],
  },
  neptune: {
    radius: 64,
    base: BLUE,
    bands: [[0.3, 0.04, BONE], [0.44, 0.03, SKY], [0.7, 0.05, BONE]],
    spots: [[-0.3, 0.2, 0.2, INK]],
  },
  'ultra-hot-jupiter': {
    radius: 72,
    base: RED,
    bands: [[0.18, 0.08, OCHRE], [0.36, 0.06, BONE], [0.55, 0.1, EMBER], [0.74, 0.07, OCHRE], [0.88, 0.05, BONE]],
  },
  'cold-gas-giant': {
    radius: 58,
    base: BONE,
    bands: [[0.25, 0.09, SKY], [0.46, 0.06, OCHRE], [0.68, 0.1, BLUE]],
    ring: OCHRE,
  },
  'gas-giant': {
    radius: 72,
    base: OCHRE,
    bands: [[0.2, 0.09, BONE], [0.4, 0.07, UMBER], [0.58, 0.1, BONE], [0.8, 0.08, UMBER]],
    spots: [[0.3, 0.2, 0.2, RED]],
  },
} satisfies Record<string, Recipe>;

export type PlanetArtKey = keyof typeof RECIPES | 'unknown';

const CENTRE = 80;

/** A stripe with gently waving edges, wider than the disc so the clip does the trimming. */
function band(recipe: Recipe, [at, thickness, colour]: [number, number, string], index: number): string {
  const top = CENTRE - recipe.radius + at * recipe.radius * 2 - thickness * recipe.radius;
  const height = thickness * recipe.radius * 2;
  const wave = Math.max(1.5, recipe.radius * 0.05);
  const edge = (y: number, phase: number, reverse: boolean) => {
    const points: string[] = [];
    for (let step = 0; step <= 8; step += 1) {
      const x = reverse ? 160 - step * 20 : step * 20;
      points.push(`${x},${(y + Math.sin(step * 1.3 + phase) * wave).toFixed(1)}`);
    }
    return points.join(' L');
  };
  return `<path d="M${edge(top, index * 1.7, false)} L${edge(top + height, index * 2.3 + 1, true)}Z" fill="${colour}"/>`;
}

/** A cut-paper blob: a ring of points whose radius wobbles in a fixed pattern. */
function patch(recipe: Recipe, [dx, dy, size, colour]: [number, number, number, string], index: number): string {
  const cx = CENTRE + dx * recipe.radius;
  const cy = CENTRE + dy * recipe.radius;
  const points: string[] = [];
  for (let step = 0; step < 9; step += 1) {
    const angle = (step / 9) * Math.PI * 2;
    const wobble = 0.72 + 0.28 * Math.sin(step * 2.4 + index * 1.9) + 0.12 * Math.cos(step * 5.1 + index);
    const r = size * recipe.radius * 0.5 * wobble;
    points.push(`${(cx + Math.cos(angle) * r * 1.25).toFixed(1)},${(cy + Math.sin(angle) * r * 0.8).toFixed(1)}`);
  }
  return `<polygon points="${points.join(' ')}" fill="${colour}"/>`;
}

function spot(recipe: Recipe, [dx, dy, size, colour]: [number, number, number, string]): string {
  const r = size * recipe.radius * 0.5;
  return `<ellipse cx="${CENTRE + dx * recipe.radius}" cy="${CENTRE + dy * recipe.radius}" rx="${(r * 1.2).toFixed(1)}" ry="${(r * 0.85).toFixed(1)}" fill="${colour}"/>`;
}

function drawPlanet(key: string, recipe: Recipe): string {
  const r = recipe.radius;
  const clip = `planet-art-${key}`;
  const surface = [
    ...(recipe.bands ?? []).map((entry, index) => band(recipe, entry, index)),
    ...(recipe.patches ?? []).map((entry, index) => patch(recipe, entry, index)),
    ...(recipe.spots ?? []).map((entry) => spot(recipe, entry)),
  ].join('');
  // One flat shadow: the part of the disc not covered by a second disc shifted towards the light.
  const shadow = `<path fill-rule="evenodd" fill="${INK}" opacity="0.3" d="M${CENTRE - r},${CENTRE}a${r},${r} 0 1,0 ${r * 2},0a${r},${r} 0 1,0 ${-r * 2},0ZM${(CENTRE - r * 1.3).toFixed(1)},${(CENTRE - r * 0.2).toFixed(1)}a${r},${r} 0 1,0 ${r * 2},0a${r},${r} 0 1,0 ${-r * 2},0Z"/>`;
  const ringBack = recipe.ring
    ? `<ellipse cx="${CENTRE}" cy="${CENTRE}" rx="${r * 1.32}" ry="${r * 0.3}" fill="none" stroke="${recipe.ring}" stroke-width="5" transform="rotate(-14 ${CENTRE} ${CENTRE})"/>`
    : '';
  // The near half of the ring is drawn again over the disc so the planet sits inside it.
  const ringFront = recipe.ring
    ? `<path d="M${CENTRE - r * 1.32},${CENTRE}a${r * 1.32},${r * 0.3} 0 0,0 ${r * 2.64},0" fill="none" stroke="${recipe.ring}" stroke-width="5" transform="rotate(-14 ${CENTRE} ${CENTRE})"/>`
    : '';
  return `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160" role="img" aria-hidden="true">
  <defs><clipPath id="${clip}"><circle cx="${CENTRE}" cy="${CENTRE}" r="${r}"/></clipPath></defs>
  ${ringBack}
  <circle cx="${CENTRE}" cy="${CENTRE}" r="${r}" fill="${recipe.base}"/>
  <g clip-path="url(#${clip})">${surface}${shadow}</g>
  ${ringFront}
</svg>`;
}

function drawUnknown(): string {
  return `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160" role="img" aria-hidden="true">
  <circle cx="${CENTRE}" cy="${CENTRE}" r="46" fill="none" stroke="${BONE}" stroke-width="2" stroke-dasharray="3 7" opacity="0.6"/>
</svg>`;
}

/** Returns the SVG markup for a planet class. */
export function planetArt(key: PlanetArtKey): string {
  if (key === 'unknown') return drawUnknown();
  return drawPlanet(key, RECIPES[key]);
}
