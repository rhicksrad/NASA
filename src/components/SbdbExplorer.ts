import {
  normalizeRow,
  resolveMany,
  sbdbLookup,
  type SbdbRow,
  type SbdbSuggestResult,
} from '../api/sbdb';
import collections from '../assets/sbdb/collections.json';
import { SbdbTypeahead } from './SbdbTypeahead';

type SortKey = 'diam' | 'H';

const FALLBACK_NOTICE = 'SBDB multi-match suggestions unavailable; showing exact matches only.';

export class SbdbExplorer {
  private input!: HTMLInputElement;

  private table!: HTMLTableElement;

  private notice!: HTMLDivElement;

  private rows: SbdbRow[] = [];

  private sortKey: SortKey = 'diam';

  private multiMatchFallback = false;

  private pinnedNotice: string | null = null;

  constructor(private readonly root: HTMLElement) {
    this.renderShell();
    this.mountTypeahead();
    this.renderCollections();
  }

  private renderShell() {
    this.root.innerHTML = `
      <div class="sbdb-explorer">
        <div class="sbdb-toolbar">
          <label>Search SBDB:</label>
          <input id="sbdb-q" placeholder="e.g. 433 Eros, 101955 Bennu, 1P/Halley" />
          <button id="sbdb-add-exact">Add</button>
          <span class="sbdb-hint">Examples: 433 Eros • 101955 Bennu • 99942 Apophis • C/2025 N1 (ATLAS)</span>
        </div>
        <div class="sbdb-controls">
          <button data-sort="diam" class="on">Sort by Diameter</button>
          <button data-sort="H">Sort by H (brightest first)</button>
        </div>
        <div class="sbdb-collections"></div>
        <div class="sbdb-notice" role="status" aria-live="polite"></div>
        <table class="sbdb-table">
          <thead><tr>
            <th>Name</th><th>Type</th><th>H</th><th>Est. D (km)</th><th>e</th><th>i (deg)</th><th>q (au)</th><th></th>
          </tr></thead>
          <tbody></tbody>
        </table>
      </div>
    `;
    this.input = this.root.querySelector('#sbdb-q') as HTMLInputElement;
    this.table = this.root.querySelector('.sbdb-table') as HTMLTableElement;
    this.notice = this.root.querySelector('.sbdb-notice') as HTMLDivElement;

    const addExact = this.root.querySelector('#sbdb-add-exact') as HTMLButtonElement | null;
    addExact?.addEventListener('click', () => {
      const q = this.input.value.trim();
      if (q) {
        void this.lookupAndShow(q);
      }
    });

    this.root.querySelectorAll<HTMLButtonElement>('.sbdb-controls [data-sort]').forEach((btn) => {
      btn.addEventListener('click', () => this.setSort(btn.dataset.sort as SortKey));
    });

    this.renderRows();
    this.refreshNotice();
  }

  private mountTypeahead() {
    new SbdbTypeahead(
      this.input,
      (pick) => {
        this.input.value = pick;
        void this.lookupAndShow(pick);
      },
      (result: SbdbSuggestResult) => {
        this.multiMatchFallback = result.fallback;
        this.refreshNotice();
      },
    );
  }

  private setSort(k: SortKey) {
    if (this.sortKey === k) return;
    this.sortKey = k;
    this.root
      .querySelectorAll<HTMLButtonElement>('.sbdb-controls button')
      .forEach((button) => button.classList.toggle('on', (button.dataset.sort as SortKey) === k));
    this.renderRows();
  }

  private setNotice(message: string | null) {
    this.pinnedNotice = message;
    this.refreshNotice();
  }

  private refreshNotice() {
    if (!this.notice) return;
    if (this.pinnedNotice) {
      this.notice.textContent = this.multiMatchFallback
        ? `${this.pinnedNotice} — ${FALLBACK_NOTICE}`
        : this.pinnedNotice;
      return;
    }
    if (this.multiMatchFallback) {
      this.notice.textContent = FALLBACK_NOTICE;
    } else {
      this.notice.textContent = '';
    }
  }

  private async lookupAndShow(s: string) {
    const query = s.trim();
    if (!query) return;
    this.setNotice('Loading…');
    try {
      const data = await sbdbLookup(query, { fullname: true });
      const row = normalizeRow(data, query);
      this.rows = [row];
      this.renderRows();
      this.setNotice(null);
    } catch (error) {
      const message = error instanceof Error && error.message ? error.message : 'lookup failed';
      this.rows = [];
      this.renderRows();
      this.setNotice(`No result for "${query}" (${message})`);
    }
  }

  private renderCollections() {
    const wrap = this.root.querySelector('.sbdb-collections');
    if (!wrap) return;
    wrap.innerHTML = '';
    Object.entries(collections).forEach(([title, ids]) => {
      const btn = document.createElement('button');
      btn.textContent = `View: ${title}`;
      btn.addEventListener('click', async () => {
        this.setNotice(`Loading ${title}…`);
        this.rows = await resolveMany(ids as string[]);
        this.renderRows();
        const count = this.rows.length;
        const suffix = count === 1 ? 'object' : 'objects';
        this.setNotice(`${count} ${suffix} from "${title}"`);
      });
      wrap.appendChild(btn);
    });
  }

  private renderRows() {
    const body = this.table.querySelector('tbody');
    if (!body) return;
    body.innerHTML = '';

    const rows = [...this.rows];
    if (this.sortKey === 'diam') {
      rows.sort((a, b) => (b.estDiameterKm ?? -Infinity) - (a.estDiameterKm ?? -Infinity));
    } else {
      rows.sort((a, b) => (a.H ?? Infinity) - (b.H ?? Infinity));
    }

    if (!rows.length) {
      const emptyRow = document.createElement('tr');
      const emptyCell = document.createElement('td');
      emptyCell.colSpan = 8;
      emptyCell.className = 'empty';
      emptyCell.textContent = 'No SBDB objects yet.';
      emptyRow.appendChild(emptyCell);
      body.appendChild(emptyRow);
      return;
    }

    for (const row of rows) {
      const tr = document.createElement('tr');
      tr.appendChild(this.makeCell(row.name));
      tr.appendChild(this.makeCell(row.type));
      tr.appendChild(this.makeCell(this.formatNumber(row.H, 2)));
      tr.appendChild(this.makeCell(this.formatNumber(row.estDiameterKm, 2)));
      tr.appendChild(this.makeCell(this.formatNumber(row.e, 4)));
      tr.appendChild(this.makeCell(this.formatNumber(row.i, 2)));
      tr.appendChild(this.makeCell(this.formatNumber(row.q, 4)));
      const actionCell = document.createElement('td');
      const button = document.createElement('button');
      button.className = 'add';
      button.textContent = 'Add';
      button.addEventListener('click', () => {
        window.dispatchEvent(new CustomEvent('neo3d:add-sbdb', { detail: row.name }));
      });
      actionCell.appendChild(button);
      tr.appendChild(actionCell);
      body.appendChild(tr);
    }
  }

  private makeCell(text: string) {
    const td = document.createElement('td');
    td.textContent = text;
    return td;
  }

  private formatNumber(value: number | undefined, digits: number) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return '—';
    }
    return value.toFixed(digits);
  }
}
