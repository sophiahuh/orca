-- Every live objective holds state now, with or without questions (weak points first:
-- docs/superpowers/plans/2026-11-05-weak-points-plans-b-c.md, Task 2). Evidence recorded earlier on an
-- objective that had no questions left no snapshot, and readCourseState reads snapshots only, so each
-- such objective (as it stands now, after merges) gets a stale placeholder: the next read folds its
-- events in. mark_stale inserts only for an objective row that exists.
do $$
declare
  r record;
begin
  for r in
    select distinct t.target
      from (select private.resolve_objective(e.objective_id) as target from public.evidence_events e) t
     where not exists (select 1 from public.objective_state s where s.objective_id = t.target)
  loop
    perform private.mark_stale(r.target, true);
  end loop;
end $$;
