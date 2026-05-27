import { useState, useRef, useEffect } from 'react';
import { Modal } from '../Modal/Modal.jsx';
import { Button, TextField } from '../primitives/index.js';

/**
 * Dialog simple para renombrar (playlist, etc).
 *
 * @param {Object} props
 * @param {string} props.title
 * @param {string} props.initialValue
 * @param {(value: string) => void | Promise<void>} props.onSubmit
 * @param {() => void} props.onClose
 */
export function RenameDialog({ title, initialValue, onSubmit, onClose }) {
  const [value, setValue] = useState(initialValue);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    // Autofocus + select all en el primer render para edicion rapida
    inputRef.current?.focus();
    inputRef.current?.select?.();
  }, []);

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

  return (
    <Modal
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancelar
          </Button>
          <Button
            type="submit"
            form="rename-form"
            variant="primary"
            loading={busy}
            loadingText="Guardando..."
            disabled={!value.trim()}
          >
            Guardar
          </Button>
        </>
      }
    >
      <form id="rename-form" onSubmit={submit}>
        <TextField
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          disabled={busy}
          maxLength={80}
        />
      </form>
    </Modal>
  );
}
