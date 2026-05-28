/**
 * Store de recomendaciones (Fase 2 — Last.fm vía Edge Function).
 *
 * Llama a la Edge Function `recommendations` para obtener cuatro tipos:
 *  - mix-by-artist   → similar-artist usando el artista más escuchado.
 *  - mix-by-track    → tracks similares al último reproducido.
 *  - genre-mix       → top tracks del género más frecuente del usuario.
 *  - discover        → artistas nuevos que no estén en biblioteca.
 *
 * Mantiene cache en memoria por sesión + caché TTL 12h del lado del server.
 */

import { create } from 'zustand';
import { supabase } from '../lib/supabase.js';
import { withRetry } from '../lib/with-retry.js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY;

async function callRecsRaw(kind, seed) {
  if (!SUPABASE_URL) throw new Error('Supabase URL no configurado');
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('sin sesión');
  const url = new URL(`${SUPABASE_URL}/functions/v1/recommendations`);
  url.searchParams.set('kind', kind);
  if (seed) url.searchParams.set('seed', seed);
  const r = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      apikey: SUPABASE_ANON ?? '',
    },
  });
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    const err = new Error(j.error ?? `recommendations ${r.status}`);
    err.status = r.status;
    throw err;
  }
  return r.json();
}

// withRetry: 3 intentos con backoff exponencial. La edge function suele
// fallar con 5xx cuando Last.fm rate-limit (5 req/s) golpea bajo carga.
function callRecs(kind, seed) {
  return withRetry(() => callRecsRaw(kind, seed), {
    maxAttempts: 3,
    onRetry: (attempt, err, delay) => {
      console.info(`[recommendations] retry ${attempt} en ${delay}ms (${err?.message})`);
    },
  });
}

/** Convierte un RecTrack del servidor en un Track-like del player. */
function recToTrack(rec) {
  return {
    id: `yt:${rec.ytId}`,
    userId: '',
    source: 'youtube',
    ytId: rec.ytId,
    title: rec.title,
    artist: rec.artist ?? null,
    album: null,
    durationSeconds: rec.duration ?? null,
    coverUrl: rec.thumbnail ?? null,
    filePath: null,
    isDownloaded: false,
    createdAt: new Date().toISOString(),
    reason: rec.reason ?? null,
  };
}

export const useRecommendationsStore = create((set, get) => ({
  /**
   * Mapa de `${kind}:${seed}` → { tracks, generatedAt, loading, error }.
   * Multimix: la Home puede tener varias filas, cada una con su propia clave.
   */
  sections: {},

  /**
   * Carga (o reusa cache de sesión) una sección de recomendaciones.
   * @param {'similar-artist'|'mix-by-track'|'genre-mix'|'discover'} kind
   * @param {string} [seed]
   */
  async fetch(kind, seed) {
    const key = `${kind}:${seed ?? ''}`;
    const cur = get().sections[key];
    if (cur?.tracks?.length) return cur;  // ya tenemos en memoria
    if (cur?.loading) return cur;
    set((s) => ({ sections: { ...s.sections, [key]: { ...cur, loading: true, error: null } } }));
    try {
      const payload = await callRecs(kind, seed);
      const tracks = (payload?.tracks ?? []).map(recToTrack);
      const entry = { tracks, generatedAt: payload.generatedAt, seed: payload.seed, loading: false, error: null };
      set((s) => ({ sections: { ...s.sections, [key]: entry } }));
      return entry;
    } catch (err) {
      console.warn('[recommendations] fetch falló', kind, seed, err?.message);
      const entry = { tracks: [], loading: false, error: String(err?.message ?? err) };
      set((s) => ({ sections: { ...s.sections, [key]: entry } }));
      return entry;
    }
  },

  reset() { set({ sections: {} }); },
}));
