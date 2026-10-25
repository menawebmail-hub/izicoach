/*
 * Device-local keys (localStorage) and their cleanup rules — pure, no Supabase, no React.
 * BUG-ISO-01 / BUG-ISO-02.
 *
 * Preserved by the session cleanup (logout, signup, portal error screens), because each
 * one may hold data that exists nowhere else:
 *   - izi_outbox:*        durable per-coach writes not yet confirmed by Supabase;
 *   - izi_chat_groups:*   Chat groups, one key per coach (device-local only);
 *   - izi_groups          legacy shared Chat groups not yet adopted by a coach;
 *   - the six legacy business caches below: no longer written or read, but an old app version
 *     may have left unsynced changes in them. They are removed only by an explicit,
 *     authorized call to clearLegacyBusinessCaches() — never automatically.
 */

export const OUTBOX_PREFIX = "izi_outbox";
export const CHAT_GROUPS_PREFIX = "izi_chat_groups:";
export const LEGACY_GROUPS_KEY = "izi_groups";
export const LEGACY_BUSINESS_CACHE_KEYS = Object.freeze([
  "izi_students",
  "izi_classes",
  "izi_courts",
  "izi_packages",
  "izi_families",
  "izi_expenses",
]);

/** Whether the session cleanup must keep this key. */
export function isPreservedLocalKey(key) {
  return (
    typeof key === "string" &&
    (key.startsWith(`${OUTBOX_PREFIX}:`) ||
      key.startsWith(CHAT_GROUPS_PREFIX) ||
      key === LEGACY_GROUPS_KEY ||
      LEGACY_BUSINESS_CACHE_KEYS.includes(key))
  );
}

/** All keys of a Storage-like object (getItem/key/length). */
function storageKeys(storage) {
  const keys = [];
  for (let i = 0; i < storage.length; i++) {
    const k = storage.key(i);
    if (k != null) keys.push(k);
  }
  return keys;
}

/** Session cleanup: removes every "izi_" key except the preserved ones. Returns the removed keys. */
export function clearLocalStateExceptPreserved(storage) {
  const removed = storageKeys(storage).filter((k) => k.startsWith("izi_") && !isPreservedLocalKey(k));
  removed.forEach((k) => storage.removeItem(k));
  return removed;
}

/**
 * Removes EXACTLY the six legacy business caches — never by prefix, never an outbox entry or a
 * Chat group. Not called by the app yet: it needs the owner's authorization (old unsynced changes).
 * Returns the keys that existed and were removed.
 */
export function clearLegacyBusinessCaches(storage) {
  const removed = [];
  for (const k of LEGACY_BUSINESS_CACHE_KEYS) {
    if (storage.getItem(k) !== null) {
      storage.removeItem(k);
      removed.push(k);
    }
  }
  return removed;
}
