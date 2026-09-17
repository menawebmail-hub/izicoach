import { supabase } from "../services/supabaseClient.js";

// ============================================================================
// coach_data sync — Phase 2 (frontend): atomic compare-and-set + durable
// per-tab outbox, replacing the old debounced fire-and-forget upsert.
//
// Scope: exclusively the six coach-owned data_keys backed by
// coach_data_compare_and_set (students/classes/expenses/courts/packages/
// families). Coach profile (`coaches` table, saveCoachProfile) and messages
// are untouched — different tables, different RPCs, not part of this outbox.
//
// Every durable write against coach_data for these six keys goes through
// coach_data_compare_and_set from here on. Nothing in this file issues a
// direct .upsert()/.update() against coach_data anymore.
// ============================================================================

export const DATA_KEYS = ["students", "classes", "expenses", "courts", "packages", "families"];

const OUTBOX_PREFIX = "izi_outbox";
const CLIENT_INSTANCE_STORAGE_KEY = "izi_client_instance_id";
const FLUSH_TIMEOUT_MS = 4000;
const DEBOUNCE_MS = 500;
const RETRY_BACKOFF_SCHEDULE_MS = [2000, 5000, 15000];

// ----------------------------------------------------------------------------
// clientInstanceId — one per browser tab. sessionStorage (not localStorage)
// so a new tab always gets its own id, while reloading the same tab (F5)
// keeps it. crypto.randomUUID() per the design; sessionStorage access is
// wrapped in try/catch (private browsing, storage disabled) with an
// in-memory fallback that at least survives for this page's lifetime.
// ----------------------------------------------------------------------------
let _memoryClientInstanceId = null;
export function getClientInstanceId() {
  try {
    let id = sessionStorage.getItem(CLIENT_INSTANCE_STORAGE_KEY);
    if (!id) {
      id = crypto.randomUUID();
      sessionStorage.setItem(CLIENT_INSTANCE_STORAGE_KEY, id);
    }
    return id;
  } catch {
    if (!_memoryClientInstanceId) _memoryClientInstanceId = crypto.randomUUID();
    return _memoryClientInstanceId;
  }
}

// ----------------------------------------------------------------------------
// In-memory module state. Deliberately NOT React state — this module has no
// React dependency, same as before (Fase B). Keyed by `${coachId}:${dataKey}`
// unless noted otherwise.
// ----------------------------------------------------------------------------
const _lastKnownRevision = {}; // scopedKey -> number (never null once known)
const _volatileUnsafe = {}; // scopedKey -> true while an unsent edit could not be persisted durably
const _retryAttempts = {}; // scopedKey -> count, reset on confirmed/already_applied
const _retryTimers = {}; // scopedKey -> timeout id
const _pendingResolvers = {}; // `${scopedKey}:${mutationToken}` -> resolve fn[] (one per coalesced caller promise)
const _debounceTimers = {}; // scopedKey -> timeout id (delays the SEND only — section 14; the entry itself is durable from the first edit)
const _inMemoryLocks = {}; // lockName -> chained promise (no-Web-Locks fallback, own tab only)
const _reconcileInFlight = {}; // coachId -> promise (single-flight)
const _generation = {}; // coachId -> number, bumped by cancelPendingSync to invalidate stale work
const _activeSendTokens = {}; // scopedKey -> mutationToken this OWN instance is genuinely awaiting an RPC response for right now (verification finding: repairOutboxStructure must not treat this as orphaned)

function scopedKeyOf(coachId, dataKey) {
  return `${coachId}:${dataKey}`;
}

function rawSetterName(dataKey) {
  return "set" + dataKey[0].toUpperCase() + dataKey.slice(1) + "Raw";
}

// ----------------------------------------------------------------------------
// Durable outbox slots — localStorage, two per (coachId,dataKey,clientInstanceId):
// `izi_outbox:<coachId>:<dataKey>:<clientInstanceId>:inFlight`
// `izi_outbox:<coachId>:<dataKey>:<clientInstanceId>:pendingLatest`
// Every read/write wrapped in try/catch — a storage failure never throws.
// ----------------------------------------------------------------------------
function outboxKey(coachId, dataKey, clientInstanceId, slot) {
  return `${OUTBOX_PREFIX}:${coachId}:${dataKey}:${clientInstanceId}:${slot}`;
}

// ----------------------------------------------------------------------------
// Local session cleanup (logout, signup, portal error screens) must never
// drop a durable outbox entry — localStorage is shared per-origin, so a
// blanket localStorage.clear() in one tab (coach or student) can destroy
// unsent writes for a *different* coach's tab still open in the same
// browser. Single source of truth for "clear my local izi_ state but leave
// every izi_outbox:* slot alone" — every call site that used to clear
// localStorage wholesale must route through this instead.
// ----------------------------------------------------------------------------
export function clearLocalStateExceptOutbox() {
  try {
    Object.keys(localStorage)
      .filter((k) => k.startsWith("izi_") && !k.startsWith(`${OUTBOX_PREFIX}:`))
      .forEach((k) => localStorage.removeItem(k));
  } catch (thrown) {
    console.error("clearLocalStateExceptOutbox: localStorage cleanup failed (non-fatal):", thrown);
  }
}

function isValidSlotShape(parsed, slot) {
  if (!parsed || typeof parsed !== "object") return false;
  if (typeof parsed.mutationToken !== "string" || !parsed.mutationToken) return false;
  if (typeof parsed.baseRevision !== "number" || parsed.baseRevision < 0) return false;
  if (!Array.isArray(parsed.payload)) return false;
  if (typeof parsed.createdAt !== "number") return false;
  if (slot === "inFlight") {
    if (!["pending", "in-flight", "conflict"].includes(parsed.status)) return false;
    if (parsed.status === "conflict") {
      if (!parsed.conflict || typeof parsed.conflict !== "object") return false;
    }
  } else if (slot === "pendingLatest") {
    if (typeof parsed.parentMutationToken !== "string" || !parsed.parentMutationToken) return false;
  }
  return true;
}

// Returns {ok:true, value: parsed|null} for a readable slot (null = empty),
// or {ok:false, corrupt:true} for a present-but-invalid entry. Never throws,
// never logs the entry's content (may hold business data).
function readOutboxSlot(coachId, dataKey, clientInstanceId, slot) {
  const k = outboxKey(coachId, dataKey, clientInstanceId, slot);
  try {
    const raw = localStorage.getItem(k);
    if (raw == null) return { ok: true, value: null };
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { ok: false, corrupt: true };
    }
    if (!isValidSlotShape(parsed, slot)) return { ok: false, corrupt: true };
    return { ok: true, value: parsed };
  } catch {
    // localStorage itself unavailable (private mode, disabled) — treat as
    // unreadable, not corrupt: nothing was actually written wrong, we just
    // can't confirm. Caller decides; we don't quarantine on this branch.
    return { ok: true, value: null, unavailable: true };
  }
}

// Returns true on success, false if the durable write failed (caller must
// react per design section 8 — volatile-unsafe banner).
function writeOutboxSlot(coachId, dataKey, clientInstanceId, slot, value) {
  const k = outboxKey(coachId, dataKey, clientInstanceId, slot);
  try {
    if (value == null) localStorage.removeItem(k);
    else localStorage.setItem(k, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

// Scans localStorage for every clientInstanceId that has an outbox entry for
// this coach (optionally scoped to one dataKey). localStorage is shared
// across tabs of the same origin, so this is how a tab discovers outboxes
// left behind by other tabs — never by reading their sessionStorage (not
// visible cross-tab, and its absence proves nothing about liveness).
function discoverOutboxInstanceIds(coachId, onlyDataKey) {
  const ids = new Set();
  try {
    const prefix = `${OUTBOX_PREFIX}:${coachId}:`;
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith(prefix)) continue;
      const rest = k.slice(prefix.length); // `${dataKey}:${instanceId}:${slot}`
      const parts = rest.split(":");
      if (parts.length !== 3) continue;
      const [dataKey, instanceId, slot] = parts;
      if (onlyDataKey && dataKey !== onlyDataKey) continue;
      if (!DATA_KEYS.includes(dataKey)) continue;
      if (slot !== "inFlight" && slot !== "pendingLatest") continue;
      ids.add(instanceId);
    }
  } catch {
    // localStorage enumeration unavailable — fall back to just our own id,
    // handled by callers (they always add getClientInstanceId() themselves).
  }
  return Array.from(ids);
}

function notifyStatusChange(coachId, dataKey) {
  try {
    document.dispatchEvent(new CustomEvent("izi-outbox-status", { detail: { coachId, dataKey } }));
  } catch {
    // no DOM (SSR/tests) — nothing to notify.
  }
}

function markVolatileUnsafe(coachId, dataKey) {
  _volatileUnsafe[scopedKeyOf(coachId, dataKey)] = true;
  notifyStatusChange(coachId, dataKey);
}
function clearVolatileUnsafe(coachId, dataKey) {
  if (_volatileUnsafe[scopedKeyOf(coachId, dataKey)]) {
    delete _volatileUnsafe[scopedKeyOf(coachId, dataKey)];
    notifyStatusChange(coachId, dataKey);
  }
}

function resolvePendingPromise(coachId, dataKey, mutationToken, outcome) {
  const k = `${scopedKeyOf(coachId, dataKey)}:${mutationToken}`;
  const resolvers = _pendingResolvers[k];
  if (resolvers) {
    delete _pendingResolvers[k];
    resolvers.forEach((resolve) => resolve(outcome));
  }
}

// ----------------------------------------------------------------------------
// Web Locks — serializes processing per (coachId,dataKey,clientInstanceId).
// Our own outbox: always acquire (waits if needed). A foreign tab's outbox:
// ifAvailable:true — adopt it only if that tab isn't already processing it
// itself; never wait, never assume it's orphaned just because we can't see
// its sessionStorage. Without navigator.locks at all: only ever touch our
// own clientInstanceId, serialized in-process only (no cross-tab adoption).
// ----------------------------------------------------------------------------
function runExclusiveInMemory(name, fn) {
  const prev = _inMemoryLocks[name] || Promise.resolve();
  const next = prev.then(fn, fn).catch(() => undefined);
  _inMemoryLocks[name] = next;
  return next;
}

function withOutboxLock(coachId, dataKey, clientInstanceId, fn) {
  const ownId = getClientInstanceId();
  const lockName = `izi_outbox_lock:${coachId}:${dataKey}:${clientInstanceId}`;
  const hasLocks = typeof navigator !== "undefined" && navigator.locks && typeof navigator.locks.request === "function";
  if (!hasLocks) {
    if (clientInstanceId !== ownId) return Promise.resolve(undefined);
    return runExclusiveInMemory(lockName, fn);
  }
  const isOwn = clientInstanceId === ownId;
  return navigator.locks
    .request(lockName, { ifAvailable: !isOwn }, async (lock) => {
      if (!isOwn && !lock) return undefined; // foreign lock busy — leave that entry alone
      return fn();
    })
    .catch(() => undefined); // Web Locks itself failing must never surface as an uncaught rejection
}

// ----------------------------------------------------------------------------
// RPC call
// ----------------------------------------------------------------------------
async function callCompareAndSet(dataKey, entry) {
  try {
    const { data, error } = await supabase.rpc("coach_data_compare_and_set", {
      p_data_key: dataKey,
      p_expected_revision: entry.baseRevision,
      p_new_value: entry.payload,
      p_mutation_token: entry.mutationToken,
    });
    if (error) return { failed: true, error };
    return { failed: false, result: data };
  } catch (e) {
    return { failed: true, error: e };
  }
}

function scheduleRetryWithBackoff(coachId, dataKey, clientInstanceId) {
  const scopedKey = scopedKeyOf(coachId, dataKey);
  const attempt = (_retryAttempts[scopedKey] || 0) + 1;
  _retryAttempts[scopedKey] = attempt;
  const delay = RETRY_BACKOFF_SCHEDULE_MS[Math.min(attempt - 1, RETRY_BACKOFF_SCHEDULE_MS.length - 1)];
  if (_retryTimers[scopedKey]) clearTimeout(_retryTimers[scopedKey]);
  _retryTimers[scopedKey] = setTimeout(() => {
    delete _retryTimers[scopedKey];
    processOutboxSlot(coachId, dataKey, clientInstanceId).catch(() => {});
  }, delay);
}

// Crash-safe promotion of pendingLatest into inFlight, in the exact order
// required so a crash at any point leaves the outbox recoverable:
//   1. rewrite pendingLatest rebased onto the new revision
//   2. copy it into inFlight
//   3. delete pendingLatest
//   4. (caller sends it — that's the next loop iteration in processOutboxSlot)
function promotePendingLatestIfAny(coachId, dataKey, clientInstanceId, newRevision) {
  const pl = readOutboxSlot(coachId, dataKey, clientInstanceId, "pendingLatest");
  if (!pl.ok) return { promoted: false, quarantined: true };
  if (!pl.value) return { promoted: false };
  const rebased = { ...pl.value, baseRevision: newRevision };
  if (!writeOutboxSlot(coachId, dataKey, clientInstanceId, "pendingLatest", rebased)) {
    markVolatileUnsafe(coachId, dataKey);
  }
  const promotedEntry = {
    mutationToken: rebased.mutationToken,
    baseRevision: rebased.baseRevision,
    payload: rebased.payload,
    status: "pending",
    createdAt: rebased.createdAt,
  };
  if (!writeOutboxSlot(coachId, dataKey, clientInstanceId, "inFlight", promotedEntry)) {
    markVolatileUnsafe(coachId, dataKey);
  }
  writeOutboxSlot(coachId, dataKey, clientInstanceId, "pendingLatest", null);
  return { promoted: true };
}

// Processes whatever currently sits in inFlight for one
// (coachId,dataKey,clientInstanceId), sending it via the RPC, handling the
// outcome, then promoting pendingLatest (if any) and looping. Never throws —
// every branch resolves or schedules a retry. Returns a status string purely
// for callers that want it (flushPending); nothing depends on the return
// value being read.
async function processOutboxSlotInner(coachId, dataKey, clientInstanceId) {
  // No AbortController exists here (deliberate — see module history): a
  // request already sent cannot be recalled if cancelPendingSync runs while
  // it's in flight. What CAN and must be prevented is this function reacting
  // to that stale response by triggering a *new* RPC call (promoted
  // pendingLatest, or a scheduled retry) — the RPC resolves its target row
  // from the session's auth.uid(), not from this coachId, so a late send
  // under an already-switched identity could write into the wrong coach's
  // row. Bookkeeping scoped to THIS coachId's own maps/localStorage keys
  // (resolving promises, updating _lastKnownRevision) stays unguarded below —
  // it can only ever touch this coachId's own entries.
  const myGeneration = _generation[coachId] || 0;
  const identityStillActive = () => (_generation[coachId] || 0) === myGeneration;
  for (;;) {
    const inFlightRes = readOutboxSlot(coachId, dataKey, clientInstanceId, "inFlight");
    if (!inFlightRes.ok) {
      notifyStatusChange(coachId, dataKey); // corrupt — surfaced by getSyncStatus, nothing to send
      return "quarantined";
    }
    const entry = inFlightRes.value;
    if (!entry) return "noop";
    if (entry.status === "conflict") return "conflict"; // waits for explicit user resolution, never auto-retried

    entry.status = "in-flight";
    // Marks the point of no return for in-place coalescing (section 14): once
    // a mutationToken has actually gone out over the wire, a later local edit
    // must never mutate its payload — even if this attempt fails and the
    // status reverts to "pending" for retry below, `attempted` stays true.
    entry.attempted = true;
    if (!writeOutboxSlot(coachId, dataKey, clientInstanceId, "inFlight", entry)) {
      markVolatileUnsafe(coachId, dataKey);
    }

    // Verification finding: repairOutboxStructure (called at the start of
    // every reconcile, not just after a real crash/reload) used to
    // unconditionally reset any on-disk "in-flight" entry back to "pending",
    // even one this exact JS instance is genuinely awaiting a real RPC
    // response for right now — reproduced with a real UI edit + a real
    // tab-visibility reconcile while the request was deliberately held open.
    // Record the token here so repairOutboxStructure can tell "orphaned by a
    // crash" from "actively in flight in this instance" apart, instead of
    // relying solely on Web Locks serialization to paper over the resulting
    // status inaccuracy.
    const activeSendKey = `${scopedKeyOf(coachId, dataKey)}:${clientInstanceId}`;
    _activeSendTokens[activeSendKey] = entry.mutationToken;
    let outcome;
    try {
      outcome = await callCompareAndSet(dataKey, entry);
    } finally {
      // callCompareAndSet never actually throws today (it has its own
      // try/catch), but this registry exists specifically to stop
      // repairOutboxStructure from treating a genuinely active send as orphaned — an
      // unexpected exception must not leave a token marked active forever
      // (that would permanently block crash-recovery for this key in this
      // instance, exactly the failure mode this registry was added to fix).
      if (_activeSendTokens[activeSendKey] === entry.mutationToken) delete _activeSendTokens[activeSendKey];
    }

    if (outcome.failed) {
      const reread = readOutboxSlot(coachId, dataKey, clientInstanceId, "inFlight");
      if (reread.ok && reread.value && reread.value.mutationToken === entry.mutationToken) {
        reread.value.status = "pending";
        writeOutboxSlot(coachId, dataKey, clientInstanceId, "inFlight", reread.value);
      }
      resolvePendingPromise(coachId, dataKey, entry.mutationToken, { status: "retrying" });
      if (!identityStillActive()) {
        // Identity changed while this send was in flight — the entry is
        // already durably "pending" above; do not arm a new retry timer for
        // a coachId cancelPendingSync already ran for (and can never run for
        // again to clean this one up). A later reconcile for this coach
        // (this tab or another) will resend it correctly.
        notifyStatusChange(coachId, dataKey);
        return "superseded";
      }
      scheduleRetryWithBackoff(coachId, dataKey, clientInstanceId);
      return "retrying";
    }

    const result = outcome.result || {};

    if (result.status === "confirmed" || result.status === "already_applied") {
      _lastKnownRevision[scopedKeyOf(coachId, dataKey)] = result.revision;
      _retryAttempts[scopedKeyOf(coachId, dataKey)] = 0;
      clearVolatileUnsafe(coachId, dataKey);
      resolvePendingPromise(coachId, dataKey, entry.mutationToken, result);
      if (!identityStillActive()) {
        // Same guard as above: confirming and resolving locally is safe
        // (scoped to this coachId), but do not auto-promote+resend a
        // pendingLatest under a session no longer authenticated as this
        // coach. Leave pendingLatest untouched for a later reconcile.
        writeOutboxSlot(coachId, dataKey, clientInstanceId, "inFlight", null);
        notifyStatusChange(coachId, dataKey);
        return "superseded";
      }
      const { promoted, quarantined } = promotePendingLatestIfAny(coachId, dataKey, clientInstanceId, result.revision);
      if (quarantined) {
        notifyStatusChange(coachId, dataKey);
        return "quarantined";
      }
      if (!promoted) {
        writeOutboxSlot(coachId, dataKey, clientInstanceId, "inFlight", null);
        notifyStatusChange(coachId, dataKey);
        return "confirmed";
      }
      continue; // send the just-promoted entry too
    }

    if (result.status === "conflict") {
      entry.status = "conflict";
      entry.conflict = {
        revision: result.revision,
        updatedAt: result.updated_at,
        dataValue: result.data_value,
        lastMutationToken: result.last_mutation_token,
      };
      if (!writeOutboxSlot(coachId, dataKey, clientInstanceId, "inFlight", entry)) {
        markVolatileUnsafe(coachId, dataKey);
      }
      clearVolatileUnsafe(coachId, dataKey); // the edit did reach the server-side check; no longer at risk of silent loss
      resolvePendingPromise(coachId, dataKey, entry.mutationToken, result);
      notifyStatusChange(coachId, dataKey);
      return "conflict";
    }

    // Unrecognized status shape — never assume success; retry conservatively.
    const reread = readOutboxSlot(coachId, dataKey, clientInstanceId, "inFlight");
    if (reread.ok && reread.value && reread.value.mutationToken === entry.mutationToken) {
      reread.value.status = "pending";
      writeOutboxSlot(coachId, dataKey, clientInstanceId, "inFlight", reread.value);
    }
    if (!identityStillActive()) {
      notifyStatusChange(coachId, dataKey);
      return "superseded";
    }
    scheduleRetryWithBackoff(coachId, dataKey, clientInstanceId);
    return "retrying";
  }
}

function processOutboxSlot(coachId, dataKey, clientInstanceId) {
  return withOutboxLock(coachId, dataKey, clientInstanceId, () => processOutboxSlotInner(coachId, dataKey, clientInstanceId));
}

// Sends one entry immediately from memory, bypassing the disk entirely —
// used only when the durable write itself failed (section 9), so there is
// nothing on disk for the normal debounce->processOutboxSlot path to find.
// Never throws; retries the same in-memory entry on failure since it has no
// other copy to fall back on. `resolvers` are the caller promise(s) to settle.
async function sendVolatileEntryNow(coachId, dataKey, clientInstanceId, entry, resolvers) {
  const scopedKey = scopedKeyOf(coachId, dataKey);
  entry.status = "in-flight";
  entry.attempted = true;
  const activeSendKey = `${scopedKey}:${clientInstanceId}`;
  _activeSendTokens[activeSendKey] = entry.mutationToken;
  let outcome;
  try {
    outcome = await callCompareAndSet(dataKey, entry);
  } finally {
    if (_activeSendTokens[activeSendKey] === entry.mutationToken) delete _activeSendTokens[activeSendKey];
  }

  if (outcome.failed) {
    entry.status = "pending"; // still nothing to persist; keep retrying from memory
    setTimeout(() => {
      sendVolatileEntryNow(coachId, dataKey, clientInstanceId, entry, resolvers).catch(() => {});
    }, 2000);
    return;
  }

  const result = outcome.result || {};

  if (result.status === "confirmed" || result.status === "already_applied") {
    _lastKnownRevision[scopedKey] = result.revision;
    clearVolatileUnsafe(coachId, dataKey);
    resolvers.forEach((r) => r(result));
    // Best-effort only: storage may still be broken, but if it has recovered
    // this clears any stale slot instead of leaving a confirmed mutation's
    // leftovers on disk. Failure here is harmless — the mutation is already
    // confirmed server-side regardless of whether this write lands.
    writeOutboxSlot(coachId, dataKey, clientInstanceId, "inFlight", null);
    notifyStatusChange(coachId, dataKey);
    return;
  }

  if (result.status === "conflict") {
    entry.status = "conflict";
    entry.conflict = {
      revision: result.revision,
      updatedAt: result.updated_at,
      dataValue: result.data_value,
      lastMutationToken: result.last_mutation_token,
    };
    // The edit did reach the server-side check, so it is no longer at risk
    // of silent loss even if this durable write also fails — but if it
    // fails, the conflict banner cannot durably remember itself, which is
    // an honest state, not a bug: keep warning instead of pretending it's safe.
    if (writeOutboxSlot(coachId, dataKey, clientInstanceId, "inFlight", entry)) {
      clearVolatileUnsafe(coachId, dataKey);
    }
    resolvers.forEach((r) => r(result));
    notifyStatusChange(coachId, dataKey);
    return;
  }

  // Unrecognized status shape — never assume success; retry conservatively.
  entry.status = "pending";
  setTimeout(() => {
    sendVolatileEntryNow(coachId, dataKey, clientInstanceId, entry, resolvers).catch(() => {});
  }, 2000);
}

// ----------------------------------------------------------------------------
// enqueue — the sole write entry point for the six setters.
//
// Section 14: the debounce only ever delays the RPC *send* — the durable
// write to localStorage happens synchronously here, before this function
// returns, every time. An F5 a millisecond later always finds it on disk.
//
// "Debounceable" (safe to mutate the existing inFlight entry's payload in
// place, keeping the same mutationToken) means status:"pending" AND
// !attempted — i.e. this exact mutationToken has never actually gone out
// over the wire. The instant a send is attempted, processOutboxSlotInner
// sets attempted:true and it stays true even if the attempt fails and status
// reverts to "pending" for retry — from that point on, a further local edit
// must go through pendingLatest instead of mutating the sent token, or an
// "already_applied" reply for the OLD payload could be mistaken for
// confirmation of the NEW one.
// ----------------------------------------------------------------------------
export function enqueueCoachDataWrite(coachId, dataKey, payload) {
  if (!coachId || !DATA_KEYS.includes(dataKey) || !Array.isArray(payload)) {
    return Promise.resolve({ status: "skipped-invalid-args" });
  }
  const clientInstanceId = getClientInstanceId();
  const scopedKey = scopedKeyOf(coachId, dataKey);

  const inFlightRes = readOutboxSlot(coachId, dataKey, clientInstanceId, "inFlight");
  if (!inFlightRes.ok) {
    // Corrupt inFlight — do not blindly overwrite; quarantine UI is the only
    // way out (explicit discard).
    notifyStatusChange(coachId, dataKey);
    return Promise.resolve({ status: "blocked-quarantined" });
  }

  const baseRevision = _lastKnownRevision[scopedKey];
  if (baseRevision == null) {
    // Never write with an unknown revision — reconcileCoachData populates
    // this for all six keys before dataReady gates the UI, so in practice
    // this only guards a genuine logic error, not a real timing window.
    console.warn("enqueueCoachDataWrite: no known baseRevision yet for", dataKey, "- write dropped");
    return Promise.resolve({ status: "skipped-no-revision" });
  }

  const existing = inFlightRes.value;

  if (!existing) {
    // Verification finding: an absent inFlight does not necessarily mean "no
    // work pending" — a pendingLatest can survive here with no inFlight
    // sibling (recoverOrphanedPendingLatest's own comment explains how: a
    // confirm landing under an identity that changed mid-flight clears
    // inFlight but deliberately leaves a pendingLatest queued behind it
    // untouched). That pendingLatest's parentMutationToken has not been
    // checked against the remote yet — treating this slot as a clean slate
    // and writing straight to inFlight would silently replace it with a new
    // mutation that never gets that check, the exact loss this guard exists
    // to prevent. Coalesce into pendingLatest instead, keeping its ORIGINAL
    // parentMutationToken (only the payload/mutationToken are the newest
    // intent) — recoverOrphanedPendingLatest/reconcile still owns validating
    // it before anything here is ever allowed to become inFlight.
    const plRes = readOutboxSlot(coachId, dataKey, clientInstanceId, "pendingLatest");
    if (plRes.ok && plRes.value) {
      return coalesceIntoPendingLatest(coachId, dataKey, clientInstanceId, scopedKey, baseRevision, payload, plRes.value.parentMutationToken);
    }
  }

  const debounceable = !existing || (existing.status === "pending" && !existing.attempted);

  if (debounceable) {
    const mutationToken = existing ? existing.mutationToken : crypto.randomUUID();
    const entry = {
      mutationToken,
      baseRevision,
      payload,
      status: "pending",
      attempted: false,
      createdAt: existing ? existing.createdAt : Date.now(),
    };
    // Durable BEFORE the timer starts — this is the fix: the intention is on
    // disk the instant this call returns, never only in _debounceTimers/memory.
    const wroteDurably = writeOutboxSlot(coachId, dataKey, clientInstanceId, "inFlight", entry);
    if (!wroteDurably) {
      // Verification finding (Prueba 9): if we fall through to the normal
      // debounce timer here, it fires 500ms from now and calls
      // processOutboxSlot, which reads this exact slot back from disk to
      // find what to send — but nothing was ever written, so it finds an
      // empty slot, returns "noop", and never calls the RPC at all. The
      // edit is silently lost forever and the caller's promise never
      // resolves, despite the volatile-unsafe banner correctly firing.
      // Section 9 requires the opposite: send immediately, no debounce,
      // precisely because there is no durable copy to fall back on.
      markVolatileUnsafe(coachId, dataKey);
      return new Promise((resolve) => {
        sendVolatileEntryNow(coachId, dataKey, clientInstanceId, entry, [resolve]).catch(() => {});
      });
    }
    return new Promise((resolve) => {
      const k = `${scopedKey}:${mutationToken}`;
      if (!_pendingResolvers[k]) _pendingResolvers[k] = [];
      _pendingResolvers[k].push(resolve);

      // Only the send is delayed/reset here — a second edit within the
      // window re-enters this same branch (still debounceable) and extends it.
      if (_debounceTimers[scopedKey]) clearTimeout(_debounceTimers[scopedKey]);
      _debounceTimers[scopedKey] = setTimeout(() => {
        delete _debounceTimers[scopedKey];
        processOutboxSlot(coachId, dataKey, clientInstanceId).catch(() => {});
      }, DEBOUNCE_MS);
    });
  }

  // Something has already gone out over the wire for this key (in-flight,
  // conflict, or pending-after-a-failed-attempt awaiting retry) — never
  // mutate it. This edit becomes the (possibly replaced) pendingLatest,
  // immediately, no debounce.
  return coalesceIntoPendingLatest(coachId, dataKey, clientInstanceId, scopedKey, baseRevision, payload, existing.mutationToken);
}

// Writes payload into pendingLatest for (coachId,dataKey,clientInstanceId),
// with whatever parentMutationToken the caller supplies — the mutation this
// coalesced intent still needs validated against the remote (by
// recoverOrphanedPendingLatest, or promoted directly by processOutboxSlotInner
// once its parent actually confirms) before it can ever become inFlight.
// Shared by both callers in enqueueCoachDataWrite: the normal
// "something's already in flight" coalesce (parent = that inFlight's own
// token) and the orphaned-pendingLatest coalesce (parent = the ORIGINAL
// pendingLatest's own parentMutationToken, unchanged — only payload/token move).
function coalesceIntoPendingLatest(coachId, dataKey, clientInstanceId, scopedKey, baseRevision, payload, parentMutationToken) {
  const mutationToken = crypto.randomUUID();
  return new Promise((resolve) => {
    _pendingResolvers[`${scopedKey}:${mutationToken}`] = [resolve];
    const existingPL = readOutboxSlot(coachId, dataKey, clientInstanceId, "pendingLatest");
    if (existingPL.ok && existingPL.value) {
      resolvePendingPromise(coachId, dataKey, existingPL.value.mutationToken, { status: "superseded" });
    }
    const latestEntry = {
      mutationToken,
      parentMutationToken,
      baseRevision,
      payload,
      createdAt: Date.now(),
    };
    if (!writeOutboxSlot(coachId, dataKey, clientInstanceId, "pendingLatest", latestEntry)) {
      markVolatileUnsafe(coachId, dataKey);
    }
    notifyStatusChange(coachId, dataKey);
  });
}

// Verification finding: processOutboxSlotInner's "confirmed/already_applied
// under a since-changed identity" branch clears inFlight without touching a
// pendingLatest queued behind it (deliberately — see that branch's own
// comment, promoting/resending under a session no longer authenticated as
// this coach would be wrong). That leaves pendingLatest on disk with no
// inFlight sibling. Left unhandled, it is invisible to the rest of the
// module: enqueueCoachDataWrite's debounceable check only looks at inFlight
// (`!existing` is true), so the next local edit fabricates a brand new
// mutationToken and silently overwrites this slot; getSyncStatus never
// inspects pendingLatest's contents either, so reconcile's pendingOwn guard
// stays false and a remote read can clobber local state right over it. This
// is the only place pendingLatest.parentMutationToken is ever read — it is
// not bookkeeping, it is the sole guard against treating a queued edit whose
// assumed base was never confirmed as safe to auto-resend.
function recoverOrphanedPendingLatest(coachId, dataKey, instanceId, pendingLatest, remoteInfo) {
  const remoteLastToken = remoteInfo ? remoteInfo.lastMutationToken : null;
  if (remoteLastToken != null && remoteLastToken === pendingLatest.parentMutationToken) {
    // The remote row's last confirmed write is exactly the mutation this
    // pendingLatest was queued behind — safe to rebase onto the real current
    // revision and promote; the next flushPending pass sends it normally.
    promotePendingLatestIfAny(coachId, dataKey, instanceId, remoteInfo.revision);
    return;
  }
  // Mismatch (including remoteInfo missing/unreadable, or a remote row that
  // doesn't exist at all — fetchRemoteCoachData reports that as
  // revision:0/lastMutationToken:null, which can never equal a real
  // parentMutationToken since pendingLatest entries always carry a non-empty
  // one). Never auto-rebase or resend on a mismatch — surface it as a
  // conflict instead, exactly like a payload that WAS sent and got rejected,
  // so the existing banner/resolution path (already reads pendingLatest's
  // payload first, falling back to inFlight's) handles it unchanged.
  const conflictEntry = {
    mutationToken: pendingLatest.mutationToken,
    baseRevision: pendingLatest.baseRevision,
    payload: pendingLatest.payload,
    status: "conflict",
    attempted: true,
    createdAt: pendingLatest.createdAt,
    conflict: {
      revision: remoteInfo ? remoteInfo.revision : 0,
      updatedAt: remoteInfo ? remoteInfo.updatedAt : null,
      dataValue: remoteInfo ? remoteInfo.dataValue : null,
      lastMutationToken: remoteLastToken,
    },
  };
  if (!writeOutboxSlot(coachId, dataKey, instanceId, "inFlight", conflictEntry)) {
    // Could not durably record the conflict — leave pendingLatest as the
    // only copy rather than losing the local intent entirely.
    markVolatileUnsafe(coachId, dataKey);
    return;
  }
  writeOutboxSlot(coachId, dataKey, instanceId, "pendingLatest", null);
  // Matches processOutboxSlotInner's own conflict branch: whoever is still
  // awaiting enqueueCoachDataWrite's promise for this exact mutationToken
  // (superseded already-queued callers were resolved separately, by
  // coalesceIntoPendingLatest, when this pendingLatest was last written)
  // must not hang forever with nothing ever resolving it.
  resolvePendingPromise(coachId, dataKey, conflictEntry.mutationToken, {
    status: "conflict",
    revision: conflictEntry.conflict.revision,
    updated_at: conflictEntry.conflict.updatedAt,
    data_value: conflictEntry.conflict.dataValue,
    last_mutation_token: conflictEntry.conflict.lastMutationToken,
  });
  notifyStatusChange(coachId, dataKey);
}

// ----------------------------------------------------------------------------
// repairOutboxStructure — called at the start of every reconcile (mount,
// tab-visible, after a crash/F5). Purely local: finishes an interrupted
// promotion and re-arms any entry that was mid-flight when the page died (RPC
// idempotency via mutationToken makes a safe retry even if the original
// request actually landed). Deliberately does NOT resolve an orphaned
// pendingLatest itself — that needs a remote read, which this function must
// stay free of so callers can skip it entirely on the (overwhelmingly common)
// pass where no orphan exists. Returns the orphans found, if any, for the
// caller to resolve via resolveOrphanedPendingLatests.
// ----------------------------------------------------------------------------
function repairOutboxStructure(coachId) {
  const ownId = getClientInstanceId();
  const instanceIds = discoverOutboxInstanceIds(coachId);
  if (!instanceIds.includes(ownId)) instanceIds.push(ownId);
  const orphans = [];
  instanceIds.forEach((instanceId) => {
    DATA_KEYS.forEach((dataKey) => {
      const inFlightRes = readOutboxSlot(coachId, dataKey, instanceId, "inFlight");
      const plRes = readOutboxSlot(coachId, dataKey, instanceId, "pendingLatest");
      if (!inFlightRes.ok || !plRes.ok) {
        notifyStatusChange(coachId, dataKey);
        return;
      }
      if (inFlightRes.value && plRes.value && inFlightRes.value.mutationToken === plRes.value.mutationToken) {
        // Step 2 (copy to inFlight) landed but step 3 (delete pendingLatest)
        // was interrupted — finish it. Do NOT resend as a new mutation.
        writeOutboxSlot(coachId, dataKey, instanceId, "pendingLatest", null);
      } else if (!inFlightRes.value && plRes.value) {
        orphans.push({ dataKey, instanceId, pendingLatest: plRes.value });
      }
      const current = readOutboxSlot(coachId, dataKey, instanceId, "inFlight");
      if (current.ok && current.value && current.value.status === "in-flight") {
        // A real fetch for this exact mutationToken is awaiting its response
        // in this instance's own memory right now (see processOutboxSlotInner)
        // — not orphaned, leave it alone. Anything else genuinely is stale
        // (this instance's memory was wiped by a reload, or it belongs to a
        // different, possibly crashed, instanceId) and still gets reset so a
        // real post-crash recovery keeps working exactly as before.
        const activeSendKey = `${scopedKeyOf(coachId, dataKey)}:${instanceId}`;
        if (_activeSendTokens[activeSendKey] === current.value.mutationToken) return;
        current.value.status = "pending";
        writeOutboxSlot(coachId, dataKey, instanceId, "inFlight", current.value);
      }
    });
  });
  return orphans;
}

// Resolves every orphan repairOutboxStructure found, against ONE dedicated
// remote read scoped to this call only — never reused as reconcileCoachData's
// final snapshot (that would let a read taken before flushPending silently
// stand in for a fresh one after it). If the read itself fails, every orphan
// is left exactly as found: pendingLatest intact, nothing promoted, nothing
// sent — getSyncStatus's pendingOwn (see below) already keeps reconcile's
// final apply step from overwriting these keys regardless of this outcome.
async function resolveOrphanedPendingLatests(coachId, orphans) {
  if (orphans.length === 0) return { ok: true };
  const remote = await fetchRemoteCoachData(coachId);
  if (!remote.ok) {
    console.warn("resolveOrphanedPendingLatests: remote read failed — leaving orphaned pendingLatest(s) pending for a later reconcile:", remote.error);
    return { ok: false, error: remote.error };
  }
  orphans.forEach(({ dataKey, instanceId, pendingLatest }) => {
    recoverOrphanedPendingLatest(coachId, dataKey, instanceId, pendingLatest, remote.data[dataKey]);
  });
  return { ok: true };
}

const _FLUSH_TIMEOUT = Symbol("flush-timeout");
function withTimeout(promise, ms) {
  return Promise.race([
    promise.catch(() => "failed"),
    new Promise((resolve) => setTimeout(() => resolve(_FLUSH_TIMEOUT), ms)),
  ]);
}

// flushPending — attempts to send every pending outbox entry for this coach
// (own tab's clientInstanceId, plus any foreign one whose Web Lock is free),
// each bounded by FLUSH_TIMEOUT_MS so reconcile can never hang forever on a
// slow/dead connection. Returns, per dataKey, one of:
// confirmed | already_applied | conflict | failed | timeout | noop | quarantined
// (quarantined is additional to the spec's list — it must not be silently
// dropped when it happens). A key touched by more than one instanceId keeps
// the first non-"noop" result seen.
async function flushPending(coachId) {
  const ownId = getClientInstanceId();
  const instanceIds = discoverOutboxInstanceIds(coachId);
  if (!instanceIds.includes(ownId)) instanceIds.push(ownId);
  const results = {};
  await Promise.all(
    instanceIds.flatMap((instanceId) =>
      DATA_KEYS.map(async (dataKey) => {
        const raw = await withTimeout(processOutboxSlot(coachId, dataKey, instanceId), FLUSH_TIMEOUT_MS);
        const mapped = raw === _FLUSH_TIMEOUT ? "timeout" : raw === "retrying" ? "failed" : raw === undefined ? "noop" : raw;
        if (!(dataKey in results) || results[dataKey] === "noop") results[dataKey] = mapped;
      })
    )
  );
  DATA_KEYS.forEach((k) => {
    if (!(k in results)) results[k] = "noop";
  });
  return results;
}

// ----------------------------------------------------------------------------
// Status introspection — pure, synchronous, safe to call on every render or
// from a mount effect (design: "la UI debe leer el estado actual al montar").
// Never returns data_value content for a healthy entry beyond what the
// conflict banner needs (and even then, only to let the user discard it —
// never rendered as text).
// ----------------------------------------------------------------------------
export function getSyncStatus(coachId) {
  const status = {};
  if (!coachId) return status;
  const ownId = getClientInstanceId();
  DATA_KEYS.forEach((dataKey) => {
    const scopedKey = scopedKeyOf(coachId, dataKey);
    const instanceIds = discoverOutboxInstanceIds(coachId, dataKey);
    let conflict = null;
    let quarantined = false;
    let pendingOwn = false;
    instanceIds.forEach((instanceId) => {
      const inFlightRes = readOutboxSlot(coachId, dataKey, instanceId, "inFlight");
      const plRes = readOutboxSlot(coachId, dataKey, instanceId, "pendingLatest");
      if (!inFlightRes.ok || !plRes.ok) quarantined = true;
      if (inFlightRes.ok && inFlightRes.value && inFlightRes.value.status === "conflict") {
        conflict = { instanceId, revision: inFlightRes.value.conflict.revision, updatedAt: inFlightRes.value.conflict.updatedAt };
      }
      if (instanceId === ownId) {
        // Verification finding: an orphaned pendingLatest (inFlight absent,
        // pendingLatest present — see recoverOrphanedPendingLatest) is durable
        // local intent every bit as unsettled as a normal in-flight/pending
        // entry. This must hold even on the raw, not-yet-repaired disk state
        // (repairOutboxStructure/reconcile hasn't necessarily run yet) — it
        // is a pure read of whatever is on disk right now, not a derived/
        // repaired view.
        const inFlightPending = inFlightRes.ok && inFlightRes.value && inFlightRes.value.status !== "conflict";
        const pendingLatestPresent = plRes.ok && !!plRes.value;
        if (inFlightPending || pendingLatestPresent) pendingOwn = true;
      }
    });
    status[dataKey] = {
      conflict,
      quarantined,
      volatileUnsafe: !!_volatileUnsafe[scopedKey],
      pendingOwn,
    };
  });
  return status;
}

// ----------------------------------------------------------------------------
// fetchRemoteData — the read half of reconciliation. Selects revision fields
// for all six keys in one query; a key with no row gets revision 0 (row
// genuinely absent — never a stand-in for "unknown").
// ----------------------------------------------------------------------------
export async function fetchRemoteCoachData(coachId) {
  if (!coachId) return { ok: false, error: new Error("fetchRemoteCoachData: missing coachId") };
  try {
    const { data, error } = await supabase
      .from("coach_data")
      .select("data_key,data_value,revision,updated_at,last_mutation_token")
      .eq("coach_id", coachId)
      .in("data_key", DATA_KEYS);
    if (error) return { ok: false, error };
    const result = {};
    DATA_KEYS.forEach((k) => {
      result[k] = { exists: false, dataValue: null, revision: 0, updatedAt: null, lastMutationToken: null };
    });
    (data || []).forEach((r) => {
      result[r.data_key] = {
        exists: true,
        dataValue: r.data_value,
        revision: r.revision,
        updatedAt: r.updated_at,
        lastMutationToken: r.last_mutation_token,
      };
    });
    return { ok: true, data: result };
  } catch (e) {
    return { ok: false, error: e };
  }
}

// ----------------------------------------------------------------------------
// reconcileCoachData — the ONLY entry point mount/visibilitychange should
// call. Single-flight per coachId: a second concurrent call for the same
// coach reuses the in-flight promise instead of starting a parallel run.
// ----------------------------------------------------------------------------
export function reconcileCoachData(coachId, rawSetters, isStillActive) {
  if (!coachId) return Promise.resolve({ ok: false });
  if (_reconcileInFlight[coachId]) return _reconcileInFlight[coachId];

  const myGeneration = _generation[coachId] || 0;
  // Bug found in verification (pre-existing, not introduced by section 14's
  // fixes): comparing the raw `_generation[coachId]` (undefined before this
  // coachId's very first cancelPendingSync ever runs) against `myGeneration`
  // (normalized to 0 via `||`) made `undefined === 0` false on every coach's
  // FIRST reconcile of a session — reconcileCoachData always returned
  // {ok:false, superseded:true} immediately, before ever reading revisions.
  // Normalize both sides identically.
  const stillActive = () => (_generation[coachId] || 0) === myGeneration && (typeof isStillActive !== "function" || isStillActive());

  const run = (async () => {
    try {
      // 1. Local-only structural repair (interrupted promotions, stale
      // in-flight) — no remote read. Also collects any orphaned pendingLatest
      // (see repairOutboxStructure/recoverOrphanedPendingLatest).
      const orphans = repairOutboxStructure(coachId);

      // 2. Resolve orphans, if any, against their OWN dedicated remote read —
      // never the final snapshot taken in step 6. Verification finding: a
      // single fetch reused both to resolve orphans AND to apply to React
      // state opens a staleness window — if flushPending (step 3) takes a
      // while, another device's write to an unrelated key between this read
      // and that fetch would never be picked up until the NEXT reconcile,
      // since the stale pre-flush snapshot would stand in for a fresh one.
      // A failed read here is intentionally non-fatal to the rest of this
      // reconcile: it leaves those specific orphans pending (protected from
      // a clobbering remote apply by getSyncStatus's pendingOwn below) for a
      // later reconcile to retry, while every other key keeps flushing/
      // applying normally.
      if (orphans.length > 0) {
        const orphanResolution = await resolveOrphanedPendingLatests(coachId, orphans);
        if (!stillActive()) return { ok: false, superseded: true };
        void orphanResolution; // failure already logged inside; nothing else to do here
      }

      // 3. Send whatever is now sendable (freshly promoted orphans included).
      await flushPending(coachId);
      // 4. Identity guard.
      if (!stillActive()) return { ok: false, superseded: true };
      // 5. Generation snapshot for the final apply below (stillActive already
      // closes over myGeneration; re-checked once more after step 6's fetch).

      // 6. Fresh remote snapshot, taken only now — after flush completes —
      // so an external write made during a slow flush (ours or another
      // device's, to any key) is never missed by reusing a pre-flush read.
      const remote = await fetchRemoteCoachData(coachId);
      if (!stillActive()) return { ok: false, superseded: true };
      if (!remote.ok) return { ok: false, error: remote.error };

      // 7. Apply per key, every guard.
      const status = getSyncStatus(coachId);
      const appliedRevisions = {};

      DATA_KEYS.forEach((dataKey) => {
        const info = remote.data[dataKey];
        const scopedKey = scopedKeyOf(coachId, dataKey);
        const priorRevision = _lastKnownRevision[scopedKey];

        // Guard: remote revision must never move backwards from what we
        // already believed, per key, independently.
        if (priorRevision != null && info.revision < priorRevision) {
          appliedRevisions[dataKey] = priorRevision;
          return;
        }
        _lastKnownRevision[scopedKey] = info.revision;
        appliedRevisions[dataKey] = info.revision;

        const keyStatus = status[dataKey];
        if (keyStatus.conflict || keyStatus.quarantined || keyStatus.volatileUnsafe || keyStatus.pendingOwn) {
          // Local intent for this key hasn't fully settled yet — never let a
          // remote read clobber it.
          return;
        }
        const setter = rawSetters && rawSetters[rawSetterName(dataKey)];
        if (setter && info.exists) setter(info.dataValue || []);
        // !info.exists: row genuinely absent — leave local state as-is.
      });

      return { ok: true, revisions: appliedRevisions };
    } catch (e) {
      return { ok: false, error: e };
    } finally {
      delete _reconcileInFlight[coachId];
    }
  })();

  _reconcileInFlight[coachId] = run;
  return run;
}

// ----------------------------------------------------------------------------
// Conflict resolution — user-initiated only, never automatic.
// ----------------------------------------------------------------------------

// "Conservar mi cambio": re-send the most recent local intent (pendingLatest
// if one exists, otherwise the conflicted inFlight entry itself) rebased on
// the remote revision the conflict reported.
export function resolveConflictKeepMine(coachId, dataKey) {
  const clientInstanceId = getClientInstanceId();
  const inFlightRes = readOutboxSlot(coachId, dataKey, clientInstanceId, "inFlight");
  if (!inFlightRes.ok || !inFlightRes.value || inFlightRes.value.status !== "conflict") return false;

  const plRes = readOutboxSlot(coachId, dataKey, clientInstanceId, "pendingLatest");
  const intentPayload = plRes.ok && plRes.value ? plRes.value.payload : inFlightRes.value.payload;
  const conflict = inFlightRes.value.conflict;

  const newEntry = {
    mutationToken: crypto.randomUUID(),
    baseRevision: conflict.revision,
    payload: intentPayload,
    status: "pending",
    createdAt: Date.now(),
  };
  writeOutboxSlot(coachId, dataKey, clientInstanceId, "pendingLatest", null);
  if (!writeOutboxSlot(coachId, dataKey, clientInstanceId, "inFlight", newEntry)) {
    markVolatileUnsafe(coachId, dataKey);
  }
  notifyStatusChange(coachId, dataKey);
  processOutboxSlot(coachId, dataKey, clientInstanceId).catch(() => {});
  return true;
}

// "Descartar y usar la versión del servidor": clears local intent for this
// key and adopts the remote value the conflict already carried (no extra
// round trip needed — it's in the conflict payload).
export function resolveConflictDiscardMine(coachId, dataKey, rawSetters) {
  const clientInstanceId = getClientInstanceId();
  const inFlightRes = readOutboxSlot(coachId, dataKey, clientInstanceId, "inFlight");
  const conflict = inFlightRes.ok && inFlightRes.value ? inFlightRes.value.conflict : null;
  writeOutboxSlot(coachId, dataKey, clientInstanceId, "inFlight", null);
  writeOutboxSlot(coachId, dataKey, clientInstanceId, "pendingLatest", null);
  clearVolatileUnsafe(coachId, dataKey);
  if (conflict) {
    _lastKnownRevision[scopedKeyOf(coachId, dataKey)] = conflict.revision;
    const setter = rawSetters && rawSetters[rawSetterName(dataKey)];
    if (setter) setter(conflict.dataValue || []);
  }
  notifyStatusChange(coachId, dataKey);
  return true;
}

// Quarantine has only one exit: discard every slot we can find for this key
// (across every clientInstanceId, since we cannot trust a corrupt entry's
// origin) and re-fetch the true remote value.
export function discardQuarantined(coachId, dataKey, rawSetters, isStillActive) {
  const clientInstanceId = getClientInstanceId();
  const instanceIds = discoverOutboxInstanceIds(coachId, dataKey);
  if (!instanceIds.includes(clientInstanceId)) instanceIds.push(clientInstanceId);
  instanceIds.forEach((instanceId) => {
    writeOutboxSlot(coachId, dataKey, instanceId, "inFlight", null);
    writeOutboxSlot(coachId, dataKey, instanceId, "pendingLatest", null);
  });
  clearVolatileUnsafe(coachId, dataKey);
  notifyStatusChange(coachId, dataKey);
  return reconcileCoachData(coachId, rawSetters, isStillActive);
}

// ----------------------------------------------------------------------------
// cancelPendingSync — called the moment the active identity changes
// (including logout). Cancels in-memory timers/retries/single-flight
// invalidation for that coach; NEVER touches its durable outbox (a later
// reconcile — this tab or another — must still be able to recover/flush it),
// and never causes another coach's data to be processed.
// ----------------------------------------------------------------------------
export function cancelPendingSync(coachId) {
  if (!coachId) return;
  _generation[coachId] = (_generation[coachId] || 0) + 1;
  const prefix = coachId + ":";
  // A debounce timer left running would fire processOutboxSlot after this
  // identity is no longer current — the RPC resolves coach_id from the
  // *session's* auth.uid() server-side, not from anything this module passes,
  // so a straggling send after a coach switch could write under the NEW
  // identity's session with the OLD coach's payload. Must be cancelled here,
  // same as the retry timers below.
  Object.keys(_debounceTimers).forEach((k) => {
    if (k.startsWith(prefix)) {
      clearTimeout(_debounceTimers[k]);
      delete _debounceTimers[k];
    }
  });
  Object.keys(_retryTimers).forEach((k) => {
    if (k.startsWith(prefix)) {
      clearTimeout(_retryTimers[k]);
      delete _retryTimers[k];
    }
  });
  Object.keys(_retryAttempts).forEach((k) => {
    if (k.startsWith(prefix)) delete _retryAttempts[k];
  });
  Object.keys(_lastKnownRevision).forEach((k) => {
    if (k.startsWith(prefix)) delete _lastKnownRevision[k];
  });
  Object.keys(_volatileUnsafe).forEach((k) => {
    if (k.startsWith(prefix)) delete _volatileUnsafe[k];
  });
  // Anyone still awaiting enqueueCoachDataWrite's promise for this coach must
  // not hang forever — resolve explicitly instead of leaving it pending. The
  // durable outbox entry itself is left untouched (module contract, see
  // cancelPendingSync's header comment) — a later reconcile, this tab or
  // another, must still be able to recover/flush it.
  Object.keys(_pendingResolvers).forEach((k) => {
    if (k.startsWith(prefix)) {
      const resolvers = _pendingResolvers[k];
      delete _pendingResolvers[k];
      resolvers.forEach((resolve) => resolve({ status: "cancelled" }));
    }
  });
  delete _reconcileInFlight[coachId];
}

// ----------------------------------------------------------------------------
// Legacy helpers kept as-is — unrelated to the six-key CAS path.
// loadAllFromSupabase is still the read path for the student_portal branch
// (a student reads their own coach's data_value; students never write these
// keys, so no revision/outbox concern applies there).
// ----------------------------------------------------------------------------
export async function loadFromSupabase(coachId, key) {
  if (!coachId) return null;
  try {
    const { data } = await supabase
      .from("coach_data")
      .select("data_value")
      .eq("coach_id", coachId)
      .eq("data_key", key)
      .single();
    return data?.data_value || null;
  } catch (e) {
    return null;
  }
}

export async function loadAllFromSupabase(coachId) {
  if (!coachId) return { ok: false, error: new Error("loadAllFromSupabase: missing coachId") };
  try {
    const { data, error } = await supabase
      .from("coach_data")
      .select("data_key,data_value")
      .eq("coach_id", coachId);
    if (error) return { ok: false, error };
    const result = {};
    (data || []).forEach((r) => {
      result[r.data_key] = r.data_value;
    });
    return { ok: true, data: result };
  } catch (e) {
    return { ok: false, error: e };
  }
}
