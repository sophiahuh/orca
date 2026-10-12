-- Courses and their uploaded material. Ids are UUIDs chosen by the browser (it updates the screen
-- before the save lands). Children reference (id, owner_id) so a row can only hang off a parent
-- with the same owner: RLS checks the row's own owner_id, the composite key checks the parent's.

create table public.courses (
  id uuid primary key,
  owner_id uuid not null default auth.uid() references auth.users on delete cascade,
  slug text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text not null check (length(trim(name)) > 0),
  short text not null,
  variant text not null check (variant in ('ald', 'circuit', 'signals', 'linear', 'stats')),
  pos_x double precision not null,
  pos_y double precision not null,
  trail text,
  -- ReviewConfig and the material-type sliders: always read and written whole; zod checks the shape.
  review_config jsonb not null check (jsonb_typeof(review_config) = 'object'),
  weights jsonb not null check (jsonb_typeof(weights) = 'object'),
  created_at timestamptz not null default now(),
  unique (owner_id, slug),
  unique (id, owner_id)
);

create table public.materials (
  id uuid primary key,
  owner_id uuid not null default auth.uid() references auth.users on delete cascade,
  course_id uuid not null,
  filename text not null,
  type text not null check (type in ('Syllabus', 'Past exam', 'Practice problems', 'Practice exam', 'Homework', 'Lecture', 'Other')),
  assigned date,
  due date,
  reflect boolean not null default false,
  -- { at, note, objectiveIds } once the student has reflected.
  reflection jsonb check (reflection is null or jsonb_typeof(reflection) = 'object'),
  -- The file in the `materials` bucket: "<owner>/<material id>/<safe name>".
  storage_path text,
  -- sha256 of the file, so a re-upload of the same file is recognised.
  content_hash text,
  size_bytes integer check (size_bytes is null or size_bytes between 0 and 26214400),
  mime text,
  status text not null default 'uploaded' check (status in ('uploaded', 'reading', 'processing', 'ready', 'failed')),
  error text,
  created_at timestamptz not null default now(),
  unique (id, owner_id),
  foreign key (course_id, owner_id) references public.courses (id, owner_id) on delete cascade,
  check (storage_path is null or storage_path like owner_id::text || '/' || id::text || '/%'),
  check ((status = 'failed') = (error is not null))
);
create unique index materials_same_file on public.materials (course_id, content_hash) where content_hash is not null;
create index on public.materials (owner_id);
create index on public.materials (course_id);

-- The material's text, one row per page or slide, read once on the server. Model calls get only
-- the pages they need (through objective anchors).
create table public.material_pages (
  owner_id uuid not null default auth.uid() references auth.users on delete cascade,
  material_id uuid not null,
  n integer not null check (n >= 1),
  text text not null,
  primary key (material_id, n),
  foreign key (material_id, owner_id) references public.materials (id, owner_id) on delete cascade
);
create index on public.material_pages (owner_id);

alter table public.courses enable row level security;
alter table public.materials enable row level security;
alter table public.material_pages enable row level security;

create policy "own courses: read" on public.courses for select to authenticated using (owner_id = (select auth.uid()));
create policy "own courses: add" on public.courses for insert to authenticated with check (owner_id = (select auth.uid()));
create policy "own courses: change" on public.courses for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));

create policy "own materials: read" on public.materials for select to authenticated using (owner_id = (select auth.uid()));
create policy "own materials: add" on public.materials for insert to authenticated with check (owner_id = (select auth.uid()));
-- The platform's missing policy: students can update their own material (reflection, dates).
create policy "own materials: change" on public.materials for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));

-- Pages are written by the server (service role) only.
create policy "own pages: read" on public.material_pages for select to authenticated using (owner_id = (select auth.uid()));

-- Nothing is deleted from the app (archive or merge); deleting the account removes everything.
