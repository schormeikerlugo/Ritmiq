/**
 * Singleton del cliente Supabase para la UI.
 * Lee URL y anon key de variables Vite (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY).
 *
 * Reescritura runtime: si la URL apunta a 127.0.0.1/localhost (caso típico
 * de Supabase local en dev) y la app corre desde otra IP de la LAN
 * (PWA en el móvil, por ejemplo 192.168.68.x), reemplazamos el host por
 * el de window.location. Así Supabase local se sirve desde el PC sin tocar
 * el .env y la PWA puede llegar.
 */

import { createSupabase } from '@ritmiq/api/supabase';

function resolveSupabaseUrl() {
  const env = import.meta.env.VITE_SUPABASE_URL ?? '';
  if (typeof window === 'undefined') return env;

  try {
    const u = new URL(env);
    const hostIsLoopback = u.hostname === '127.0.0.1' || u.hostname === 'localhost';
    const pageHost = window.location.hostname;
    const pageIsLoopback = pageHost === '127.0.0.1' || pageHost === 'localhost';

    // Si el env apunta a loopback y estamos en una IP de LAN, reescribimos.
    if (hostIsLoopback && !pageIsLoopback) {
      u.hostname = pageHost;
      return u.toString().replace(/\/$/, '');
    }
  } catch {
    /* env malformada, devolvemos tal cual */
  }
  return env;
}

const url = resolveSupabaseUrl();
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  console.warn('[supabase] missing URL or anon key');
} else {
  console.info('[supabase] using', url);
}

export const supabase = createSupabase(url ?? '', anonKey ?? '');
