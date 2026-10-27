-- When a class meets, and the weekdays its "Twice a week" / "Weekly" quick review and dive fall on
-- (src/lib/mastery/review-days.ts). Course-only, never inherited from the profile. Null = not set.
alter table public.courses
  add column schedule jsonb check (schedule is null or jsonb_typeof(schedule) = 'object');

comment on column public.courses.schedule is 'Class meetings ({day, start, end}) and the student''s review weekdays (quickDays, deepDays; null = the day before class); null = not set.';
