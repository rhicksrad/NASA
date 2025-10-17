export interface CacheStats {
  hits: number;
  misses: number;
  size: number;
}

class ImageCache {
  private map = new Map<string, { url: string; title: string; asset?: string }>();
  private hits = 0;
  private misses = 0;
  private readonly key = 'neo:imageCache:v1';
  private readonly max = 500; // cap entries

  constructor() {
    try {
      const raw = sessionStorage.getItem(this.key);
      if (raw) {
        const obj = JSON.parse(raw) as Record<string, { url: string; title: string; asset?: string }>;
        for (const [k, v] of Object.entries(obj)) this.map.set(k, v);
      }
    } catch (err) {
      void err; // ignore storage unavailability
    }
  }

  get(k: string) {
    const v = this.map.get(k);
    if (v) this.hits++;
    else this.misses++;
    return v || null;
  }

  set(k: string, url: string, title: string, asset?: string) {
    if (this.map.size >= this.max) {
      const first = this.map.keys().next().value;
      if (first) this.map.delete(first);
    }
    this.map.set(k, { url, title, asset });
    try {
      const obj: Record<string, { url: string; title: string; asset?: string }> = {};
      for (const [kk, vv] of this.map.entries()) obj[kk] = vv;
      sessionStorage.setItem(this.key, JSON.stringify(obj));
    } catch (err) {
      void err; // ignore quota errors
    }
  }

  stats(): CacheStats {
    return { hits: this.hits, misses: this.misses, size: this.map.size };
  }
}

export const imageCache = new ImageCache();
