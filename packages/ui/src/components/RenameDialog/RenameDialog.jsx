import { createPortal } from 'react-dom';
import { useEffect, useState } from 'react';
import { useLockBodyScroll } from '../../lib/use-lock-body-scroll.js';
import styles from './RenameDialog.module.css';

/**
 * @param {Object} props
 * @param {string} props.title
 * @param {string} props.initialValue
 * @param {(value: string) => void | Promise<void>} props.onSubmit
 * @param {() => void} props.onClose
 */
export function RenameDialog({ title, initialValue, onSubmit, onClose }) {
  useLockBodyScroll(true);
  const [value, setValue] = useState(initialValue);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const submit = async (e) => {
    e.preventDefault();
    const v = value.trim();
    if (!v || v === initialValue) { onClose(); return; }
    setBusy(true);
    try {
      await onSubmit(v);
      onClose();
    } finally { setBusy(false); }
  };

  return createPortal((
    <div className={styles.backdrop} onClick={onClose}>
      <form className={styles.dialog} onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h2 className={styles.title}>{title}</h2>
        <input
          className={styles.input}
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          autoFocus
          disabled={busy}
          maxLength={80}
        />
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.btnSecondary}
            onClick={onClose}
            disabled={busy}
          >Cancelar</button>
          <button
            type="submit"
            className={styles.btnPrimary}
            disabled={busy || !value.trim()}
          >Guardar</button>
        </div>
      </form>
    </div>
  ), document.body);
}
