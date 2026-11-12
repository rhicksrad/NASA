/**
 * A tiny key/value cache that survives reloads: IndexedDB when available,
 * localStorage otherwise. Every failure degrades to a cache miss.
 */
export interface PersistentCache {
  get(key: string): Promise<unknown | undefined>;
  set(key: string, value: unknown): Promise<void>;
}

export function createPersistentCache(dbName: string, storeName: string): PersistentCache {
  if (typeof window === 'undefined') {
    return { get: async () => undefined, set: async () => {} };
  }

  const fallback = createLocalStorageCache(`${dbName}:`);

  if (!('indexedDB' in window)) {
    return fallback;
  }

  let dbPromise: Promise<IDBDatabase | null> | null = null;
  const openDb = (): Promise<IDBDatabase | null> => {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve) => {
      try {
        const request = window.indexedDB.open(dbName, 1);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains(storeName)) {
            db.createObjectStore(storeName);
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
    return dbPromise;
  };

  return {
    async get(key) {
      const db = await openDb();
      if (!db) return fallback.get(key);
      return new Promise<unknown | undefined>((resolve) => {
        try {
          const tx = db.transaction(storeName, 'readonly');
          const store = tx.objectStore(storeName);
          const request = store.get(key);
          request.onsuccess = () => {
            resolve(request.result ?? undefined);
          };
          request.onerror = () => resolve(undefined);
          tx.onabort = () => resolve(undefined);
        } catch {
          resolve(undefined);
        }
      });
    },
    async set(key, value) {
      const db = await openDb();
      if (!db) {
        await fallback.set(key, value);
        return;
      }
      const ok = await new Promise<boolean>((resolve) => {
        try {
          const tx = db.transaction(storeName, 'readwrite');
          const store = tx.objectStore(storeName);
          let settled = false;
          const finish = (result: boolean) => {
            if (!settled) {
              settled = true;
              resolve(result);
            }
          };
          tx.oncomplete = () => finish(true);
          tx.onerror = () => finish(false);
          tx.onabort = () => finish(false);
          store.put(value, key);
        } catch {
          resolve(false);
        }
      });
      if (!ok) {
        await fallback.set(key, value);
      }
    },
  };
}

function createLocalStorageCache(prefix: string): PersistentCache {
  if (typeof window === 'undefined') {
    return { get: async () => undefined, set: async () => {} };
  }
  return {
    async get(key) {
      try {
        const storage = window.localStorage;
        const raw = storage.getItem(prefix + key);
        if (!raw) return undefined;
        const parsed = JSON.parse(raw) as { value?: unknown };
        return parsed.value;
      } catch {
        return undefined;
      }
    },
    async set(key, value) {
      try {
        const storage = window.localStorage;
        const payload = JSON.stringify({ value });
        storage.setItem(prefix + key, payload);
      } catch {
        // ignore
      }
    },
  };
}
