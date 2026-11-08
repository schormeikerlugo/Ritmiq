/**
 * Capa de zonas de la app de TV (lib/tv-nav.js): al pulsar Atrás en una
 * página principal (o desde el menú/reproductor) se recuadra la zona elegida
 * y se oscurecen las demás (sin nombres: el recuadro basta); ← → ↓ ↑ eligen y OK entra (al último elemento
 * usado en esa zona). Solo dibuja: el manejo de teclas está en tv-nav.js.
 *
 * Solo opacidad, bordes y transform: barato en el onn.
 *
 * @module @ritmiq/ui/components/TvZoneLayer
 */
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { availableZones, zoneRect } from '../../lib/tv-nav.js';
import { toast } from '../../stores/toast.js';
import styles from './TvZoneLayer.module.css';

export function TvZoneLayer() {
  const [state, setState] = useState({ open: false, selected: null });
  const [rects, setRects] = useState({});

  useEffect(() => {
    const onLayer = (e) => {
      const d = e.detail ?? {};
      if (d.open) {
        // El menú se despliega al seleccionarlo: medir tras la transición.
        const measure = () => {
          const r = {};
          for (const z of availableZones()) r[z] = zoneRect(z);
          setRects(r);
        };
        measure();
        setTimeout(measure, 260);
      }
      setState({ open: !!d.open, selected: d.selected ?? null });
    };
    const onHint = () => toast.info('Pulsa Atrás para cambiar de zona (menú, contenido, reproductor)');
    const onSliderHint = () => toast.info('Pulsa OK para mover la barra; OK o Atrás para soltarla');
    window.addEventListener('ritmiq:tv-zone-layer', onLayer);
    window.addEventListener('ritmiq:tv-zone-hint', onHint);
    window.addEventListener('ritmiq:tv-slider-hint', onSliderHint);
    return () => {
      window.removeEventListener('ritmiq:tv-zone-layer', onLayer);
      window.removeEventListener('ritmiq:tv-zone-hint', onHint);
      window.removeEventListener('ritmiq:tv-slider-hint', onSliderHint);
    };
  }, []);

  if (!state.open) return null;
  return createPortal(
    <div className={styles.layer} aria-live="polite">
      {Object.entries(rects).map(([zone, r]) => r && (
        <div
          key={zone}
          className={styles.zone}
          data-selected={zone === state.selected || undefined}
          style={{ left: r.left, top: r.top, width: r.width, height: r.height }}
        />
      ))}
      <div className={styles.hint}>
        <span><kbd>←</kbd><kbd>→</kbd><kbd>↓</kbd> elegir zona</span>
        <span><kbd>OK</kbd> entrar</span>
        <span><kbd>Atrás</kbd> Inicio / salir</span>
      </div>
    </div>,
    document.body,
  );
}
