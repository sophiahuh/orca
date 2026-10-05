-- Uploads to Storage (Phase 4, Task 6). The server reads each uploaded PDF into material_pages
-- and records what it found; the columns that describe the file and its reading are the server's.

-- Text hidden in the file that the reader dropped: { "items": n, "pages": [page numbers] }.
-- Null until the file has been read (or for a material with no file).
alter table public.materials add column hidden_text jsonb
  check (hidden_text is null or (jsonb_typeof(hidden_text) = 'object' and jsonb_typeof(hidden_text -> 'items') = 'number' and jsonb_typeof(hidden_text -> 'pages') = 'array'));

-- Students change only what they told Orca about a material (and their reflection); the file's
-- path, hash, size, type, reading status, error and hidden-text record are written by the server.
-- Without this, a student could reset a read material to 'uploaded' and have it processed again.
revoke update on public.materials from anon, authenticated;
grant update (filename, type, assigned, due, reflect, reflection) on public.materials to authenticated;
