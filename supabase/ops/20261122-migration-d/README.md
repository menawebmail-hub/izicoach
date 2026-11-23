# Migration D: production runbook (not applied)

These scripts prepare the student portal for stages 2.1 and 2.2 of BUG-AGENDA-05 (advance absence notices, and time and court of a single date). Run them in the Supabase SQL editor of the production project, in order, and only with the owner's explicit authorization for each step. They were generated from `supabase/migrations/` by `.local-tests/ops/build-migration-d-ops.mjs` and validated on PGlite by `.local-tests/ops/migration-d-ops.pglite.test.mjs` (7/7). Do not edit them by hand.

| Step | File | Writes | Stop if |
|---|---|---|---|
| 1 | `01_preflight_readonly.sql` | nothing | any row has `ok = false` |
| 2 | `02_repair_history.sql` | 4 rows in `supabase_migrations.schema_migrations` | it aborts |
| 3 | `03_apply_migration_d.sql` | `get_my_student_portal()`, 2 internal helper functions, 1 history row | it aborts |
| 4 | `04_postcheck_readonly.sql` | nothing | any row has `ok = false`: run step 5 |
| — | `05_rollback_migration_d.sql` | restores Migration A's function, drops the helpers, deletes D's history row | — |

What each step does:

- **Step 1** compares production with the repo:
  - the migration history;
  - the two policies that were dropped by hand;
  - an `md5(prosrc)` fingerprint of each relevant function, plus its owner and SECURITY DEFINER flag;
  - the grants on the portal function.

  If a function's fingerprint differs, compare `pg_get_functiondef(...)` with the repo file before doing anything else.
- **Step 2** only records the 4 migrations that were applied by hand. It touches no schema object.
- **Step 3** applies Migration D in a single transaction, with guards before and after.

All write scripts (steps 2, 3 and 5) abort the whole transaction when a check fails, and then nothing is changed.

After step 4, validate with a TEST student account only. The frontend merge (`fix/agenda-edit-scope` → `main`) comes after this.
