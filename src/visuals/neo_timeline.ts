import * as d3 from 'd3';
import type { NeoFlat } from '../utils/neo';

export function renderNeoTimeline(host: HTMLElement, data: NeoFlat[]) {
  host.replaceChildren();
  const w = host.clientWidth || 640;
  const h = host.clientHeight || 260;
  const m = { t: 16, r: 16, b: 28, l: 42 };
  const svg = d3.select(host).append('svg').attr('width', w).attr('height', h);
  const g = svg.append('g').attr('transform', `translate(${m.l},${m.t})`);
  const innerW = w - m.l - m.r;
  const innerH = h - m.t - m.b;

  const parse = d3.utcParse('%Y-%m-%d');
  const xDomain = d3.extent(data, d => parse(d.date)!) as [Date, Date] | [undefined, undefined];
  if (!xDomain[0] || !xDomain[1]) {
    return;
  }
  const x = d3.scaleUtc().domain([xDomain[0], xDomain[1]]).range([0, innerW]);

  const miss = data.map(d => d.miss_ld ?? NaN).filter(v => !Number.isNaN(v));
  const missExtentRaw = miss.length ? d3.extent(miss) : undefined;
  const missExtent: [number, number] = missExtentRaw && missExtentRaw[0] != null && missExtentRaw[1] != null
    ? [missExtentRaw[0], missExtentRaw[1] === missExtentRaw[0] ? missExtentRaw[1] + 1 : missExtentRaw[1]]
    : [0, 1];
  const y = d3.scaleLinear().domain(missExtent).nice().range([innerH, 0]);

  const color = (d: NeoFlat) => (d.is_hazardous ? '#b00020' : '#0b3d91');
  const diaValues = data.map(d => d.dia_km_max ?? 0);
  const diaExtentRaw = d3.extent(diaValues);
  const sizeDomain: [number, number] = diaExtentRaw && diaExtentRaw[0] != null && diaExtentRaw[1] != null
    ? [diaExtentRaw[0], diaExtentRaw[1] === diaExtentRaw[0] ? diaExtentRaw[1] + 1 : diaExtentRaw[1]]
    : [0, 1];
  const size = d3.scaleSqrt().domain(sizeDomain).range([2, 10]);

  g.append('g').attr('transform', `translate(0,${innerH})`).call(d3.axisBottom(x).ticks(6));
  g.append('g').call(d3.axisLeft(y));

  const pts = g.append('g').attr('aria-hidden', 'true');
  pts
    .selectAll('circle')
    .data(data)
    .enter()
    .append('circle')
    .attr('cx', d => x(parse(d.date)!))
    .attr('cy', d => y(d.miss_ld ?? y.domain()[1]))
    .attr('r', d => size(d.dia_km_max ?? 0))
    .attr('fill', d => color(d))
    .attr('fill-opacity', 0.6);
}
