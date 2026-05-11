/**
 * Bloquea pinch-zoom y double-tap zoom en iOS Safari (donde el viewport
 * `user-scalable=no` se ignora por accesibilidad). Llamar una vez al iniciar
 * la app.
 */
export function installZoomBlocker() {
  if (typeof window === 'undefined') return;

  const blockGesture = (e) => { e.preventDefault(); };
  document.addEventListener('gesturestart',  blockGesture, { passive: false });
  document.addEventListener('gesturechange', blockGesture, { passive: false });
  document.addEventListener('gestureend',    blockGesture, { passive: false });

  // Double-tap to zoom
  let lastTouchEnd = 0;
  document.addEventListener('touchend', (e) => {
    const now = Date.now();
    if (now - lastTouchEnd <= 300) e.preventDefault();
    lastTouchEnd = now;
  }, { passive: false });

  // Ctrl + wheel (desktop browsers / Electron)
  document.addEventListener('wheel', (e) => {
    if (e.ctrlKey) e.preventDefault();
  }, { passive: false });

  // Ctrl/Cmd + (=, -, 0, +) zoom shortcuts
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && ['=', '-', '0', '+'].includes(e.key)) {
      e.preventDefault();
    }
  });
}
