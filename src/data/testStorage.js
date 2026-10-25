// In-memory Storage (getItem/setItem/removeItem/key/length) for tests. Not used by the app.
export function createTestStorage(initial = {}, { failWritesFor = null } = {}) {
  const map = new Map(Object.entries(initial));
  return {
    get length() { return map.size; },
    key(i) { return [...map.keys()][i] ?? null; },
    getItem(k) { return map.has(k) ? map.get(k) : null; },
    setItem(k, v) {
      if (failWritesFor && failWritesFor(k)) throw new Error("QuotaExceededError");
      map.set(k, String(v));
    },
    removeItem(k) { map.delete(k); },
    dump() { return Object.fromEntries(map); },
  };
}
