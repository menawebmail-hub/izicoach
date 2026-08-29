import { supabase } from "../services/supabaseClient.js";

// --- SUPABASE SYNC HELPERS (moved out of App.jsx, Fase B) ---
// Low-level I/O against the `coach_data` table. No React, no localStorage, no
// business-logic decisions (e.g. what counts as "no data") — those stay with
// the caller (loadData, in App.jsx, until Fase E moves it into CoachDataProvider).

// Both maps are keyed by `${coachId}:${key}` (Fase E1) — previously keyed only
// by `key`, which meant a pending write from a coach who had already logged
// out (or switched to a different coach) shared its debounce slot with
// whoever was active now, with no way to tell them apart or cancel just one.
const _syncQueue = {};
const _syncPrevLen = {};

// Cancels every write still waiting on its debounce timer for one coach —
// called from App.jsx the moment the active identity changes (including
// logout), so a stale identity's pending writes never fire after it stopped
// being current. Does not touch a write already past this point (its request
// is already out, coach_id is correct, nothing to invalidate) — only work
// that hasn't started yet. Also drops that coach's _syncPrevLen entries so a
// later re-login by the same coach starts its shrink-detection fresh instead
// of comparing against a stale length from the previous session.
export function cancelPendingSync(coachId) {
  if (!coachId) return;
  const prefix = coachId + ":";
  Object.keys(_syncQueue).forEach((k) => {
    if (k.startsWith(prefix)) {
      clearTimeout(_syncQueue[k]);
      delete _syncQueue[k];
    }
  });
  Object.keys(_syncPrevLen).forEach((k) => {
    if (k.startsWith(prefix)) delete _syncPrevLen[k];
  });
}

// Fire-and-forget upsert of one data_key for a coach, debounced 500ms per
// coach+key (collapses rapid successive writes into one), with an immediate
// flush when the array shrinks (e.g. an item was deleted) so a delete never
// gets clobbered by a stale larger array still sitting in the debounce queue.
export function syncToSupabase(coachId, key, value) {
  if (!coachId || typeof coachId !== "string" || coachId.length < 10) return;
  const scopedKey = `${coachId}:${key}`;
  const doSync = async () => {
    // The timer (or immediate shrink-flush below) has fired — this is now an
    // in-flight request, not pending work, so cancelPendingSync no longer
    // needs to reach it. _syncQueue should only ever hold what hasn't run yet.
    delete _syncQueue[scopedKey];
    try {
      const {error} = await supabase.from("coach_data").upsert(
        {
          coach_id: coachId,
          data_key: key,
          data_value: value,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "coach_id,data_key" }
      );
      if (error) console.warn("Sync error:", key, error);
    } catch (e) {
      console.warn("Sync error:", key, e);
    }
  };
  const prevLen = _syncPrevLen[scopedKey] || 0;
  const curLen = Array.isArray(value) ? value.length : 0;
  _syncPrevLen[scopedKey] = curLen;
  if (curLen < prevLen && prevLen > 0) {
    if (_syncQueue[scopedKey]) clearTimeout(_syncQueue[scopedKey]);
    doSync();
    return;
  }
  if (_syncQueue[scopedKey]) clearTimeout(_syncQueue[scopedKey]);
  _syncQueue[scopedKey] = setTimeout(doSync, 500);
}

// Unused elsewhere in the app today (confirmed by grep during the original
// audit) — moved as-is for completeness, not wired into anything new.
// KNOWN ISSUE, not fixed here (audited for E2b): missing coachId, "no row for
// this key" (PGRST116), and a real Supabase/network error all return the
// same `null` — the `error` half of the destructure is discarded. Callers
// that need to tell those apart should use loadAllFromSupabase, whose
// {ok,data|error} contract already distinguishes them.
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

// Contract: {ok:true, data:{...}} for a real read — data may legitimately be an
// empty object, that's a valid "this coach has no data yet", not a failure.
// {ok:false, error} for anything that isn't a real read (Supabase-reported error
// OR a thrown exception, e.g. network down, OR a missing coachId) — callers must
// NEVER treat this the same as an empty dataset: no push local→remote, no
// marking data as loaded.
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
// --- END SYNC HELPERS ---
