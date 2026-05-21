-- Ritmiq — Sistema social: perfiles de usuario
--
-- Cada usuario tiene exactamente un perfil. Se crea automaticamente
-- via trigger al registrarse (o manualmente en el primer login).
-- El username es el @handle publico, unico en toda la plataforma.

create table public.profiles (
  user_id       uuid primary key references auth.users(id) on delete cascade,
  username      text unique not null
                  check (
                    length(username) >= 3 and
                    length(username) <= 24 and
                    username ~ '^[a-z0-9_]+$'
                  ),
  display_name  text        check (length(display_name) <= 60),
  avatar_url    text,
  bio           text        check (length(bio) <= 200),
  -- privacidad: controla si los amigos ven "Escuchando ahora"
  show_activity boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index idx_profiles_username on public.profiles(username);

alter table public.profiles enable row level security;

-- Lectura publica: cualquier usuario autenticado puede ver perfiles
-- (necesario para buscar amigos por @handle).
create policy "profiles: read authenticated"
  on public.profiles for select
  using (auth.role() = 'authenticated');

-- Solo el propio usuario puede insertar/actualizar su perfil.
create policy "profiles: insert own"
  on public.profiles for insert
  with check (auth.uid() = user_id);

create policy "profiles: update own"
  on public.profiles for update
  using (auth.uid() = user_id);

-- Trigger: actualiza updated_at en cada UPDATE.
create or replace function public.handle_profile_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profile_updated_at
  before update on public.profiles
  for each row execute function public.handle_profile_updated_at();

-- Trigger: genera un username por defecto al crear un perfil si no
-- se pasa uno. Toma los primeros 8 chars del UUID del usuario.
-- El cliente DEBERA actualizar esto en el flujo de onboarding social.
create or replace function public.handle_new_profile()
returns trigger language plpgsql security definer as $$
begin
  -- Solo auto-genera username si no se paso uno valido
  if new.username is null or length(new.username) < 3 then
    new.username := 'user_' || lower(replace(new.user_id::text, '-', ''))[:8];
  end if;
  return new;
end;
$$;

create trigger new_profile_username
  before insert on public.profiles
  for each row execute function public.handle_new_profile();
