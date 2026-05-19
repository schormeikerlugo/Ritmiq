/**
 * Store global para BottomSheet — un solo punto de control para todos los
 * sheets de la app. Se renderean desde <BottomSheetHost /> (App.jsx) en
 * vez de portalear desde cada consumidor, lo que simplifica el flujo de
 * eventos, evita duplicacion de logica y centraliza el stacking.
 *
 * Contrato sobre `onClose`:
 *   - El callback `entry.onClose` se invoca SOLO cuando el sheet pide
 *     cerrarse desde su propia interaccion (click en backdrop, ESC, swipe).
 *     Lo dispara <BottomSheetHost />, NO el store.
 *   - Las acciones `close`, `closeById`, `closeAll` del store NO llaman a
 *     `onClose`. Asi, cerrar un sheet "externamente" (cleanup de un
 *     useEffect, navegacion) no provoca doble dispatch hacia el consumidor.
 *
 * Recomendacion para contenidos con state local (forms con inputs):
 *   Extrae el cuerpo del dialog como un componente propio y pasalo como
 *   <Body /> dentro de `content`. Asi el Body guarda su state aislado y
 *   el sheet no se recrea cuando el usuario escribe en un input.
 *
 *   function MyBody({ onClose }) {
 *     const [val, setVal] = useState('');
 *     return <input value={val} onChange={(e) => setVal(e.target.value)} />;
 *   }
 *   open({ title: 'Algo', content: <MyBody onClose={...} /> });
 *
 * Uso basico (estatico):
 *   const open = useBottomSheet((s) => s.open);
 *   const id = open({ title: 'Opciones', content: <Menu /> });
 *
 * @module @ritmiq/ui/stores/bottom-sheet
 */
import { create } from 'zustand';

let nextId = 1;

/**
 * @typedef {Object} BottomSheetEntry
 * @property {number} id
 * @property {string} [title]
 * @property {import('react').ReactNode} [header]      Override del header.
 * @property {import('react').ReactNode} content       Cuerpo del sheet.
 * @property {boolean} [dismissOnBackdrop=true]
 * @property {() => void} [onClose]                    Callback al cerrar.
 */

export const useBottomSheet = create((set, get) => ({
  /** @type {BottomSheetEntry[]} */
  stack: [],

  /**
   * Abre un nuevo sheet (lo apila encima del actual).
   * @param {Omit<BottomSheetEntry, 'id'>} entry
   * @returns {number} id del sheet — usar para closeById si se quiere
   *   cerrar uno especifico (no necesariamente el top).
   */
  open: (entry) => {
    const id = nextId++;
    set((s) => ({ stack: [...s.stack, { id, ...entry }] }));
    return id;
  },

  /** Cierra el sheet del top del stack (el visible).
   *  NO llama a `entry.onClose` — eso lo hace el BottomSheetHost cuando
   *  el sheet pide cerrarse via interaccion (evita doble llamada cuando
   *  el cierre se origina externamente). */
  close: () => {
    const stack = get().stack;
    if (stack.length === 0) return;
    set({ stack: stack.slice(0, -1) });
  },

  /** Cierra un sheet especifico por id. Misma logica que close(). */
  closeById: (id) => {
    const stack = get().stack;
    if (!stack.some((e) => e.id === id)) return;
    set({ stack: stack.filter((e) => e.id !== id) });
  },

  /** Cierra todos los sheets — util para resets o navegacion. */
  closeAll: () => {
    set({ stack: [] });
  },

  /**
   * Actualiza un sheet ya abierto (ej. para refrescar `content` cuando
   * el componente que lo abrio re-renderiza con state nuevo). NO causa
   * la animacion de salida/entrada — solo reemplaza props.
   * @param {number} id
   * @param {Partial<Omit<BottomSheetEntry, 'id'>>} patch
   */
  update: (id, patch) => {
    const stack = get().stack;
    const idx = stack.findIndex((e) => e.id === id);
    if (idx === -1) return;
    const updated = { ...stack[idx], ...patch };
    const next = [...stack];
    next[idx] = updated;
    set({ stack: next });
  },
}));
