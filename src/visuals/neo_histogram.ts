import * as d3 from 'd3';
import type { NeoFlat } from '../utils/neo';

export function renderNeoHistogram(host: HTMLElement, data: NeoFlat[]) {
  host.replaceChildren();
  const w = host.clientWidth || 480;
  const h = host.clientHeight || 260;
  const m = { t: 16, r: 16, b: 28, l: 38 };
  const svg = d3.select(host).append('svg').attr('width', w).attr('height', h);
  const g = svg.append('g').attr('transform', `translate(${m.l},${m.t})`);
  const innerW = w - m.l - m.r;
  const innerH = h - m.t - m.b;

  const vals = data.map(d => d.dia_km_max ?? 0).filter(v => v > 0);
  if (!vals.length) {
    return;
  }

  const x = d3.scaleLinear().domain([0, d3.max(vals)!]).nice().range([0, innerW]);
  const bins = d3.bin().domain(x.domain() as [number, number]).thresholds(20)(vals);
  const y = d3.scaleLinear().domain([0, d3.max(bins, b => b.length)!]).nice().range([innerH, 0]);

  g.append('g').attr('transform', `translate(0,${innerH})`).call(d3.axisBottom(x).ticks(6));
  g.append('g').call(d3.axisLeft(y));

  g
    .selectAll('rect')
    .data(bins)
    .enter()
    .append('rect')
    .attr('x', b => x(b.x0!))
    .attr('y', b => y(b.length))
    .attr('width', b => Math.max(0, x(b.x1!) - x(b.x0!) - 1))
    .attr('height', b => innerH - y(b.length))
    .attr('fill', '#0b3d91')
    .attr('fill-opacity', 0.7);
}
