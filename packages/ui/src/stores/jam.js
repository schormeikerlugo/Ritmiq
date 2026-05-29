/**
 * Jam mode store (Fase 8.1).
 *
 * Modelo host\u2192participants:
 *   - Host crea sesion con un codigo corto que comparte.
 *   - Otros se unen al codigo (join). Su user_id va en jam_participants.
 *   - Host envia updates de current_track + position + is_playing
 *     actualizando jam_sessions. RLS solo permite UPDATE al host.
 *   - Participantes escuchan via Realtime Postgres CDC al canal
 *     "jam:<sessionId>".
 *
 * Tres modos:
 *   - 'idle':     sin jam activo.
 *   - 'hosting':  el user creo una sesion. setCurrentTrack/seek/etc se
 *                 propagan a participants.
 *   - 'guest':    el user se unio a una sesion ajena. Los updates del
 *                 host llegan via Realtime y se aplican al player local.
 *
 * @module @ritmiq/ui/stores/jam
 */
import { create } from 'zustand';
import { supabase } from '../lib/supabase.js';

/** Heartbeat de presence (last_seen_at) cada N ms. */
const HEARTBEAT_MS = 30_000;

/** Genera codigo en cliente como fallback si el helper SQL falla. */
function makeCode() {
  const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 6; i++) {
    out += CHARS[Math.floor(Math.random() * CHARS.length)];
  }
  return out;
}

export const useJamStore = create((set, get) => ({
  // 'idle' | 'hosting' | 'guest'
  mode: 'idle',
  /** @type {null | { id: string, code: string, hostId: string }} */
  session: null,
  /** @type {Array<{ user_id: string, joined_at: string }>} */
  participants: [],
  /** Estado del player canonico de la sesion (solo lectura para guests). */
  state: {
    currentTrack: null,
    positionSeconds: 0,
    isPlaying: false,
    queue: [],
  },
  /** Subscriptions Realtime activas (para cleanup). */
  _channels: [],
  _heartbeatTimer: null,

  /**
   * Crea una sesion nueva como host. Inserta en jam_sessions + join
   * automatico como participant + suscribe a CDC.
   */
  async createSession() {
    const { data: { user } } = await supabase.auth.getSession().then((r) => r.data);
    if (!user) throw new Error('no autenticado');

    // Genera codigo unico (retry hasta 5 veces si colisiona).
    let code = '';
    let inserted = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      code = makeCode();
      const { data, error } = await supabase
        .from('jam_sessions')
        .insert({ host_id: user.id, code, current_track: null, position_seconds: 0, is_playing: false, queue: [] })
        .select()
        .single();
      if (!error) {
        inserted = data;
        break;
      }
      // 23505 = unique violation; reintentar.
      if (error.code !== '23505') throw error;
    }
    if (!inserted) throw new Error('no se pudo generar codigo unico');

    set({
      mode: 'hosting',
      session: { id: inserted.id, code: inserted.code, hostId: user.id },
      state: {
        currentTrack: inserted.current_track,
        positionSeconds: Number(inserted.position_seconds) || 0,
        isPlaying: inserted.is_playing,
        queue: inserted.queue ?? [],
      },
    });

    // Auto-join como participant (para mostrarse en la lista).
    await supabase.from('jam_participants').upsert({
      session_id: inserted.id,
      user_id: user.id,
      last_seen_at: new Date().toISOString(),
    });

    await get()._subscribe(inserted.id);
    get()._startHeartbeat();
    return inserted;
  },

  /**
   * Se une a una sesion existente por codigo. Lee el state actual y
   * se suscribe a Realtime.
   */
  async joinSession(code) {
    const codeNorm = String(code ?? '').trim().toUpperCase();
    if (!/^[A-Z0-9]{6}$/.test(codeNorm)) throw new Error('codigo invalido');

    const { data: { user } } = await supabase.auth.getSession().then((r) => r.data);
    if (!user) throw new Error('no autenticado');

    const { data: ses, error } = await supabase
      .from('jam_sessions')
      .select('*')
      .eq('code', codeNorm)
      .maybeSingle();
    if (error) throw error;
    if (!ses) throw new Error('sesion no encontrada');

    const isHost = ses.host_id === user.id;

    set({
      mode: isHost ? 'hosting' : 'guest',
      session: { id: ses.id, code: ses.code, hostId: ses.host_id },
      state: {
        currentTrack: ses.current_track,
        positionSeconds: Number(ses.position_seconds) || 0,
        isPlaying: ses.is_playing,
        queue: ses.queue ?? [],
      },
    });

    await supabase.from('jam_participants').upsert({
      session_id: ses.id,
      user_id: user.id,
      last_seen_at: new Date().toISOString(),
    });

    await get()._subscribe(ses.id);
    get()._startHeartbeat();
    return ses;
  },

  /**
   * Sale de la sesion. Si era hosting y nadie mas queda, borra la
   * session (cascade lleva participants). Si era guest, solo borra
   * su participant row.
   */
  async leaveSession() {
    const { session, mode, _channels, _heartbeatTimer } = get();
    if (!session) return;

    const { data: { user } } = await supabase.auth.getSession().then((r) => r.data);

    // Cleanup channels + heartbeat ANTES de las queries para que los
    // updates de los otros no causen un re-render con state stale.
    for (const ch of _channels) {
      try { await supabase.removeChannel(ch); } catch {}
    }
    if (_heartbeatTimer) {
      clearInterval(_heartbeatTimer);
    }
    set({ _channels: [], _heartbeatTimer: null });

    try {
      if (mode === 'hosting' && user?.id === session.hostId) {
        // Host cierra la sesion entera.
        await supabase.from('jam_sessions').delete().eq('id', session.id);
      } else if (user?.id) {
        await supabase.from('jam_participants').delete()
          .eq('session_id', session.id)
          .eq('user_id', user.id);
      }
    } catch (e) {
      console.warn('[jam] leave cleanup failed', e?.message);
    }

    set({
      mode: 'idle',
      session: null,
      participants: [],
      state: { currentTrack: null, positionSeconds: 0, isPlaying: false, queue: [] },
    });
  },

  /**
   * Envia un update del state. Solo el host puede ejecutar (RLS
   * rechaza guests). Updates parciales con merge.
   *
   * @param {Partial<{ currentTrack: any, positionSeconds: number, isPlaying: boolean, queue: any[] }>} patch
   */
  async hostBroadcast(patch) {
    const { session, mode } = get();
    if (mode !== 'hosting' || !session) return;
    const payload = {};
    if (patch.currentTrack !== undefined) payload.current_track = patch.currentTrack;
    if (patch.positionSeconds !== undefined) payload.position_seconds = patch.positionSeconds;
    if (patch.isPlaying !== undefined) payload.is_playing = patch.isPlaying;
    if (patch.queue !== undefined) payload.queue = patch.queue;
    if (Object.keys(payload).length === 0) return;
    payload.updated_at = new Date().toISOString();

    // Optimistic local: aplicamos el cambio al state local antes del
    // round-trip a Postgres. Mas responsivo.
    set((s) => ({
      state: {
        ...s.state,
        ...(patch.currentTrack !== undefined && { currentTrack: patch.currentTrack }),
        ...(patch.positionSeconds !== undefined && { positionSeconds: patch.positionSeconds }),
        ...(patch.isPlaying !== undefined && { isPlaying: patch.isPlaying }),
        ...(patch.queue !== undefined && { queue: patch.queue }),
      },
    }));

    try {
      await supabase.from('jam_sessions').update(payload).eq('id', session.id);
    } catch (e) {
      console.warn('[jam] hostBroadcast failed', e?.message);
    }
  },

  /** Internal: suscripcion a Postgres CDC + presencia. */
  async _subscribe(sessionId) {
    const sesChannel = supabase
      .channel(`jam:${sessionId}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'jam_sessions',
        filter: `id=eq.${sessionId}`,
      }, (payload) => {
        const row = payload.new;
        // Solo aplicar para guests; el host ya aplico optimistically.
        if (get().mode === 'guest') {
          set({
            state: {
              currentTrack: row.current_track,
              positionSeconds: Number(row.position_seconds) || 0,
              isPlaying: row.is_playing,
              queue: row.queue ?? [],
            },
          });
        }
      })
      .on('postgres_changes', {
        event: 'DELETE',
        schema: 'public',
        table: 'jam_sessions',
        filter: `id=eq.${sessionId}`,
      }, () => {
        // El host cerro la sesion. Los guests salen automaticamente.
        if (get().mode === 'guest') {
          get().leaveSession();
        }
      })
      .subscribe();

    const partChannel = supabase
      .channel(`jam-participants:${sessionId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'jam_participants',
        filter: `session_id=eq.${sessionId}`,
      }, async () => {
        // Re-fetch la lista entera. Volumen bajo (max ~10 participantes).
        const { data } = await supabase
          .from('jam_participants')
          .select('user_id, joined_at, last_seen_at')
          .eq('session_id', sessionId);
        set({ participants: data ?? [] });
      })
      .subscribe();

    // Trigger inicial.
    const { data: initialParts } = await supabase
      .from('jam_participants')
      .select('user_id, joined_at, last_seen_at')
      .eq('session_id', sessionId);
    set({
      _channels: [sesChannel, partChannel],
      participants: initialParts ?? [],
    });
  },

  /** Internal: heartbeat de last_seen_at cada 30s mientras esta en sesion. */
  _startHeartbeat() {
    const existing = get()._heartbeatTimer;
    if (existing) clearInterval(existing);
    const timer = setInterval(async () => {
      const { session } = get();
      if (!session) return;
      const { data: { user } } = await supabase.auth.getSession().then((r) => r.data);
      if (!user) return;
      try {
        await supabase.from('jam_participants').update({
          last_seen_at: new Date().toISOString(),
        }).eq('session_id', session.id).eq('user_id', user.id);
      } catch {}
    }, HEARTBEAT_MS);
    set({ _heartbeatTimer: timer });
  },

  reset() {
    const { _channels, _heartbeatTimer } = get();
    for (const ch of _channels) {
      try { supabase.removeChannel(ch); } catch {}
    }
    if (_heartbeatTimer) clearInterval(_heartbeatTimer);
    set({
      mode: 'idle',
      session: null,
      participants: [],
      state: { currentTrack: null, positionSeconds: 0, isPlaying: false, queue: [] },
      _channels: [],
      _heartbeatTimer: null,
    });
  },
}));
