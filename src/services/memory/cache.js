/**
 * @returns {{ get: (key: string) => unknown, set: (key: string, value: unknown) => void, delete: (key: string) => boolean, clear: () => void }}
 */
export function createMemoryCache() {
  const store = new Map();

  return {
    get(key) {
      return store.get(key);
    },
    set(key, value) {
      store.set(key, value);
    },
    delete(key) {
      return store.delete(key);
    },
    clear() {
      store.clear();
    },
  };
}
