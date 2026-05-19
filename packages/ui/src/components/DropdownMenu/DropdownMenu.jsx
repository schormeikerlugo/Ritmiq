import { useEffect, useRef, useState } from 'react';
import { isDesktop } from '../../lib/api.js';
import { useBottomSheet } from '../../stores/bottom-sheet.js';
import styles from './DropdownMenu.module.css';

/**
 * Detecta si estamos en viewport mobile. Memoizado por render para no
 * volver a leer matchMedia en cada item — solo en el render del menu.
 */
function useIsMobileViewport() {
  const [mobile, setMobile] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia('(max-width: 768px)').matches;
  });
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(max-width: 768px)');
    const onChange = () => setMobile(mq.matches);
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, []);
  return mobile;
}

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
  const isMobile = useIsMobileViewport();
  // PWA mobile usa BottomSheet iOS-style; desktop usa dropdown clasico.
  // Tambien forzamos dropdown en Electron desktop sin importar viewport.
  const useSheet = isMobile && !isDesktop;

  const openSheet = useBottomSheet((s) => s.open);
  const closeSheetById = useBottomSheet((s) => s.closeById);
  const sheetIdRef = useRef(null);

  useEffect(() => {
    if (!open || useSheet) return;
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
  }, [open, useSheet]);

  const handleItemClick = (it) => {
    // Solo cambia el state local. El cleanup del effect de abajo se
    // encargara de sacar el sheet del store.
    setOpen(false);
    it.onClick?.();
  };

  // PWA mobile: abrir el menu = push al store global de BottomSheet.
  // El render real lo hace <BottomSheetHost /> en App.jsx.
  useEffect(() => {
    if (!open || !useSheet) return;
    const id = openSheet({
      title: label ?? 'Opciones',
      content: (
        <ul className={styles.sheetList} role="menu">
          {items.map((it, i) => {
            if (it.separator) {
              return <li key={`sep-${i}`} className={styles.sheetSep} role="separator" />;
            }
            return (
              <li key={it.id ?? `${i}-${it.label}`} role="none">
                <button
                  type="button"
                  role="menuitem"
                  className={styles.sheetItem}
                  data-danger={it.danger}
                  disabled={it.disabled}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleItemClick(it);
                  }}
                >
                  {it.icon && <span className={styles.sheetIcon}>{it.icon}</span>}
                  <span className={styles.sheetLabel}>{it.label}</span>
                </button>
              </li>
            );
          })}
        </ul>
      ),
      onClose: () => setOpen(false),
    });
    sheetIdRef.current = id;
    return () => {
      // Idempotente — si el host ya saco el sheet, closeById es no-op.
      if (sheetIdRef.current != null) {
        closeSheetById(sheetIdRef.current);
        sheetIdRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, useSheet]);

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

      {/* Desktop / wide viewport: dropdown clasico inline */}
      {open && !useSheet && (
        <ul className={styles.menu} data-align={align} role="menu" style={{ animation: 'ritmiq-fade-in-up var(--dur-fast) var(--ease-standard)' }}>
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
                    handleItemClick(it);
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
