/**
 * enrich-tags client — dispara el enriquecimiento de `artist_tags` para
 * un batch de artistas via la edge function `enrich-tags`.
 *
 * Idempotente: el servidor maneja TTL 30d, no es necesario que el cliente
 * lleve contabilidad de qué ya fue enriquecido.
 *
 * Best-effort: la respuesta del servidor no se necesita para nada (todos
 * los consumers de `artist_tags` la leen on-demand). Esta llamada es
 * fire-and-forget desde el cliente.
 *
 * @module @ritmiq/ui/lib/enrich-tags
 */
import { supabase } from './supabase.js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY;

const MAX_PER_REQUEST = 50;
// Throttle: no llamar mas seguido que cada X ms para el mismo conjunto
// de artistas. Evita spam si el caller se llama desde un effect que
// se dispara con frecuencia.
const MIN_INTERVAL_MS = 60_000;
const LS_KEY = 'ritmiq.enrich-tags-last-call';

function shouldThrottle() {
  if (typeof localStorage === 'undefined') return false;
  try {
    const lastRaw = localStorage.getItem(LS_KEY);
    if (!lastRaw) return false;
    const last = Number.parseInt(lastRaw, 10);
    if (!Number.isFinite(last)) return false;
    return Date.now() - last < MIN_INTERVAL_MS;
  } catch {
    return false;
  }
}

function markCall() {
  if (typeof localStorage === 'undefined') return;
  try { localStorage.setItem(LS_KEY, String(Date.now())); } catch {}
}

/**
 * Enriquece tags para un batch de artistas (max 50). Si hay mas, se trunca.
 * Fire-and-forget por default; pasa `await: true` si necesitas el payload.
 *
 * @param {string[]} artists nombres de artistas
 * @param {{ force?: boolean, await?: boolean }} [opts]
 * @returns {Promise<{enriched:number,cached:number,fetched:number,failed:string[]} | null>}
 */
export async function enrichArtistTags(artists, opts = {}) {
  if (!SUPABASE_URL) return null;
  if (!Array.isArray(artists) || artists.length === 0) return null;
  if (!opts.force && shouldThrottle()) return null;

  // Dedup + clamp en cliente para no mandar payloads grandes innecesarios.
  const seen = new Set();
  const clean = [];
  for (const a of artists) {
    if (typeof a !== 'string') continue;
    const k = a.trim().toLowerCase();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    clean.push(a.trim());
    if (clean.length >= MAX_PER_REQUEST) break;
  }
  if (clean.length === 0) return null;

  markCall();

  try {
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token ?? SUPABASE_ANON;
    if (!token) return null;

    const promise = fetch(`${SUPABASE_URL}/functions/v1/enrich-tags`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: SUPABASE_ANON ?? '',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ artists: clean }),
    });

    if (!opts.await) {
      // Fire-and-forget: no esperamos el resultado, solo capturamos errores
      // para no contaminar la consola con uncaught rejections.
      promise.catch(() => {});
      return null;
    }

    const r = await promise;
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}
