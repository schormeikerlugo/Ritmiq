-- Ritmiq — tabla `tunnel_endpoints`
--
-- El cliente desktop publica aquí la URL pública actual de su Cloudflare
-- Tunnel (puede ser un Quick Tunnel cuya URL cambia en cada arranque).
-- La PWA del mismo usuario lee/observa esta tabla para conocer siempre la
-- URL vigente y reconectarse sin intervención manual.
--
-- Una sola fila por usuario (PRIMARY KEY user_id). RLS estricto: cada
-- usuario solo ve y escribe su propia fila.

create table public.tunnel_endpoints (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  url         text not null,
  source      text not null default 'quick' check (source in ('quick','named','custom')),
  updated_at  timestamptz not null default now()
);

create index idx_tunnel_endpoints_updated on public.tunnel_endpoints(updated_at desc);

alter table public.tunnel_endpoints enable row level security;

create policy "tunnel_endpoints_select_own"
  on public.tunnel_endpoints for select
  using (auth.uid() = user_id);

create policy "tunnel_endpoints_insert_own"
  on public.tunnel_endpoints for insert
  with check (auth.uid() = user_id);

create policy "tunnel_endpoints_update_own"
  on public.tunnel_endpoints for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "tunnel_endpoints_delete_own"
  on public.tunnel_endpoints for delete
  using (auth.uid() = user_id);

-- Realtime para que la PWA reciba la nueva URL sin polling.
alter publication supabase_realtime add table public.tunnel_endpoints;
