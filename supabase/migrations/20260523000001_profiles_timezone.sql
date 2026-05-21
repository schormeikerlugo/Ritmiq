-- Anadir timezone IANA a profiles para enviar reminders en hora
-- local del usuario.
--
-- Frontend la setea con Intl.DateTimeFormat().resolvedOptions().timeZone
-- que devuelve strings IANA validos: 'America/Caracas', 'Europe/Madrid',
-- 'America/Mexico_City', 'UTC', etc.
--
-- La Edge Function streak-reminder calcula:
--   user_local_hour = extract(hour from now() at time zone profile.timezone)
-- y solo envia si user_local_hour coincide con el slot (12 o 21).
--
-- Default 'UTC' para usuarios pre-existentes \u2014 recibiran reminders
-- en hora UTC hasta que actualicen su perfil (auto en proximo login).

alter table profiles
  add column if not exists timezone text not null default 'UTC';

-- Indice no es necesario \u2014 el cron lee todos los users de
-- push_subscriptions, no filtra por timezone.

comment on column profiles.timezone is
  'IANA timezone (ej. America/Caracas, Europe/Madrid). Lo setea el frontend al login con Intl.DateTimeFormat().resolvedOptions().timeZone. Usado por streak-reminder para enviar en hora local.';
