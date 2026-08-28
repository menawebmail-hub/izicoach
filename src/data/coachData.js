import { supabase } from "../services/supabaseClient.js";

// --- SUPABASE SYNC HELPERS (moved out of App.jsx, Fase B) ---
// Low-level I/O against the `coach_data` table. No React, no localStorage, no
// business-logic decisions (e.g. what counts as "no data") — those stay with
// the caller (loadData, in App.jsx, until Fase E moves it into CoachDataProvider).

// PENDING DEBT (Fase D/E): both maps below are keyed only by `key` (e.g.
// "students"), not by coachId — a leftover from when this only ever ran for
// one active coach per browser tab. Harmless today under that assumption, but
// it must be revisited (namespaced by coachId, or replaced entirely) together
// with the rest of the auto-sync mechanism when Fase E redesigns writes as an
// explicit, coachId-required API instead of a setter side effect.
const _syncQueue = {};
const _syncPrevLen = {};

// Fire-and-forget upsert of one data_key for a coach, debounced 500ms per key
// (collapses rapid successive writes into one), with an immediate flush when
// the array shrinks (e.g. an item was deleted) so a delete never gets clobbered
// by a stale larger array still sitting in the debounce queue. Unchanged from
// the original App.jsx implementation, except: the upsert's own {error} (a
// real Supabase-reported failure returned on a resolved response, not thrown)
// used to be silently discarded — it's now logged the same way a thrown
// exception already was. Still fire-and-forget: no Promise returned, no
// contract change, debounce/_syncQueue/_syncPrevLen untouched.
export function syncToSupabase(coachId, key, value) {
  if (!coachId || typeof coachId !== "string" || coachId.length < 10) return;
  const doSync = async () => {
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
  const prevLen = _syncPrevLen[key] || 0;
  const curLen = Array.isArray(value) ? value.length : 0;
  _syncPrevLen[key] = curLen;
  if (curLen < prevLen && prevLen > 0) {
    if (_syncQueue[key]) clearTimeout(_syncQueue[key]);
    doSync();
    return;
  }
  if (_syncQueue[key]) clearTimeout(_syncQueue[key]);
  _syncQueue[key] = setTimeout(doSync, 500);
}

// Unused elsewhere in the app today (confirmed by grep during the original
// audit) — moved as-is for completeness, not wired into anything new.
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
