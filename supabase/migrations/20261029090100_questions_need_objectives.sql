-- Every question tests one objective (2026-10-26): every generation path writes questions only for
-- objectives it was given, and the hosted database checked had none without one. Fails, and
-- changes nothing, if a question without an objective exists.
alter table public.questions alter column objective_id set not null;
