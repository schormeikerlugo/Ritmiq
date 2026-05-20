/**
 * Settings persistentes de reproduccion (Fase 2 — Sprint γ).
 *
 * Centraliza preferencias de audio que NO son state del player en si:
 *   - crossfadeSeconds: 0..8 — duracion del fundido al saltar manualmente.
 *   - eqEnabled: bool — si la cadena de EQ esta activa.
 *   - eqGains: number[6] — ganancias por banda en dB, [-12, +12].
 *   - eqPreset: string — preset seleccionado (o 'custom').
 *
 * Persistencia: localStorage clave 'ritmiq.settings.v1'.
 *
 * Cada cambio relevante de audio aplica al backend al instante via el
 * hook useApplyAudioSettings (montado en App.jsx junto al engine).
 *
 * @module @ritmiq/ui/stores/settings
 */
import { create } from 'zustand';

const LS_KEY = 'ritmiq.settings.v1';

/** Presets de EQ. Valores en dB, longitud 6 (= EQ_BANDS). */
export const EQ_PRESETS = {
  flat:    [ 0,  0,  0,  0,  0,  0],
  bass:    [ 6,  4,  2,  0, -1,  0],
  vocal:   [-2, -1,  1,  3,  2,  0],
  rock:    [ 4,  3,  0,  1,  3,  4],
  pop:     [-1,  2,  4,  4,  2, -1],
  classic: [ 4,  3,  0,  0,  2,  3],
  electro: [ 5,  3,  0,  1,  3,  5],
};

const DEFAULTS = {
  crossfadeSeconds: 0,
  eqEnabled: false,
  eqGains: EQ_PRESETS.flat.slice(),
  eqPreset: 'flat',
};

function readInitial() {
  if (typeof localStorage === 'undefined') return { ...DEFAULTS };
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw);
    return {
      crossfadeSeconds: clamp(parsed.crossfadeSeconds ?? 0, 0, 8),
      eqEnabled: !!parsed.eqEnabled,
      eqGains: Array.isArray(parsed.eqGains) && parsed.eqGains.length === 6
        ? parsed.eqGains.map((g) => clamp(Number(g) || 0, -12, 12))
        : DEFAULTS.eqGains.slice(),
      eqPreset: typeof parsed.eqPreset === 'string' ? parsed.eqPreset : 'flat',
    };
  } catch {
    return { ...DEFAULTS };
  }
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, Number(n) || 0));
}

function persist(state) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify({
      crossfadeSeconds: state.crossfadeSeconds,
      eqEnabled: state.eqEnabled,
      eqGains: state.eqGains,
      eqPreset: state.eqPreset,
    }));
  } catch {}
}

export const useSettingsStore = create((set, get) => ({
  ...readInitial(),

  /** @param {number} s 0..8 segundos */
  setCrossfade(s) {
    const v = clamp(s, 0, 8);
    set({ crossfadeSeconds: v });
    persist(get());
  },

  /** @param {boolean} enabled */
  setEqEnabled(enabled) {
    set({ eqEnabled: !!enabled });
    persist(get());
  },

  /**
   * Ajusta una banda especifica (0..5). Pasa a preset 'custom'
   * automaticamente.
   * @param {number} idx 0..5
   * @param {number} gainDb -12..+12
   */
  setEqBand(idx, gainDb) {
    if (idx < 0 || idx > 5) return;
    const gains = get().eqGains.slice();
    gains[idx] = clamp(gainDb, -12, 12);
    set({ eqGains: gains, eqPreset: 'custom' });
    persist(get());
  },

  /** Aplica un preset. Si name no existe, ignora. */
  setEqPreset(name) {
    const preset = EQ_PRESETS[name];
    if (!preset) return;
    set({ eqGains: preset.slice(), eqPreset: name });
    persist(get());
  },

  /** Reset total a defaults. */
  resetAudio() {
    set({ ...DEFAULTS, eqGains: DEFAULTS.eqGains.slice() });
    persist(get());
  },
}));
