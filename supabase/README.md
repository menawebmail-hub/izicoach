# supabase/

IziCoach already had a live Supabase project — schema, RLS, and RPCs —
before any of it was versioned in this repo. Versioned migration history
starts **2026-08-31**.

`migrations/20260831180000_security_hardening.sql` documents and verifies
the auth/invites/student-authorization hardening that was applied and
tested against production during that work (email confirmation gate,
`invites`/`student_auth` RLS and grants, the invite RPCs). It is **not** a
full database bootstrap — a fresh install still needs the pre-existing
schema captured and versioned separately before this directory alone could
rebuild the database from scratch.

Do not run any migration here manually against production without first
checking for schema drift against what's actually live.
