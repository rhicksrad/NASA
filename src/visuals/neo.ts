import type { NeoBrowse } from '../types/nasa';

export function renderNeoSummary(summaryEl: HTMLElement, listEl: HTMLElement, data: NeoBrowse): void {
  const total = data.page?.total_elements ?? 0;
  summaryEl.textContent = `Sample size: ${data.page?.size ?? 0} • Total known (reported): ${total}`;
  listEl.replaceChildren();

  const first = data.near_earth_objects?.[0];
  if (first) {
    const li = document.createElement('li');
    li.textContent = `First sample object: ${first.name}`;
    listEl.appendChild(li);
  } else {
    const li = document.createElement('li');
    li.textContent = 'No objects returned in this sample.';
    listEl.appendChild(li);
  }
}
