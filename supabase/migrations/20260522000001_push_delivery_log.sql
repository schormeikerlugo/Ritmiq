-- Log de entregas Web Push fallidas para diagnostico operativo.
--
-- La Edge Function send-push-notification registra aqui cada vez que
-- un endpoint devuelve un codigo de estado distinto de 200/404/410:
--   - 200/201 \u2192 OK, no se loguea (volumen alto, sin valor).
--   - 404/410 \u2192 endpoint expirado, ya se borra de push_subscriptions,
--     no se loguea (es comportamiento normal).
--   - 429 \u2192 throttling APNs o FCM, util para detectar si estamos
--     spammeando.
--   - 5xx \u2192 problemas del servicio push.
--   - 4xx (otros) \u2192 VAPID mal firmado, payload roto, etc.
--
-- Purge automatico: rows > 30 dias se limpian con un cron (definir
-- aparte si crece demasiado). Por ahora no hay cron \u2014 la tabla es
-- de bajo volumen porque los errores frecuentes son 404/410.

create table if not exists push_delivery_log (
  id          uuid          primary key default gen_random_uuid(),
  endpoint    text          not null,
  user_id     uuid          references auth.users (id) on delete cascade,
  status_code int           not null,
  error_msg   text,
  created_at  timestamptz   not null default now()
);

-- Indice por created_at para purge eficiente y consultas recientes.
create index if not exists push_delivery_log_created_idx
  on push_delivery_log (created_at desc);

-- Indice por user_id para diagnostico per-usuario.
create index if not exists push_delivery_log_user_idx
  on push_delivery_log (user_id, created_at desc);

-- RLS: solo accesible con service role. No exponemos al cliente
-- porque contiene endpoints que no deben filtrarse cross-user.
alter table push_delivery_log enable row level security;

-- Sin policies = sin acceso anon/authenticated. Solo service role
-- bypasea RLS.
