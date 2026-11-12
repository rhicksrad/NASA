/** SVG renderers for the CME report cards. */
import { svgEl } from '../../lib/dom';
import { auroraLatitude, type TimelineEvent } from './analysis';

const HOUR_MS = 3_600_000;

/** Half-dial gauge, Kp 0–9 left to right. */
export function kpGauge(peakKp: number): SVGSVGElement {
  const cx = 120;
  const cy = 120;
  const r = 90;
  const angle = (kp: number) => Math.PI * (1 + kp / 9);
  const point = (kp: number, radius: number) => ({
    x: cx + radius * Math.cos(angle(kp)),
    y: cy + radius * Math.sin(angle(kp)),
  });

  const svg = svgEl('svg', { viewBox: '0 0 240 140', role: 'img', 'aria-label': `Peak Kp ${peakKp} of 9` });

  const bands: Array<[number, number, string]> = [
    [0, 3, '#6aa96a'],
    [3, 6, '#d2b55b'],
    [6, 9, '#cf6a6a'],
  ];
  for (const [from, to, color] of bands) {
    const start = point(from, r);
    const end = point(to, r);
    svg.append(
      svgEl('path', {
        d: `M ${start.x} ${start.y} A ${r} ${r} 0 0 1 ${end.x} ${end.y}`,
        stroke: color,
        fill: 'none',
        'stroke-width': 14,
      }),
    );
  }

  for (let kp = 0; kp <= 9; kp += 1) {
    const { x, y } = point(kp, r + 16);
    svg.append(svgEl('text', { x, y, 'text-anchor': 'middle', 'font-size': 10, fill: '#cdd6e3' }, String(kp)));
  }

  const tip = point(Math.min(9, peakKp), r - 10);
  svg.append(
    svgEl('line', { x1: cx, y1: cy, x2: tip.x, y2: tip.y, stroke: '#e6e6e6', 'stroke-width': 2 }),
    svgEl('text', { x: cx, y: cy - 10, 'text-anchor': 'middle', 'font-size': 14, fill: '#e6e6e6' }, `Peak Kp ${peakKp}`),
  );
  return svg;
}

/** Predicted arrivals, the observed shock, storm onset and Kp readings on one UTC axis. */
export function arrivalTimeline(events: TimelineEvent[], availableWidth: number): SVGSVGElement {
  const times = events.map((event) => event.t.getTime());
  const minT = Math.min(...times) - 6 * HOUR_MS;
  const maxT = Math.max(...times) + 6 * HOUR_MS;

  const width = Math.max(320, Math.min(900, availableWidth));
  const height = 160;
  const pad = 34;
  const mid = height / 2;
  const x = (time: number) => pad + ((time - minT) / (maxT - minT)) * (width - pad * 2);

  const svg = svgEl('svg', { viewBox: `0 0 ${width} ${height}`, class: 'timeline-svg', role: 'img' });
  svg.setAttribute('aria-label', 'Timeline of predicted and observed CME arrival');
  svg.append(svgEl('line', { x1: pad, x2: width - pad, y1: mid, y2: mid, stroke: '#2a3a4e' }));

  // Keep roughly a dozen ticks however long the event window is.
  const tickMs = Math.max(6, Math.ceil((maxT - minT) / HOUR_MS / 12 / 6) * 6) * HOUR_MS;
  for (let time = minT; time <= maxT; time += tickMs) {
    const tx = x(time);
    svg.append(
      svgEl('line', { x1: tx, x2: tx, y1: mid - 4, y2: mid + 4, stroke: '#32465f' }),
      svgEl(
        'text',
        { x: tx + 2, y: mid - 8, fill: '#8ea2bb', 'font-size': 9 },
        new Date(time).toISOString().slice(5, 16).replace('T', ' '),
      ),
    );
  }

  const label = (lx: number, ly: number, text: string) =>
    svg.append(svgEl('text', { x: lx, y: ly, fill: '#cdd6e3', 'font-size': 10 }, text));

  for (const event of events) {
    const cx = x(event.t.getTime());
    switch (event.kind) {
      case 'pred': {
        const y = mid - 16;
        svg.append(svgEl('polygon', { points: `${cx},${y} ${cx - 6},${y + 10} ${cx + 6},${y + 10}`, fill: '#5ac8fa' }));
        label(cx + 8, y + 10, `${event.label}${event.kp ? ` · Kp90:${event.kp}` : ''}`);
        break;
      }
      case 'ips':
        svg.append(svgEl('circle', { cx, cy: mid, r: 5, fill: '#ffd166' }));
        label(cx + 8, mid - 6, 'Observed shock');
        break;
      case 'gst':
        svg.append(svgEl('rect', { x: cx - 6, y: mid + 10, width: 12, height: 8, fill: '#ef476f' }));
        label(cx + 8, mid + 18, 'GST start');
        break;
      case 'kp':
        svg.append(svgEl('circle', { cx, cy: mid + 40 - Math.min(9, event.kp) * 3, r: 2.5, fill: '#c0cbdc' }));
        break;
    }
  }
  return svg;
}

/** Plate carrée strip shading the latitudes where aurora may be visible at the given Kp. */
export function auroraBands(peakKp: number): SVGSVGElement {
  const width = 480;
  const height = 240;
  const bandHeight = ((90 - auroraLatitude(peakKp)) / 180) * height;
  const svg = svgEl('svg', { viewBox: `0 0 ${width} ${height}`, class: 'aurora-svg', role: 'img' });
  svg.setAttribute('aria-label', 'Latitude bands where aurora may be visible');

  for (const y of [0, height - bandHeight]) {
    svg.append(svgEl('rect', { x: 0, y, width, height: bandHeight, fill: '#7fbf7f22', stroke: '#7fbf7f66' }));
  }
  for (let lat = -60; lat <= 60; lat += 30) {
    const y = ((90 - lat) / 180) * height;
    svg.append(
      svgEl('line', { x1: 0, x2: width, y1: y, y2: y, stroke: '#2a3a4e' }),
      svgEl('text', { x: 4, y: y - 2, fill: '#8ea2bb', 'font-size': 10 }, `${lat}°`),
    );
  }
  return svg;
}
