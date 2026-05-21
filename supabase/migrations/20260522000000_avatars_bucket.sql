-- Ritmiq — bucket de Storage para avatares de perfil.
--
-- Lectura publica (los amigos necesitan ver el avatar del otro), escritura
-- restringida al propio usuario. Cada avatar se sube como:
--   avatars/<user_id>/avatar.<ext>
--
-- Para simplicidad usamos rutas determinísticas por usuario — al re-subir
-- el archivo se sobreescribe. Esto permite cache busting via query param
-- (?v=<timestamp>) sin acumular blobs huerfanos.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'avatars',
  'avatars',
  true,
  2097152,  -- 2 MB max por avatar
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do nothing;

-- Lectura publica (cualquier usuario, incluso anonimo, puede ver avatares).
create policy "avatars: public read"
  on storage.objects for select
  using (bucket_id = 'avatars');

-- Insert: solo el propio usuario puede subir en su carpeta.
-- La ruta debe empezar con su user_id (ej: avatars/<uid>/avatar.png).
create policy "avatars: own insert"
  on storage.objects for insert
  with check (
    bucket_id = 'avatars'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

-- Update: idem — solo en su propia carpeta.
create policy "avatars: own update"
  on storage.objects for update
  using (
    bucket_id = 'avatars'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

-- Delete: idem.
create policy "avatars: own delete"
  on storage.objects for delete
  using (
    bucket_id = 'avatars'
    and auth.uid()::text = (storage.foldername(name))[1]
  );
