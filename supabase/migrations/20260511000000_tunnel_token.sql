-- Añade el access token al registry del tunnel.
--
-- Antes, el usuario tenía que pegar URL + token en el PWA cada vez que el
-- almacenamiento del navegador se vaciaba (iOS Safari evicta localStorage
-- tras ~7 días sin uso, modo incógnito, etc.). Guardando el token cifrado por
-- RLS en Supabase, la PWA lo rehidrata automáticamente con la sesión.
--
-- RLS heredada de la tabla: cada usuario sólo ve su propia fila.

alter table public.tunnel_endpoints
  add column if not exists access_token text;
