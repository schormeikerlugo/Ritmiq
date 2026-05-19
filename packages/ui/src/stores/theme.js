/**
 * Store del tema de la app — dark / light / auto.
 *
 * - 'dark'  → fuerza el tema oscuro (default actual de la app).
 * - 'light' → fuerza el tema claro.
 * - 'auto'  → sigue al sistema operativo (prefers-color-scheme).
 *
 * Persistencia: localStorage clave `ritmiq.theme`. Si no hay valor guardado,
 * arranca en 'dark' (no en 'auto') porque la app fue diseñada en oscuro y
 * los usuarios existentes esperan ese look.
 *
 * Aplicacion: `document.documentElement.dataset.theme = <theme>`. El CSS
 * en `tokens.css` reacciona a ese atributo. Ver tokens.css para los
 * overrides por tema.
 *
 * @module @ritmiq/ui/stores/theme
 */
import { create } from 'zustand';

const LS_KEY = 'ritmiq.theme';
const VALID = ['dark', 'light', 'auto'];

function readInitial() {
  if (typeof localStorage === 'undefined') return 'dark';
  try {
    const v = localStorage.getItem(LS_KEY);
    if (v && VALID.includes(v)) return v;
  } catch {}
  return 'dark';
}

function applyToDom(theme) {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.theme = theme;
}

export const useThemeStore = create((set) => ({
  /** @type {'dark'|'light'|'auto'} */
  theme: readInitial(),

  /** @param {'dark'|'light'|'auto'} theme */
  setTheme: (theme) => {
    if (!VALID.includes(theme)) return;
    try { localStorage.setItem(LS_KEY, theme); } catch {}
    applyToDom(theme);
    set({ theme });
  },
}));

/**
 * Aplica el tema actual al <html> en el arranque. Llamar una vez antes del
 * primer render del App para evitar el flash blanco en light/auto.
 * Idempotente.
 */
export function initTheme() {
  applyToDom(useThemeStore.getState().theme);
}
