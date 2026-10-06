-- A course can inherit the account-wide defaults instead of taking a one-time copy. A non-null
-- value is that course's explicit, highest-priority override.
alter table public.courses
  alter column review_config drop not null,
  alter column weights drop not null;

comment on column public.courses.review_config is 'Course review-config override; null inherits profiles.default_review_config.';
comment on column public.courses.weights is 'Course material-weight override; null inherits profiles.default_weights.';

-- Until now each course was created with a copy of the defaults. A copy that still equals what the
-- course would inherit (the owner's account default, else Orca's built-in one, DEFAULT_CONFIG and
-- DEFAULT_WEIGHTS in src/lib/data.ts) was never a choice for that course: it becomes inherit again.
-- A course whose settings differ keeps them as its override.
update public.courses c
set review_config = null
from public.profiles p
where p.owner_id = c.owner_id
  and c.review_config = coalesce(p.default_review_config, '{"quick":{"duration":"10 min","cadence":"Daily"},"deep":{"duration":"30 min","cadence":"Weekly"},"exam":{"duration":"10 hours","cadence":"1 wk before exam"}}'::jsonb);

update public.courses c
set weights = null
from public.profiles p
where p.owner_id = c.owner_id
  and c.weights = coalesce(p.default_weights, '{"homework":25,"practiceExams":25,"practiceProblems":25,"lectures":25}'::jsonb);
