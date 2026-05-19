/**
 * BottomSheetHost — punto unico de render para todos los bottom sheets.
 *
 * Se monta UNA VEZ en App.jsx (dentro de .shell) y renderea el stack del
 * store global `useBottomSheet`. Cualquier componente puede abrir un sheet
 * llamando a `useBottomSheet.getState().open({...})` o desde el hook:
 *
 *   const open = useBottomSheet((s) => s.open);
 *   const id = open({ title, content, onClose });
 *
 * Soporta multiples sheets apilados — cada uno con su propio backdrop —
 * para flujos tipo menu contextual que abre sub-sheet.
 *
 * NOTA iOS PWA standalone: en modo standalone, iOS puede dejar un pequeño
 * espacio entre el panel y el borde fisico inferior (safe-area-inset-bottom).
 * Es una limitacion documentada del runtime de iOS WebKit con position:fixed
 * en este contexto, no del codigo. El sheet sigue siendo plenamente funcional
 * — se trata solo de un detalle estetico en una plataforma especifica.
 *
 * @module @ritmiq/ui/components/BottomSheet/BottomSheetHost
 */
import { useBottomSheet } from '../../stores/bottom-sheet.js';
import { BottomSheet } from './BottomSheet.jsx';

export function BottomSheetHost() {
  const stack = useBottomSheet((s) => s.stack);
  const closeById = useBottomSheet((s) => s.closeById);

  if (stack.length === 0) return null;

  return (
    <>
      {stack.map((entry) => (
        <BottomSheet
          key={entry.id}
          title={entry.title}
          header={entry.header}
          dismissOnBackdrop={entry.dismissOnBackdrop}
          onClose={() => {
            // Cierre originado por interaccion con el sheet (backdrop, ESC,
            // swipe-down). Notificamos al consumidor PRIMERO (para que
            // pueda actualizar su state) y luego sacamos del stack.
            entry.onClose?.();
            closeById(entry.id);
          }}
        >
          {entry.content}
        </BottomSheet>
      ))}
    </>
  );
}
