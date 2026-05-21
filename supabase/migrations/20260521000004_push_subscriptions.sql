-- Ritmiq — Sistema social: suscripciones Web Push (T6 completado)
--
-- Almacena los endpoints de push por dispositivo/browser.
-- Un usuario puede tener multiples suscripciones (movil, desktop, tablet).
-- Las Edge Functions (send-friend-request, send-share) consultan esta
-- tabla para enviar notificaciones push via VAPID.

create table public.push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  -- endpoint unico por suscripcion (incluye el browser push service URL)
  endpoint    text not null unique,
  -- claves ECDH para cifrar el payload
  p256dh      text not null,
  auth_key    text not null,
  -- metadata opcional para debugging
  user_agent  text,
  platform    text check (platform in ('ios', 'android', 'desktop')),
  created_at  timestamptz not null default now(),
  -- actualizado cuando la PWA re-suscribe (renovacion de endpoint)
  updated_at  timestamptz not null default now()
);

create index idx_push_subs_user on public.push_subscriptions(user_id);

alter table public.push_subscriptions enable row level security;

-- Solo el propio usuario gestiona sus suscripciones.
create policy "push_subs: own read"
  on public.push_subscriptions for select
  using (auth.uid() = user_id);

create policy "push_subs: own insert"
  on public.push_subscriptions for insert
  with check (auth.uid() = user_id);

create policy "push_subs: own update"
  on public.push_subscriptions for update
  using (auth.uid() = user_id);

create policy "push_subs: own delete"
  on public.push_subscriptions for delete
  using (auth.uid() = user_id);

-- Las Edge Functions (service role) necesitan leer suscripciones
-- de OTROS usuarios para enviarles push (ej: send-share envia push
-- al receiver, no al sender).
-- Esto se resuelve via service role en las Edge Functions — el service
-- role bypasea RLS por diseno en Supabase.

-- Trigger updated_at
create or replace function public.handle_push_sub_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger push_sub_updated_at
  before update on public.push_subscriptions
  for each row execute function public.handle_push_sub_updated_at();
