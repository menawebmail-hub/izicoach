-- ============================================================================
-- Admin-4A — coach_invites schema, security, and RPCs
-- ============================================================================
--
-- SCOPE: brand-new table (public.coach_invites) plus its indexes/constraints,
-- RLS, a helper function, and 4 new RPCs. Does NOT touch coaches, coach_data,
-- student_auth, invites, messages, admins, or audit_logs in any way beyond
-- READING coaches/auth.users/student_auth (existing-identity checks, same
-- pattern already used by admin_get_coach/admin_get_student) and INSERTing
-- into audit_logs (same pattern as every existing admin RPC). No policy,
-- grant, or column on any existing table is modified by this migration.
--
-- Design decisions locked in for Admin-4A (approved in the design-review
-- session, not versioned here as prose beyond this header):
--   - coach_invites is fully isolated: no FK to/from invites, student_auth,
--     coaches, or coach_data. It is NOT a variant of the student `invites`
--     table — different domain (nobody exists yet on the other end), so it
--     is not forced into that table's shape.
--   - Token is never stored in plaintext. token_hash = sha256(token), hex-
--     encoded. The plaintext token is generated server-side, returned to the
--     caller exactly once (on create or on rotation), and never persisted
--     anywhere in this schema — not in coach_invites, not in audit_logs.
--   - invited_by / revoked_by store admins.id (the admin identity's own
--     surrogate PK, never auth.uid()) — same convention the rest of the
--     Admin schema already uses. accepted_auth_user_id stores auth.users.id
--     of whoever actually accepts in Admin-4C — a different identity space
--     entirely, hence the distinct column name (never called accepted_by,
--     to avoid implying it holds an admins.id like its siblings).
--   - None of invited_by/revoked_by/accepted_auth_user_id carry a foreign
--     key, deliberately — identical reasoning to audit_logs.actor_id/
--     coach_id in Admin-1: a historical invite record must survive the
--     deletion of the admin or auth user it references, never be nulled or
--     cascaded away as a side effect of an unrelated account deletion.
--   - accepted_at / accepted_auth_user_id are created now (nullable, no
--     default) but have NO writer anywhere in this migration — every RPC
--     here only ever reads them (to decide "active"/"status"). Admin-4C is
--     the only phase that will ever write them. This avoids a second
--     ALTER TABLE later and lets "active invite" be defined completely and
--     correctly from day one instead of being redefined in two phases.
--   - Existing-identity lookups ("is this email already a coach / already a
--     student") go through auth.users, joined to coaches/student_auth by id
--     (id = auth.uid() in both), comparing lower(trim(auth.users.email)) —
--     never coaches.email/student_auth.email directly, since those columns
--     are not guaranteed to be kept in sync with the real Auth identity.
--   - "Active invite" = revoked_at IS NULL AND accepted_at IS NULL AND
--     expires_at > now(). expires_at > now() is NOT encodable in a partial
--     index predicate (Postgres requires IMMUTABLE predicates; now() is not
--     immutable) — so the partial unique index below only encodes the two
--     NULL checks, and expiry is resolved entirely at read time via the
--     coach_invite_is_active() helper. This is sufficient: the create RPC
--     never inserts a second row while a non-revoked/non-accepted one still
--     exists for the same email (expired or not) — it always reuses that
--     row (new token, refreshed expires_at) instead, so the index's slightly
--     broader guarantee ("at most one non-finalized row per email") is
--     exactly what the RPC logic needs, not an approximation of it.
--   - Defense-in-depth CHECK constraints beyond the two above: each
--     "pair" of timestamp+identity columns must be set together, never one
--     without the other (coach_invites_revoked_pair_check,
--     coach_invites_accepted_pair_check), and expires_at must always be
--     strictly after created_at (coach_invites_expires_after_created_check
--     — verified against every write path: on insert, both use the same
--     transaction-local now() so expires_at = created_at + 7 days exactly;
--     on rotation, created_at is left untouched from the original creation
--     while expires_at becomes now()+7 days, and since now() only ever
--     moves forward from that original created_at, the inequality holds
--     unconditionally on reuse too). None of these are reachable from any
--     RPC's own logic today — they exist purely as a backstop against a
--     future bug or a direct write from a role that bypasses the RPCs
--     entirely (postgres/service_role).
--   - Token rotation on reuse: reinviting an email that already has a
--     non-revoked/non-accepted row does NOT return the old token — it
--     generates a new one, replaces token_hash in place on the SAME row
--     (same id, same invited_by, same created_at), and refreshes expires_at
--     to now()+7 days. The previous token stops working immediately. This
--     is a deliberate, accepted trade-off (approved in review): a UI can
--     only ever offer "generate a new link", never "recover the old one".
--   - RLS: enabled, zero policies (deny-all for anon/authenticated by
--     omission), zero table grants to anon/authenticated at all — not even
--     a bare SELECT. This mirrors admins/audit_logs exactly, not
--     invites/student_auth (which DO grant SELECT because they have a real
--     per-row policy for it to gate) — coach_invites has no policy, so a
--     table grant here would be a dead, misleading privilege. The only
--     sanctioned access path is is_admin()-gated SECURITY DEFINER RPCs,
--     plus the one public preview RPC (SECURITY DEFINER bypasses RLS for
--     its own execution regardless of table grants, same mechanism that
--     already lets get_student_invite_preview work for anon today).
--
-- Every RPC below follows the exact pattern already used 5 times in this
-- schema (is_admin/admin_get_session/admin_list_coaches/admin_get_coach/
-- admin_list_students/admin_get_student): SECURITY DEFINER, OWNER TO
-- postgres, SET search_path TO '', REVOKE ALL ... FROM PUBLIC, anon,
-- authenticated before granting exactly the roles that need it.
--
-- pgcrypto: digest() (used to hash tokens) requires the pgcrypto extension.
-- gen_random_uuid() itself does NOT need it (built into Postgres core since
-- v13) but digest() does. CREATE EXTENSION IF NOT EXISTS is idempotent; a
-- read-only check against production (2026-09-06) confirmed pgcrypto 1.3 is
-- already installed there, with digest(text,text)/digest(bytea,text) living
-- in the `extensions` schema (Supabase's convention — never `public` or
-- `pg_catalog`), so CREATE EXTENSION IF NOT EXISTS below is a guaranteed
-- no-op in production, kept only so this migration is self-contained if run
-- against a fresh database. Because every RPC below runs with
-- `SET search_path TO ''`, `extensions` is never implicitly searched — every
-- call to digest() is written schema-qualified as `extensions.digest(...)`.
-- encode() lives in pg_catalog, which Postgres always implicitly searches
-- regardless of search_path, so `encode(...)` would already resolve
-- correctly unqualified — it is still written as `pg_catalog.encode(...)`
-- throughout, purely so the resolution is explicit to a reader rather than
-- relying on that implicit-pg_catalog rule. gen_random_uuid() is likewise
-- pg_catalog-resident (core Postgres) and left unqualified for the same
-- reason it needs no qualification.
--
-- Wrapped in a single transaction. Idempotent (CREATE TABLE IF NOT EXISTS,
-- CREATE OR REPLACE FUNCTION, IF NOT EXISTS on indexes) — safe to re-run.
-- ============================================================================

BEGIN;

-- ============================================================================
-- 0. Extension dependency
-- ============================================================================
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================================
-- 1. coach_invites
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.coach_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash text NOT NULL,
  email text NOT NULL,
  invited_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  revoked_by uuid,
  accepted_at timestamptz,
  accepted_auth_user_id uuid,
  CONSTRAINT coach_invites_email_normalized_check
    CHECK (email = lower(trim(email))),
  CONSTRAINT coach_invites_terminal_states_check
    CHECK (revoked_at IS NULL OR accepted_at IS NULL),
  CONSTRAINT coach_invites_revoked_pair_check
    CHECK ((revoked_at IS NULL) = (revoked_by IS NULL)),
  CONSTRAINT coach_invites_accepted_pair_check
    CHECK ((accepted_at IS NULL) = (accepted_auth_user_id IS NULL)),
  CONSTRAINT coach_invites_expires_after_created_check
    CHECK (expires_at > created_at)
);

-- Lookup by hash (preview/accept) — never by plaintext token, it is never
-- stored. Standalone unique index (not an inline UNIQUE column) so its name
-- is explicit and predictable for the unique_violation-by-constraint-name
-- branching in admin_create_coach_invite below.
CREATE UNIQUE INDEX IF NOT EXISTS coach_invites_token_hash_key
  ON public.coach_invites (token_hash);

-- At most one non-revoked/non-accepted row per email — see header for why
-- expires_at cannot (and does not need to) appear in this predicate.
CREATE UNIQUE INDEX IF NOT EXISTS coach_invites_active_per_email
  ON public.coach_invites (email)
  WHERE revoked_at IS NULL AND accepted_at IS NULL;

-- Listing/pagination, same shape as audit_logs_created_at_idx.
CREATE INDEX IF NOT EXISTS coach_invites_created_at_idx
  ON public.coach_invites (created_at DESC);

ALTER TABLE public.coach_invites ENABLE ROW LEVEL SECURITY;

-- No policies, intentionally — see file header. Zero table grants either,
-- not even SELECT (unlike invites/student_auth, which grant SELECT to back
-- a real policy — coach_invites has none, so a grant here would be dead).
REVOKE ALL ON public.coach_invites FROM anon;
REVOKE ALL ON public.coach_invites FROM authenticated;

-- ============================================================================
-- 2. coach_invite_is_active(...) — pure computation over three timestamps,
-- no table access. NOT SECURITY DEFINER (nothing to elevate — it never
-- touches coach_invites or any other table, unlike is_admin which needs
-- SECURITY DEFINER specifically to read admins without a grant). Still
-- owner postgres and tightly granted, matching the rest of this schema's
-- posture, even though the elevation itself buys nothing here.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.coach_invite_is_active(
  p_revoked_at timestamptz,
  p_accepted_at timestamptz,
  p_expires_at timestamptz
)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  SELECT p_revoked_at IS NULL AND p_accepted_at IS NULL AND p_expires_at > now();
$function$
;

ALTER FUNCTION public.coach_invite_is_active(timestamptz, timestamptz, timestamptz) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.coach_invite_is_active(timestamptz, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.coach_invite_is_active(timestamptz, timestamptz, timestamptz) TO postgres, service_role;

-- ============================================================================
-- 3. admin_create_coach_invite — create or (if an active/expired-but-not-
-- revoked row already exists for this email) rotate. Existing-identity
-- checks go through auth.users, never coaches.email/student_auth.email.
-- Never returns token_hash. The plaintext token is returned exactly once,
-- here, and never logged.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.admin_create_coach_invite(p_email text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid;
  v_admin_id uuid;
  v_email text;
  v_existing record;
  v_new_token text;
  v_new_hash text;
  v_constraint_name text;
  v_attempt integer;
  v_new_expires_at timestamptz;
begin
  v_uid := auth.uid();

  if v_uid is null then
    raise exception 'admin_create_coach_invite: no authenticated user'
      using errcode = 'P0001';
  end if;

  if not public.is_admin(v_uid) then
    raise exception 'admin_create_coach_invite: not authorized'
      using errcode = 'P0001';
  end if;

  select id into v_admin_id from public.admins where auth_user_id = v_uid;

  -- Normalize once. Empty/whitespace-only collapses to NULL, caught by the
  -- format check below (never persisted as a bare-null attempt).
  v_email := nullif(lower(trim(p_email)), '');

  if v_email is null or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    return jsonb_build_object('ok', false, 'error', 'invalid_email');
  end if;

  -- Coach existente: la fuente de identidad es Auth, no coaches.email.
  if exists (
    select 1
    from auth.users au
    join public.coaches c on c.id = au.id
    where lower(trim(au.email)) = v_email
  ) then
    return jsonb_build_object('ok', false, 'error', 'coach_exists');
  end if;

  -- Student existente: idem, vía student_auth.
  if exists (
    select 1
    from auth.users au
    join public.student_auth sa on sa.id = au.id
    where lower(trim(au.email)) = v_email
  ) then
    return jsonb_build_object('ok', false, 'error', 'student_account_exists');
  end if;

  -- Fila no-revoked/no-accepted existente para este email, si hay — lockeada
  -- para el resto de esta transacción (ver header: race con otro create/con
  -- un revoke concurrente).
  select id, created_at
  into v_existing
  from public.coach_invites
  where email = v_email and revoked_at is null and accepted_at is null
  for update;

  if v_existing.id is not null then
    v_new_token := replace(gen_random_uuid()::text, '-', '');
    v_new_hash := pg_catalog.encode(extensions.digest(v_new_token, 'sha256'), 'hex');
    v_new_expires_at := now() + interval '7 days';

    update public.coach_invites
    set token_hash = v_new_hash,
        expires_at = v_new_expires_at
    where id = v_existing.id;

    insert into public.audit_logs (actor_type, actor_id, action, target_type, target_id, coach_id, result, metadata)
    values ('admin', v_admin_id, 'admin.coach_invite.create', 'coach_invite', v_existing.id::text, null, 'success', jsonb_build_object('email', v_email, 'reused', true));

    return jsonb_build_object(
      'ok', true, 'reused', true,
      'invite', jsonb_build_object(
        'id', v_existing.id, 'email', v_email, 'token', v_new_token,
        'expires_at', v_new_expires_at, 'created_at', v_existing.created_at
      )
    );
  end if;

  -- No hay fila activa: intentar insertar una nueva. Máximo 3 intentos ante
  -- una colisión extraordinaria de índice único (mismo patrón que
  -- create_student_invite).
  for v_attempt in 1..3 loop
    begin
      v_new_token := replace(gen_random_uuid()::text, '-', '');
      v_new_hash := pg_catalog.encode(extensions.digest(v_new_token, 'sha256'), 'hex');
      v_new_expires_at := now() + interval '7 days';

      insert into public.coach_invites (token_hash, email, invited_by, expires_at)
      values (v_new_hash, v_email, v_admin_id, v_new_expires_at)
      returning id, created_at into v_existing;

      insert into public.audit_logs (actor_type, actor_id, action, target_type, target_id, coach_id, result, metadata)
      values ('admin', v_admin_id, 'admin.coach_invite.create', 'coach_invite', v_existing.id::text, null, 'success', jsonb_build_object('email', v_email, 'reused', false));

      return jsonb_build_object(
        'ok', true, 'reused', false,
        'invite', jsonb_build_object(
          'id', v_existing.id, 'email', v_email, 'token', v_new_token,
          'expires_at', v_new_expires_at, 'created_at', v_existing.created_at
        )
      );
    exception
      when unique_violation then
        get stacked diagnostics v_constraint_name = constraint_name;

        if v_constraint_name = 'coach_invites_active_per_email' then
          -- Otra transacción ganó la carrera e insertó primero: releer su
          -- fila (ya visible, la otra transacción commiteó para que esta
          -- excepción ocurra) y rotarla en vez de fallar.
          select id, created_at
          into v_existing
          from public.coach_invites
          where email = v_email and revoked_at is null and accepted_at is null
          for update;

          if v_existing.id is null then
            raise exception 'admin_create_coach_invite: unique_violation on coach_invites_active_per_email but no active row found for email=%', v_email
              using errcode = 'P0001';
          end if;

          v_new_token := replace(gen_random_uuid()::text, '-', '');
          v_new_hash := pg_catalog.encode(extensions.digest(v_new_token, 'sha256'), 'hex');
          v_new_expires_at := now() + interval '7 days';

          update public.coach_invites
          set token_hash = v_new_hash,
              expires_at = v_new_expires_at
          where id = v_existing.id;

          insert into public.audit_logs (actor_type, actor_id, action, target_type, target_id, coach_id, result, metadata)
          values ('admin', v_admin_id, 'admin.coach_invite.create', 'coach_invite', v_existing.id::text, null, 'success', jsonb_build_object('email', v_email, 'reused', true));

          return jsonb_build_object(
            'ok', true, 'reused', true,
            'invite', jsonb_build_object(
              'id', v_existing.id, 'email', v_email, 'token', v_new_token,
              'expires_at', v_new_expires_at, 'created_at', v_existing.created_at
            )
          );

        elsif v_constraint_name = 'coach_invites_token_hash_key' then
          -- Colisión extraordinaria de hash — reintentar con un token nuevo.
          continue;
        else
          raise exception 'admin_create_coach_invite: unexpected unique_violation on constraint % for email=%', v_constraint_name, v_email
            using errcode = 'P0001';
        end if;
    end;
  end loop;

  raise exception 'admin_create_coach_invite: could not create invite after 3 attempts for email=%', v_email
    using errcode = 'P0001';
end;
$function$
;

ALTER FUNCTION public.admin_create_coach_invite(text) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.admin_create_coach_invite(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_create_coach_invite(text) TO authenticated, postgres, service_role;

-- ============================================================================
-- 4. admin_list_coach_invites — server-side search/filter/pagination.
-- status is always derived (revoked > accepted > expired > pending), never
-- stored. Never returns token_hash.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.admin_list_coach_invites(
  p_search text DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_limit int DEFAULT 25,
  p_offset int DEFAULT 0
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid;
  v_admin_id uuid;
  v_search text;
  v_status text;
  v_limit int;
  v_offset int;
  v_total bigint;
  v_rows jsonb;
begin
  v_uid := auth.uid();

  if v_uid is null then
    raise exception 'admin_list_coach_invites: no authenticated user'
      using errcode = 'P0001';
  end if;

  if not public.is_admin(v_uid) then
    raise exception 'admin_list_coach_invites: not authorized'
      using errcode = 'P0001';
  end if;

  v_search := nullif(trim(p_search), '');
  v_status := nullif(trim(p_status), '');

  v_limit := least(greatest(coalesce(p_limit, 25), 1), 100);
  v_offset := greatest(coalesce(p_offset, 0), 0);

  select count(*)
  into v_total
  from public.coach_invites ci
  where (v_search is null or ci.email ilike '%' || v_search || '%')
    and (
      v_status is null or
      (case
        when ci.revoked_at is not null then 'revoked'
        when ci.accepted_at is not null then 'accepted'
        when ci.expires_at <= now() then 'expired'
        else 'pending'
      end) = v_status
    );

  select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb)
  into v_rows
  from (
    select
      ci.id, ci.email, ci.created_at, ci.expires_at, ci.revoked_at,
      (case
        when ci.revoked_at is not null then 'revoked'
        when ci.accepted_at is not null then 'accepted'
        when ci.expires_at <= now() then 'expired'
        else 'pending'
      end) as status,
      inv.name as invited_by_name,
      rev.name as revoked_by_name
    from public.coach_invites ci
    left join public.admins inv on inv.id = ci.invited_by
    left join public.admins rev on rev.id = ci.revoked_by
    where (v_search is null or ci.email ilike '%' || v_search || '%')
      and (
        v_status is null or
        (case
          when ci.revoked_at is not null then 'revoked'
          when ci.accepted_at is not null then 'accepted'
          when ci.expires_at <= now() then 'expired'
          else 'pending'
        end) = v_status
      )
    order by ci.created_at desc
    limit v_limit offset v_offset
  ) t;

  -- Only log when a real search was performed — never v_search/p_search,
  -- only the fact that a search happened and how many rows it matched.
  -- Same rule as admin_list_coaches/admin_list_students.
  if v_search is not null then
    select id into v_admin_id from public.admins where auth_user_id = v_uid;

    insert into public.audit_logs (actor_type, actor_id, action, result, metadata)
    values (
      'admin', v_admin_id, 'admin.coach_invites.list_viewed', 'success',
      jsonb_build_object('query_type', 'email', 'result_count', v_total)
    );
  end if;

  return jsonb_build_object('ok', true, 'total', v_total, 'invites', v_rows);
end;
$function$
;

ALTER FUNCTION public.admin_list_coach_invites(text, text, int, int) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.admin_list_coach_invites(text, text, int, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_coach_invites(text, text, int, int) TO authenticated, postgres, service_role;

-- ============================================================================
-- 5. admin_revoke_coach_invite — idempotent on double-revoke, structured
-- rejection on revoke-after-accept, allowed (and logged) on an already-
-- expired-but-not-revoked row.
-- ============================================================================
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
  v_was_expired boolean;
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

  -- Revocar una invitación ya expirada (pero nunca revocada) se permite:
  -- deja un registro explícito y auditable de "esto se cerró activamente",
  -- distinto de "simplemente venció", sin costo de seguridad adicional.
  v_was_expired := v_invite.expires_at <= now();

  update public.coach_invites
  set revoked_at = now(), revoked_by = v_admin_id
  where id = p_invite_id and revoked_at is null and accepted_at is null;

  get diagnostics v_rows_updated = row_count;

  -- Fail-closed, not idempotent-success: the SELECT ... FOR UPDATE above
  -- already confirmed revoked_at/accepted_at were both NULL while holding
  -- the row lock, and that lock is held continuously through this UPDATE —
  -- no concurrent transaction could have changed this row in between. A
  -- row_count other than 1 here can only mean a genuine inconsistency
  -- (never a legitimate race), so it must raise, not be swallowed as a
  -- normal outcome.
  if v_rows_updated <> 1 then
    raise exception
      'admin_revoke_coach_invite: expected 1 updated row, got %',
      v_rows_updated
      using errcode = 'P0001';
  end if;

  insert into public.audit_logs (actor_type, actor_id, action, target_type, target_id, coach_id, result, metadata)
  values ('admin', v_admin_id, 'admin.coach_invite.revoke', 'coach_invite', p_invite_id::text, null, 'success', jsonb_build_object('email', v_invite.email, 'was_expired', v_was_expired));

  return jsonb_build_object('ok', true, 'already_revoked', false);
end;
$function$
;

ALTER FUNCTION public.admin_revoke_coach_invite(uuid) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.admin_revoke_coach_invite(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_revoke_coach_invite(uuid) TO authenticated, postgres, service_role;

-- ============================================================================
-- 6. get_coach_invite_preview — the only anon-reachable entry point. Reveals
-- nothing beyond {valid}: no admin identity, no internal ids, no token, no
-- signal about whether the underlying reason for invalidity was "not
-- found" vs "revoked" vs "expired" vs "accepted" — same anti-enumeration
-- posture as get_student_invite_preview. Never logged (see file header:
-- an anon-reachable RPC would otherwise let random/bot traffic flood
-- audit_logs with zero-value noise).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_coach_invite_preview(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_hash text;
  v_invite record;
begin
  -- Structural validation BEFORE any hashing or table lookup: the only
  -- shape this system ever generates is 32 lowercase hex chars (a UUID with
  -- its dashes stripped). Anything else — NULL, empty, wrong length,
  -- uppercase, non-hex characters — is rejected here, with the exact same
  -- {valid:false} response as every other invalid case below, and never
  -- reaches digest() or a query against coach_invites at all.
  if p_token is null or p_token !~ '^[0-9a-f]{32}$' then
    return jsonb_build_object('valid', false);
  end if;

  v_hash := pg_catalog.encode(extensions.digest(p_token, 'sha256'), 'hex');

  select revoked_at, accepted_at, expires_at
  into v_invite
  from public.coach_invites
  where token_hash = v_hash;

  if not found then
    return jsonb_build_object('valid', false);
  end if;

  if not public.coach_invite_is_active(v_invite.revoked_at, v_invite.accepted_at, v_invite.expires_at) then
    return jsonb_build_object('valid', false);
  end if;

  return jsonb_build_object('valid', true);
end;
$function$
;

ALTER FUNCTION public.get_coach_invite_preview(text) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.get_coach_invite_preview(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_coach_invite_preview(text) TO anon, authenticated, postgres, service_role;

COMMIT;
