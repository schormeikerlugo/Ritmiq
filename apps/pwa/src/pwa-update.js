/**
 * Registro del service worker + flujo de actualización de la PWA.
 *
 * Solo se ejecuta en el build de la PWA (este módulo importa el módulo
 * virtual `virtual:pwa-register`, que únicamente existe cuando el plugin
 * vite-plugin-pwa está activo). El build de Electron desktop no incluye
 * este archivo.
 *
 * Comportamiento:
 *   - Registra el SW (registerType 'prompt' en vite.config.js).
 *   - Cuando hay una versión nueva en espera (onNeedRefresh), avisa con un
 *     toast no intrusivo "Actualizar" — NO recarga solo para no cortar la
 *     reproducción. El usuario decide.
 *   - Comprueba actualizaciones cada 24h y cada vez que la app vuelve a
 *     primer plano (visibilitychange), con un throttle de 24h.
 *   - Enlaza todo al store `pwa-update` de @ritmiq/ui para que la UI
 *     (AboutInfoView) muestre la versión y ofrezca "Buscar actualizaciones".
 *
 * IMPORTANTE: actualizar el SW NUNCA borra las descargas. Viven en
 * IndexedDB (`ritmiq-local`), que sobrevive a updates y reloads. Solo se
 * pierden al DESINSTALAR la PWA.
 */
import { registerSW } from 'virtual:pwa-register';
import { usePwaUpdateStore } from '@ritmiq/ui/stores/pwa-update.js';
import { toast } from '@ritmiq/ui/stores/toast.js';

const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 horas
const LAST_CHECK_KEY = 'ritmiq.pwa-last-update-check';

// Versión/fecha inyectadas por Vite `define` (ver vite.config.js).
const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0';
const BUILD_DATE = typeof __BUILD_DATE__ !== 'undefined' ? __BUILD_DATE__ : '';

function elapsedSinceLastCheck() {
  try {
    const raw = localStorage.getItem(LAST_CHECK_KEY);
    if (!raw) return Infinity;
    const last = Number(raw);
    return Number.isFinite(last) ? Date.now() - last : Infinity;
  } catch {
    return Infinity;
  }
}
function markChecked() {
  try { localStorage.setItem(LAST_CHECK_KEY, String(Date.now())); } catch { /* noop */ }
}

export function setupPwaUpdates() {
  const store = usePwaUpdateStore.getState();

  // updateSW(true) activa el SW en espera (skipWaiting) y recarga la página.
  // Las descargas en IndexedDB quedan intactas tras el reload.
  let updateSW = () => {};
  let swRegistration = null;

  updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      // Hay una versión nueva lista. Avisamos sin recargar.
      usePwaUpdateStore.getState().setNeedRefresh(true);
      toast.info('Nueva versión disponible', {
        icon: 'ArrowDownToLine',
        duration: 0, // persistente hasta que el usuario actúe
        action: {
          label: 'Actualizar',
          onClick: () => usePwaUpdateStore.getState().applyUpdate(),
        },
      });
    },
    onRegisteredSW(_swUrl, registration) {
      swRegistration = registration ?? null;
      if (!registration) return;

      // Auto-check periódico cada 24h.
      setInterval(() => {
        registration.update().catch(() => {});
        markChecked();
      }, CHECK_INTERVAL_MS);

      // Check al volver a primer plano, con throttle de 24h para no
      // martillar el servidor cada vez que el usuario cambia de app.
      const onVisible = () => {
        if (document.visibilityState !== 'visible') return;
        if (elapsedSinceLastCheck() < CHECK_INTERVAL_MS) return;
        registration.update().catch(() => {});
        markChecked();
      };
      document.addEventListener('visibilitychange', onVisible);

      // Primer check al arrancar (respeta el throttle de 24h).
      if (elapsedSinceLastCheck() >= CHECK_INTERVAL_MS) {
        registration.update().catch(() => {});
        markChecked();
      }
    },
  });

  // Enlaza el updater real al store desacoplado de @ritmiq/ui.
  store.bindUpdater({
    version: APP_VERSION,
    buildDate: BUILD_DATE,
    update: (reload = true) => updateSW(reload),
    // Comprobación manual (botón "Buscar actualizaciones" en Ajustes).
    // Resuelve true si tras forzar update() el SW quedó en needRefresh.
    check: async () => {
      if (!swRegistration) return false;
      try {
        await swRegistration.update();
        markChecked();
      } catch {
        return false;
      }
      // Pequeña espera para que onNeedRefresh tenga oportunidad de dispararse.
      await new Promise((r) => setTimeout(r, 600));
      return usePwaUpdateStore.getState().needRefresh;
    },
  });
}
