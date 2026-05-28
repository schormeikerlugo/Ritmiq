/**
 * useShortcutsOnboarding \u2014 muestra un toast informativo la PRIMERA vez
 * que un usuario entra a Ritmiq, informandole que `?` (Shift+/) abre la
 * lista de atajos de teclado.
 *
 * Se dispara con delay 4s tras el primer login + render del Home, para
 * no chocar con otros toasts iniciales (DailyStreakToast, MilestoneToast).
 *
 * Persistencia: flag boolean en localStorage 'ritmiq.shortcuts-seen'.
 * Una vez visto, no vuelve a mostrarse en ese device. Si el usuario
 * cierra el toast manualmente, igualmente queda como visto.
 *
 * Solo se ejecuta en desktop o PWA con teclado fisico probable
 * (heuristica: pointer:fine + ancho >= 768px). En mobile puro no aporta.
 *
 * @module @ritmiq/ui/lib/use-shortcuts-onboarding
 */
import { useEffect } from 'react';
import { toast } from '../stores/toast.js';
import { useBottomSheet } from '../stores/bottom-sheet.js';

const STORAGE_KEY = 'ritmiq.shortcuts-seen';
const SHOW_DELAY_MS = 4000;

function hasPhysicalKeyboardLikely() {
  if (typeof window === 'undefined') return false;
  if (typeof window.matchMedia !== 'function') return false;
  try {
    const finePointer = window.matchMedia('(pointer: fine)').matches;
    const wideEnough = window.innerWidth >= 768;
    return finePointer && wideEnough;
  } catch {
    return false;
  }
}

async function openShortcutsHelpInternal() {
  // Reuse del modal de atajos via bottom-sheet (consistente con `?`).
  const { open } = useBottomSheet.getState();
  const { createElement } = await import('react');
  const { ShortcutsHelp } = await import(
    '../components/ShortcutsHelp/ShortcutsHelp.jsx'
  );
  open({
    title: 'Atajos de teclado',
    content: createElement(ShortcutsHelp),
  });
}

export function useShortcutsOnboarding(userId) {
  useEffect(() => {
    if (!userId) return undefined;
    if (!hasPhysicalKeyboardLikely()) return undefined;
    try {
      if (localStorage.getItem(STORAGE_KEY) === '1') return undefined;
    } catch {
      return undefined;
    }

    const timeout = setTimeout(() => {
      try { localStorage.setItem(STORAGE_KEY, '1'); } catch {}
      toast.show({
        message: 'Pulsa ? para ver los atajos de teclado.',
        icon: 'Sparkles',
        duration: 8000,
        action: {
          label: 'Ver',
          onClick: () => { openShortcutsHelpInternal().catch(() => {}); },
        },
      });
    }, SHOW_DELAY_MS);

    return () => clearTimeout(timeout);
  }, [userId]);
}
