import { sbdbSuggest, type SbdbSuggestResult } from '../api/sbdb';

type SuggestListener = (result: SbdbSuggestResult) => void;

export class SbdbTypeahead {
  private menu?: HTMLUListElement;

  private timer: number | undefined;

  constructor(
    private input: HTMLInputElement,
    private onPick: (name: string) => void,
    private onSuggest?: SuggestListener,
  ) {
    this.wire();
  }

  private wire() {
    this.input.autocomplete = 'off';
    this.input.addEventListener('input', () => {
      clearTimeout(this.timer);
      const q = this.input.value.trim();
      if (q.length < 2) {
        this.onSuggest?.({ items: [], fallback: false });
        this.hide();
        return;
      }
      this.timer = window.setTimeout(() => this.query(q), 180);
    });
    this.input.addEventListener('blur', () => setTimeout(() => this.hide(), 150));
  }

  private async query(q: string) {
    try {
      const result = await sbdbSuggest(q);
      this.onSuggest?.(result);
      if (!result.items.length) {
        this.hide();
        return;
      }
      this.show(result.items.slice(0, 10));
    } catch {
      this.onSuggest?.({ items: [], fallback: false });
      this.hide();
    }
  }

  private show(items: string[]) {
    this.hide();
    this.menu = document.createElement('ul');
    this.menu.className = 'sbdb-typeahead';
    for (const name of items) {
      const li = document.createElement('li');
      li.textContent = name;
      li.onclick = () => {
        this.onPick(name);
        this.hide();
      };
      this.menu.appendChild(li);
    }
    this.input.parentElement?.appendChild(this.menu);
  }

  private hide() {
    this.menu?.remove();
    this.menu = undefined;
  }
}
