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
 *   - Comprueba actualizaciones en CADA arranque y cada vez que la app vuelve
 *     a primer plano (visibilitychange), sin throttle — así los usuarios
 *     reciben cambios casi al instante tras un deploy.
 *   - Cuando hay una versión nueva (onNeedRefresh), la AUTO-APLICA con recarga
 *     suave, SALVO que se esté reproduciendo audio (en ese caso avisa con un
 *     toast "Actualizar" para no cortar la música).
 *   - Enlaza todo al store `pwa-update` de @ritmiq/ui para que la UI
 *     (AboutInfoView) muestre la versión y ofrezca "Buscar actualizaciones".
 *
 * IMPORTANTE: actualizar el SW NUNCA borra las descargas. Viven en
 * IndexedDB (`ritmiq-local`), que sobrevive a updates y reloads. Solo se
 * pierden al DESINSTALAR la PWA.
 */
import { registerSW } from 'virtual:pwa-register';
import { usePwaUpdateStore } from '@ritmiq/ui/stores/pwa-update.js';
import { usePlayerStore } from '@ritmiq/ui/stores/player.js';
import { toast } from '@ritmiq/ui/stores/toast.js';

// Comprobación periódica cada 30 min (además del check en cada foco).
const CHECK_INTERVAL_MS = 30 * 60 * 1000;

// Versión/fecha inyectadas por Vite `define` (ver vite.config.js).
const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0';
const BUILD_DATE = typeof __BUILD_DATE__ !== 'undefined' ? __BUILD_DATE__ : '';

/** ¿Se está reproduciendo audio ahora? (para no cortar con una recarga). */
function isPlayingNow() {
  try { return !!usePlayerStore.getState().isPlaying; } catch { return false; }
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
      const store = usePwaUpdateStore.getState();
      store.setNeedRefresh(true);
      // Si NO se está reproduciendo, auto-aplicar el SW nuevo (recarga suave).
      // Así los usuarios reciben cambios sin tener que pulsar nada tras un
      // deploy. Si está sonando algo, no cortamos: avisamos con un toast.
      if (!isPlayingNow()) {
        toast.info('Actualizando a la última versión…', { icon: 'ArrowDownToLine', duration: 2500 });
        // Pequeño respiro para que el toast se pinte antes de recargar.
        // Usamos updateSW(true) directo (referencia local fiable, no depende
        // de que bindUpdater ya haya corrido).
        setTimeout(() => { try { updateSW(true); } catch { location.reload(); } }, 800);
        return;
      }
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

      // Auto-check periódico cada 30 min.
      setInterval(() => { registration.update().catch(() => {}); }, CHECK_INTERVAL_MS);

      // Check cada vez que la app vuelve a primer plano (sin throttle): es
      // barato (un HEAD al sw.js) y garantiza que el usuario recibe el deploy
      // reciente al reabrir la app.
      const onVisible = () => {
        if (document.visibilityState === 'visible') registration.update().catch(() => {});
      };
      document.addEventListener('visibilitychange', onVisible);

      // Check inmediato al arrancar.
      registration.update().catch(() => {});
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
