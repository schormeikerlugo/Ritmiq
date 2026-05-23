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
  /** @type {import('@supabase/supabase-js').RealtimeChannel|null} */
  _channel: null,

  /**
   * Snapshot autoritativo de la racha desde user_streaks (BD).
   * Se hidrata al login + via Realtime.
   *
   * Estructura:
   *   { currentStreak: number, longestStreak: number,
   *     longestAt: string|null, lastPlayedDate: string|null }
   *
   * null = no cargado todavia. Fallback al calculo local desde events.
   * @type {{ currentStreak:number, longestStreak:number, longestAt:string|null, lastPlayedDate:string|null }|null}
   */
  streakSnapshot: null,

  /**
   * Lista de trofeos desbloqueados desde streak_milestones.
   * Cada item: { milestone: 7|30|100|365, achievedAt: 'YYYY-MM-DD', streakValue: number }
   * @type {Array<{ milestone:number, achievedAt:string, streakValue:number }>}
   */
  milestones: [],

  /**
   * Cola FIFO de toasts pendientes de mostrar (milestones nuevos llegados
   * via Realtime mientras la app esta activa).
   * UI consume con popMilestoneToast().
   * @type {Array<{ milestone:number, streakValue:number }>}
   */
  milestoneToastQueue: [],

  /**
   * Flag interno: `true` cuando ya mostramos el toast de bienvenida con
   * el trofeo mas alto en esta sesion. Se resetea en reset() (logout) y
   * en cada hard reload de la app (porque el store vive en memoria).
   * Evita re-disparar el welcome si el user navega entre vistas o si
   * subscribeStreak recibe un update.
   */
  _welcomeShown: false,

  /** @type {import('@supabase/supabase-js').RealtimeChannel|null} */
  _streakChannel: null,
  /** @type {import('@supabase/supabase-js').RealtimeChannel|null} */
  _milestonesChannel: null,

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
    const s = get();
    if (s._channel) { try { supabase.removeChannel(s._channel); } catch {} }
    if (s._streakChannel) { try { supabase.removeChannel(s._streakChannel); } catch {} }
    if (s._milestonesChannel) { try { supabase.removeChannel(s._milestonesChannel); } catch {} }
    set({
      events: [],
      loading: false,
      error: null,
      _recentlyRecorded: new Map(),
      _channel: null,
      streakSnapshot: null,
      milestones: [],
      milestoneToastQueue: [],
      _welcomeShown: false,
      _streakChannel: null,
      _milestonesChannel: null,
    });
  },

  /**
   * Hidrata el snapshot autoritativo de racha + milestones desde Supabase.
   *
   * - user_streaks: 1 fila por user con current_streak + longest_streak.
   * - streak_milestones: N filas con trofeos desbloqueados.
   *
   * Si la tabla no existe (migration no aplicada) o el SELECT falla,
   * el state queda en null/[] y el frontend usa el calculo local desde
   * events como fallback. Cero regresion.
   *
   * @param {string} userId
   */
  async loadStreakSnapshot(userId) {
    if (!userId) return;
    try {
      // Pull paralelo de las dos tablas.
      const [streakRes, milestonesRes] = await Promise.allSettled([
        supabase
          .from('user_streaks')
          .select('current_streak, longest_streak, longest_at, last_played_date')
          .eq('user_id', userId)
          .maybeSingle(),
        supabase
          .from('streak_milestones')
          .select('milestone, achieved_at, streak_value')
          .eq('user_id', userId)
          .order('milestone', { ascending: true }),
      ]);

      if (streakRes.status === 'fulfilled' && streakRes.value.data) {
        const d = streakRes.value.data;
        set({
          streakSnapshot: {
            currentStreak: d.current_streak ?? 0,
            longestStreak: d.longest_streak ?? 0,
            longestAt: d.longest_at ?? null,
            lastPlayedDate: d.last_played_date ?? null,
          },
        });
      }

      if (milestonesRes.status === 'fulfilled' && milestonesRes.value.data) {
        const ms = milestonesRes.value.data.map((r) => ({
          milestone: r.milestone,
          achievedAt: r.achieved_at,
          streakValue: r.streak_value,
        }));
        set({ milestones: ms });
      }
    } catch (err) {
      console.warn('[history] loadStreakSnapshot fallo (no fatal):', err?.message);
    }
  },

  /**
   * Suscribe a Realtime de user_streaks + streak_milestones del usuario.
   *
   * - user_streaks UPDATE/INSERT -> hidrata streakSnapshot.
   * - streak_milestones INSERT  -> push al milestoneToastQueue para que
   *   la UI muestre confetti con el nuevo trofeo.
   *
   * @param {string} userId
   * @returns {() => void} unsubscribe
   */
  subscribeStreak(userId) {
    if (!userId) return () => {};

    // Cleanup previos.
    const existingStreak = get()._streakChannel;
    if (existingStreak) { try { supabase.removeChannel(existingStreak); } catch {} }
    const existingMs = get()._milestonesChannel;
    if (existingMs) { try { supabase.removeChannel(existingMs); } catch {} }

    const streakCh = supabase
      .channel(`user_streaks:${userId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'user_streaks', filter: `user_id=eq.${userId}` },
        (payload) => {
          const row = payload?.new;
          if (!row || payload.eventType === 'DELETE') {
            set({ streakSnapshot: null });
            return;
          }
          set({
            streakSnapshot: {
              currentStreak: row.current_streak ?? 0,
              longestStreak: row.longest_streak ?? 0,
              longestAt: row.longest_at ?? null,
              lastPlayedDate: row.last_played_date ?? null,
            },
          });
        }
      )
      .subscribe();

    const msCh = supabase
      .channel(`streak_milestones:${userId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'streak_milestones', filter: `user_id=eq.${userId}` },
        (payload) => {
          const row = payload?.new;
          if (!row) return;
          set((s) => {
            // Anadir a lista de milestones desbloqueados.
            const alreadyIn = s.milestones.some((m) => m.milestone === row.milestone);
            const nextMilestones = alreadyIn
              ? s.milestones
              : [...s.milestones, {
                  milestone: row.milestone,
                  achievedAt: row.achieved_at,
                  streakValue: row.streak_value,
                }].sort((a, b) => a.milestone - b.milestone);

            // Push al queue para que la UI muestre el toast.
            const nextQueue = [
              ...s.milestoneToastQueue,
              { milestone: row.milestone, streakValue: row.streak_value },
            ];
            return { milestones: nextMilestones, milestoneToastQueue: nextQueue };
          });
        }
      )
      .subscribe();

    set({ _streakChannel: streakCh, _milestonesChannel: msCh });

    return () => {
      try { supabase.removeChannel(streakCh); } catch {}
      try { supabase.removeChannel(msCh); } catch {}
      set({ _streakChannel: null, _milestonesChannel: null });
    };
  },

  /**
   * UI consume el siguiente toast pendiente. Devuelve { milestone, streakValue }
   * o null si la cola esta vacia.
   */
  popMilestoneToast() {
    const queue = get().milestoneToastQueue;
    if (queue.length === 0) return null;
    const [head, ...rest] = queue;
    set({ milestoneToastQueue: rest });
    return head;
  },

  /**
   * Re-encola un milestone ya desbloqueado para que el MilestoneToast lo
   * vuelva a animar. Usado por el boton "Volver a ver" en StatsView.
   *
   * Toma streakValue del milestones cacheado para que el subtitulo muestre
   * el valor real con el que se desbloqueo (no la racha actual). Si no
   * esta cacheado, usa el milestone como fallback.
   *
   * @param {number} milestone
   */
  replayMilestone(milestone) {
    const found = get().milestones.find((m) => m.milestone === milestone);
    const streakValue = found?.streakValue ?? milestone;
    set((s) => ({
      milestoneToastQueue: [...s.milestoneToastQueue, { milestone, streakValue }],
    }));
  },

  /**
   * Muestra al usuario el trofeo de mayor nivel que tiene desbloqueado
   * como saludo al iniciar la app. Idempotente por sesion: solo se
   * dispara una vez (flag _welcomeShown).
   *
   * REGLAS:
   *   - Si el user no tiene milestones desbloqueados, no hace nada.
   *   - Si el mas alto es 365 (Legend = modal), bajamos al siguiente
   *     mas alto. El modal cada arranque seria intrusivo. Si solo
   *     tiene 365, no mostramos welcome (lo veria como modal todos
   *     los dias, mejor que se quede como hito ocasional).
   *   - Si hay items en la cola pendientes (e.g. un milestone nuevo
   *     llego en este arranque via Realtime), NO inyectamos welcome
   *     encima — el nuevo es prioritario.
   *
   * Tras ejecutar marca _welcomeShown=true para evitar re-disparos
   * cuando subscribeStreak entregue actualizaciones de milestones.
   */
  showWelcomeMilestone() {
    const s = get();
    if (s._welcomeShown) return;
    if (s.milestoneToastQueue.length > 0) {
      // Hay algo mas urgente en la cola — no contamines el welcome.
      // Marcamos como mostrado igualmente para no insistir.
      set({ _welcomeShown: true });
      return;
    }
    const ms = s.milestones;
    if (!Array.isArray(ms) || ms.length === 0) {
      // Sin trofeos: silencio, sin marcar shown para que si el user
      // alcanza su primer milestone en esta sesion via Realtime el
      // welcome NO se dispare encima (el nuevo trofeo es lo unico
      // que verá).
      return;
    }
    // Ordenar desc por milestone, ignorar 365 (Legend modal).
    const sorted = [...ms].sort((a, b) => b.milestone - a.milestone);
    const pick = sorted.find((m) => m.milestone !== 365);
    if (!pick) {
      // El user solo tiene Legend (365). No mostramos welcome para no
      // bloquear con modal cada arranque. Marcamos shown.
      set({ _welcomeShown: true });
      return;
    }
    set((st) => ({
      _welcomeShown: true,
      milestoneToastQueue: [
        ...st.milestoneToastQueue,
        { milestone: pick.milestone, streakValue: pick.streakValue },
      ],
    }));
  },

  /**
   * Suscribe a Realtime de `play_history` para multidevice sync.
   *
   * Problema que resuelve: cuando un mismo user reproduce en device A
   * (iPhone) y luego abre la app en device B (iPad/Desktop), el device B
   * tenia un snapshot viejo de events (cargado al login). Sin Realtime,
   * device B no veia las nuevas plays de device A hasta que recargara la
   * app o llamara explicitamente a load(). Consecuencia: la racha se
   * calculaba con dayMap incompleto y aparecia DISMINUIDA hasta el
   * proximo refresh.
   *
   * Con esta suscripcion, cualquier INSERT en play_history del user
   * llega en <1s a todos sus devices abiertos y los events se mantienen
   * sincronizados.
   *
   * Dedup: si el evento llega desde Realtime y ya esta en local (porque
   * lo grabe yo y luego el server me lo eco), no se duplica — comparamos
   * por (yt_id||track_id) + playedAt cercano.
   *
   * @param {string} userId
   * @returns {() => void} unsubscribe
   */
  subscribeRealtime(userId) {
    if (!userId) return () => {};
    // Si ya hay un canal activo, ciérralo primero (cambio de user, etc.)
    const existing = get()._channel;
    if (existing) {
      try { supabase.removeChannel(existing); } catch {}
    }

    const channel = supabase
      .channel(`history:${userId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'play_history', filter: `user_id=eq.${userId}` },
        (payload) => {
          const row = payload?.new;
          if (!row) return;
          const event = rowToEvent(row);
          set((s) => {
            // Dedup: mismo fingerprint con playedAt a <5s ya esta en local.
            const fp = event.ytId || event.trackId;
            const eventT = new Date(event.playedAt).getTime();
            const dup = s.events.some((e) => {
              const efp = e.ytId || e.trackId;
              if (efp !== fp) return false;
              const dt = Math.abs(new Date(e.playedAt).getTime() - eventT);
              return dt < 5000;
            });
            if (dup) return s;
            const next = [event, ...s.events].slice(0, HISTORY_LIMIT);
            // Mantener orden descendente por playedAt — Realtime puede
            // entregar eventos fuera de orden si hay latencia.
            next.sort((a, b) => new Date(b.playedAt) - new Date(a.playedAt));
            return { events: next };
          });
        }
      )
      .subscribe();

    set({ _channel: channel });

    return () => {
      try { supabase.removeChannel(channel); } catch {}
      set({ _channel: null });
    };
  },
}));

/* ─── Helpers fecha LOCAL (no UTC) ───────────────────────────────────── */

/**
 * Devuelve la clave 'YYYY-MM-DD' del dia LOCAL para `date`. A diferencia de
 * `.toISOString().slice(0,10)` (que usa UTC), esta funcion respeta el
 * timezone del device — clave para que la racha refleje lo que el usuario
 * percibe como "hoy" / "ayer".
 *
 * Ejemplo en UTC-4 (Dominicana):
 *   2026-05-20T02:00Z (= 21:00 local del 19) → '2026-05-19'
 *
 * @param {Date} date
 * @returns {string}
 */
export function localDayKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Devuelve un Date posicionado en 00:00:00.000 LOCAL del mismo dia que
 * `date`. Util como ancla para iterar dias hacia atras sin que el offset
 * de timezone deslice el calculo.
 *
 * @param {Date} date
 * @returns {Date}
 */
export function startOfLocalDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

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
 * @param {{ days?: number, topLimit?: number, streakSnapshot?: object|null }} opts
 *   - streakSnapshot: si se pasa, se usa como fallback autoritativo para
 *     casos donde events esta truncado al HISTORY_LIMIT (500). El longest
 *     siempre se toma del snapshot si existe (mantiene record historico).
 */
export function selectStatsForPeriod(events, opts = {}) {
  const { days = 30, topLimit = 5 } = opts;
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
    //
    // CRITICO: usar fecha LOCAL del usuario, NO UTC.
    // Bug previo: .toISOString().slice(0,10) devuelve la fecha UTC. En zonas
    // con offset negativo (Americas) las plays nocturnas (8-11 PM local)
    // caen al dia siguiente en UTC. Resultado: un usuario en Dominicana
    // (UTC-4) que escucha lun/mar/mie a las 9 PM local veria dayMap con
    // claves mar/mie/jue UTC y la racha se desincroniza con la percepcion
    // real del usuario.
    //
    // Solucion: localDayKey(date) usa el calendario local del device para
    // generar 'YYYY-MM-DD'. Coincide con lo que el usuario llama "hoy"
    // mentalmente.
    const day = localDayKey(new Date(e.playedAt));
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

  // Racha consecutiva: dias seguidos (en hora LOCAL del usuario) con al
  // menos 1 play, contando hacia atras desde hoy.
  //
  // Reglas precisas:
  //   - Si HOY (local) tiene plays → cuenta y avanza al dia anterior.
  //   - Si HOY no tiene plays todavia → no rompe. Permite que el usuario
  //     abra la app de manana y vea su racha de N dias previos intacta
  //     hasta que escuche algo nuevo o hasta que termine el dia local.
  //   - Si AYER (local) no tiene plays → rompe la racha (perdida real).
  //   - Buscamos hacia atras usando dias LOCALES (no UTC) para que
  //     coincida con localDayKey() usado al construir dayMap.
  //
  // Bug previo: usaba toISOString().slice(0,10) (UTC) tanto en dayMap
  // como en el loop. Mezclado con offsets negativos (Americas) la racha
  // "se corria" segun la hora del dia y aparecia disminuida.
  let streak = 0;
  const todayLocal = startOfLocalDay(new Date());
  for (let i = 0; i < days; i++) {
    const d = new Date(todayLocal.getTime() - i * 86400_000);
    const key = localDayKey(d);
    if (dayMap.has(key)) {
      streak++;
    } else if (i === 0) {
      // Hoy aun sin plays — no rompe la racha. El usuario tiene todo el
      // dia para sumar. Saltamos a ayer y seguimos comprobando.
      continue;
    } else {
      // Dia previo sin plays → racha terminada.
      break;
    }
  }

  // Si tenemos snapshot autoritativo desde BD (user_streaks) Y el calculo
  // local podria estar truncado (events.length llego al HISTORY_LIMIT),
  // preferir el valor autoritativo. Resuelve el caso de rachas >500 events.
  // El snapshot es siempre >= que el local (calculado por trigger con la
  // tabla completa).
  let longestStreak = streak;
  let longestAt = null;
  const snap = opts.streakSnapshot;
  if (snap && typeof snap.currentStreak === 'number') {
    longestStreak = Math.max(snap.longestStreak ?? 0, streak);
    longestAt = snap.longestAt ?? null;
    // Solo usar el current snapshot si nuestro calculo local podria estar
    // incompleto (events truncados). Si tenemos < HISTORY_LIMIT events,
    // el calculo local es definitorio (mas fresco que el snapshot, que
    // se actualiza por trigger con potencial delay de Realtime).
    if (events.length >= 500) {
      streak = Math.max(streak, snap.currentStreak);
    }
  }

  return {
    totalPlays,
    totalSeconds,
    totalMinutes: Math.floor(totalSeconds / 60),
    uniqueTracks: trackCounts.size,
    uniqueArtists: artistCounts.size,
    activeDays: dayMap.size,
    streak,
    longestStreak,
    longestAt,
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
