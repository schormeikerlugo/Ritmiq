/**
 * Store de actualización de la PWA (Fase 9 / update flow).
 *
 * Mantiene el estado del ciclo de actualización del service worker, pero
 * SIN depender de `virtual:pwa-register` (que solo existe en el build de
 * `apps/pwa`). La capa de la PWA inyecta las funciones reales vía
 * `bindUpdater()`. La UI (AboutInfoView) lee este store y dispara acciones.
 *
 * Así el build de Electron desktop —que no tiene el plugin PWA— compila sin
 * problemas: en desktop el updater nunca se enlaza y todo queda inerte.
 *
 * Estado:
 *   - version / buildDate: identidad del build actual (mostrada en Ajustes).
 *   - needRefresh: hay un SW nuevo en espera → ofrecer "Actualizar".
 *   - checking: hay una comprobación manual en curso.
 *   - bound: si la PWA ya enlazó el updater real.
 *
 * @module @ritmiq/ui/stores/pwa-update
 */
import { create } from 'zustand';

export const usePwaUpdateStore = create((set, get) => ({
  /** Versión semántica del build (package.json). */
  version: null,
  /** Fecha del build (YYYY-MM-DD). */
  buildDate: null,
  /** true cuando hay una nueva versión del SW lista para activarse. */
  needRefresh: false,
  /** true mientras corre una comprobación manual de actualizaciones. */
  checking: false,
  /** true si la capa PWA ya enlazó las funciones reales. */
  bound: false,

  /** @type {(reload?: boolean) => Promise<void> | void} */
  _doUpdate: null,
  /** @type {() => Promise<boolean>} resuelve true si encontró update. */
  _doCheck: null,

  /**
   * Enlaza el updater real (llamado una vez desde apps/pwa).
   * @param {{ version?: string, buildDate?: string,
   *   update: (reload?: boolean) => any, check: () => Promise<boolean> }} api
   */
  bindUpdater(api) {
    set({
      bound: true,
      version: api.version ?? get().version,
      buildDate: api.buildDate ?? get().buildDate,
      _doUpdate: api.update ?? null,
      _doCheck: api.check ?? null,
    });
  },

  /** La capa PWA marca que hay una versión nueva disponible. */
  setNeedRefresh(value) {
    set({ needRefresh: !!value });
  },

  /** Aplica la actualización: activa el SW nuevo y recarga. */
  applyUpdate() {
    const fn = get()._doUpdate;
    if (fn) fn(true);
  },

  /**
   * Comprueba manualmente si hay una actualización. Devuelve true si la hay.
   * Usado por el botón "Buscar actualizaciones" de Ajustes.
   */
  async checkForUpdate() {
    const fn = get()._doCheck;
    if (!fn || get().checking) return false;
    set({ checking: true });
    try {
      const found = await fn();
      return !!found;
    } catch {
      return false;
    } finally {
      set({ checking: false });
    }
  },
}));
