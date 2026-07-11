-- Ritmiq — multi-endpoint por usuario en `tunnel_endpoints`.
--
-- Fase 2 (servidor headless 24/7): además del endpoint del DESKTOP, el
-- servidor casero publica su propio endpoint. Un usuario puede tener AMBOS
-- disponibles a la vez y el cliente elige (desktop rápido / servidor 24/7).
--
-- Cambio: la clave pasa de `user_id` a `(user_id, kind)`. Las filas
-- existentes se etiquetan como 'desktop' (comportamiento previo).
--
-- RLS: se mantiene owner-only (auth.uid() = user_id).

-- 1) Nueva columna `kind`.
alter table public.tunnel_endpoints
  add column if not exists kind text not null default 'desktop'
    check (kind in ('desktop', 'server'));

-- 2) Reemplazar la PK (user_id) por (user_id, kind).
--    Postgres nombra la PK original `tunnel_endpoints_pkey`.
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'tunnel_endpoints_pkey'
      and conrelid = 'public.tunnel_endpoints'::regclass
  ) then
    alter table public.tunnel_endpoints drop constraint tunnel_endpoints_pkey;
  end if;
end $$;

alter table public.tunnel_endpoints
  add primary key (user_id, kind);

-- 3) Índice de consulta por usuario (ya existía uno por updated_at).
create index if not exists idx_tunnel_endpoints_user_kind
  on public.tunnel_endpoints(user_id, kind);

-- Las políticas RLS existentes (select/insert/update/delete own) siguen
-- válidas porque se basan en user_id. Realtime ya incluye la tabla.
