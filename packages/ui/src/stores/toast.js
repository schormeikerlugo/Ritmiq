import { create } from 'zustand';

/**
 * Store global de toasts (snackbars).
 *
 * API publica:
 *   const showToast = useToastStore((s) => s.show);
 *   showToast({ message: 'Añadida a Favoritas', icon: 'Heart' });
 *
 * Variantes: 'default' | 'success' | 'error' | 'info'.
 * Duracion: default 3500ms. Pasar 0 para permanente (cierre manual).
 *
 * Maximo 3 toasts en pantalla. Los mas viejos se descartan FIFO.
 *
 * El componente <ToastHost> debe montarse una sola vez en App.jsx.
 */

const MAX_VISIBLE = 3;
const DEFAULT_DURATION = 3500;

let _id = 0;
function nextId() { return ++_id; }

export const useToastStore = create((set, get) => ({
  /** @type {Array<{ id: number, message: string, variant: string, icon?: string, duration: number, action?: { label: string, onClick: () => void } }>} */
  toasts: [],

  /**
   * Muestra un toast. Devuelve el id (util para dismiss manual).
   * @param {{ message: string, variant?: 'default'|'success'|'error'|'info', icon?: string, duration?: number, action?: { label: string, onClick: () => void } }} opts
   */
  show(opts) {
    const id = nextId();
    const toast = {
      id,
      message: opts.message,
      variant: opts.variant ?? 'default',
      icon: opts.icon,
      duration: opts.duration ?? DEFAULT_DURATION,
      action: opts.action,
    };
    set((s) => {
      // FIFO: si superamos MAX_VISIBLE, tiramos el mas viejo.
      const next = [...s.toasts, toast];
      while (next.length > MAX_VISIBLE) next.shift();
      return { toasts: next };
    });

    // Auto-dismiss salvo duration=0
    if (toast.duration > 0) {
      setTimeout(() => get().dismiss(id), toast.duration);
    }

    return id;
  },

  dismiss(id) {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },

  /** Atajo: show con variant='success' */
  success(message, opts = {}) {
    return get().show({ ...opts, message, variant: 'success' });
  },
  /** Atajo: show con variant='error' */
  error(message, opts = {}) {
    return get().show({ ...opts, message, variant: 'error', duration: opts.duration ?? 5000 });
  },
  /** Atajo: show con variant='info' */
  info(message, opts = {}) {
    return get().show({ ...opts, message, variant: 'info' });
  },
}));

/**
 * Helper para usar fuera de componentes React (ej. stores, librerias).
 *   import { toast } from 'stores/toast.js';
 *   toast.success('Guardado');
 */
export const toast = {
  show:    (opts) => useToastStore.getState().show(opts),
  success: (msg, opts) => useToastStore.getState().success(msg, opts),
  error:   (msg, opts) => useToastStore.getState().error(msg, opts),
  info:    (msg, opts) => useToastStore.getState().info(msg, opts),
  dismiss: (id) => useToastStore.getState().dismiss(id),
};
