import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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
 * @param {string} [props.triggerClassName]         Clase extra para el botón trigger
 * @param {string} [props.wrapClassName]            Clase extra para el wrapper
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
export function DropdownMenu({ trigger, items, align = 'right', label, triggerClassName, wrapClassName }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const triggerRef = useRef(null);
  const menuRef = useRef(null);
  // Coords del menu cuando se renderiza via portal en desktop.
  // Se calculan desde getBoundingClientRect() del trigger porque el menu
  // se monta en document.body y usa position: fixed — necesita coords de viewport.
  const [coords, setCoords] = useState(null);
  const isMobile = useIsMobileViewport();
  // PWA mobile usa BottomSheet iOS-style; desktop usa dropdown clasico.
  // Tambien forzamos dropdown en Electron desktop sin importar viewport.
  const useSheet = isMobile && !isDesktop;

  const openSheet = useBottomSheet((s) => s.open);
  const closeSheetById = useBottomSheet((s) => s.closeById);
  const sheetIdRef = useRef(null);

  // Recalcula posicion del menu cuando se abre o cuando hay scroll/resize.
  //
  // Por que useLayoutEffect: corre antes de paint, asi evita un frame
  // donde el menu se ve en (0,0) o fuera de pantalla antes de saltar a
  // su posicion final.
  //
  // El menu se renderiza primero con visibility:hidden (coords.measured=false)
  // para poder medir su tamano real, despues calculamos flip/clamp y
  // re-renderizamos visible. Asi soportamos menus de cualquier altura
  // (no asumimos N items * Ypx) y cualquier ancho.
  //
  // Margen al borde del viewport: 8px en todos los lados. Por que: el menu
  // pegado al borde se ve apretado y en sistemas con scrollbar visible
  // (Linux/Windows) se puede solapar con ella.
  const VIEWPORT_MARGIN = 8;
  const TRIGGER_GAP = 4;
  useLayoutEffect(() => {
    if (!open || useSheet) return;
    const updatePosition = () => {
      const trig = triggerRef.current;
      if (!trig) return;
      const trigRect = trig.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;

      // Medimos el menu real si ya esta montado (segundo render en adelante);
      // si no esta montado todavia, asumimos un fallback razonable solo para
      // el primer paint hidden.
      const menuEl = menuRef.current;
      const menuW = menuEl?.offsetWidth ?? 240;
      const menuH = menuEl?.offsetHeight ?? 200;

      // ── Eje vertical: flip arriba si no cabe abajo ─────────────────
      const spaceBelow = vh - trigRect.bottom - VIEWPORT_MARGIN;
      const spaceAbove = trigRect.top - VIEWPORT_MARGIN;
      // Preferimos abajo. Volteamos solo si:
      // 1) abajo no cabe completo, Y
      // 2) arriba cabe mejor que abajo.
      const flipUp = menuH > spaceBelow && spaceAbove > spaceBelow;
      let top;
      if (flipUp) {
        // Pegado al top del trigger, con gap hacia abajo.
        top = trigRect.top - menuH - TRIGGER_GAP;
        // Si tampoco cabe arriba (menu enorme), pegado al margen y se
        // recortara con max-height (ver CSS). Nunca dejamos top < margen.
        if (top < VIEWPORT_MARGIN) top = VIEWPORT_MARGIN;
      } else {
        top = trigRect.bottom + TRIGGER_GAP;
        // Clamp si por extremo el menu se sale por abajo (caso raro: viewport
        // muy chico). Igual el max-height del CSS lo limita.
        if (top + menuH > vh - VIEWPORT_MARGIN) {
          top = Math.max(VIEWPORT_MARGIN, vh - VIEWPORT_MARGIN - menuH);
        }
      }

      // ── Eje horizontal: clamp dentro del viewport ──────────────────
      // Calculamos left "ideal" segun align, despues clampeamos a [margin, vw - menuW - margin].
      let left;
      if (align === 'right') {
        // Borde derecho del menu pegado al borde derecho del trigger.
        left = trigRect.right - menuW;
      } else {
        // Borde izquierdo del menu pegado al borde izquierdo del trigger.
        left = trigRect.left;
      }
      // Clamp horizontal: prioriza no salirse por la derecha; si el menu
      // es mas ancho que el viewport (extremo) lo pegamos al margen izq.
      if (left + menuW > vw - VIEWPORT_MARGIN) {
        left = vw - VIEWPORT_MARGIN - menuW;
      }
      if (left < VIEWPORT_MARGIN) {
        left = VIEWPORT_MARGIN;
      }

      setCoords({
        top,
        left,
        flipUp,
        // measured=true significa que ya tenemos dimensiones reales del DOM,
        // asi el menu se muestra. measured=false (primer render) = hidden.
        measured: !!menuEl,
      });
    };

    // Doble pasada: la primera con menuEl=null (estimacion), la segunda
    // tras el commit/paint cuando el menu existe en el DOM y podemos medirlo.
    // requestAnimationFrame asegura que React ya hizo flush del primer render.
    updatePosition();
    const raf = requestAnimationFrame(updatePosition);

    // Reposicionar en scroll (capture: cualquier scroll de cualquier ancestro)
    // y resize. No usamos animation frame loop — solo eventos pasivos.
    window.addEventListener('scroll', updatePosition, true);
    window.addEventListener('resize', updatePosition);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', updatePosition, true);
      window.removeEventListener('resize', updatePosition);
    };
  }, [open, useSheet, align]);

  useEffect(() => {
    if (!open || useSheet) return;
    const onDoc = (e) => {
      // Cerrar si el click es fuera del trigger Y fuera del menu (portal).
      const inTrigger = ref.current && ref.current.contains(e.target);
      const inMenu = menuRef.current && menuRef.current.contains(e.target);
      if (!inTrigger && !inMenu) setOpen(false);
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

  // Desktop dropdown via portal: escapa de cualquier ancestro con overflow,
  // contain, content-visibility o transform que clipearia el menu.
  // Por que portal + position fixed: el ancestro mas cercano `.row` usa
  // `content-visibility: auto` que aplica `contain: paint` implicito y
  // clipea cualquier descendiente al box del row (56px). El portal saca
  // el menu del subtree del row y lo monta en <body>.
  const menuNode = open && !useSheet && coords && (
    <ul
      ref={menuRef}
      className={styles.menu}
      data-align={align}
      data-flip={coords.flipUp ? 'up' : 'down'}
      role="menu"
      style={{
        position: 'fixed',
        top: coords.top,
        left: coords.left,
        // Primer render: hidden mientras medimos. Asi no hay flash en
        // posicion erronea. measured pasa a true en el segundo updatePosition().
        visibility: coords.measured ? 'visible' : 'hidden',
        // Anti-flash extra: el primer render queda fuera del flujo visible
        // del usuario; el segundo (medido) entra con la animacion.
        animation: coords.measured
          ? (coords.flipUp
              ? 'ritmiq-fade-in-down var(--dur-fast) var(--ease-standard)'
              : 'ritmiq-fade-in-up var(--dur-fast) var(--ease-standard)')
          : 'none',
      }}
    >
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
  );

  return (
    <div className={`${styles.wrap} ${wrapClassName ?? ''}`} ref={ref}>
      <button
        ref={triggerRef}
        type="button"
        className={`${styles.trigger} ${triggerClassName ?? ''}`}
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        aria-label={label ?? 'Más opciones'}
        aria-haspopup="menu"
        aria-expanded={open}
      >{trigger}</button>

      {menuNode && typeof document !== 'undefined'
        ? createPortal(menuNode, document.body)
        : null}
    </div>
  );
}
