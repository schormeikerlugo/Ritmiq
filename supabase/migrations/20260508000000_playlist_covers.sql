-- Ritmiq — añadir portadas personalizables a playlists.

alter table public.playlists
  add column if not exists cover_url text;

-- Bucket para portadas de playlists (público en lectura).
insert into storage.buckets (id, name, public)
values ('playlist-covers', 'playlist-covers', true)
on conflict (id) do nothing;

create policy "playlist-covers: public read"
  on storage.objects for select
  using (bucket_id = 'playlist-covers');

create policy "playlist-covers: authenticated insert"
  on storage.objects for insert
  with check (bucket_id = 'playlist-covers' and auth.role() = 'authenticated');

create policy "playlist-covers: owner update"
  on storage.objects for update
  using (bucket_id = 'playlist-covers' and auth.uid() = owner);

create policy "playlist-covers: owner delete"
  on storage.objects for delete
  using (bucket_id = 'playlist-covers' and auth.uid() = owner);
