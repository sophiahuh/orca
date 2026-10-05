-- Uploaded files: a private bucket, one folder per student ("<owner>/<material id>/<safe name>").
-- PDFs only for now, 25 MB at most.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('materials', 'materials', false, 26214400, array['application/pdf']);

create policy "own files: read" on storage.objects for select to authenticated
  using (bucket_id = 'materials' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "own files: add" on storage.objects for insert to authenticated
  with check (bucket_id = 'materials' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "own files: replace" on storage.objects for update to authenticated
  using (bucket_id = 'materials' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'materials' and (storage.foldername(name))[1] = (select auth.uid())::text);
-- No delete: files stay, like everything else; deleting the account is the way out.
