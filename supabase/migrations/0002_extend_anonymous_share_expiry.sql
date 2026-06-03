-- Extend the retention window for anonymous (signed-out) uploads from 7 days
-- to 365 days. New uploads already use 365 days (see src/worker/index.ts);
-- this backfills existing anonymous shares so they match.
--
-- expires_at is recomputed from created_at (not from the current expires_at)
-- so the statement is idempotent: re-running always yields created_at + 365
-- days regardless of any prior value, and it mirrors the worker's own logic
-- (upload time + 365 days). Signed-in users keep a null expiry, and
-- soft-deleted rows are left untouched. The shares_updated_at trigger refreshes
-- updated_at automatically.

update public.shares
set expires_at = created_at + interval '365 days'
where owner_user_id is null
  and expires_at is not null
  and deleted_at is null;
