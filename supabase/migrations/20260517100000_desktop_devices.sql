-- Fase 7: Discovery automatica de desktops para devices invitados.
--
-- Cuando el owner aprueba un device, su desktop escribe la relacion
-- (owner_user_id, guest_user_id) en `desktop_devices`. La PWA del
-- guest, al iniciar sesion, consulta los desktops disponibles via
-- JOIN con `tunnel_endpoints` y se ahorra pegar la URL manualmente.
--
-- La autoridad sigue siendo el desktop: esta tabla solo es discovery.
-- Aunque alguien aparezca aqui, sin device_token no puede consumir nada.

CREATE TABLE IF NOT EXISTS public.desktop_devices (
  owner_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  guest_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name  text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_user_id, guest_user_id)
);

CREATE INDEX IF NOT EXISTS idx_desktop_devices_guest
  ON public.desktop_devices(guest_user_id);

ALTER TABLE public.desktop_devices ENABLE ROW LEVEL SECURITY;

-- El owner administra (insert/update/delete) sus propios invitados.
CREATE POLICY "owner manages own list" ON public.desktop_devices
  FOR ALL
  USING (auth.uid() = owner_user_id)
  WITH CHECK (auth.uid() = owner_user_id);

-- El guest puede leer las filas donde el aparece (para discovery).
CREATE POLICY "guest reads own entries" ON public.desktop_devices
  FOR SELECT
  USING (auth.uid() = guest_user_id);

-- View conveniente para que la PWA descubra desktops disponibles.
-- Devuelve la tunnel_url de cada owner que ha aprobado al user actual.
-- Se filtra automaticamente por RLS de `tunnel_endpoints` (cada user ve
-- solo la suya); pero como hacemos JOIN como el guest, necesitamos que
-- el guest pueda ver el endpoint del owner — lo gestionamos via una
-- funcion SECURITY DEFINER.

CREATE OR REPLACE FUNCTION public.list_available_desktops()
RETURNS TABLE (
  owner_user_id uuid,
  display_name  text,
  tunnel_url    text,
  updated_at    timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    dd.owner_user_id,
    COALESCE(dd.display_name, 'Desktop') AS display_name,
    te.url AS tunnel_url,
    te.updated_at
  FROM public.desktop_devices dd
  JOIN public.tunnel_endpoints te ON te.user_id = dd.owner_user_id
  WHERE dd.guest_user_id = auth.uid()
    AND te.url IS NOT NULL;
$$;

GRANT EXECUTE ON FUNCTION public.list_available_desktops() TO authenticated;
