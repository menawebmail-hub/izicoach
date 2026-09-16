-- ============================================================================
-- coach_data sync — Phase 1 (additive, non-breaking)
--
-- Adds server-side compare-and-set support for coach_data so the frontend can
-- stop losing edits to a debounced, unprotected client-side upsert (reload /
-- tab-switch / offline race — investigated and designed this session; plan
-- lives in the assistant's plan file for this project, not yet committed
-- anywhere in the repo).
--
-- This migration is purely additive:
--   1. new columns (revision, last_mutation_token) with safe defaults, and a
--      backfill so existing rows read as "revision 1" (real content), not
--      "never written" (revision 0);
--   2. a BEFORE INSERT OR UPDATE trigger that maintains revision/updated_at
--      for EVERY writer, old or new — so a not-yet-migrated frontend, or the
--      existing update_my_student_profile RPC, keeps producing a coherent
--      revision sequence with zero code changes on their side;
--   3. a new RPC, coach_data_compare_and_set(text,bigint,jsonb,uuid), granted
--      to `authenticated`, alongside (not instead of) the direct writes the
--      current frontend still does.
--
-- Deliberately NOT included here: revoking the direct INSERT/UPDATE grants on
-- coach_data for `authenticated`. That is a separate, later migration
-- (rollout stage 4), applied only once the new frontend is confirmed to be
-- the only writer in practice. Until then, this migration changes nothing
-- observable for the app as it runs today.
--
-- ----------------------------------------------------------------------------
-- REMOTE SCHEMA VERIFIED — audited directly against izicoach Project
-- (eerocqdoawrciatvqnof) via read-only SQL Editor queries before writing this
-- version of the migration. No longer assumptions.
-- ----------------------------------------------------------------------------
--   - coach_data columns: coach_id uuid, data_key text, data_value jsonb,
--     updated_at timestamptz. PK confirmed as exactly
--     PRIMARY KEY (coach_id, data_key) — the ON CONFLICT (coach_id, data_key)
--     clause below matches it exactly, by column set (Postgres doesn't care
--     about the order listed).
--   - coach_data.coach_id has an FK to coaches.id.
--   - No triggers currently exist on coach_data — coach_data_bump_revision_trg
--     below is the first, nothing to collide with.
--   - RLS is enabled on coach_data and NOT forced (relforcerowsecurity=false),
--     i.e. the table owner (postgres) already bypasses it — consistent with
--     coach_data_compare_and_set being SECURITY DEFINER, owned by postgres.
--   - coaches.id is itself PK and has a direct FK to auth.users(id) — so
--     `exists (select 1 from public.coaches where id = auth.uid())` in the
--     RPC's guard is confirmed correct, not inferred from usage elsewhere.
--   - The live coach_has_access(uuid) matches the versioned migration
--     (20260907150000_account_access_control_phase_a.sql) byte-for-byte in
--     the definition pulled back — no drift to account for.
--   - Effective grants today on coach_data: `authenticated` has
--     SELECT/INSERT/UPDATE, no DELETE; `anon` has nothing; `service_role` has
--     everything. This is exactly what stage 1 (this migration) preserves —
--     it adds the new RPC/trigger without touching any of these table-level
--     grants; the direct INSERT/UPDATE `authenticated` already has is what
--     lets today's frontend keep working unmodified through this migration.
--   - update_my_student_profile does a direct `UPDATE ... SET data_value =
--     ...` on the `students` row of coach_data without ever mentioning
--     last_mutation_token — confirms the trigger's "wipe the token when the
--     writer didn't explicitly change it" branch is not a hypothetical edge
--     case, it's exactly what this existing RPC does on every call.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. Columns + backfill (runs BEFORE the trigger exists below, on purpose —
--    the backfill must not be intercepted by coach_data_bump_revision).
-- ----------------------------------------------------------------------------
alter table public.coach_data
  add column if not exists revision bigint not null default 0,
  add column if not exists last_mutation_token uuid;

update public.coach_data set revision = 1 where revision = 0;

comment on column public.coach_data.revision is
  'Monotonic version counter for this (coach_id,data_key) row. Maintained exclusively by coach_data_bump_revision() — no writer, RPC included, sets this directly.';
comment on column public.coach_data.last_mutation_token is
  'Client-generated UUID of the mutation that produced the current data_value, when the writer explicitly carried it forward. NULL whenever it did not (see coach_data_bump_revision) — a NULL token can never satisfy an idempotent-retry match, by design.';


-- ----------------------------------------------------------------------------
-- 2. Trigger: revision/updated_at are always server-maintained, for every
--    writer (old direct upsert, update_my_student_profile, or the new RPC).
--
--    Deliberately NOT SECURITY DEFINER: it only reads/writes NEW/OLD for the
--    row already being written by the calling statement, needs no elevated
--    lookup of its own, and runs with whatever privilege that statement
--    already has. Adding SECURITY DEFINER here would be privilege escalation
--    with no corresponding need.
-- ----------------------------------------------------------------------------
create or replace function public.coach_data_bump_revision()
returns trigger
language plpgsql
set search_path to ''
as $function$
begin
  if tg_op = 'INSERT' then
    new.revision := 1;
  else
    new.revision := coalesce(old.revision, 0) + 1;
    -- A writer that doesn't know about last_mutation_token (old frontend,
    -- update_my_student_profile) leaves NEW.last_mutation_token identical to
    -- OLD's simply by never mentioning the column in its UPDATE. Left alone,
    -- that stale token could later satisfy an unrelated retry's
    -- already_applied check even though this write actually replaced the
    -- content it was supposed to be confirming. Wipe it whenever the writer
    -- didn't explicitly change it.
    if new.last_mutation_token is not distinct from old.last_mutation_token then
      new.last_mutation_token := null;
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$function$;

alter function public.coach_data_bump_revision() owner to postgres;
revoke all on function public.coach_data_bump_revision() from public, anon, authenticated;

drop trigger if exists coach_data_bump_revision_trg on public.coach_data;
create trigger coach_data_bump_revision_trg
before insert or update on public.coach_data
for each row execute function public.coach_data_bump_revision();


-- ----------------------------------------------------------------------------
-- 3. RPC: atomic compare-and-set.
--
--    Contract (see plan for full rationale):
--      - "confirmed"        — written; caller's payload is now the row.
--      - "already_applied"  — this exact mutation_token was already the last
--                              one recorded; idempotent retry, nothing re-sent.
--      - "conflict"         — caller's expected_revision no longer matches;
--                              returns the real current revision/data_value
--                              so the caller can show/resolve the conflict
--                              without a second round trip.
--
--    Identity guard is three-layered, not just "auth.uid() is not null" —
--    a student is also an authenticated identity and must never pass:
--      1. auth.uid() resolves to something at all;
--      2. that id has a row in public.coaches (it IS a coach, not e.g. a
--         student_auth identity);
--      3. coach_has_access(that id) — not blocked/deactivated
--         (Account Access Control Phase C.1).
-- ----------------------------------------------------------------------------
create or replace function public.coach_data_compare_and_set(
  p_data_key text,
  p_expected_revision bigint,
  p_new_value jsonb,
  p_mutation_token uuid
) returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_coach_id uuid := auth.uid();
  v_current record;
  v_new_revision bigint;
  v_new_updated_at timestamptz;
begin
  if v_coach_id is null then
    raise exception 'coach_data_compare_and_set: no autenticado'
      using errcode = 'P0001';
  end if;

  if not exists (select 1 from public.coaches where id = v_coach_id) then
    raise exception 'coach_data_compare_and_set: identidad % no es un coach', v_coach_id
      using errcode = 'P0001';
  end if;

  if not public.coach_has_access(v_coach_id) then
    raise exception 'coach_data_compare_and_set: acceso de coach bloqueado'
      using errcode = 'P0001';
  end if;

  if p_data_key is null
     or p_data_key not in ('students','classes','expenses','courts','packages','families') then
    raise exception 'coach_data_compare_and_set: data_key inválido: %', p_data_key
      using errcode = '22023';
  end if;

  if p_new_value is null or jsonb_typeof(p_new_value) <> 'array' then
    raise exception 'coach_data_compare_and_set: p_new_value debe ser un array JSON'
      using errcode = '22023';
  end if;

  if p_mutation_token is null then
    raise exception 'coach_data_compare_and_set: p_mutation_token es obligatorio'
      using errcode = '22023';
  end if;

  if p_expected_revision is null or p_expected_revision < 0 then
    raise exception 'coach_data_compare_and_set: p_expected_revision inválido: %', p_expected_revision
      using errcode = '22023';
  end if;

  -- First-write race: two concurrent calls can both believe there's no row
  -- yet (p_expected_revision = 0). SELECT ... FOR UPDATE cannot lock the
  -- absence of a row, so this resolves the race with an atomic
  -- INSERT ... ON CONFLICT DO NOTHING instead of a plain SELECT-then-INSERT.
  if p_expected_revision = 0 then
    insert into public.coach_data (coach_id, data_key, data_value, last_mutation_token)
    values (v_coach_id, p_data_key, p_new_value, p_mutation_token)
    on conflict (coach_id, data_key) do nothing
    returning revision, updated_at into v_new_revision, v_new_updated_at;

    if found then
      return jsonb_build_object(
        'status', 'confirmed',
        'revision', v_new_revision,
        'updated_at', v_new_updated_at
      );
    end if;
    -- else: another concurrent call won the race and created the row a
    -- moment earlier. Fall through — the SELECT below will now find it, and
    -- this call's expected_revision=0 will correctly mismatch it.
  end if;

  select revision, last_mutation_token, data_value, updated_at
    into v_current
    from public.coach_data
    where coach_id = v_coach_id and data_key = p_data_key
    for update;

  if not found then
    -- p_expected_revision was not 0 but no row actually exists.
    return jsonb_build_object(
      'status', 'conflict',
      'revision', 0,
      'updated_at', null,
      'data_value', null,
      'last_mutation_token', null
    );
  end if;

  if v_current.last_mutation_token = p_mutation_token then
    -- Idempotent retry: this exact mutation already landed — the client
    -- never saw the earlier response (e.g. connection dropped right after
    -- the server committed it). Do not write again.
    return jsonb_build_object(
      'status', 'already_applied',
      'revision', v_current.revision,
      'updated_at', v_current.updated_at
    );
  end if;

  if v_current.revision <> p_expected_revision then
    return jsonb_build_object(
      'status', 'conflict',
      'revision', v_current.revision,
      'updated_at', v_current.updated_at,
      'data_value', v_current.data_value,
      'last_mutation_token', v_current.last_mutation_token
    );
  end if;

  update public.coach_data
     set data_value = p_new_value,
         last_mutation_token = p_mutation_token
   where coach_id = v_coach_id and data_key = p_data_key
  returning revision, updated_at into v_new_revision, v_new_updated_at;

  return jsonb_build_object(
    'status', 'confirmed',
    'revision', v_new_revision,
    'updated_at', v_new_updated_at
  );
end;
$function$;

alter function public.coach_data_compare_and_set(text, bigint, jsonb, uuid) owner to postgres;

revoke all on function public.coach_data_compare_and_set(text, bigint, jsonb, uuid) from public, anon;
grant execute on function public.coach_data_compare_and_set(text, bigint, jsonb, uuid) to authenticated, postgres, service_role;


-- ----------------------------------------------------------------------------
-- 4. Deliberately NOT done here (rollout stage 4 — separate migration, later,
--    only once the new frontend is confirmed to be the only writer):
--
--   revoke insert, update, delete on public.coach_data from public, anon, authenticated;
--
-- Direct INSERT/UPDATE grants on coach_data for `authenticated` stay exactly
-- as they are today, so the current frontend (not yet changed to call this
-- RPC) keeps working unmodified through this migration.
-- ----------------------------------------------------------------------------
