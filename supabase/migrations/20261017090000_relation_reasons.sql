-- Each topic link carries one sentence saying why it's there (owner, 2026-10-17), shown when the
-- student hovers the link on the Atlas. Links made before this have none until "Find connections"
-- explains them.
alter table public.relations add column reason text check (reason is null or char_length(reason) <= 300);
