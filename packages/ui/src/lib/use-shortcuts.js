/**
 * Atajos de teclado globales — solo desktop. Se monta una vez en App.
 *
 * Atajos:
 *   - Space           toggle play/pause
 *   - →               siguiente pista
 *   - ←               pista anterior (o reinicia si pos > 3s, segun store.prev())
 *   - ↑               volumen +5%
 *   - ↓               volumen -5%
 *   - M               mute toggle (guarda volumen previo)
 *   - Ctrl/Cmd+K      focus al input de busqueda
 *   - /               focus al input de busqueda (sin modificador)
 *   - Shift+/  (?)    abre modal de ayuda con todos los atajos
 *
 * Guards:
 *   - Ignora si el target es un input/textarea/select o contentEditable.
 *   - Ignora si hay un BottomSheet abierto (deja que el sheet maneje sus
 *     propias interacciones — ESC, etc.).
 *   - Ignora si la combinacion lleva modificadores no esperados para evitar
 *     pisarse con atajos del navegador (ej. Ctrl+Shift+K = DevTools).
 *
 * @module @ritmiq/ui/lib/use-shortcuts
 */
import { createElement, useEffect } from 'react';
import { usePlayerStore } from '../stores/player.js';
import { useBottomSheet } from '../stores/bottom-sheet.js';

/** ID del input de busqueda en TopBar — se usa para focus via getElementById. */
export const SEARCH_INPUT_ID = 'ritmiq-search-input';

/** Memoriza el volumen previo al mutear para poder restaurarlo. */
let volumeBeforeMute = null;

/**
 * Determina si el evento debe ignorarse por venir de un campo editable.
 * @param {KeyboardEvent} e
 */
function isFromEditable(e) {
  const t = e.target;
  if (!t || !(t instanceof Element)) return false;
  const tag = t.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (t instanceof HTMLElement && t.isContentEditable) return true;
  return false;
}

/**
 * Abre un sheet con la lista de atajos. Reusa el BottomSheet global.
 * Importado dinamicamente para que el componente del modal no entre
 * en el bundle inicial.
 */
async function openShortcutsHelp() {
  const open = useBottomSheet.getState().open;
  const { ShortcutsHelp } = await import(
    '../components/ShortcutsHelp/ShortcutsHelp.jsx'
  );
  open({ title: 'Atajos de teclado', content: createElement(ShortcutsHelp) });
}

/**
 * Hook React: registra el listener global de keydown mientras el componente
 * que lo monta este vivo. Pensado para montarse una sola vez al nivel de App.
 */
export function useGlobalShortcuts() {
  useEffect(() => {
    const onKeyDown = (e) => {
      // Si hay un sheet abierto, no interceptamos — el sheet maneja su
      // propio ESC / interaccion. Excepcion: el modal de ayuda mismo,
      // pero al estar en un sheet, "?" no haria nada nuevo (ya esta
      // abierto), asi que no necesitamos rama especial.
      if (useBottomSheet.getState().stack.length > 0) return;

      // Ignora si el evento viene de un campo editable.
      // Excepcion: ESC dentro de un input para blur — pero eso lo deja
      // pasar el navegador por su cuenta, no necesitamos hacerlo aqui.
      if (isFromEditable(e)) return;

      const store = usePlayerStore.getState();
      const k = e.key;
      const hasCtrl = e.ctrlKey || e.metaKey;
      const hasShift = e.shiftKey;
      const hasAlt = e.altKey;

      // ── Ctrl/Cmd+K → focus search ─────────────────────────────
      if (hasCtrl && !hasShift && !hasAlt && (k === 'k' || k === 'K')) {
        const el = document.getElementById(SEARCH_INPUT_ID);
        if (el) {
          e.preventDefault();
          el.focus();
          if (el instanceof HTMLInputElement) el.select();
        }
        return;
      }

      // El resto de atajos no llevan modificadores.
      if (hasCtrl || hasAlt) return;

      // ── / → focus search ──────────────────────────────────────
      if (k === '/' && !hasShift) {
        const el = document.getElementById(SEARCH_INPUT_ID);
        if (el) {
          e.preventDefault();
          el.focus();
          if (el instanceof HTMLInputElement) el.select();
        }
        return;
      }

      // ── ? (Shift+/) → abrir ayuda ─────────────────────────────
      if (k === '?' || (k === '/' && hasShift)) {
        e.preventDefault();
        openShortcutsHelp();
        return;
      }

      // ── Space → play/pause ────────────────────────────────────
      if (k === ' ' || k === 'Spacebar') {
        if (!store.currentTrack) return;
        e.preventDefault();
        store.togglePlay();
        return;
      }

      // ── ArrowRight / ArrowLeft → next / prev ──────────────────
      if (k === 'ArrowRight') {
        if (!store.currentTrack) return;
        e.preventDefault();
        store.next();
        return;
      }
      if (k === 'ArrowLeft') {
        if (!store.currentTrack) return;
        e.preventDefault();
        store.prev();
        return;
      }

      // ── ArrowUp / ArrowDown → volumen ±5% ─────────────────────
      if (k === 'ArrowUp') {
        e.preventDefault();
        const v = Math.min(1, (store.volume ?? 0.8) + 0.05);
        store.setVolume(v);
        return;
      }
      if (k === 'ArrowDown') {
        e.preventDefault();
        const v = Math.max(0, (store.volume ?? 0.8) - 0.05);
        store.setVolume(v);
        return;
      }

      // ── M → mute toggle ───────────────────────────────────────
      if (k === 'm' || k === 'M') {
        e.preventDefault();
        const cur = store.volume ?? 0.8;
        if (cur > 0) {
          volumeBeforeMute = cur;
          store.setVolume(0);
        } else {
          store.setVolume(volumeBeforeMute ?? 0.5);
          volumeBeforeMute = null;
        }
        return;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
