-- ============================================================================
-- Student Portal — Migration A: get_my_student_portal() (additive, non-breaking)
--
-- WHY: the policy "student_read_coach_data" (20260911142144_..._c2_rls.sql)
-- lets any linked, active student SELECT all six coach_data keys of their
-- coach — every other student's record (names, emails, phones, combos,
-- payments, mensualidades), every class roster and everyone's attendance,
-- class.studentData/studentPacks (per-student agreed amounts), and the coach's
-- whole expenses ledger (incomes of every student + general expenses). The
-- Student Portal downloads all of it and filters in the browser.
--
-- WHAT THIS MIGRATION DOES: adds ONE read-only RPC that derives the caller's
-- coach and student exclusively from auth.uid() -> public.student_auth, and
-- returns only the data the Portal needs for that student (and, only when the
-- caller is a family's payment responsible, for that family's members).
-- The server only AUTHORIZES AND REDUCES raw data — it never computes Cobros
-- rules (mensual state, combo counters, slot payments, attendance defaults…).
-- Those keep running in the frontend's shared helpers, unchanged.
--
-- WHAT THIS MIGRATION DOES NOT DO: it does not touch any policy or grant on
-- coach_data/coaches. "student_read_coach_data" and "student_read_coach"
-- stay exactly as they are until the new frontend is live and verified
-- (Migration B / Migration C, separate, later). Applying this file changes
-- nothing observable for the app as it runs today.
--
-- Decisions (approved 2026-09-29):
--   1. Family: if the caller is the family's payment responsible
--      (families[].responsible.studentId), it also receives each member's
--      record, classes, attendance, combos/mensualidades and payment
--      movements. A member who is not the responsible receives ONLY their own
--      data (family = null; never the responsible or siblings).
--   2. A blocked/deactivated COACH does not block the student's portal —
--      same as the current policy. Only student_access_control
--      (student_portal_has_access) gates the student.
--
-- Response contract (jsonb, version 1):
--   {
--     "version": 1,
--     "coach":   { "id", "name", "photo", "sport", "currency" },
--     "student": own record, whitelisted keys (copied only if present):
--                id, name, avatar, photo, email, phone, status, familyId,
--                sport, combos (complete — they are the student's own),
--     "family":  null
--                | { "id", "name" (if present),
--                    "responsibleStudentId": <student.id, same JSON type>,
--                    "members": [ member records, whitelisted keys:
--                                 id, name, avatar, photo, status, familyId,
--                                 sport, combos — never email/phone ] },
--     "classes": only classes whose roster contains an authorized id
--                (the caller, plus members when responsible). Whitelisted
--                keys copied only if present (presence matters:
--                expandClasses keys on hasOwnProperty("cancelledDates")):
--                id, title, days, time, timeEnd, court, date, startDate,
--                endDate, occurrences, cancelledDates, rescheduledDates,
--                dateCancellations, paused, cancelled, cancelType,
--                rescheduledTo, rescheduled, plannedResume
--                + "students": roster reduced to authorized ids
--                + "attendanceLog": [{ date, day (if present),
--                    present, ausente_dada, ausente_reprog — each reduced to
--                    authorized ids }]. Every entry is kept even if all three
--                    arrays end up empty: its mere existence changes the
--                    "unmarked = presente" default for that date.
--                studentData / studentPacks are NEVER returned (coach-only,
--                EditClassScreen).
--     "packages": only packages referenced by an authorized combo's packId:
--                 { id, name, type, qty } — never price.
--     "payment_movements": expenses rows with type = "ingreso" whose
--                 pagoLinkId is referenced by an authorized person's combos
--                 (mensualidades[].pagoLinkId, mensualidades[].historialPagos[]
--                 .pagoLinkId, payments[].pagoLinkId), whitelisted keys
--                 pagoLinkId, type, date, amount, method, mes, voided,
--                 voidedAt + "studentId": the id of the person whose combo
--                 references it. Never general expenses, never note/category.
--     "generated_at": timestamptz
--   }
--
-- Identification of each family member (responsible caller only):
--   - member record:       family.members[].id
--   - classes:             classes[].students contains the member's id
--   - attendance:          classes[].attendanceLog[].present / ausente_dada /
--                          ausente_reprog contain the member's id
--   - combos/mensualidades: embedded in the member's own record
--   - payment movements:   payment_movements[].studentId = member's id
--   Ids are student ids from the coach's roster (unique within it), returned
--   with the same JSON type they have in coach_data, so the frontend resolves
--   Responsable -> miembro -> clases/asistencia/pagos with plain equality and
--   never needs coach_data again.
--
-- Errors (uniform, errcode P0001, never data-revealing):
--   get_my_student_portal: not_authenticated | no_student_link |
--   access_blocked | student_not_found | integrity_error
--
-- Ids are compared as TEXT on both sides (jsonb #>> '{}' / ->>), tolerant of a
-- number-vs-string id anywhere in the JSON, same as update_my_student_profile.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. Internal helper: keep only the elements of a JSON array whose text value
--    is one of p_ids, preserving order. Non-array input -> []. Never callable
--    by clients (REVOKE below); used only inside get_my_student_portal, which
--    runs as its owner.
-- ----------------------------------------------------------------------------
create or replace function public.portal_filter_id_array(p_arr jsonb, p_ids text[])
returns jsonb
language sql
immutable
set search_path to ''
as $function$
  select coalesce(jsonb_agg(x.v order by x.o), '[]'::jsonb)
  from jsonb_array_elements(
         case when jsonb_typeof(p_arr) = 'array' then p_arr else '[]'::jsonb end
       ) with ordinality as x(v, o)
  where (x.v #>> '{}') = any(p_ids);
$function$;

alter function public.portal_filter_id_array(jsonb, text[]) owner to postgres;
revoke all on function public.portal_filter_id_array(jsonb, text[]) from public, anon, authenticated;


-- ----------------------------------------------------------------------------
-- 2. get_my_student_portal()
-- ----------------------------------------------------------------------------
create or replace function public.get_my_student_portal()
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_link_count integer;
  v_coach_id uuid;
  v_student_id bigint;
  v_self_id text;

  v_students jsonb;
  v_classes jsonb;
  v_families jsonb;
  v_expenses jsonb;
  v_packages jsonb;

  v_self_count integer;
  v_self_raw jsonb;
  v_self jsonb;
  v_family_raw jsonb;
  v_family jsonb := null;
  v_members jsonb := '[]'::jsonb;
  v_people jsonb;
  v_auth_ids text[];

  v_coach jsonb;
  v_out_classes jsonb;
  v_out_packages jsonb;
  v_out_movements jsonb;

  c_self_keys     constant text[] := array['id','name','avatar','photo','email','phone','status','familyId','sport','combos'];
  c_member_keys   constant text[] := array['id','name','avatar','photo','status','familyId','sport','combos'];
  c_family_keys   constant text[] := array['id','name'];
  c_class_keys    constant text[] := array['id','title','days','time','timeEnd','court','date','startDate','endDate',
                                           'occurrences','cancelledDates','rescheduledDates','dateCancellations',
                                           'paused','cancelled','cancelType','rescheduledTo','rescheduled','plannedResume'];
  c_att_keys      constant text[] := array['date','day'];
  c_package_keys  constant text[] := array['id','name','type','qty'];
  c_movement_keys constant text[] := array['pagoLinkId','type','date','amount','method','mes','voided','voidedAt'];
begin
  -- 1. Identity: coach and student come ONLY from the caller's own student_auth row.
  if v_uid is null then
    raise exception 'get_my_student_portal: not_authenticated' using errcode = 'P0001';
  end if;

  select count(*) into v_link_count from public.student_auth where id = v_uid;
  if v_link_count <> 1 then
    raise exception 'get_my_student_portal: no_student_link' using errcode = 'P0001';
  end if;

  select coach_id, student_id into v_coach_id, v_student_id
  from public.student_auth
  where id = v_uid;

  if v_coach_id is null or v_student_id is null then
    raise exception 'get_my_student_portal: no_student_link' using errcode = 'P0001';
  end if;

  -- Only the STUDENT's own access gate (decision 2: a blocked coach does not block the portal).
  if not public.student_portal_has_access(v_uid) then
    raise exception 'get_my_student_portal: access_blocked' using errcode = 'P0001';
  end if;

  v_self_id := v_student_id::text;

  -- 2. Raw datasets of THIS coach only. Missing or non-array -> [].
  select data_value into v_students from public.coach_data where coach_id = v_coach_id and data_key = 'students';
  select data_value into v_classes  from public.coach_data where coach_id = v_coach_id and data_key = 'classes';
  select data_value into v_families from public.coach_data where coach_id = v_coach_id and data_key = 'families';
  select data_value into v_expenses from public.coach_data where coach_id = v_coach_id and data_key = 'expenses';
  select data_value into v_packages from public.coach_data where coach_id = v_coach_id and data_key = 'packages';
  if jsonb_typeof(v_students) is distinct from 'array' then v_students := '[]'::jsonb; end if;
  if jsonb_typeof(v_classes)  is distinct from 'array' then v_classes  := '[]'::jsonb; end if;
  if jsonb_typeof(v_families) is distinct from 'array' then v_families := '[]'::jsonb; end if;
  if jsonb_typeof(v_expenses) is distinct from 'array' then v_expenses := '[]'::jsonb; end if;
  if jsonb_typeof(v_packages) is distinct from 'array' then v_packages := '[]'::jsonb; end if;

  -- 3. Own record: exactly one roster entry with this id.
  select count(*) into v_self_count
  from jsonb_array_elements(v_students) as t(e)
  where jsonb_typeof(e) = 'object' and e->>'id' = v_self_id;

  if v_self_count = 0 then
    raise exception 'get_my_student_portal: student_not_found' using errcode = 'P0001';
  elsif v_self_count > 1 then
    raise exception 'get_my_student_portal: integrity_error' using errcode = 'P0001';
  end if;

  select e into v_self_raw
  from jsonb_array_elements(v_students) as t(e)
  where jsonb_typeof(e) = 'object' and e->>'id' = v_self_id;

  select coalesce(jsonb_object_agg(k, v), '{}'::jsonb) into v_self
  from jsonb_each(v_self_raw) as t(k, v)
  where k = any(c_self_keys);

  -- 4. Family — only when the caller is its payment responsible. First match in array order,
  --    the same one StudentApp's families.find(...) picks today. A family without an id never
  --    yields members (StudentApp would otherwise match every student with no familyId).
  select f into v_family_raw
  from jsonb_array_elements(v_families) with ordinality as t(f, o)
  where jsonb_typeof(f) = 'object'
    and f->'responsible'->>'studentId' = v_self_id
  order by o
  limit 1;

  if v_family_raw is not null and (v_family_raw->>'id') is not null then
    select coalesce(jsonb_agg(m.rec order by m.o), '[]'::jsonb) into v_members
    from (
      select (select coalesce(jsonb_object_agg(mk, mv), '{}'::jsonb)
              from jsonb_each(e) as t2(mk, mv)
              where mk = any(c_member_keys)) as rec,
             o
      from jsonb_array_elements(v_students) with ordinality as t(e, o)
      where jsonb_typeof(e) = 'object'
        and (e->>'id') is not null
        and e->>'id' <> v_self_id
        and e->>'familyId' = v_family_raw->>'id'
    ) as m;

    select coalesce(jsonb_object_agg(fk, fv), '{}'::jsonb)
             || jsonb_build_object('responsibleStudentId', v_self->'id', 'members', v_members)
      into v_family
    from jsonb_each(v_family_raw) as t(fk, fv)
    where fk = any(c_family_keys);
  end if;

  -- Authorized people and ids: the caller, plus members only when responsible.
  v_people := jsonb_build_array(v_self) || v_members;
  select coalesce(array_agg(p->>'id'), array[]::text[]) into v_auth_ids
  from jsonb_array_elements(v_people) as t(p)
  where (p->>'id') is not null;

  -- 5. Classes: rosters and attendance reduced to authorized ids; coach-only keys never copied.
  select coalesce(jsonb_agg(
           (select coalesce(jsonb_object_agg(ck, cv), '{}'::jsonb)
            from jsonb_each(c) as t2(ck, cv)
            where ck = any(c_class_keys))
           || jsonb_build_object(
                'students', public.portal_filter_id_array(c->'students', v_auth_ids),
                'attendanceLog', (
                  select coalesce(jsonb_agg(
                           (select coalesce(jsonb_object_agg(ak, av), '{}'::jsonb)
                            from jsonb_each(a) as t4(ak, av)
                            where ak = any(c_att_keys))
                           || jsonb_build_object(
                                'present',        public.portal_filter_id_array(a->'present', v_auth_ids),
                                'ausente_dada',   public.portal_filter_id_array(a->'ausente_dada', v_auth_ids),
                                'ausente_reprog', public.portal_filter_id_array(a->'ausente_reprog', v_auth_ids))
                           order by ao), '[]'::jsonb)
                  from jsonb_array_elements(
                         case when jsonb_typeof(c->'attendanceLog') = 'array' then c->'attendanceLog' else '[]'::jsonb end
                       ) with ordinality as t3(a, ao)
                  where jsonb_typeof(a) = 'object'))
           order by co), '[]'::jsonb)
    into v_out_classes
  from jsonb_array_elements(v_classes) with ordinality as t(c, co)
  where jsonb_typeof(c) = 'object'
    and jsonb_array_length(public.portal_filter_id_array(c->'students', v_auth_ids)) > 0;

  -- 6. Packages referenced by an authorized combo (name/type/qty only, never price).
  select coalesce(jsonb_agg(
           (select coalesce(jsonb_object_agg(pk2, pv2), '{}'::jsonb)
            from jsonb_each(pk) as t2(pk2, pv2)
            where pk2 = any(c_package_keys))
           order by po), '[]'::jsonb)
    into v_out_packages
  from jsonb_array_elements(v_packages) with ordinality as t(pk, po)
  where jsonb_typeof(pk) = 'object'
    and (pk->>'id') in (
      select cb->>'packId'
      from jsonb_array_elements(v_people) as pp(p),
           jsonb_array_elements(case when jsonb_typeof(p->'combos') = 'array' then p->'combos' else '[]'::jsonb end) as cbs(cb)
      where jsonb_typeof(cb) = 'object' and (cb->>'packId') is not null
    );

  -- 7. Payment movements: income rows linked (pagoLinkId) to an authorized person's own combos,
  --    each tagged with that person's studentId. Never general expenses, never other students' incomes.
  with links as (
    select distinct p->'id' as student_id, l.link
    from jsonb_array_elements(v_people) as pp(p),
         jsonb_array_elements(case when jsonb_typeof(p->'combos') = 'array' then p->'combos' else '[]'::jsonb end) as cbs(cb),
         lateral (
           select ms.m->>'pagoLinkId'
           from jsonb_array_elements(case when jsonb_typeof(cb->'mensualidades') = 'array' then cb->'mensualidades' else '[]'::jsonb end) as ms(m)
           union all
           select hs.h->>'pagoLinkId'
           from jsonb_array_elements(case when jsonb_typeof(cb->'mensualidades') = 'array' then cb->'mensualidades' else '[]'::jsonb end) as ms2(m2),
                jsonb_array_elements(case when jsonb_typeof(ms2.m2->'historialPagos') = 'array' then ms2.m2->'historialPagos' else '[]'::jsonb end) as hs(h)
           union all
           select ps.py->>'pagoLinkId'
           from jsonb_array_elements(case when jsonb_typeof(cb->'payments') = 'array' then cb->'payments' else '[]'::jsonb end) as ps(py)
         ) as l(link)
    where jsonb_typeof(cb) = 'object'
      and l.link is not null
      and l.link <> ''
  )
  select coalesce(jsonb_agg(
           (select coalesce(jsonb_object_agg(ek, ev), '{}'::jsonb)
            from jsonb_each(e) as t2(ek, ev)
            where ek = any(c_movement_keys))
           || jsonb_build_object('studentId', links.student_id)
           order by eo, links.student_id::text), '[]'::jsonb)
    into v_out_movements
  from jsonb_array_elements(v_expenses) with ordinality as t(e, eo)
  join links on links.link = e->>'pagoLinkId'
  where jsonb_typeof(e) = 'object'
    and e->>'type' = 'ingreso';

  -- 8. Minimal public coach profile (never email, phone, country, created_at).
  select jsonb_build_object('id', co.id, 'name', co.name, 'photo', co.photo, 'sport', co.sport, 'currency', co.currency)
    into v_coach
  from public.coaches as co
  where co.id = v_coach_id;

  return jsonb_build_object(
    'version', 1,
    'coach', v_coach,
    'student', v_self,
    'family', v_family,
    'classes', v_out_classes,
    'packages', v_out_packages,
    'payment_movements', v_out_movements,
    'generated_at', now()
  );
end;
$function$;

alter function public.get_my_student_portal() owner to postgres;
revoke all on function public.get_my_student_portal() from public, anon;
grant execute on function public.get_my_student_portal() to authenticated, postgres, service_role;


-- ----------------------------------------------------------------------------
-- 3. Deliberately NOT done here (later, separate migrations, only after the new
--    frontend is live and verified):
--
--   Migration B:  drop policy "student_read_coach_data" on public.coach_data;
--   Migration C:  drop policy "student_read_coach" on public.coaches;
-- ----------------------------------------------------------------------------
