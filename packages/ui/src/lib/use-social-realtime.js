/**
 * useSocialRealtime — suscripciones Realtime para el sistema social.
 *
 * Tres canales independientes:
 *
 *   1. presence:       INSERT/UPDATE/DELETE de la tabla presence
 *                      (filtrados por RLS — solo amigos mutuos con
 *                      show_activity=true llegan). Actualiza el Map
 *                      friendsPresence del store para que la UI muestre
 *                      "Escuchando ahora" sin recargar.
 *
 *   2. friendships:    INSERT/UPDATE/DELETE de friendships donde el
 *                      usuario actual es requester o addressee. Recarga
 *                      las solicitudes y los amigos cuando hay cambios
 *                      (mas simple y robusto que aplicar deltas a mano).
 *
 *   3. shared_items:   INSERT donde receiver_id = usuario. Inserta el
 *                      nuevo item al inicio del inbox sin recargar todo.
 *
 * Las suscripciones se montan/desmontan automaticamente al cambiar
 * el userId (login/logout). Limpieza correcta via cleanup function.
 *
 * @module @ritmiq/ui/lib/use-social-realtime
 */

import { useEffect } from 'react';
import { supabase } from './supabase.js';
import { useSocialStore } from '../stores/social.js';

// Cada cuanto barrer el Map de presencia para descartar entradas expiradas
// (TTL 2min server-side, pero el server solo limpia su tabla cada 5min via
// cron — entre medias podemos tener filas stale en el cliente si el amigo
// se desconecto sin hacer un DELETE explicito).
const STALE_SWEEP_MS = 30_000;

export function useSocialRealtime(userId) {
  useEffect(() => {
    if (!userId) return;

    // ── Sweep periodico de presencias expiradas ──────────────────────
    const sweepTimer = setInterval(() => {
      const { friendsPresence, setFriendPresence } = useSocialStore.getState();
      const now = Date.now();
      for (const [uid, entry] of friendsPresence) {
        const exp = entry.expiresAt ? new Date(entry.expiresAt).getTime() : 0;
        if (exp && exp < now) setFriendPresence(uid, null);
      }
    }, STALE_SWEEP_MS);

    // ── Canal 1: presence ──────────────────────────────────────────
    // No podemos filtrar por user_id porque queremos ver TODOS los
    // amigos. RLS hace el filtrado server-side: el usuario solo recibe
    // payloads de filas que tiene permiso de leer (amigos mutuos con
    // show_activity=true) — ver migracion 20260521000003_presence.sql.
    const presenceCh = supabase
      .channel(`rt-social-presence-${userId}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'presence' },
        (payload) => {
          const { eventType, new: row, old: oldRow } = payload;
          const setPresence = useSocialStore.getState().setFriendPresence;

          if (eventType === 'DELETE') {
            const uid = oldRow?.user_id;
            if (uid) setPresence(uid, null);
            return;
          }
          if (!row?.user_id) return;
          if (row.user_id === userId) return; // ignorar la propia
          setPresence(row.user_id, {
            userId:          row.user_id,
            ytId:            row.yt_id,
            title:           row.title,
            artist:          row.artist,
            coverUrl:        row.cover_url,
            positionSeconds: row.position_seconds ?? 0,
            expiresAt:       row.expires_at,
          });
        })
      .subscribe();

    // ── Canal 2: friendships ──────────────────────────────────────
    // Cualquier cambio donde yo sea participante recarga los datos.
    // RLS ya filtra a las filas donde soy requester o addressee.
    const friendshipsCh = supabase
      .channel(`rt-social-friendships-${userId}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'friendships' },
        () => {
          const { loadFriends, loadRequests } = useSocialStore.getState();
          loadFriends(userId);
          loadRequests(userId);
        })
      .subscribe();

    // ── Canal 3: shared_items ─────────────────────────────────────
    // Solo INSERT (nuevos shares recibidos). UPDATE local lo manejamos
    // optimisticamente desde markInboxItemRead/Saved.
    const sharedCh = supabase
      .channel(`rt-social-shared-${userId}`)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'shared_items', filter: `receiver_id=eq.${userId}` },
        () => {
          // Recargar el inbox completo — barato y garantiza consistencia
          // (el payload no trae el perfil del sender, que necesitamos
          // para el row).
          useSocialStore.getState().loadInbox(userId);
        })
      .subscribe();

    return () => {
      clearInterval(sweepTimer);
      try { supabase.removeChannel(presenceCh); } catch {}
      try { supabase.removeChannel(friendshipsCh); } catch {}
      try { supabase.removeChannel(sharedCh); } catch {}
    };
  }, [userId]);
}
