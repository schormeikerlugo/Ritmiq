/**
 * Código QR en SVG (qrcode-generator). Módulos oscuros sobre fondo blanco
 * con margen: es lo que escanean bien las cámaras desde lejos.
 *
 * @module @ritmiq/ui/components/Jam/QrCode
 */
import { useMemo } from 'react';
import qrcode from 'qrcode-generator';

/**
 * @param {{ value: string, size?: number, className?: string, title?: string }} props
 */
export function QrCode({ value, size = 160, className, title = 'Código QR' }) {
  const { path, count } = useMemo(() => {
    const qr = qrcode(0, 'M');
    qr.addData(value);
    qr.make();
    const n = qr.getModuleCount();
    let d = '';
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (qr.isDark(r, c)) d += `M${c + 2} ${r + 2}h1v1h-1z`;
      }
    }
    return { path: d, count: n };
  }, [value]);
  const box = count + 4; // 2 módulos de margen por lado
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox={`0 0 ${box} ${box}`}
      role="img"
      aria-label={title}
      shapeRendering="crispEdges"
    >
      <rect width={box} height={box} fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  );
}
