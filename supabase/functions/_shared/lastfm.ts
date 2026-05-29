// Helpers compartidos para Last.fm + artist_tags.
//
// Hasta Fase 5.1, las funciones lfm(), topTagsByArtist, TAG_BLACKLIST e
// isAllowedTag vivian duplicadas en `recommendations/` y `enrich-tags/`.
// Este modulo unifica la implementacion.
//
// IMPORTANT: cuando se modifique TAG_BLACKLIST aqui, no hay que tocar
// nada mas — ambos edge functions consumen este modulo.
//
// Para usar desde una edge function:
//   import { lfm, isAllowedTag, topTagsByArtist } from '../_shared/lastfm.ts';

export const LASTFM_BASE = 'https://ws.audioscrobbler.com/2.0/';

/**
 * Lista negra de tags que nunca queremos usar como "género":
 *  - genericos / no descriptivos
 *  - decadas (00s, 10s, 20s) — son periodo, no genero
 *  - meta-listas del usuario en Last.fm
 *  - vocales (no son genero real)
 */
export const TAG_BLACKLIST = new Set<string>([
  'seen live', 'awesome', 'favorite', 'favourite', 'favorites', 'favourites',
  'all', 'albums i own', 'tracks i own', 'love at first listen',
  'male vocalists', 'female vocalists', 'male vocalist', 'female vocalist',
  'cool', 'great', 'amazing', 'best', 'good', 'beautiful', 'epic',
  'classic', 'masterpiece', 'spotify',
]);

/**
 * Determina si un tag es valido como "genero" para usar en recomendaciones.
 * Filtra blacklist + decadas + anos puros + tags muy cortos.
 */
export function isAllowedTag(tag: string): boolean {
  const t = tag.toLowerCase().trim();
  if (TAG_BLACKLIST.has(t)) return false;
  // Decadas tipo "00s", "10s", "70s", "1990s", etc.
  if (/^\d{2,4}s?$/.test(t)) return false;
  // Anos puros.
  if (/^(19|20)\d{2}$/.test(t)) return false;
  // Muy corto.
  if (t.length < 3) return false;
  return true;
}

/**
 * Wrapper para llamar a Last.fm API. Requiere LASTFM_API_KEY en env.
 *
 * Detecta tanto HTTP errors (status no-200) como Last.fm errors
 * (response.error con message), porque Last.fm responde 200 con
 * error en el body para algunos casos (rate limit, key invalida).
 *
 * @param method Nombre del metodo Last.fm (ej. "artist.getTopTags").
 * @param params Params adicionales (artist, autocorrect, etc.).
 * @returns JSON parseado de la respuesta.
 */
export async function lfm(method: string, params: Record<string, string>): Promise<any> {
  const apiKey = Deno.env.get('LASTFM_API_KEY');
  if (!apiKey) throw new Error('LASTFM_API_KEY no configurada');
  const url = new URL(LASTFM_BASE);
  url.searchParams.set('method', method);
  url.searchParams.set('api_key', apiKey);
  url.searchParams.set('format', 'json');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const r = await fetch(url.toString(), {
    headers: { 'User-Agent': 'Ritmiq/0.1' },
  });
  if (!r.ok) throw new Error(`lastfm ${method} ${r.status}`);
  const j = await r.json();
  if (j.error) throw new Error(`lastfm ${method}: ${j.message}`);
  return j;
}

/**
 * Trae los top-tags de un artista desde Last.fm. Retorna array lowercase
 * (sin filtrar via isAllowedTag — el caller decide).
 *
 * Defensivo: si la llamada falla, retorna []. No throwea.
 */
export async function topTagsByArtist(artist: string): Promise<string[]> {
  try {
    const j = await lfm('artist.getTopTags', { artist, autocorrect: '1' });
    const items = j?.toptags?.tag ?? [];
    return items.slice(0, 10).map((x: any) => String(x.name).toLowerCase());
  } catch {
    return [];
  }
}
