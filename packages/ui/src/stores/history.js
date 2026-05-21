/**
 * Store del historial de reproducción + derivados para recomendaciones.
 *
 * Responsabilidades:
 *  - Cargar últimos N eventos desde Supabase (`play_history`).
 *  - Insertar eventos nuevos cuando el usuario "consume" un track
 *    (umbral: 30s reproducidos o 30% del track, lo que sea menor).
 *  - Encolar inserciones en IndexedDB cuando no hay red (offline-first).
 *  - Exponer selectores derivados para la Home:
 *      · recentTracks      → últimos únicos
 *      · topTracks30d      → más reproducidos en 30 días
 *      · topArtists30d     → artistas más escuchados en 30 días
 *      · continueListening → tracks que empezaste pero no terminaste
 *
 * Diseño: snapshot autocontenido. Cada evento guarda title/artist/cover
 * propios; así los tracks efímeros (yt:<id>) que el usuario escucha desde
 * el buscador y nunca guarda en biblioteca también aparecen en la Home.
 */

import { create } from 'zustand';
import { supabase } from '../lib/supabase.js';
import { db as localDb } from '../lib/local-downloads.js';
import { isEphemeralId } from '../lib/track-helpers.js';

const HISTORY_LIMIT = 500;

/** @typedef {{ ytId?: string|null, trackId?: string|null, title:string, artist?:string|null, coverUrl?:string|null, durationSeconds?:number|null, durationPlayedSeconds?:number|null, playedAt:string, source?:string|null }} HistoryEvent */

// Helpers de IndexedDB para cola offline.
async function getOfflineQueue() {
  try { return (await localDb.table('pendingPlays').toArray()) ?? []; }
  catch { return []; }
}
async function pushOfflineQueue(event) {
  try { await localDb.table('pendingPlays').add({ ...event, queuedAt: Date.now() }); }
  catch (e) { console.warn('[history] no se pudo encolar offline', e?.message); }
}
async function clearOfflineQueue(ids) {
  try {
    if (!Array.isArray(ids) || !ids.length) return;
    await localDb.table('pendingPlays').bulkDelete(ids);
  } catch {}
}

export const useHistoryStore = create((set, get) => ({
  /** @type {HistoryEvent[]} ordenado descendente por playedAt */
  events: [],
  loading: false,
  error: null,
  // Set de fingerprints (yt_id||track_id) ya registrados en esta sesión
  // dentro de los últimos 60s — para no contar 5 veces si el usuario repite
  // el mismo track manualmente.
  _recentlyRecorded: new Map(),

  /** Carga inicial: pull desde Supabase + flush de cola offline si hay red. */
  async load() {
    set({ loading: true, error: null });
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const userId = session?.user?.id;
      if (!userId) {
        set({ events: [], loading: false });
        return;
      }

      // Flush primero la cola pendiente.
      await get().flushOffline();

      const { data, error } = await supabase
        .from('play_history')
        .select('*')
        .order('played_at', { ascending: false })
        .limit(HISTORY_LIMIT);
      if (error) throw error;

      const events = (data ?? []).map(rowToEvent);
      set({ events, loading: false });
    } catch (err) {
      console.warn('[history] load falló:', err?.message ?? err);
      set({ loading: false, error: String(err?.message ?? err) });
    }
  },

  /**
   * Registra una reproducción. Aplica dedup por fingerprint dentro de 60s
   * para evitar inflar el conteo con repeticiones inmediatas.
   *
   * @param {import('@ritmiq/core/types').Track} track
   * @param {number} playedSeconds   tiempo efectivo reproducido (segundos)
   */
  async record(track, playedSeconds) {
    if (!track) return;
    const fp = track.ytId || track.id;
    if (!fp) return;

    const now = Date.now();
    const recent = get()._recentlyRecorded;
    // Limpieza ligera de entradas viejas.
    for (const [k, t] of recent) if (now - t > 60_000) recent.delete(k);
    if (recent.has(fp)) return;
    recent.set(fp, now);

    const ephemeral = isEphemeralId(track.id);
    /** @type {HistoryEvent} */
    const event = {
      ytId: track.ytId ?? null,
      trackId: ephemeral ? null : (track.id ?? null),
      title: track.title || 'Desconocido',
      artist: track.artist ?? null,
      coverUrl: track.coverUrl ?? null,
      durationSeconds: track.durationSeconds ?? null,
      durationPlayedSeconds: Math.round(playedSeconds || 0),
      playedAt: new Date().toISOString(),
      source: track.source ?? 'youtube',
    };

    // Optimista: añadir al state inmediatamente para que la Home reaccione.
    set((s) => ({ events: [event, ...s.events].slice(0, HISTORY_LIMIT) }));

    // Persistir en Supabase, encolando si falla.
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const userId = session?.user?.id;
      if (!userId) return;
      const row = eventToRow(event, userId);
      const { error } = await supabase.from('play_history').insert(row);
      if (error) throw error;
    } catch (err) {
      console.info('[history] sin red, encolando play offline', err?.message);
      await pushOfflineQueue(event);
    }
  },

  /** Reintenta enviar la cola pendiente a Supabase. */
  async flushOffline() {
    try {
      const pending = await getOfflineQueue();
      if (!pending.length) return;
      const { data: { session } } = await supabase.auth.getSession();
      const userId = session?.user?.id;
      if (!userId) return;
      const rows = pending.map((p) => eventToRow(p, userId));
      const { error } = await supabase.from('play_history').insert(rows);
      if (error) throw error;
      await clearOfflineQueue(pending.map((p) => p.id));
    } catch (err) {
      console.info('[history] flush offline falló', err?.message);
    }
  },

  reset() {
    set({ events: [], loading: false, error: null, _recentlyRecorded: new Map() });
  },
}));

/* ─── Mappers ────────────────────────────────────────────────────────── */

function rowToEvent(r) {
  return {
    ytId: r.yt_id ?? null,
    trackId: r.track_id ?? null,
    title: r.title ?? 'Desconocido',
    artist: r.artist ?? null,
    coverUrl: r.cover_url ?? null,
    durationSeconds: r.duration_seconds ?? null,
    durationPlayedSeconds: r.duration_played_seconds ?? null,
    playedAt: r.played_at,
    source: r.source ?? 'youtube',
  };
}

// UUID v4 regex — usado para validar track_id antes de mandarlo al server.
// Postgres rechaza con 400 'invalid input syntax for type uuid' si recibe
// cualquier otra cosa. Componentes sociales antiguos a veces crean tracks
// con id = ytId raw (ej. 'zG-hiBaCk0I'); validamos aqui para que el
// fallback (null + yt_id) siempre funcione, sin depender de que cada
// origen use el prefijo 'yt:' correctamente.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function eventToRow(e, userId) {
  const isValidUuid = typeof e.trackId === 'string' && UUID_RE.test(e.trackId);
  return {
    user_id: userId,
    track_id: isValidUuid ? e.trackId : null,
    yt_id: e.ytId ?? null,
    title: e.title,
    artist: e.artist ?? null,
    cover_url: e.coverUrl ?? null,
    duration_seconds: e.durationSeconds ?? null,
    duration_played_seconds: e.durationPlayedSeconds ?? null,
    source: e.source ?? 'youtube',
    played_at: e.playedAt,
  };
}

/* ─── Selectores derivados (puros) ───────────────────────────────────── */

/** Últimos N únicos por fingerprint, más reciente primero. */
export function selectRecentTracks(events, limit = 20) {
  const seen = new Set();
  const out = [];
  for (const e of events) {
    const fp = e.ytId || e.trackId;
    if (!fp || seen.has(fp)) continue;
    seen.add(fp);
    out.push(eventToTrackLike(e));
    if (out.length >= limit) break;
  }
  return out;
}

/** Top N por count en últimos `days` días. */
export function selectTopTracks(events, { days = 30, limit = 15 } = {}) {
  const cutoff = Date.now() - days * 86400_000;
  const counts = new Map();
  for (const e of events) {
    if (new Date(e.playedAt).getTime() < cutoff) continue;
    const fp = e.ytId || e.trackId;
    if (!fp) continue;
    const cur = counts.get(fp);
    if (cur) cur.count++;
    else counts.set(fp, { count: 1, event: e });
  }
  return [...counts.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, limit)
    .map((x) => ({ ...eventToTrackLike(x.event), playCount: x.count }));
}

/** Top N artistas por count agregando todas las plays. */
export function selectTopArtists(events, { days = 30, limit = 10 } = {}) {
  const cutoff = Date.now() - days * 86400_000;
  const counts = new Map();
  for (const e of events) {
    if (new Date(e.playedAt).getTime() < cutoff) continue;
    const a = (e.artist || '').trim();
    if (!a) continue;
    const key = a.toLowerCase();
    const cur = counts.get(key);
    if (cur) {
      cur.count++;
      // Conservar cover/event más reciente.
      if (new Date(e.playedAt) > new Date(cur.event.playedAt)) cur.event = e;
    } else {
      counts.set(key, { count: 1, artist: a, event: e });
    }
  }
  return [...counts.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, limit)
    .map((x) => ({
      artist: x.artist,
      coverUrl: x.event.coverUrl,
      playCount: x.count,
      // Track de referencia (último escuchado del artista) — útil para
      // iniciar un "Mix de X" empezando por uno conocido.
      seedTrack: eventToTrackLike(x.event),
    }));
}

/**
 * Stats agregados de los ultimos `days` dias — usado por la vista
 * "Tu mes en Ritmiq" (F2.11). Devuelve totales + top tracks/artistas.
 *
 * @param {Array} events
 * @param {{ days?: number, topLimit?: number }} opts
 */
export function selectStatsForPeriod(events, { days = 30, topLimit = 5 } = {}) {
  const cutoff = Date.now() - days * 86400_000;
  let totalPlays = 0;
  let totalSeconds = 0;
  const trackCounts = new Map();
  const artistCounts = new Map();
  const dayMap = new Map();  // ISO date → count, para racha

  for (const e of events) {
    const t = new Date(e.playedAt).getTime();
    if (!Number.isFinite(t) || t < cutoff) continue;
    totalPlays += 1;
    // Tiempo escuchado real (puede venir como durationPlayedSeconds o
    // como aproximacion la propia duracion del track si esta consumido).
    const played = Number(e.durationPlayedSeconds);
    const dur = Number(e.durationSeconds);
    if (Number.isFinite(played) && played > 0) totalSeconds += played;
    else if (Number.isFinite(dur) && dur > 0) totalSeconds += dur;

    // Track aggregation.
    const fp = e.ytId || e.trackId;
    if (fp) {
      const cur = trackCounts.get(fp);
      if (cur) cur.count++;
      else trackCounts.set(fp, { count: 1, event: e });
    }
    // Artist aggregation.
    const a = (e.artist || '').trim();
    if (a) {
      const key = a.toLowerCase();
      const cur = artistCounts.get(key);
      if (cur) {
        cur.count++;
        if (new Date(e.playedAt) > new Date(cur.event.playedAt)) cur.event = e;
      } else {
        artistCounts.set(key, { count: 1, artist: a, event: e });
      }
    }
    // Daily distribution para racha de dias activos.
    const day = new Date(e.playedAt).toISOString().slice(0, 10);
    dayMap.set(day, (dayMap.get(day) ?? 0) + 1);
  }

  const topTracks = [...trackCounts.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, topLimit)
    .map((x) => ({ ...eventToTrackLike(x.event), playCount: x.count }));

  const topArtists = [...artistCounts.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, topLimit)
    .map((x) => ({
      artist: x.artist,
      coverUrl: x.event.coverUrl,
      playCount: x.count,
    }));

  // Racha consecutiva: dias seguidos con al menos 1 play, contando hacia
  // atras desde hoy.
  let streak = 0;
  const today = new Date();
  for (let i = 0; i < days; i++) {
    const d = new Date(today.getTime() - i * 86400_000);
    const iso = d.toISOString().slice(0, 10);
    if (dayMap.has(iso)) streak++;
    else if (i > 0) break;
  }

  return {
    totalPlays,
    totalSeconds,
    totalMinutes: Math.floor(totalSeconds / 60),
    uniqueTracks: trackCounts.size,
    uniqueArtists: artistCounts.size,
    activeDays: dayMap.size,
    streak,
    topTracks,
    topArtists,
  };
}

/**
 * Tracks que comenzaste pero no terminaste recientemente.
 * Heurística: duration_played_seconds < duration_seconds * 0.8.
 */
export function selectContinueListening(events, { limit = 8 } = {}) {
  const seen = new Set();
  const out = [];
  for (const e of events) {
    const fp = e.ytId || e.trackId;
    if (!fp || seen.has(fp)) continue;
    if (!e.durationSeconds || !e.durationPlayedSeconds) continue;
    if (e.durationPlayedSeconds >= e.durationSeconds * 0.8) continue;
    if (e.durationPlayedSeconds < 30) continue; // muy pronto, no es "continúa"
    seen.add(fp);
    out.push(eventToTrackLike(e));
    if (out.length >= limit) break;
  }
  return out;
}

/** Convierte un HistoryEvent en un Track-like reproducible. */
function eventToTrackLike(e) {
  // Si tiene ytId, lo reconstruimos como track efímero reproducible al
  // estilo `metaToCandidate`. Si tiene trackId, será una referencia que
  // resolveremos contra la biblioteca al hacer click.
  return {
    id: e.trackId || (e.ytId ? `yt:${e.ytId}` : null),
    userId: '',
    source: e.source ?? 'youtube',
    ytId: e.ytId ?? null,
    title: e.title,
    artist: e.artist ?? null,
    album: null,
    durationSeconds: e.durationSeconds ?? null,
    coverUrl: e.coverUrl ?? null,
    filePath: null,
    isDownloaded: false,
    createdAt: e.playedAt,
  };
}
