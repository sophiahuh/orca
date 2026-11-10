-- Unanchored questions (owner, 2026-11-10): a course whose objectives came from a pasted syllabus
-- can lose every file that teaches them (its lecture removed; a held-back practice exam is never
-- read), and then neither Orca's writer nor the connector's add_questions can write a question,
-- because one for a material objective must carry a source anchor and there is no page to anchor
-- to. Such an objective now takes a question marked `unanchored`: no anchor, no material, stored
-- and shown as not course-specific, exactly like an inferred objective's. The server decides when
-- (no live, non-held-back material teaches the objective: src/lib/server/connector/add-questions.ts);
-- the check below only makes the flag the one way past the anchor rule.
alter table public.questions add column unanchored boolean not null default false;

create or replace function private.check_question_anchor() returns trigger
language plpgsql set search_path = '' as $$
declare
  origin text;
begin
  select o.origin into origin from public.objectives o where o.id = new.objective_id;
  if origin = 'inferred' and new.anchor is not null then
    raise exception 'Question % is for an inferred objective and must not carry a source anchor', new.id
      using errcode = 'check_violation';
  elsif new.unanchored and new.anchor is not null then
    raise exception 'Question % is marked unanchored and must not carry a source anchor', new.id
      using errcode = 'check_violation';
  elsif coalesce(origin, '') <> 'inferred' and not new.unanchored and new.anchor is null then
    raise exception 'Question % needs a source anchor into the course material', new.id
      using errcode = 'check_violation';
  end if;
  return null;
end;
$$;

drop trigger if exists question_anchor on public.questions;
create constraint trigger question_anchor after insert or update of anchor, objective_id, unanchored on public.questions
  deferrable initially deferred for each row execute function private.check_question_anchor();
