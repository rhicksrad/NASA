/** SVG renderers for the CME report. Colours come from storm.css so the charts follow the site palette. */
import { WORLD_LAND_PATH } from '../../assets/worldLand';
import { svgEl } from '../../lib/dom';
import { auroraLatitude, type TimelineEvent } from './analysis';

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const DEG = Math.PI / 180;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function formatDay(date: Date): string {
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}`;
}

export function formatClock(date: Date): string {
  return `${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')}`;
}

const kpClass = (kp: number) => (kp >= 7 ? 'is-severe' : kp >= 5 ? 'is-storm' : '');

/**
 * One UTC axis from the eruption to the end of the storm: when the models expected the cloud,
 * when the shock actually arrived, and the Kp readings that followed.
 */
export function arrivalTimeline(events: TimelineEvent[], availableWidth: number): SVGSVGElement {
  const times = events.map((event) => event.t.getTime());
  const span = Math.max(...times) - Math.min(...times);
  const margin = Math.max(3 * HOUR_MS, span * 0.04);
  const minT = Math.min(...times) - margin;
  const maxT = Math.max(...times) + margin;

  const width = Math.max(340, Math.min(1000, Math.round(availableWidth)));
  const compact = width < 560;
  const height = 236;
  const padL = 8;
  const padR = 8;
  const axisY = 118;
  const barBase = 214;
  const barMax = 62;
  const x = (time: number) => padL + ((time - minT) / (maxT - minT)) * (width - padL - padR);

  const svg = svgEl('svg', { viewBox: `0 0 ${width} ${height}`, class: 'timeline-svg', role: 'img' });
  svg.setAttribute('aria-label', 'Timeline from the eruption to its arrival at Earth');

  // Day ticks along the axis.
  svg.append(svgEl('line', { x1: padL, x2: width - padR, y1: axisY, y2: axisY, class: 'tl-axis' }));
  const days = (maxT - minT) / DAY_MS;
  const stepDays = Math.max(1, Math.ceil(days / (compact ? 4 : 8)));
  const firstDay = Math.ceil(minT / DAY_MS) * DAY_MS;
  for (let time = firstDay; time <= maxT; time += stepDays * DAY_MS) {
    const tx = x(time);
    svg.append(
      svgEl('line', { x1: tx, x2: tx, y1: axisY, y2: axisY + 6, class: 'tl-tick' }),
      svgEl('text', { x: tx, y: axisY + 19, class: 'tl-tick-label', 'text-anchor': 'middle' }, formatDay(new Date(time))),
    );
  }

  /** A label that flips to the left of its marker near the right edge. */
  const label = (cx: number, y: number, text: string, className = 'tl-label') => {
    const flip = cx > width * 0.5;
    svg.append(svgEl('text', { x: cx + (flip ? -8 : 8), y, class: className, 'text-anchor': flip ? 'end' : 'start' }, text));
  };

  const launch = events.find((event) => event.kind === 'launch');
  const shock = events.find((event) => event.kind === 'ips');
  const predictions = events.filter((event) => event.kind === 'pred');
  const readings = events.filter((event): event is Extract<TimelineEvent, { kind: 'kp' }> => event.kind === 'kp');

  // Kp readings: three-hour bars under the axis.
  if (readings.length) {
    const barWidth = Math.max(3, x(minT + 3 * HOUR_MS) - x(minT) - 1.5);
    const peak = readings.reduce((best, reading) => (reading.kp > best.kp ? reading : best));
    for (const reading of readings) {
      const h = (Math.min(9, reading.kp) / 9) * barMax;
      svg.append(
        svgEl('rect', {
          x: x(reading.t.getTime()),
          y: barBase - h,
          width: barWidth,
          height: h,
          class: `tl-kp ${kpClass(reading.kp)}`,
        }),
      );
    }
    svg.append(svgEl('line', { x1: padL, x2: width - padR, y1: barBase, y2: barBase, class: 'tl-base' }));
    svg.append(
      svgEl(
        'text',
        { x: x(peak.t.getTime()), y: barBase - (Math.min(9, peak.kp) / 9) * barMax - 6, class: 'tl-label tl-label--strong' },
        `Kp ${Number(peak.kp.toFixed(1))}`,
      ),
    );
    svg.append(svgEl('text', { x: padL, y: barBase + 16, class: 'tl-tick-label' }, 'Geomagnetic activity at Earth (Kp, 0 to 9)'));
  }

  if (launch) {
    const cx = x(launch.t.getTime());
    svg.append(
      svgEl('line', { x1: cx, x2: cx, y1: axisY - 26, y2: axisY, class: 'tl-stem' }),
      svgEl('circle', { cx, cy: axisY, r: 4.5, class: 'tl-launch' }),
    );
    label(cx - 8, axisY - 32, `Left the Sun ${formatDay(launch.t)}, ${formatClock(launch.t)}`);
  }

  if (predictions.length) {
    const first = predictions[0].t.getTime();
    const last = predictions[predictions.length - 1].t.getTime();
    if (last > first) {
      svg.append(svgEl('line', { x1: x(first), x2: x(last), y1: axisY - 12, y2: axisY - 12, class: 'tl-forecast-span' }));
    }
    for (const prediction of predictions) {
      const cx = x(prediction.t.getTime());
      svg.append(svgEl('polygon', { points: `${cx},${axisY - 3} ${cx - 6},${axisY - 15} ${cx + 6},${axisY - 15}`, class: 'tl-forecast' }));
    }
    const text =
      predictions.length > 1
        ? `Forecast arrival, ${predictions.length} model runs`
        : `Forecast arrival ${formatDay(predictions[0].t)}, ${formatClock(predictions[0].t)}`;
    label(x(first) - 8, axisY - 58, text);
    svg.append(svgEl('line', { x1: x(first), x2: x(first), y1: axisY - 52, y2: axisY - 15, class: 'tl-stem' }));
  }

  if (shock) {
    const cx = x(shock.t.getTime());
    svg.append(
      svgEl('line', { x1: cx, x2: cx, y1: 22, y2: readings.length ? barBase : axisY, class: 'tl-shock-line' }),
      svgEl('circle', { cx, cy: axisY, r: 5.5, class: 'tl-shock' }),
    );
    label(cx - 8, 18, `Shock reached Earth ${formatDay(shock.t)}, ${formatClock(shock.t)}`, 'tl-label tl-label--strong');
  }

  return svg;
}

/** Points on the circle `colatitude` degrees from a pole, as [lon, lat] sorted west to east. */
function ovalEdge(poleLat: number, poleLon: number, colatitude: number): Array<[number, number]> {
  const phi = poleLat * DEG;
  const c = colatitude * DEG;
  const points: Array<[number, number]> = [];
  for (let bearing = 0; bearing < 360; bearing += 3) {
    const theta = bearing * DEG;
    const lat = Math.asin(Math.sin(phi) * Math.cos(c) + Math.cos(phi) * Math.sin(c) * Math.cos(theta));
    const lon =
      poleLon * DEG + Math.atan2(Math.sin(theta) * Math.sin(c) * Math.cos(phi), Math.cos(c) - Math.sin(phi) * Math.sin(lat));
    points.push([((((lon / DEG + 180) % 360) + 360) % 360) - 180, lat / DEG]);
  }
  return points.sort((a, b) => a[0] - b[0]);
}

/**
 * World map with the two auroral zones for a given Kp. The zones are centred on the geomagnetic
 * poles, which is why the northern one dips furthest south over North America.
 */
export function auroraMap(peakKp: number): SVGSVGElement {
  const colatitude = 90 - auroraLatitude(peakKp);
  const svg = svgEl('svg', { viewBox: '0 0 360 180', class: 'aurora-svg', role: 'img' });
  svg.setAttribute('aria-label', `Map of where aurora may be visible at Kp ${peakKp}`);
  svg.append(svgEl('path', { d: WORLD_LAND_PATH, class: 'aurora-land' }));

  const zones: Array<[number, number, number]> = [
    [80.7, -72.7, 0],
    [-80.7, 107.3, 180],
  ];
  for (const [poleLat, poleLon, edgeY] of zones) {
    const edge = ovalEdge(poleLat, poleLon, colatitude);
    const line = edge.map(([lon, lat]) => `${(lon + 180).toFixed(1)},${(90 - lat).toFixed(1)}`);
    const first = edge[0];
    const last = edge[edge.length - 1];
    // Close the curve along the map edge, joining both ends at the same latitude.
    const seam = (90 - (first[1] + last[1]) / 2).toFixed(1);
    svg.append(
      svgEl('path', { d: `M0,${seam}L${line.join('L')}L360,${seam}L360,${edgeY}L0,${edgeY}Z`, class: 'aurora-zone' }),
      svgEl('path', { d: `M0,${seam}L${line.join('L')}L360,${seam}`, class: 'aurora-edge' }),
    );
  }
  return svg;
}
