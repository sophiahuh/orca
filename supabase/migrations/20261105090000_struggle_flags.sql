-- Weak points first (docs/superpowers/specs/2026-11-04-weak-points-first-design.md): confusion
-- events become struggle flags. flag_source says where a flag came from (its strength follows
-- from it in code, src/lib/mastery/flags.ts); page is the page or slide in material_id it's about.
-- Existing confusion rows were all homework reflections: the new column is filled for them once
-- here (no existing value is rewritten). Answers carry neither column.

alter table public.evidence_events
  add column flag_source text check (flag_source in ('homework', 'handwritten-marker', 'connector', 'slide', 'manual')),
  add column page integer check (page is null or page >= 1);

update public.evidence_events set flag_source = 'homework' where kind = 'confusion';

-- The Phase 4 rule (material and note required on every confusion row) is replaced: manual and
-- connector flags have no material, slide and manual flags have no note.
do $$
declare
  c text;
begin
  select conname into c from pg_constraint
   where conrelid = 'public.evidence_events'::regclass and contype = 'c'
     and pg_get_constraintdef(oid) like '%confusion%' and pg_get_constraintdef(oid) like '%note IS NOT NULL%';
  if c is null then
    raise exception 'struggle_flags: the old confusion check constraint was not found';
  end if;
  execute format('alter table public.evidence_events drop constraint %I', c);
end $$;

alter table public.evidence_events add constraint evidence_events_flag_check check (
  kind <> 'confusion' or (
    question_id is null
    and flag_source is not null
    and (material_id is not null or flag_source in ('manual', 'connector'))
    and (page is null or material_id is not null)
    and (flag_source <> 'slide' or (material_id is not null and page is not null))
  )
);
alter table public.evidence_events add constraint evidence_events_answer_no_flag check (
  kind <> 'answer' or (flag_source is null and page is null)
);

comment on column public.evidence_events.flag_source is 'Struggle flags (kind confusion): where the flag came from. connector = check me; every other source = struggled.';
comment on column public.evidence_events.page is 'Struggle flags: the page (a .pptx: the slide) in material_id the flag is about; null when not about a page.';

-- Reserved for Plan B (the marker description in Settings is screened like Notes for Orca).
alter table public.security_events drop constraint security_events_kind_check;
alter table public.security_events add constraint security_events_kind_check
  check (kind in ('upload', 'reflection_note', 'student_answer', 'generated', 'orca_notes', 'marker_notes'));
