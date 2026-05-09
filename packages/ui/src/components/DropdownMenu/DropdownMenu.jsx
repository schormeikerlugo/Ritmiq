import { useEffect, useRef, useState } from 'react';
import styles from './DropdownMenu.module.css';

/**
 * Menú desplegable simple.
 *
 * @param {Object} props
 * @param {React.ReactNode} props.trigger          Elemento que abre el menú
 * @param {Array<DropdownItem>} props.items
 * @param {'left'|'right'} [props.align]
 * @param {string} [props.label]                    aria-label del trigger
 *
 * @typedef {Object} DropdownItem
 * @property {string} [id]
 * @property {string} label
 * @property {string} [icon]
 * @property {() => void} [onClick]
 * @property {boolean} [danger]
 * @property {boolean} [disabled]
 * @property {boolean} [separator]    Si true, renderiza un separador en lugar de item
 */
export function DropdownMenu({ trigger, items, align = 'right', label }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className={styles.wrap} ref={ref}>
      <button
        type="button"
        className={styles.trigger}
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        aria-label={label ?? 'Más opciones'}
        aria-haspopup="menu"
        aria-expanded={open}
      >{trigger}</button>
      {open && (
        <ul className={styles.menu} data-align={align} role="menu">
          {items.map((it, i) => {
            if (it.separator) {
              return <li key={`sep-${i}`} className={styles.sep} role="separator" />;
            }
            return (
              <li key={it.id ?? `${i}-${it.label}`} role="none">
                <button
                  type="button"
                  role="menuitem"
                  className={styles.item}
                  data-danger={it.danger}
                  disabled={it.disabled}
                  onClick={(e) => {
                    e.stopPropagation();
                    setOpen(false);
                    it.onClick?.();
                  }}
                >
                  {it.icon && <span className={styles.icon}>{it.icon}</span>}
                  <span>{it.label}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
