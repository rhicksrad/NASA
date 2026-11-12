/** Mass against radius for every planet in the result that has both, on log axes. */
import { svgEl } from '../../lib/dom';

export interface ChartPlanet {
  name: string;
  /** Radius in Earth radii. */
  rade: number | null;
  /** Mass in Earth masses. */
  masse: number | null;
}

const WIDTH = 720;
const HEIGHT = 440;
const PAD = { left: 46, right: 14, top: 14, bottom: 40 };

const MASS_RANGE: [number, number] = [0.05, 12_000];
const RADIUS_RANGE: [number, number] = [0.25, 32];
const MASS_TICKS = [0.1, 1, 10, 100, 1000, 10_000];
const RADIUS_TICKS = [0.5, 1, 2, 4, 10, 20];

/** The solar system's own planets, for scale. */
const LANDMARKS: Array<{ name: string; mass: number; radius: number }> = [
  { name: 'Earth', mass: 1, radius: 1 },
  { name: 'Neptune', mass: 17.15, radius: 3.88 },
  { name: 'Jupiter', mass: 317.8, radius: 11.21 },
];

const clamp = (value: number, [min, max]: [number, number]) => Math.min(max, Math.max(min, value));

function scale(range: [number, number], from: number, to: number): (value: number) => number {
  const [min, max] = range.map(Math.log10);
  return (value) => from + ((Math.log10(clamp(value, range)) - min) / (max - min)) * (to - from);
}

const x = scale(MASS_RANGE, PAD.left, WIDTH - PAD.right);
const y = scale(RADIUS_RANGE, HEIGHT - PAD.bottom, PAD.top);

/**
 * Draws the chart. Every dot carries `data-index` (its position in `planets`) so the caller can
 * turn a click back into a planet.
 */
export function massRadiusChart(planets: ChartPlanet[], selectedName: string): SVGSVGElement {
  const svg = svgEl('svg', { viewBox: `0 0 ${WIDTH} ${HEIGHT}`, class: 'mr-chart', role: 'img' });
  svg.setAttribute('aria-label', 'Planet mass against radius, both relative to Earth, on logarithmic axes');

  for (const tick of MASS_TICKS) {
    const tx = x(tick);
    svg.append(
      svgEl('line', { x1: tx, x2: tx, y1: PAD.top, y2: HEIGHT - PAD.bottom, class: 'mr-grid' }),
      svgEl('text', { x: tx, y: HEIGHT - PAD.bottom + 16, 'text-anchor': 'middle', class: 'mr-tick' }, tick.toLocaleString('en-US')),
    );
  }
  for (const tick of RADIUS_TICKS) {
    const ty = y(tick);
    svg.append(
      svgEl('line', { x1: PAD.left, x2: WIDTH - PAD.right, y1: ty, y2: ty, class: 'mr-grid' }),
      svgEl('text', { x: PAD.left - 8, y: ty + 4, 'text-anchor': 'end', class: 'mr-tick' }, String(tick)),
    );
  }
  svg.append(
    svgEl('text', { x: WIDTH - PAD.right, y: HEIGHT - 4, 'text-anchor': 'end', class: 'mr-axis' }, 'Mass, Earth = 1'),
    svgEl('text', { x: 0, y: PAD.top + 2, class: 'mr-axis' }, 'Radius, Earth = 1'),
  );

  const dots = svgEl('g', { class: 'mr-dots' });
  let selected: { cx: number; cy: number; index: number } | null = null;
  planets.forEach((planet, index) => {
    if (planet.masse === null || planet.rade === null || planet.masse <= 0 || planet.rade <= 0) return;
    const cx = x(planet.masse);
    const cy = y(planet.rade);
    if (planet.name === selectedName) {
      selected = { cx, cy, index };
      return;
    }
    const dot = svgEl('circle', { cx: cx.toFixed(1), cy: cy.toFixed(1), r: 3.5, 'data-index': index });
    dot.append(svgEl('title', {}, planet.name));
    dots.append(dot);
  });
  svg.append(dots);

  for (const landmark of LANDMARKS) {
    const cx = x(landmark.mass);
    const cy = y(landmark.radius);
    svg.append(
      svgEl('path', { d: `M${cx - 6},${cy}H${cx + 6}M${cx},${cy - 6}V${cy + 6}`, class: 'mr-landmark' }),
      svgEl('text', { x: cx + 9, y: cy + 14, class: 'mr-landmark-label' }, landmark.name),
    );
  }

  const chosen = planets.find((planet) => planet.name === selectedName);
  if (selected) {
    const { cx, cy, index } = selected as { cx: number; cy: number; index: number };
    const flip = cx > WIDTH * 0.7;
    svg.append(
      svgEl('circle', { cx, cy, r: 11, class: 'mr-selected-ring' }),
      svgEl('circle', { cx, cy, r: 5, class: 'mr-selected', 'data-index': index }),
      svgEl('text', { x: cx + (flip ? -16 : 16), y: cy - 10, 'text-anchor': flip ? 'end' : 'start', class: 'mr-selected-label' }, selectedName),
    );
  } else if (chosen?.rade) {
    // No mass on record: it sits somewhere along this line.
    const cy = y(chosen.rade);
    svg.append(
      svgEl('line', { x1: PAD.left, x2: WIDTH - PAD.right, y1: cy, y2: cy, class: 'mr-selected-line' }),
      svgEl('text', { x: WIDTH - PAD.right, y: cy - 6, 'text-anchor': 'end', class: 'mr-selected-label' }, `${selectedName}, mass not measured`),
    );
  }

  return svg;
}
