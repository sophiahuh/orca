-- Owner, 2026-11-07: extraction output has no length limits (as decided 2026-10-25). A link's
-- reason longer than 300 characters would fail the whole structure save, so the column's limit goes.
alter table public.relations drop constraint relations_reason_check;
