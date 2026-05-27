import { useState } from 'react';
import { Modal } from '../Modal/Modal.jsx';
import { Button } from './Button.jsx';
import { Icon } from '../Icon/Icon.jsx';
import styles from './ConfirmDialog.module.css';

/**
 * Modal de confirmacion estilizado. Reemplaza el confirm() nativo del
 * navegador con un dialog que respeta la estetica de la PWA.
 *
 * Usa async/await: el onConfirm puede devolver una promesa y el boton
 * mostrara el spinner hasta que resuelva. Si onConfirm lanza, el dialog
 * se queda abierto y muestra el error.
 *
 * @param {{
 *   title: string,
 *   body?: React.ReactNode,
 *   confirmLabel?: string,
 *   cancelLabel?: string,
 *   variant?: 'danger' | 'primary',
 *   icon?: string,
 *   onConfirm: () => void | Promise<void>,
 *   onClose: () => void,
 * }} props
 */
export function ConfirmDialog({
  title,
  body,
  confirmLabel = 'Confirmar',
  cancelLabel = 'Cancelar',
  variant = 'primary',
  icon,
  onConfirm,
  onClose,
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const handleConfirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
      onClose();
    } catch (err) {
      setError(String(err?.message ?? err));
      setBusy(false);
    }
  };

  return (
    <Modal
      onClose={busy ? () => {} : onClose}
      title={title}
      size="sm"
      dismissOnBackdrop={!busy}
      dismissOnEscape={!busy}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button
            variant={variant}
            onClick={handleConfirm}
            loading={busy}
            loadingText="..."
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className={styles.body}>
        {icon && (
          <div
            className={[styles.iconWrap, variant === 'danger' && styles.iconWrapDanger]
              .filter(Boolean).join(' ')}
            aria-hidden="true"
          >
            <Icon name={icon} size={20} />
          </div>
        )}
        {typeof body === 'string' ? <p className={styles.text}>{body}</p> : body}
        {error && <p className={styles.error} role="alert">{error}</p>}
      </div>
    </Modal>
  );
}
