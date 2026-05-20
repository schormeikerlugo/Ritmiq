/**
 * Aplica los settings de audio (EQ gains) al backend cada vez que
 * cambian en useSettingsStore.
 *
 * IMPORTANTE: este hook NO inicializa el WebAudio graph. Esa
 * responsabilidad pertenece al UI que activa el toggle (debe llamar
 * backend.initGraphFromGesture() dentro del onClick para cumplir la
 * restriccion de iOS PWA de "usuario gesture required").
 *
 * Si el graph aun no existe y el usuario solo cambia sliders de EQ,
 * los setters del backend son no-op — el state queda en el store
 * pero no afecta al audio hasta que el graph se cree desde el toggle.
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
    function apply(state) {
      // No-op si el graph no esta inicializado — los setters internos
      // ya hacen guard, pero evitamos llamadas redundantes.
      if (!backend.isGraphReady?.()) return;
      backend.setEqEnabled(state.eqEnabled);
      backend.setEqGains(state.eqGains);
    }
    apply(useSettingsStore.getState());
    const unsub = useSettingsStore.subscribe((state) => apply(state));
    return () => unsub();
  }, [backend]);
}
