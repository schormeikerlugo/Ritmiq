-- Spotify Web API tokens por usuario (Fase 6.3).
--
-- OAuth PKCE flow: el usuario autoriza Ritmiq a leer su historial Spotify
-- (scopes: user-top-read, user-read-recently-played). El access_token
-- expira en 1h; el refresh_token persiste hasta que el usuario revoque
-- el acceso desde su panel de Spotify.
--
-- Solo el owner puede leer su propio token. Service role escribe via la
-- edge function `spotify-callback`.
--
-- TTL implicito: el access_token incluye expires_at; el refresh_token
-- no expira hasta revoke explicito o 1 ano sin uso.

create table if not exists public.spotify_tokens (
  user_id        uuid primary key references auth.users(id) on delete cascade,
  access_token   text not null,
  refresh_token  text not null,
  expires_at     timestamptz not null,        -- cuando vence access_token
  scope          text not null,                -- lista separada por espacios
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists idx_spotify_tokens_expires
  on public.spotify_tokens(expires_at);

alter table public.spotify_tokens enable row level security;

-- Owner puede LEER su propio token.
drop policy if exists "spotify_tokens_owner_read" on public.spotify_tokens;
create policy "spotify_tokens_owner_read"
  on public.spotify_tokens for select
  to authenticated
  using (auth.uid() = user_id);

-- Owner puede BORRAR (revocar localmente sin pasar por Spotify).
drop policy if exists "spotify_tokens_owner_delete" on public.spotify_tokens;
create policy "spotify_tokens_owner_delete"
  on public.spotify_tokens for delete
  to authenticated
  using (auth.uid() = user_id);

-- Service role bypasea RLS para los INSERT/UPDATE desde la edge function.
-- No creamos policies para INSERT/UPDATE explicitas porque solo service
-- role escribe (callback + refresh).

comment on table public.spotify_tokens is
  'OAuth tokens de Spotify Web API por usuario. PKCE flow. Service role escribe via edge spotify-callback. Owner lee/borra.';
