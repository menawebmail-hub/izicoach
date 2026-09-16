-- ============================================================================
-- Admin-4A.1 — fix: an expired coach_invites row must never become revoked
-- ============================================================================
--
-- SCOPE: replaces exactly one function, public.admin_revoke_coach_invite(uuid),
-- via CREATE OR REPLACE FUNCTION (same signature). Touches nothing else —
-- not the coach_invites table (no column/constraint/index change), not any
-- other function (admin_create_coach_invite, admin_list_coach_invites,
-- get_coach_invite_preview, coach_invite_is_active, is_admin, ... all
-- untouched), not RLS, not any existing migration file
-- (20260906180000_admin4a_coach_invites.sql is not modified or renamed).
--
-- BUG BEING FIXED: the version of admin_revoke_coach_invite shipped in
-- 20260906180000 only special-cased accepted (reject) and already-revoked
-- (idempotent success) before unconditionally revoking everything else —
-- including a row that was merely expired but never revoked. That was a
-- deliberate design choice at the time (documented in that migration's own
-- comments), superseded now by the definitive product rule: only a
-- `pending` invite (revoked_at IS NULL, accepted_at IS NULL, expires_at >
-- now()) may ever transition to `revoked`. An `expired` row must be
-- rejected with no mutation at all, same as `accepted` already was.
--
-- Definitive states (unchanged from Admin-4A's own derivation, e.g. in
-- admin_list_coach_invites — restated here only for this function's own
-- reasoning):
--   accepted_at IS NOT NULL      -> accepted
--   revoked_at IS NOT NULL       -> revoked
--   expires_at <= now()          -> expired
--   otherwise                    -> pending
-- (accepted/revoked are already mutually exclusive by
-- coach_invites_terminal_states_check, so the order those two are checked
-- in never matters — confirmed, not re-litigated here.)
--
-- New behavior of admin_revoke_coach_invite:
--   not found  -> {ok:false, error:'not_found'}            (unchanged)
--   accepted   -> {ok:false, error:'already_accepted'}      (unchanged)
--   revoked    -> {ok:true, already_revoked:true}           (unchanged, idempotent)
--   expired    -> {ok:false, error:'already_expired'}       (NEW — no mutation)
--   pending    -> revoke normally, {ok:true, already_revoked:false}
--
-- For the expired case specifically: revoked_at and revoked_by are left
-- exactly as they were (NULL, since accepted/revoked were already ruled
-- out above) — no UPDATE statement runs at all on that path. An
-- audit_logs row is still inserted, action admin.coach_invite.revoke,
-- result 'rejected', metadata {email, reason:'already_expired'} — same
-- shape as the existing already_accepted rejection, never token/token_hash.
--
-- v_was_expired and metadata.was_expired are removed entirely: the success
-- path can now only ever be reached from a genuinely pending row (expired
-- is intercepted before the UPDATE), so there is nothing left for that
-- flag to describe.
--
-- Everything else is byte-for-byte the same as the version this replaces:
-- auth.uid()/is_admin() gate, the initial SELECT ... FOR UPDATE (still
-- locks the row before branching on its state — the new expired check
-- runs while that same lock is held, so the fail-closed row_count=1 check
-- on the eventual UPDATE remains exactly as justified as before: by the
-- time that UPDATE runs, the row has been confirmed, under a continuously
-- held lock, to be not-accepted, not-revoked, AND not-expired — genuinely
-- pending — so a row_count other than 1 there still can only mean a real
-- inconsistency, never a legitimate race), SECURITY DEFINER, OWNER TO
-- postgres, SET search_path TO '', same grants, same repeated-revoke
-- idempotency.
--
-- Wrapped in a single transaction. CREATE OR REPLACE FUNCTION is naturally
-- idempotent; the ALTER FUNCTION/REVOKE/GRANT lines below are technically
-- no-ops (a function replace with an unchanged signature keeps its owner
-- and grants) but are reasserted anyway, purely so this migration is
-- self-verifying without depending on nothing else having touched them
-- since Admin-4A — same defensive posture as every other migration here.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.admin_revoke_coach_invite(p_invite_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid;
  v_admin_id uuid;
  v_invite record;
  v_rows_updated integer;
begin
  v_uid := auth.uid();

  if v_uid is null then
    raise exception 'admin_revoke_coach_invite: no authenticated user'
      using errcode = 'P0001';
  end if;

  if not public.is_admin(v_uid) then
    raise exception 'admin_revoke_coach_invite: not authorized'
      using errcode = 'P0001';
  end if;

  select id into v_admin_id from public.admins where auth_user_id = v_uid;

  if p_invite_id is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_parameter');
  end if;

  select id, email, revoked_at, accepted_at, expires_at
  into v_invite
  from public.coach_invites
  where id = p_invite_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  if v_invite.accepted_at is not null then
    insert into public.audit_logs (actor_type, actor_id, action, target_type, target_id, coach_id, result, metadata)
    values ('admin', v_admin_id, 'admin.coach_invite.revoke', 'coach_invite', p_invite_id::text, null, 'rejected', jsonb_build_object('email', v_invite.email, 'reason', 'already_accepted'));
    return jsonb_build_object('ok', false, 'error', 'already_accepted');
  end if;

  if v_invite.revoked_at is not null then
    -- Ya revocada: éxito idempotente, no error — un doble-click o dos
    -- admins revocando a la vez terminan en el mismo estado sin fricción.
    return jsonb_build_object('ok', true, 'already_revoked', true);
  end if;

  -- Expirada (y ni accepted ni revoked, ya descartados arriba): rechazar
  -- SIN mutar nada — la regla de producto definitiva exige que solo una
  -- invitación pending pueda transicionar a revoked. Se audita como
  -- 'rejected', igual que already_accepted arriba, nunca como éxito.
  if v_invite.expires_at <= now() then
    insert into public.audit_logs (actor_type, actor_id, action, target_type, target_id, coach_id, result, metadata)
    values ('admin', v_admin_id, 'admin.coach_invite.revoke', 'coach_invite', p_invite_id::text, null, 'rejected', jsonb_build_object('email', v_invite.email, 'reason', 'already_expired'));
    return jsonb_build_object('ok', false, 'error', 'already_expired');
  end if;

  -- A partir de acá la fila es garantizadamente pending (ni accepted, ni
  -- revoked, ni expired) — mismo lock continuo desde el SELECT ... FOR
  -- UPDATE de arriba, así que un row_count distinto de 1 abajo solo puede
  -- significar una inconsistencia real, nunca una carrera legítima.
  update public.coach_invites
  set revoked_at = now(), revoked_by = v_admin_id
  where id = p_invite_id and revoked_at is null and accepted_at is null;

  get diagnostics v_rows_updated = row_count;

  if v_rows_updated <> 1 then
    raise exception
      'admin_revoke_coach_invite: expected 1 updated row, got %',
      v_rows_updated
      using errcode = 'P0001';
  end if;

  insert into public.audit_logs (actor_type, actor_id, action, target_type, target_id, coach_id, result, metadata)
  values ('admin', v_admin_id, 'admin.coach_invite.revoke', 'coach_invite', p_invite_id::text, null, 'success', jsonb_build_object('email', v_invite.email));

  return jsonb_build_object('ok', true, 'already_revoked', false);
end;
$function$
;

ALTER FUNCTION public.admin_revoke_coach_invite(uuid) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.admin_revoke_coach_invite(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_revoke_coach_invite(uuid) TO authenticated, postgres, service_role;

COMMIT;
