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
  /** @type {Array<{ user_id: string, joined_at: string, role: 'host'|'guest' }>} */
  participants: [],
  /** Estado del player canonico de la sesion (solo lectura para guests). */
  state: {
    currentTrack: null,
    positionSeconds: 0,
    isPlaying: false,
    queue: [],
  },
  /**
   * Cola colaborativa de sugerencias (tabla jam_queue). Cada item:
   * { id, track, suggestedBy, position, playedAt }. Ordenada por position.
   * Pendientes (playedAt == null) primero, ya reproducidas al final.
   * @type {Array<{ id:string, track:any, suggestedBy:string, position:number, playedAt:string|null }>}
   */
  suggestions: [],
  /**
   * Cache de perfiles (display_name/username/avatar_url) de los sugeridores,
   * indexado por user_id. Se resuelve de la tabla profiles al recibir CDC.
   * @type {Record<string, { userId:string, username:string, displayName:string|null, avatarUrl:string|null }>}
   */
  profilesById: {},

  /**
   * Arranque coordinado (Bloque 3.7). Mapa userId → 'loading' | 'ready'
   * para el playId actual. El host lo usa para saber por quien espera y la
   * UI muestra spinner/check por participante.
   * @type {Record<string, 'loading'|'ready'>}
   */
  readyByUser: {},
  /** Lista de userIds que el host aun espera para arrancar (derivado). @type {string[]} */
  waitingFor: [],
  /** playId del arranque coordinado en curso (incrementa por cada track). */
  _playId: 0,
  /** El canal broadcast Realtime (subset de _channels) para enviar mensajes. */
  _bcastChannel: null,

  /** Subscriptions Realtime activas (para cleanup). */
  _channels: [],
  _heartbeatTimer: null,

  /**
   * Codigo pendiente de unirse via deep-link (/jam/<code>). App.jsx lo
   * setea al detectar la URL; cuando hay user logueado se monta el
   * JamModal con este codigo. Se limpia tras consumirlo.
   * @type {string|null}
   */
  pendingJoinCode: null,
  setPendingJoinCode(code) {
    const norm = String(code ?? '').trim().toUpperCase();
    set({ pendingJoinCode: /^[A-Z0-9]{6}$/.test(norm) ? norm : null });
  },
  clearPendingJoinCode() { set({ pendingJoinCode: null }); },

  /**
   * Flag global del JamModal. Lo abre el botón del Player (footer desktop)
   * y cualquier punto de entrada. App.jsx monta el modal cuando es true.
   */
  jamModalOpen: false,
  openJamModal() { set({ jamModalOpen: true }); },
  closeJamModal() { set({ jamModalOpen: false }); },

  /**
   * Crea una sesion nueva como host. Inserta en jam_sessions + join
   * automatico como participant + suscribe a CDC.
   */
  async createSession() {
    const { data: { session: authSession } } = await supabase.auth.getSession();
    const user = authSession?.user;
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

    // Auto-join como participant (para mostrarse en la lista). El creador
    // es el host, asi que su rol es 'host'.
    await supabase.from('jam_participants').upsert({
      session_id: inserted.id,
      user_id: user.id,
      role: 'host',
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

    const { data: { session: authSession } } = await supabase.auth.getSession();
    const user = authSession?.user;
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
      role: isHost ? 'host' : 'guest',
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

    const { data: { session: authSession } } = await supabase.auth.getSession();
    const user = authSession?.user;

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
      suggestions: [],
      profilesById: {},
      readyByUser: {},
      waitingFor: [],
      _bcastChannel: null,
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

  /**
   * Transfiere el control de la sesion a otro participante. Solo el host
   * actual puede ejecutarla (validado server-side por jam_transfer_host).
   * Tras el RPC, el cambio de host_id llega via CDC y el ex-host pasa a
   * 'guest' automaticamente (mode recalculado en el subscribe).
   *
   * @param {string} newHostUserId user_id del nuevo host (debe estar en la sesion)
   */
  async transferHost(newHostUserId) {
    const { session, mode } = get();
    if (mode !== 'hosting' || !session) throw new Error('solo el host puede transferir');
    if (!newHostUserId || newHostUserId === session.hostId) return;

    const { error } = await supabase.rpc('jam_transfer_host', {
      p_session_id: session.id,
      p_new_host_id: newHostUserId,
    });
    if (error) throw error;

    // Optimista: el ex-host pasa a guest localmente. El CDC confirmara.
    set({
      mode: 'guest',
      session: { ...session, hostId: newHostUserId },
    });
  },

  // ── Cola colaborativa (jam_queue) ──────────────────────────────────

  /**
   * Sugiere un track a la cola del jam. Cualquier participante puede.
   * Se inserta al final (position = max+1). El CDC actualiza la lista en
   * todos los clientes.
   * @param {any} track objeto track con al menos { ytId, title, artist }
   */
  async suggestTrack(track) {
    const { session } = get();
    if (!session || !track) return;
    const { data: { session: authSession } } = await supabase.auth.getSession();
    const user = authSession?.user;
    if (!user) throw new Error('no autenticado');

    // position = ultimo + 1 para mantener orden de llegada.
    const maxPos = get().suggestions.reduce((m, s) => Math.max(m, s.position), -1);
    const slim = {
      ytId: track.ytId ?? null,
      id: track.id ?? null,
      title: track.title ?? '',
      artist: track.artist ?? null,
      album: track.album ?? null,
      coverUrl: track.coverUrl ?? null,
      durationSeconds: typeof track.durationSeconds === 'number' ? track.durationSeconds : null,
    };
    const { error } = await supabase.from('jam_queue').insert({
      session_id: session.id,
      suggested_by: user.id,
      track: slim,
      position: maxPos + 1,
    });
    if (error) throw error;
  },

  /**
   * Quita una sugerencia. RLS permite al host cualquiera, o al autor si
   * aun no se reprodujo.
   * @param {string} id id de la fila jam_queue
   */
  async removeSuggestion(id) {
    if (!id) return;
    const { error } = await supabase.from('jam_queue').delete().eq('id', id);
    if (error) throw error;
  },

  /**
   * Reordena una sugerencia (solo host). Asigna una nueva position.
   * Implementacion simple: position = valor objetivo; el orden se recalcula
   * al re-fetch. Para inserciones entre dos, usamos el promedio.
   * @param {string} id
   * @param {number} newPosition
   */
  async reorderSuggestion(id, newPosition) {
    const { mode } = get();
    if (mode !== 'hosting') return;
    const { error } = await supabase
      .from('jam_queue')
      .update({ position: newPosition })
      .eq('id', id);
    if (error) throw error;
  },

  /**
   * El host reproduce una sugerencia: marca played_at y aplica el track al
   * player local (que se propaga a los guests por use-jam-sync). Solo host.
   * @param {string} id
   */
  async playSuggestion(id) {
    const { mode, suggestions } = get();
    if (mode !== 'hosting') return;
    const item = suggestions.find((s) => s.id === id);
    if (!item) return;

    // Marcar como reproducida (mueve al final de la lista de pendientes).
    await supabase
      .from('jam_queue')
      .update({ played_at: new Date().toISOString() })
      .eq('id', id);

    // Reproducir con arranque coordinado (todos preparan y arrancan a la vez).
    get().coordinatedPlay(item.track);
  },

  // ── Arranque coordinado (Bloque 3.7) ───────────────────────────────

  /**
   * El host avanza la cola automaticamente: toma la 1ª sugerencia pendiente
   * (played_at == null, orden position) y la reproduce coordinadamente. Si
   * no hay pendientes, se detiene. Llamado al terminar una cancion (FIFO).
   */
  async jamAdvance() {
    const { mode, suggestions } = get();
    if (mode !== 'hosting') return;
    const pending = suggestions
      .filter((s) => !s.playedAt)
      .sort((a, b) => a.position - b.position);
    const next = pending[0];
    if (!next) {
      // Cola vacia: detener limpiamente y avisar a los guests.
      try {
        const { usePlayerStore } = await import('./player.js');
        usePlayerStore.setState({ isPlaying: false });
      } catch {}
      get()._broadcast('control', { action: 'pause' });
      return;
    }
    await supabase
      .from('jam_queue')
      .update({ played_at: new Date().toISOString() })
      .eq('id', next.id);
    get().coordinatedPlay(next.track);
  },

  /**
   * Reproduce un track con arranque coordinado: prepara en todos los
   * clientes, espera a que todos confirmen "ready" y entonces ordena
   * arrancar a la vez. Solo host. El host tambien se prepara localmente.
   * @param {any} track
   */
  async coordinatedPlay(track) {
    const { mode, participants } = get();
    if (mode !== 'hosting' || !track) return;

    const playId = get()._playId + 1;
    // Estado inicial: todos los participantes en 'loading'.
    const ids = participants.map((p) => p.user_id);
    const readyByUser = {};
    for (const id of ids) readyByUser[id] = 'loading';
    set({
      _playId: playId,
      readyByUser,
      waitingFor: ids.slice(),
      state: { ...get().state, currentTrack: track, positionSeconds: 0, isPlaying: false },
    });

    // Persistir en jam_sessions para quien entre a mitad de sesion.
    try {
      await supabase.from('jam_sessions').update({
        current_track: track, position_seconds: 0, is_playing: false,
        updated_at: new Date().toISOString(),
      }).eq('id', get().session?.id);
    } catch {}

    // Pedir a todos que preparen (incluido el host, localmente).
    get()._broadcast('prepare', { playId, track });
    get()._localPrepare(playId, track);
  },

  /** El host fuerza el arranque sin esperar a los rezagados (boton UI). */
  forceStart() {
    if (get().mode !== 'hosting') return;
    get()._maybeStart(true);
  },

  /**
   * Internal: prepara el track localmente (host o guest) y, cuando el audio
   * esta listo, marca este cliente como 'ready' y lo difunde.
   */
  async _localPrepare(playId, track) {
    const myId = await get()._myUserId();
    if (!myId) return;
    // Disparar la preparacion en el player (resuelve URL + carga sin sonar).
    const onReady = (err) => {
      if (get()._playId !== playId) return; // playId viejo, ignorar
      if (err) { console.warn('[jam] localPrepare error', err?.message); }
      get()._markReady(myId, playId);
      get()._broadcast('ready', { playId, userId: myId });
    };
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('ritmiq:jam-prepare', { detail: { track, onReady } }));
    }
  },

  /** Internal: marca un user como ready para el playId actual. */
  _markReady(userId, playId) {
    if (get()._playId !== playId) return;
    set((s) => ({
      readyByUser: { ...s.readyByUser, [userId]: 'ready' },
      waitingFor: s.waitingFor.filter((id) => id !== userId),
    }));
    // El host decide si ya puede arrancar.
    if (get().mode === 'hosting') get()._maybeStart(false);
  },

  /**
   * Internal (host): arranca si todos estan ready (o force=true). Emite el
   * mensaje 'start' con un pequeno delay relativo para que todos arranquen
   * casi simultaneamente.
   */
  _maybeStart(force) {
    if (get().mode !== 'hosting') return;
    const waiting = get().waitingFor;
    if (!force && waiting.length > 0) return; // aun faltan
    const playId = get()._playId;
    const startInMs = 300;
    get()._broadcast('start', { playId, startInMs });
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('ritmiq:jam-start', { detail: { startInMs } }));
    }
    set((s) => ({
      waitingFor: [],
      state: { ...s.state, isPlaying: true },
    }));
    // Persistir is_playing.
    supabase.from('jam_sessions').update({
      is_playing: true, updated_at: new Date().toISOString(),
    }).eq('id', get().session?.id).then(() => {}, () => {});
  },

  /** Internal: envia un mensaje broadcast por el canal del jam. */
  _broadcast(event, payload) {
    const ch = get()._bcastChannel;
    if (!ch) return;
    try { ch.send({ type: 'broadcast', event, payload }); } catch {}
  },

  /** Internal: user_id actual. */
  async _myUserId() {
    const { data: { session: authSession } } = await supabase.auth.getSession();
    return authSession?.user?.id ?? null;
  },

  /**
   * Internal: resuelve perfiles (avatar/nombre) de los user_ids dados que
   * aun no esten en cache. Merge en profilesById.
   * @param {string[]} userIds
   */
  async _resolveProfiles(userIds) {
    const have = get().profilesById;
    const missing = [...new Set(userIds)].filter((id) => id && !have[id]);
    if (missing.length === 0) return;
    const { data } = await supabase
      .from('profiles')
      .select('user_id, username, display_name, avatar_url')
      .in('user_id', missing);
    if (!data || data.length === 0) return;
    const next = { ...get().profilesById };
    for (const p of data) {
      next[p.user_id] = {
        userId: p.user_id,
        username: p.username,
        displayName: p.display_name ?? null,
        avatarUrl: p.avatar_url ?? null,
      };
    }
    set({ profilesById: next });
  },

  /** Internal: re-fetch completo de la cola de sugerencias + perfiles. */
  async _refreshSuggestions(sessionId) {
    const { data } = await supabase
      .from('jam_queue')
      .select('id, track, suggested_by, position, played_at')
      .eq('session_id', sessionId)
      .order('played_at', { ascending: true, nullsFirst: true })
      .order('position', { ascending: true });
    const suggestions = (data ?? []).map((r) => ({
      id: r.id,
      track: r.track,
      suggestedBy: r.suggested_by,
      position: Number(r.position) || 0,
      playedAt: r.played_at,
    }));
    set({ suggestions });
    await get()._resolveProfiles(suggestions.map((s) => s.suggestedBy));

    // Pre-prepare (Bloque 3.7): calentar la cache de la SIGUIENTE sugerencia
    // pendiente en todos los clientes para que su arranque coordinado sea
    // casi instantaneo. Solo si hay sesion activa. Best-effort.
    if (get().mode !== 'idle' && typeof window !== 'undefined') {
      const pending = suggestions
        .filter((s) => !s.playedAt)
        .sort((a, b) => a.position - b.position);
      const next = pending[0];
      if (next?.track) {
        window.dispatchEvent(new CustomEvent('ritmiq:jam-preprepare', { detail: { track: next.track } }));
      }
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
      }, async (payload) => {
        const row = payload.new;
        const { session, mode } = get();

        // Detectar transferencia de host: si host_id cambio, recalcular
        // el mode local de este cliente.
        if (session && row.host_id && row.host_id !== session.hostId) {
          const { data: { session: authSession } } = await supabase.auth.getSession();
          const user = authSession?.user;
          const amNewHost = user?.id === row.host_id;
          set({
            mode: amNewHost ? 'hosting' : 'guest',
            session: { ...session, hostId: row.host_id },
          });
        }

        // El transporte en vivo (track/play/seek) ahora viaja por BROADCAST
        // (arranque coordinado, baja latencia). El CDC de jam_sessions solo
        // se usa como snapshot persistente para quien entra a mitad de
        // sesion. Guardamos el state como referencia, sin tocar el player
        // (eso lo hace el handshake prepare/start).
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
      // ── Arranque coordinado (broadcast) ──────────────────────────────
      .on('broadcast', { event: 'prepare' }, ({ payload }) => {
        const { playId, track } = payload ?? {};
        if (!track) return;
        set({ _playId: playId, state: { ...get().state, currentTrack: track, isPlaying: false } });
        get()._localPrepare(playId, track);
      })
      .on('broadcast', { event: 'ready' }, ({ payload }) => {
        const { playId, userId } = payload ?? {};
        if (userId) get()._markReady(userId, playId);
      })
      .on('broadcast', { event: 'start' }, ({ payload }) => {
        const { playId, startInMs } = payload ?? {};
        if (get()._playId !== playId) return;
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('ritmiq:jam-start', { detail: { startInMs } }));
        }
        set((s) => ({ waitingFor: [], state: { ...s.state, isPlaying: true } }));
      })
      .on('broadcast', { event: 'control' }, ({ payload }) => {
        const { action, seconds } = payload ?? {};
        if (typeof window === 'undefined') return;
        if (action === 'pause') {
          import('./player.js').then(({ usePlayerStore }) => usePlayerStore.setState({ isPlaying: false }));
        } else if (action === 'play') {
          import('./player.js').then(({ usePlayerStore }) => usePlayerStore.setState({ isPlaying: true }));
        } else if (action === 'seek' && typeof seconds === 'number') {
          window.dispatchEvent(new CustomEvent('ritmiq:seek', { detail: { seconds } }));
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
          .select('user_id, joined_at, last_seen_at, role')
          .eq('session_id', sessionId);
        set({ participants: data ?? [] });
        get()._resolveProfiles((data ?? []).map((p) => p.user_id));
      })
      .subscribe();

    // Canal CDC de la cola colaborativa (jam_queue). Cualquier cambio
    // (sugerencia nueva, quitada, reproducida, reordenada) re-fetch la
    // lista y resuelve perfiles de los sugeridores nuevos.
    const queueChannel = supabase
      .channel(`jam-queue:${sessionId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'jam_queue',
        filter: `session_id=eq.${sessionId}`,
      }, () => {
        get()._refreshSuggestions(sessionId);
      })
      .subscribe();

    // Trigger inicial.
    const { data: initialParts } = await supabase
      .from('jam_participants')
      .select('user_id, joined_at, last_seen_at, role')
      .eq('session_id', sessionId);
    set({
      _channels: [sesChannel, partChannel, queueChannel],
      _bcastChannel: sesChannel,
      participants: initialParts ?? [],
    });
    get()._resolveProfiles((initialParts ?? []).map((p) => p.user_id));
    await get()._refreshSuggestions(sessionId);
  },

  /** Internal: heartbeat de last_seen_at cada 30s mientras esta en sesion. */
  _startHeartbeat() {
    const existing = get()._heartbeatTimer;
    if (existing) clearInterval(existing);
    const timer = setInterval(async () => {
      const { session } = get();
      if (!session) return;
      const { data: { session: authSession } } = await supabase.auth.getSession();
      const user = authSession?.user;
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
      suggestions: [],
      profilesById: {},
      readyByUser: {},
      waitingFor: [],
      state: { currentTrack: null, positionSeconds: 0, isPlaying: false, queue: [] },
      _channels: [],
      _bcastChannel: null,
      _heartbeatTimer: null,
      pendingJoinCode: null,
    });
  },
}));
