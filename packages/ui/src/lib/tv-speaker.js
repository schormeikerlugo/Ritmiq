/**
 * Sesión "altavoz" permanente de la app de TV.
 *
 * Con sesión iniciada, la TV crea (o retoma) una jam de tipo 'speaker' en la
 * que ella es el host: los teléfonos y PCs se unen con el QR o el código y la
 * controlan a distancia. El código se guarda en localStorage para retomar la
 * misma sesión al reabrir la app (mismo QR); si ya no existe, se crea otra.
 * Si la sesión se cierra (o se cambia el código), se recrea sola.
 *
 * @module @ritmiq/ui/lib/tv-speaker
 */
import { useEffect } from 'react';
import { useJamStore } from '../stores/jam.js';
import { IS_TV } from './tv-nav.js';

const LS_KEY = 'ritmiq:tv:speakerCode';

// Depuración por ADB/DevTools en la TV (adb forward … webview_devtools_remote).
if (IS_TV && typeof window !== 'undefined') window.__ritmiqJam = useJamStore;

let inFlight = false;

/** Retoma (si este aparato es el host) o crea la sesión altavoz. */
async function ensureSpeakerSession() {
  if (inFlight) return;
  inFlight = true;
  try {
    if (useJamStore.getState().mode !== 'idle') return;
    let saved = null;
    try { saved = localStorage.getItem(LS_KEY); } catch {}
    if (saved) {
      try {
        const ses = await useJamStore.getState().joinSession(saved);
        // Retomar solo si ESTE aparato es el host (jam.js hostedHere) y es
        // de tipo altavoz; si no, salir y crear una nueva.
        if (ses?.kind === 'speaker' && useJamStore.getState().mode === 'hosting') return;
      } catch { /* ya no existe */ }
      try { localStorage.removeItem(LS_KEY); } catch {}
      if (useJamStore.getState().mode !== 'idle') await useJamStore.getState().leaveSession();
    }
    await useJamStore.getState().createSession('speaker');
  } catch (e) {
    console.warn('[tv-speaker] no se pudo preparar la sesión', e?.message);
  } finally {
    inFlight = false;
  }
}

export function useTvSpeakerSession(userId) {
  const mode = useJamStore((s) => s.mode);
  const code = useJamStore((s) => s.session?.code ?? null);

  useEffect(() => {
    if (IS_TV && code && mode === 'hosting') { try { localStorage.setItem(LS_KEY, code); } catch {} }
  }, [code, mode]);

  useEffect(() => {
    if (!IS_TV || !userId || mode !== 'idle') return undefined;
    // Pequeña espera tras el login / tras cerrarse la sesión.
    const t = setTimeout(ensureSpeakerSession, 1500);
    return () => clearTimeout(t);
  }, [userId, mode]);
}
