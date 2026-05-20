/**
 * Aplica los settings de audio (EQ enabled, EQ gains) al backend cada
 * vez que cambian en useSettingsStore.
 *
 * Lazy WebAudio init:
 *  - Solo dispara `backend.setEqEnabled(true)` si el usuario activo el
 *    EQ. Eso inicializa el AudioContext + MediaElementSource. Una vez
 *    inicializado NO se puede deshacer (limitacion WebAudio), pero
 *    pasar el EQ a bypass es transparente y sin overhead audible.
 *  - Si el usuario nunca toca el EQ, el WebAudio graph nunca se crea
 *    y el audio sigue el path nativo del <audio>.
 *
 * @module @ritmiq/ui/lib/use-apply-audio-settings
 */
import { useEffect } from 'react';
import { useSettingsStore } from '../stores/settings.js';

/**
 * @param {ReturnType<import('./html-audio-backend.js').createHtmlAudioBackend>} backend
 */
export function useApplyAudioSettings(backend) {
  useEffect(() => {
    if (!backend) return;
    let initialized = false;

    function apply(state) {
      if (!state.eqEnabled && !initialized) return; // no-op total
      if (state.eqEnabled || initialized) {
        initialized = true;
        backend.setEqEnabled(state.eqEnabled);
        backend.setEqGains(state.eqGains);
        // En iOS hay que asegurar que el ctx este running tras un gesto.
        try { backend.resumeContext?.(); } catch {}
      }
    }

    // Estado inicial.
    apply(useSettingsStore.getState());
    const unsub = useSettingsStore.subscribe((state) => apply(state));
    return () => unsub();
  }, [backend]);
}
