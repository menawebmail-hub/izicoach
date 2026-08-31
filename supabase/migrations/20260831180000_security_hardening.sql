-- ============================================================================
-- Security hardening — invites / student_auth / coach onboarding
-- (first versioned migration against a database that already existed —
-- see supabase/README.md; this is not a schema baseline/bootstrap)
-- ============================================================================
--
-- SCOPE: this migration does NOT recreate the IziCoach schema. `coaches`,
-- `invites`, `student_auth`, and `coach_data` are assumed to already exist
-- (created elsewhere, never versioned in this repo). This file represents
-- EXCLUSIVELY the security/schema hardening verified live against
-- production via read-only introspection queries (pg_get_functiondef,
-- pg_indexes, information_schema.*, pg_policies, pg_constraint) run in the
-- Supabase SQL Editor, cross-checked against real data before being
-- transcribed here. Nothing in this file was reconstructed from memory —
-- every constraint name, index definition, FK, RLS policy, grant, and RPC
-- body below is copied verbatim from what that introspection returned.
--
-- NON-GOALS / explicit safety rules followed throughout:
--   - No destructive cleanup of existing data. Where a constraint/index
--     could fail against incompatible legacy rows (duplicate active
--     invites, an active invite with no invited_email, duplicate
--     (coach_id,student_id) pairs in student_auth), this migration lets
--     Postgres raise its own constraint-violation error and STOPS —
--     it never deletes, dedups, or silently reassigns rows to make a
--     constraint pass.
--   - Idempotent: safe to run more than once against the same database.
--   - Schema-drift detection (added in this revision): every column,
--     constraint, and index this migration cares about is verified
--     structurally if it already exists — never assumed correct just
--     because an object with the expected name is present. A same-named
--     object with a different real definition makes this migration
--     RAISE EXCEPTION and stop, rather than silently accepting it or
--     silently replacing it (no automatic DROP-and-recreate of a
--     divergent object — that decision is left to a human).
--   - `coaches.onboarded` backfill mirrors EXACTLY the heuristic that was
--     actually run and empirically verified against production (5/5
--     coaches cross-checked both directions, zero mismatches — see
--     docs/SESSION_STATE.md section 4). It does not invent a rule for
--     rows that heuristic can't classify (a coach with no name on file) —
--     see the guard in step 1 below, which fails loudly instead.
--   - Wrapped in a single transaction (BEGIN/COMMIT): any exception,
--     constraint violation, or unique violation anywhere in this file
--     rolls back everything — no partial application is possible.
--
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. coaches.onboarded
-- ============================================================================
-- If the column doesn't exist yet: add it, backfill via the verified
-- production heuristic, fail loudly on anything that heuristic can't
-- classify, then lock NOT NULL DEFAULT false.
-- If the column already exists: verify it structurally matches the target
-- (boolean, NOT NULL, DEFAULT false) — RAISE EXCEPTION on any divergence
-- instead of assuming it's correct or silently reconciling it.
do $$
declare
  v_exists boolean;
  v_type text;
  v_notnull boolean;
  v_default text;
begin
  select exists(
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'coaches' and column_name = 'onboarded'
  ) into v_exists;

  if v_exists then
    select format_type(a.atttypid, a.atttypmod), a.attnotnull, pg_get_expr(d.adbin, d.adrelid)
    into v_type, v_notnull, v_default
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    join pg_namespace n on n.oid = c.relnamespace
    left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
    where n.nspname = 'public' and c.relname = 'coaches' and a.attname = 'onboarded'
      and a.attnum > 0 and not a.attisdropped;

    if v_type is distinct from 'boolean'
       or v_notnull is distinct from true
       or v_default is distinct from 'false' then
      raise exception 'coaches.onboarded exists but diverges from the verified target (boolean NOT NULL DEFAULT false): type=%, not_null=%, default=%. Not reconciling automatically — resolve manually.',
        v_type, v_notnull, v_default;
    end if;

    -- Already correct: nothing to do.
  else
    alter table public.coaches add column onboarded boolean default false;

    -- Mirrors EXACTLY the backfill executed and verified against production:
    -- a coach row with a real, non-empty name is treated as already
    -- onboarded. Deliberately does not invent a rule beyond this.
    update public.coaches set onboarded = true where name is not null and name <> '';

    -- Any row still NULL here is a coach with no name on file — a case the
    -- verified production backfill never had to handle (it didn't occur).
    -- Fail loudly and require a manual decision rather than silently
    -- guessing that an unclassified coach is or isn't onboarded.
    if exists (select 1 from public.coaches where onboarded is null) then
      raise exception 'coaches.onboarded: % row(s) have no name on file — the verified production backfill (name-based) does not cover this case. Resolve manually (decide onboarded true/false per row) before re-running this migration.',
        (select count(*) from public.coaches where onboarded is null);
    end if;

    alter table public.coaches alter column onboarded set default false;
    alter table public.coaches alter column onboarded set not null;
  end if;
end $$;


-- ============================================================================
-- 2. invites — additive hardening only. coach_id nullability is left
-- untouched on purpose (out of scope for this hardening pass).
-- ============================================================================

-- invites.used: target is boolean NOT NULL DEFAULT false. If it already
-- exists with a different type/nullability/default, fail loudly instead of
-- silently leaving (or silently "fixing") a divergent definition.
do $$
declare
  v_exists boolean;
  v_type text;
  v_notnull boolean;
  v_default text;
begin
  select exists(
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'invites' and column_name = 'used'
  ) into v_exists;

  if v_exists then
    select format_type(a.atttypid, a.atttypmod), a.attnotnull, pg_get_expr(d.adbin, d.adrelid)
    into v_type, v_notnull, v_default
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    join pg_namespace n on n.oid = c.relnamespace
    left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
    where n.nspname = 'public' and c.relname = 'invites' and a.attname = 'used'
      and a.attnum > 0 and not a.attisdropped;

    if v_type is distinct from 'boolean'
       or v_notnull is distinct from true
       or v_default is distinct from 'false' then
      raise exception 'invites.used exists but diverges from the verified target (boolean NOT NULL DEFAULT false): type=%, not_null=%, default=%. Not reconciling automatically — resolve manually.',
        v_type, v_notnull, v_default;
    end if;
  else
    alter table public.invites add column used boolean not null default false;
  end if;
end $$;

-- invites.invited_email: target is text, nullable (production has it
-- nullable — this migration does not impose NOT NULL). Only the type is
-- verified when the column already exists, per the approved scope.
do $$
declare
  v_exists boolean;
  v_type text;
begin
  select exists(
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'invites' and column_name = 'invited_email'
  ) into v_exists;

  if v_exists then
    select format_type(a.atttypid, a.atttypmod)
    into v_type
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'invites' and a.attname = 'invited_email'
      and a.attnum > 0 and not a.attisdropped;

    if v_type is distinct from 'text' then
      raise exception 'invites.invited_email exists but is type % — expected text. Not reconciling automatically — resolve manually.', v_type;
    end if;
  else
    alter table public.invites add column invited_email text;
  end if;
end $$;

-- CHECK invites_active_requires_email: compared against the exact
-- check_clause captured live from production (information_schema, the same
-- catalog view used to verify it originally), whitespace-normalized so
-- cosmetic formatting differences can't produce a false positive.
do $$
declare
  v_clause text;
begin
  select cc.check_clause into v_clause
  from information_schema.table_constraints tc
  join information_schema.check_constraints cc
    on cc.constraint_schema = tc.constraint_schema and cc.constraint_name = tc.constraint_name
  where tc.table_schema = 'public' and tc.table_name = 'invites'
    and tc.constraint_name = 'invites_active_requires_email';

  if v_clause is not null then
    if regexp_replace(v_clause, '\s+', ' ', 'g') is distinct from '((used = true) OR (invited_email IS NOT NULL))' then
      raise exception 'invites_active_requires_email exists but its definition diverges from the verified target: %. Not reconciling automatically — resolve manually.', v_clause;
    end if;
  else
    -- No data cleanup here (see file header). If an existing active invite
    -- (used=false) has no invited_email, this fails loudly and stops.
    alter table public.invites
      add constraint invites_active_requires_email
      check ((used = true) or (invited_email is not null));
  end if;
end $$;

-- FK invites_coach_id_fkey: verified structurally (referenced table/column,
-- delete rule) via information_schema — discrete field comparisons, not
-- rendered/deparsed text, so it can't be thrown off by search_path or
-- formatting differences.
do $$
declare
  v_col text;
  v_ftable text;
  v_fschema text;
  v_fcol text;
  v_delrule text;
begin
  select kcu.column_name, ccu.table_schema, ccu.table_name, ccu.column_name, rc.delete_rule
  into v_col, v_fschema, v_ftable, v_fcol, v_delrule
  from information_schema.table_constraints tc
  join information_schema.key_column_usage kcu
    on kcu.constraint_name = tc.constraint_name and kcu.constraint_schema = tc.constraint_schema
  join information_schema.constraint_column_usage ccu
    on ccu.constraint_name = tc.constraint_name and ccu.constraint_schema = tc.constraint_schema
  join information_schema.referential_constraints rc
    on rc.constraint_name = tc.constraint_name and rc.constraint_schema = tc.constraint_schema
  where tc.constraint_type = 'FOREIGN KEY'
    and tc.table_schema = 'public' and tc.table_name = 'invites'
    and tc.constraint_name = 'invites_coach_id_fkey';

  if v_col is not null then
    if v_col is distinct from 'coach_id'
       or v_fschema is distinct from 'public'
       or v_ftable is distinct from 'coaches'
       or v_fcol is distinct from 'id'
       or upper(v_delrule) is distinct from 'CASCADE' then
      raise exception 'invites_coach_id_fkey exists but diverges from the verified target (coach_id -> public.coaches(id) ON DELETE CASCADE): column=%, ref=%.%, ref_column=%, delete_rule=%. Not reconciling automatically — resolve manually.',
        v_col, v_fschema, v_ftable, v_fcol, v_delrule;
    end if;
  else
    alter table public.invites
      add constraint invites_coach_id_fkey
      foreign key (coach_id) references public.coaches(id) on delete cascade;
  end if;
end $$;

-- invites_active_per_student: verified structurally via pg_index/
-- pg_attribute/pg_get_expr (unique, exact columns in order, exact partial
-- predicate) — never a naive text comparison of indexdef, which cosmetic
-- differences (parens, casts) could make look different for an equivalent
-- index or, worse, look equal for a genuinely different one.
do $$
declare
  v_idx_oid oid;
  v_ok boolean;
begin
  select c.oid into v_idx_oid
  from pg_class c
  where c.relname = 'invites_active_per_student' and c.relnamespace = 'public'::regnamespace and c.relkind = 'i';

  if v_idx_oid is not null then
    select
      i.indisunique
      and i.indrelid = 'public.invites'::regclass
      and i.indnatts = 2
      and (select a.attname from pg_attribute a where a.attrelid = i.indrelid and a.attnum = i.indkey[0]) = 'coach_id'
      and (select a.attname from pg_attribute a where a.attrelid = i.indrelid and a.attnum = i.indkey[1]) = 'student_id'
      and i.indpred is not null
      and regexp_replace(pg_get_expr(i.indpred, i.indrelid), '\s+', ' ', 'g') = '(used = false)'
    into v_ok
    from pg_index i
    where i.indexrelid = v_idx_oid;

    if not v_ok then
      raise exception 'invites_active_per_student exists but is not the expected unique partial index on (coach_id, student_id) WHERE used=false. Not reconciling automatically — resolve manually.';
    end if;
  else
    -- Fails loudly (unique_violation) if any (coach_id, student_id) pair
    -- already has more than one active (used=false) invite — no automatic
    -- dedup performed.
    create unique index invites_active_per_student
      on public.invites using btree (coach_id, student_id)
      where (used = false);
  end if;
end $$;


-- ============================================================================
-- 3. student_auth — additive hardening only.
-- ============================================================================

do $$
declare
  v_col text;
  v_ftable text;
  v_fschema text;
  v_fcol text;
  v_delrule text;
begin
  select kcu.column_name, ccu.table_schema, ccu.table_name, ccu.column_name, rc.delete_rule
  into v_col, v_fschema, v_ftable, v_fcol, v_delrule
  from information_schema.table_constraints tc
  join information_schema.key_column_usage kcu
    on kcu.constraint_name = tc.constraint_name and kcu.constraint_schema = tc.constraint_schema
  join information_schema.constraint_column_usage ccu
    on ccu.constraint_name = tc.constraint_name and ccu.constraint_schema = tc.constraint_schema
  join information_schema.referential_constraints rc
    on rc.constraint_name = tc.constraint_name and rc.constraint_schema = tc.constraint_schema
  where tc.constraint_type = 'FOREIGN KEY'
    and tc.table_schema = 'public' and tc.table_name = 'student_auth'
    and tc.constraint_name = 'student_auth_coach_id_fkey';

  if v_col is not null then
    if v_col is distinct from 'coach_id'
       or v_fschema is distinct from 'public'
       or v_ftable is distinct from 'coaches'
       or v_fcol is distinct from 'id'
       or upper(v_delrule) is distinct from 'CASCADE' then
      raise exception 'student_auth_coach_id_fkey exists but diverges from the verified target (coach_id -> public.coaches(id) ON DELETE CASCADE): column=%, ref=%.%, ref_column=%, delete_rule=%. Not reconciling automatically — resolve manually.',
        v_col, v_fschema, v_ftable, v_fcol, v_delrule;
    end if;
  else
    alter table public.student_auth
      add constraint student_auth_coach_id_fkey
      foreign key (coach_id) references public.coaches(id) on delete cascade;
  end if;
end $$;

do $$
declare
  v_col text;
  v_ftable text;
  v_fschema text;
  v_fcol text;
  v_delrule text;
begin
  select kcu.column_name, ccu.table_schema, ccu.table_name, ccu.column_name, rc.delete_rule
  into v_col, v_fschema, v_ftable, v_fcol, v_delrule
  from information_schema.table_constraints tc
  join information_schema.key_column_usage kcu
    on kcu.constraint_name = tc.constraint_name and kcu.constraint_schema = tc.constraint_schema
  join information_schema.constraint_column_usage ccu
    on ccu.constraint_name = tc.constraint_name and ccu.constraint_schema = tc.constraint_schema
  join information_schema.referential_constraints rc
    on rc.constraint_name = tc.constraint_name and rc.constraint_schema = tc.constraint_schema
  where tc.constraint_type = 'FOREIGN KEY'
    and tc.table_schema = 'public' and tc.table_name = 'student_auth'
    and tc.constraint_name = 'student_auth_id_fkey';

  if v_col is not null then
    if v_col is distinct from 'id'
       or v_fschema is distinct from 'auth'
       or v_ftable is distinct from 'users'
       or v_fcol is distinct from 'id'
       or upper(v_delrule) is distinct from 'CASCADE' then
      raise exception 'student_auth_id_fkey exists but diverges from the verified target (id -> auth.users(id) ON DELETE CASCADE): column=%, ref=%.%, ref_column=%, delete_rule=%. Not reconciling automatically — resolve manually.',
        v_col, v_fschema, v_ftable, v_fcol, v_delrule;
    end if;
  else
    alter table public.student_auth
      add constraint student_auth_id_fkey
      foreign key (id) references auth.users(id) on delete cascade;
  end if;
end $$;

-- student_auth_coach_student_unique: same structural verification approach
-- as invites_active_per_student, no partial predicate expected here.
do $$
declare
  v_idx_oid oid;
  v_ok boolean;
begin
  select c.oid into v_idx_oid
  from pg_class c
  where c.relname = 'student_auth_coach_student_unique' and c.relnamespace = 'public'::regnamespace and c.relkind = 'i';

  if v_idx_oid is not null then
    select
      i.indisunique
      and i.indrelid = 'public.student_auth'::regclass
      and i.indnatts = 2
      and i.indpred is null
      and (select a.attname from pg_attribute a where a.attrelid = i.indrelid and a.attnum = i.indkey[0]) = 'coach_id'
      and (select a.attname from pg_attribute a where a.attrelid = i.indrelid and a.attnum = i.indkey[1]) = 'student_id'
    into v_ok
    from pg_index i
    where i.indexrelid = v_idx_oid;

    if not v_ok then
      raise exception 'student_auth_coach_student_unique exists but is not the expected unique index on (coach_id, student_id). Not reconciling automatically — resolve manually.';
    end if;
  else
    -- Fails loudly (unique_violation) if duplicate (coach_id, student_id)
    -- pairs already exist — no automatic dedup performed.
    create unique index student_auth_coach_student_unique
      on public.student_auth using btree (coach_id, student_id);
  end if;
end $$;


-- ============================================================================
-- 4. RPCs — verbatim from pg_get_functiondef, retrieved live from
-- production. CREATE OR REPLACE is naturally idempotent. UNCHANGED in this
-- revision — byte-for-byte identical to the previous version of this file.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.accept_student_invite(p_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid;
  v_coach_id uuid;
  v_student_id bigint;
  v_invited_email text;
  v_used boolean;
  v_auth_email text;
  v_email_confirmed_at timestamptz;
  v_already_mine boolean;
  v_uid_has_other boolean;
  v_pair_has_other boolean;
  v_rows_updated integer;
begin
  v_uid := auth.uid();

  if v_uid is null then
    raise exception 'accept_student_invite: invalid invite'
      using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from public.coaches
    where id = v_uid
  ) then
    raise exception 'accept_student_invite: invalid invite'
      using errcode = 'P0001';
  end if;

  if p_code is null or p_code = '' then
    raise exception 'accept_student_invite: invalid invite'
      using errcode = 'P0001';
  end if;

  select
    coach_id,
    student_id,
    invited_email,
    used
  into
    v_coach_id,
    v_student_id,
    v_invited_email,
    v_used
  from public.invites
  where code = p_code
  for update;

  if not found then
    raise exception 'accept_student_invite: invalid invite'
      using errcode = 'P0001';
  end if;

  select
    email,
    email_confirmed_at
  into
    v_auth_email,
    v_email_confirmed_at
  from auth.users
  where id = v_uid;

  if v_auth_email is null
     or v_email_confirmed_at is null then
    raise exception 'accept_student_invite: invalid invite'
      using errcode = 'P0001';
  end if;

  if v_invited_email is null
     or trim(v_invited_email) = '' then
    raise exception 'accept_student_invite: invalid invite'
      using errcode = 'P0001';
  end if;

  if lower(trim(v_auth_email))
     <> lower(trim(v_invited_email)) then
    raise exception 'accept_student_invite: invalid invite'
      using errcode = 'P0001';
  end if;

  if v_used then

    select exists(
      select 1
      from public.student_auth
      where id = v_uid
        and coach_id = v_coach_id
        and student_id = v_student_id
    )
    into v_already_mine;

    if v_already_mine then
      return jsonb_build_object('ok', true);
    end if;

    raise exception 'accept_student_invite: invalid invite'
      using errcode = 'P0001';
  end if;

  select exists(
    select 1
    from public.student_auth
    where id = v_uid
  )
  into v_uid_has_other;

  if v_uid_has_other then
    raise exception 'accept_student_invite: invalid invite'
      using errcode = 'P0001';
  end if;

  select exists(
    select 1
    from public.student_auth
    where coach_id = v_coach_id
      and student_id = v_student_id
  )
  into v_pair_has_other;

  if v_pair_has_other then
    raise exception 'accept_student_invite: invalid invite'
      using errcode = 'P0001';
  end if;

  begin
    insert into public.student_auth (
      id,
      coach_id,
      student_id,
      email
    )
    values (
      v_uid,
      v_coach_id,
      v_student_id,
      v_auth_email
    );

  exception
    when unique_violation then
      raise exception 'accept_student_invite: invalid invite'
        using errcode = 'P0001';
  end;

  update public.invites
  set used = true
  where code = p_code
    and used = false;

  get diagnostics v_rows_updated = row_count;

  if v_rows_updated <> 1 then
    raise exception 'accept_student_invite: invalid invite'
      using errcode = 'P0001';
  end if;

  return jsonb_build_object('ok', true);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.create_student_invite(p_student_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_coach_id uuid;
  v_is_coach boolean;
  v_students jsonb;
  v_match_count integer;
  v_student jsonb;
  v_invited_email text;
  v_existing record;
  v_new_code text;
  v_constraint_name text;
  v_attempt integer;
begin
  -- Fail closed: debe existir un usuario autenticado.
  if auth.uid() is null then
    raise exception 'create_student_invite: no authenticated user'
      using errcode = 'P0001';
  end if;

  -- El coach_id se obtiene exclusivamente de auth.uid().
  v_coach_id := auth.uid();

  -- Verificar que el usuario autenticado sea realmente un coach.
  select exists(
    select 1
    from public.coaches
    where id = v_coach_id
  )
  into v_is_coach;

  if not v_is_coach then
    raise exception
      'create_student_invite: auth.uid()=% is not a coach',
      v_coach_id
      using errcode = 'P0001';
  end if;

  -- Obtener exclusivamente el roster de alumnos de este coach.
  select data_value
  into v_students
  from public.coach_data
  where coach_id = v_coach_id
    and data_key = 'students';

  if v_students is null then
    raise exception
      'create_student_invite: no students dataset for coach_id=%',
      v_coach_id
      using errcode = 'P0001';
  end if;

  -- El dataset debe ser un array JSON válido.
  if jsonb_typeof(v_students) <> 'array' then
    raise exception
      'create_student_invite: coach_data.students is not a JSON array for coach_id=%',
      v_coach_id
      using errcode = 'P0001';
  end if;

  -- El alumno debe existir exactamente una vez dentro del roster del coach.
  select count(*)
  into v_match_count
  from jsonb_array_elements(v_students) as elem
  where elem->>'id' = p_student_id::text;

  if v_match_count = 0 then
    raise exception
      'create_student_invite: student_id=% not found for coach_id=%',
      p_student_id,
      v_coach_id
      using errcode = 'P0001';
  elsif v_match_count > 1 then
    raise exception
      'create_student_invite: integrity error — student_id=% matched % entries for coach_id=%, expected exactly 1',
      p_student_id,
      v_match_count,
      v_coach_id
      using errcode = 'P0001';
  end if;

  select elem
  into v_student
  from jsonb_array_elements(v_students) as elem
  where elem->>'id' = p_student_id::text;

  -- El email sale exclusivamente del roster y se normaliza.
  v_invited_email :=
    nullif(lower(trim(v_student->>'email')), '');

  if v_invited_email is null then
    raise exception
      'create_student_invite: student_id=% has no email on file, cannot create invite',
      p_student_id
      using errcode = 'P0001';
  end if;

  -- Buscar una invitación activa existente.
  select code, invited_email
  into v_existing
  from public.invites
  where coach_id = v_coach_id
    and student_id = p_student_id
    and used = false;

  if v_existing.code is not null then

    -- Mismo email: reutilizar exactamente el mismo código.
    if lower(trim(v_existing.invited_email)) = v_invited_email then
      return jsonb_build_object(
        'ok', true,
        'code', v_existing.code
      );

    else
      -- El email cambió: invalidar la invitación anterior.
      update public.invites
      set used = true
      where code = v_existing.code;
    end if;

  end if;

  -- Generar código fuerte exclusivamente server-side.
  v_new_code := replace(gen_random_uuid()::text, '-', '');

  -- Máximo 3 intentos ante una extraordinaria colisión del código.
  for v_attempt in 1..3 loop

    begin

      insert into public.invites (
        code,
        coach_id,
        student_id,
        used,
        invited_email
      )
      values (
        v_new_code,
        v_coach_id,
        p_student_id,
        false,
        v_invited_email
      );

      return jsonb_build_object(
        'ok', true,
        'code', v_new_code
      );

    exception
      when unique_violation then

        get stacked diagnostics
          v_constraint_name = constraint_name;

        -- Carrera contra el índice que permite
        -- una sola invitación activa por alumno/coach.
        if v_constraint_name = 'invites_active_per_student' then

          select code, invited_email
          into v_existing
          from public.invites
          where coach_id = v_coach_id
            and student_id = p_student_id
            and used = false;

          -- Otra llamada creó correctamente la misma invitación.
          if v_existing.code is not null
             and lower(trim(v_existing.invited_email)) = v_invited_email then

            return jsonb_build_object(
              'ok', true,
              'code', v_existing.code
            );

          end if;

          -- Existe una invitación activa pero para otro email.
          if v_existing.code is not null then

            raise exception
              'create_student_invite: active invite exists for student_id=% with a different invited_email (expected %, found %)',
              p_student_id,
              v_invited_email,
              v_existing.invited_email
              using errcode = 'P0001';

          end if;

          -- El índice produjo la violación pero ya no encontramos
          -- la fila activa. Fallar cerrado.
          raise exception
            'create_student_invite: unique_violation on invites_active_per_student but no matching active invite found for student_id=%',
            p_student_id
            using errcode = 'P0001';

        elsif v_constraint_name = 'invites_pkey' then

          -- Colisión extraordinaria del código.
          -- Generar uno nuevo y volver a intentar.
          v_new_code :=
            replace(gen_random_uuid()::text, '-', '');

        else

          -- Nunca asumir que una constraint desconocida es segura.
          raise exception
            'create_student_invite: unexpected unique_violation on constraint % for student_id=%',
            v_constraint_name,
            p_student_id
            using errcode = 'P0001';

        end if;

    end;

  end loop;

  -- Nunca devolver éxito si no se consiguió un código válido.
  raise exception
    'create_student_invite: could not generate a unique invite code after 3 attempts for student_id=%',
    p_student_id
    using errcode = 'P0001';
end;
$function$
;

CREATE OR REPLACE FUNCTION public.get_student_invite_preview(p_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_coach_id uuid;
  v_coach_name text;
  v_coach_name_check text;
begin
  if p_code is null or p_code = '' then
    return jsonb_build_object('valid', false);
  end if;

  select i.coach_id
  into v_coach_id
  from public.invites i
  where i.code = p_code
    and i.used = false;

  if v_coach_id is null then
    return jsonb_build_object('valid', false);
  end if;

  select c.name
  into v_coach_name
  from public.coaches c
  where c.id = v_coach_id;

  v_coach_name_check := nullif(trim(v_coach_name), '');

  if v_coach_name_check is null then
    return jsonb_build_object('valid', false);
  end if;

  return jsonb_build_object(
    'valid', true,
    'coach_name', v_coach_name
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.update_my_student_profile(p_name text, p_phone text, p_email text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_coach_id uuid;
  v_student_id bigint;
  v_current jsonb;
  v_match_count integer;
  v_patched jsonb;
  v_new_updated_at timestamptz := now();
begin
  select coach_id, student_id
  into v_coach_id, v_student_id
  from public.student_auth
  where id = auth.uid();

  if not found then
    raise exception 'update_my_student_profile: no student_auth row for auth.uid()=%', auth.uid()
      using errcode = 'P0001';
  end if;

  if v_coach_id is null then
    raise exception 'update_my_student_profile: student_auth.coach_id is null for auth.uid()=%', auth.uid()
      using errcode = 'P0001';
  end if;

  select data_value
  into v_current
  from public.coach_data
  where coach_id = v_coach_id
    and data_key = 'students'
  for update;

  if not found then
    raise exception 'update_my_student_profile: no coach_data row for coach_id=%, data_key=students', v_coach_id
      using errcode = 'P0001';
  end if;

  if v_current is null or jsonb_typeof(v_current) <> 'array' then
    raise exception 'update_my_student_profile: coach_data.data_value is not a JSON array for coach_id=%', v_coach_id
      using errcode = 'P0001';
  end if;

  select count(*)
  into v_match_count
  from jsonb_array_elements(v_current) as elem
  where elem->>'id' = v_student_id::text;

  if v_match_count = 0 then
    raise exception 'update_my_student_profile: student_id=% not found in coach_data for coach_id=%', v_student_id, v_coach_id
      using errcode = 'P0001';
  elsif v_match_count > 1 then
    raise exception 'update_my_student_profile: integrity error — student_id=% matched % entries in coach_data for coach_id=%, expected exactly 1, no write performed', v_student_id, v_match_count, v_coach_id
      using errcode = 'P0001';
  end if;

  select jsonb_agg(
    case
      when elem->>'id' = v_student_id::text
      then elem || jsonb_build_object(
        'name', p_name,
        'phone', p_phone,
        'email', p_email
      )
      else elem
    end
    order by ord
  )
  into v_patched
  from jsonb_array_elements(v_current) with ordinality as t(elem, ord);

  update public.coach_data
  set data_value = v_patched,
      updated_at = v_new_updated_at
  where coach_id = v_coach_id
    and data_key = 'students';

  return jsonb_build_object(
    'ok', true,
    'updated_at', v_new_updated_at
  );
end;
$function$
;


-- ============================================================================
-- 5. EXECUTE privileges — revoke PUBLIC defensively (no-op if PUBLIC never
-- had a grant), then grant exactly the roles confirmed live in production.
-- ============================================================================
revoke all on function public.accept_student_invite(text) from public;
revoke all on function public.create_student_invite(bigint) from public;
revoke all on function public.get_student_invite_preview(text) from public;
revoke all on function public.update_my_student_profile(text, text, text) from public;

grant execute on function public.accept_student_invite(text) to authenticated, postgres, service_role;
grant execute on function public.create_student_invite(bigint) to authenticated, postgres, service_role;
grant execute on function public.get_student_invite_preview(text) to anon, authenticated, postgres, service_role;
grant execute on function public.update_my_student_profile(text, text, text) to authenticated, postgres, service_role;


-- ============================================================================
-- 6. RLS — drop every historical policy we know of (idempotent via IF
-- EXISTS), ensure RLS is enabled (not forced — matches verified production
-- state), and (re)create exactly the two policies confirmed live. Now
-- inside the same transaction as everything else, so no other session can
-- observe the brief window between DROP and CREATE POLICY — it's invisible
-- until COMMIT.
-- ============================================================================
alter table public.invites enable row level security;
alter table public.student_auth enable row level security;

drop policy if exists "Anyone can read invite by code" on public.invites;
drop policy if exists "Coaches manage invites" on public.invites;
drop policy if exists "coach_select_own_invites" on public.invites;

create policy "coach_select_own_invites"
  on public.invites
  for select
  to authenticated
  using (auth.uid() = coach_id);

drop policy if exists "Coaches see own students" on public.student_auth;
drop policy if exists "Insert own" on public.student_auth;
drop policy if exists "Students see own data" on public.student_auth;
drop policy if exists "coach_manage_students" on public.student_auth;
drop policy if exists "student_own_auth" on public.student_auth;
drop policy if exists "student_select_own_row" on public.student_auth;

create policy "student_select_own_row"
  on public.student_auth
  for select
  to authenticated
  using (id = auth.uid());


-- ============================================================================
-- 7. Table grants — anon: zero direct privileges on either table.
-- authenticated: SELECT only. postgres/service_role are never touched by
-- a REVOKE here, so their administrative privileges are never degraded.
-- Same transaction-visibility guarantee as section 6 above.
-- ============================================================================
revoke all on public.invites from anon;
revoke all on public.invites from authenticated;
grant select on public.invites to authenticated;

revoke all on public.student_auth from anon;
revoke all on public.student_auth from authenticated;
grant select on public.student_auth to authenticated;

COMMIT;
