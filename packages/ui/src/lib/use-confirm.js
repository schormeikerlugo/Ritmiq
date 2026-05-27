import { useCallback, useState } from 'react';

/**
 * Hook que devuelve { confirm, dialogProps }. Uso:
 *
 *   const { confirm, dialogProps } = useConfirm();
 *
 *   const onDelete = async () => {
 *     const ok = await confirm({
 *       title: 'Eliminar registro',
 *       body: '¿Seguro?',
 *       variant: 'danger',
 *       icon: 'Trash2',
 *     });
 *     if (!ok) return;
 *     await doDelete();
 *   };
 *
 *   return (
 *     <>
 *       ...
 *       {dialogProps && <ConfirmDialog {...dialogProps} />}
 *     </>
 *   );
 *
 * Permite reemplazar `confirm()` nativo con una API promise-based
 * sin crear N estados booleanos por componente.
 */
export function useConfirm() {
  const [state, setState] = useState(/** @type {null | { resolve: (b: boolean) => void, opts: object }} */(null));

  const confirm = useCallback((opts) => {
    return new Promise((resolve) => setState({ resolve, opts }));
  }, []);

  /**
   * Resuelve la promesa con el valor `result` y desmonta el dialog.
   * Se llama desde onConfirm (true) o desde onClose (false).
   */
  const finish = (result) => {
    if (!state) return;
    state.resolve(result);
    setState(null);
  };

  const dialogProps = state
    ? {
        ...state.opts,
        // ConfirmDialog hace: await onConfirm(); luego onClose().
        // Como aqui resolvemos true en onConfirm y desmontamos, el
        // onClose posterior es ignorado (state ya es null).
        onConfirm: () => finish(true),
        onClose: () => finish(false),
      }
    : null;

  return { confirm, dialogProps };
}
