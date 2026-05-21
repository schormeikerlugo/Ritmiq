/**
 * use-share-reminder — recuerda al usuario los shares no vistos.
 *
 * Flujo:
 *   1. La PWA recibe un push notification (si esta activada) al instante
 *      que un amigo le comparte un track / playlist. Pero el usuario
 *      puede haber: (a) ignorado la push, (b) tenido las push apagadas,
 *      (c) entrado a Ritmiq sin haber abierto la notification.
 *
 *   2. Este hook revisa periodicamente el inbox y selecciona items
 *      "candidatos a recordatorio":
 *        - readAt === null (no abiertos)
 *        - createdAt antiguo segun tier:
 *            - Reciente (2-15 min)    → recordatorio leve
 *            - Antiguo  (>15 min)     → recordatorio si nunca lo mostramos
 *        - No mostrado ya en esta sesion (in-memory Set).
 *
 *   3. Si hay candidatos, se publica un evento en useShareReminderStore
 *      que el componente <ShareReminderModal> escucha y abre.
 *
 *   4. Una vez mostrado, el item se marca como "ya recordado" en
 *      localStorage (ritmiq.share-reminded.<id>) para no insistir en
 *      futuras sesiones tampoco — solo mostramos una vez por share.
 *
 * Pensado para emparejarse con el push: si el push llega y el usuario
 * lo abre → se marca como leido y el reminder nunca dispara. Si el
 * push no llega o se ignora → el reminder cubre el caso.
 *
 * @module @ritmiq/ui/lib/use-share-reminder
 */

import { create } from 'zustand';
import { useEffect } from 'react';
import { useSocialStore } from '../stores/social.js';
import { useViewStore } from '../stores/view.js';

const REMINDED_KEY_PREFIX = 'ritmiq.share-reminded.';
const CHECK_INTERVAL_MS   = 30_000;   // revisar cada 30s
const MIN_AGE_MS          = 2 * 60_000;  // share debe tener al menos 2min sin abrir

// ── Store mini para el modal de recordatorio ─────────────────────────

/** @typedef {{ id, kind, title, artist, coverUrl, playlistName, message, senderUsername, senderAvatarUrl, ytId, playlistSnapshot }} ReminderItem */

export const useShareReminderStore = create((set) => ({
  /** @type {ReminderItem[]} items a mostrar en el modal */
  pendingReminders: [],
  show: (items) => set({ pendingReminders: items }),
  dismiss: () => set({ pendingReminders: [] }),
}));

// ── Helpers de persistencia ─────────────────────────────────────────

function hasBeenReminded(itemId) {
  try { return localStorage.getItem(REMINDED_KEY_PREFIX + itemId) === '1'; }
  catch { return false; }
}
function markReminded(itemId) {
  try { localStorage.setItem(REMINDED_KEY_PREFIX + itemId, '1'); } catch {}
}

// ── Hook ────────────────────────────────────────────────────────────

export function useShareReminder(userId) {
  useEffect(() => {
    if (!userId) return;

    function check() {
      const { inbox } = useSocialStore.getState();
      const { view }  = useViewStore.getState();

      // Si el usuario YA esta viendo la bandeja, no molestar.
      if (view.kind === 'friends') return;

      const now = Date.now();
      const candidates = inbox.filter((item) => {
        if (item.readAt) return false;             // ya abierto
        if (hasBeenReminded(item.id)) return false; // ya recordado
        const createdMs = new Date(item.createdAt).getTime();
        if (!Number.isFinite(createdMs)) return false;
        const age = now - createdMs;
        return age >= MIN_AGE_MS;
      });

      if (candidates.length === 0) return;

      // Marcar todos como recordados ANTES de mostrar — evita loops
      // si el usuario cierra el modal sin marcar como leido.
      for (const c of candidates) markReminded(c.id);

      // Mostrar solo los 3 mas recientes para no abrumar
      const top3 = candidates
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .slice(0, 3);

      useShareReminderStore.getState().show(top3);
    }

    // Primer check tras 30s (da tiempo a que la PWA cargue inbox)
    const initial = setTimeout(check, CHECK_INTERVAL_MS);
    const timer   = setInterval(check, CHECK_INTERVAL_MS);

    return () => {
      clearTimeout(initial);
      clearInterval(timer);
    };
  }, [userId]);
}
