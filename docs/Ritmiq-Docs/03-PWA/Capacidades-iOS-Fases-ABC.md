---
tipo: modulo
capa: pwa
plataforma: pwa
estado: estable
ultima-revision: 2026-09-02
archivo: apps/pwa/vite.config.js, packages/ui/src/App.jsx, supabase/functions/send-push-notification
tags: [pwa, ios, manifest, shortcuts, share-target, web-push, declarative, gesto, edge-swipe]
---

# Capacidades iOS — Fases A / B / C + gesto de "volver"

> Aprovechamiento de capacidades de iOS Safari (18.4 / 26) y Android para acercar la PWA a una app nativa: instalación enriquecida, onboarding iOS 26, notificaciones declarativas y gesto de deslizar-para-volver. Investigación basada en las notas de WebKit (Safari 18.4, 26.0, 26.6) y la doc de Declarative Web Push.

## Contexto y realidad (sin humo)

- La PWA **ya** usaba un stack moderno: MediaSession completo, Wake Lock, Web Push + VAPID, App Badging, Web Audio (visualizer/EQ), `storage.persist()`, Web Share saliente, splash iOS, `audioSession` hint.
- **Background Fetch / Background Sync / Periodic Sync NO existen en iOS** (ni en iOS 26). → La descarga con la app cerrada **sigue sin ser posible** en iOS. No se implementó nada que lo prometa.
- iOS 26 congela el número de OS en la UA (`iPhone OS 18_6`) y sólo actualiza `Version/26.0`.

---

## Fase A — Manifest enrichment (`6452c9a`)

Archivo: `apps/pwa/vite.config.js` (bloque `manifest`).

| Campo | Qué aporta |
|---|---|
| `shortcuts` (4) | Al mantener pulsado el icono (iOS 26 / Android): **Buscar, Favoritas, Amigos, Descargas**. Cada uno abre `/?go=<vista>`. |
| `share_target` (GET) | Ritmiq aparece en la hoja **Compartir** del sistema. Al compartirle una URL/texto (p.ej. enlace de YouTube) abre `/?source=share_target&shared_url=…`. |
| `launch_handler` | `navigate-existing`: reabrir reusa la ventana abierta (no corta reproducción ni duplica instancias). |
| `display_override` | `[standalone, minimal-ui]`. |
| `categories` | `[music, entertainment]`. |
| `screenshots` (2) | 1080×1920 branded, `form_factor: narrow` → ficha de instalación. Generadas en `apps/pwa/public/screenshots/`. |

**Enrutado de la intención** — `packages/ui/src/App.jsx`:
- `detectLaunchIntent()` (nivel módulo): lee `?go=`, `?openTab=`, `?shared_url/text/title`, limpia esos params con `history.replaceState` y guarda `initialLaunchIntent`.
- Un `useEffect` que corre **una vez al haber usuario** ejecuta la intención: `goSearchView`/`goFriends`/`goDownloads`/`goPlaylist(favoritesId)` o `goSearch(query)` para lo compartido.

---

## Fase B — Onboarding iOS 26 + splash (`d119dc3`)

- **Detección de versión** — `packages/ui/src/lib/share.js`: `getIOSMajorVersion()` (lee `Version/NN`, fallback `OS X_Y`) e `isIOS26OrNewer()`.
- **`IOSInstallHint`**: en iOS 26+ el copy del paso 2 menciona el interruptor **"Abrir como web app"** del diálogo de Añadir; en iOS ≤18 mantiene el flujo clásico.
- **Splash de modelos nuevos** — `scripts/generate-splash.sh` + `apps/pwa/index.html`: añadidos **iPhone 16 Pro** (402×874@3x → 1206×2622) y **16 Pro Max** (440×956@3x → 1320×2868) con sus media queries y en `includeAssets`.
- **Status bar** (revisado, sin cambios): `apple-mobile-web-app-status-bar-style=black-translucent` + `viewport-fit=cover` es lo correcto para una app oscura edge-to-edge que respeta `--safe-top`.
- La app es **portrait-locked** (`orientation:portrait`), por eso **no** hay splash landscape (iOS no los mostraría).

---

## Fase C — Declarative Web Push (`016ddfd`)

Formato **declarativo estándar** ([Declarative Web Push](https://webkit.org/blog/16535/meet-declarative-web-push/), iOS 18.4+/macOS 15.5+): la notificación se muestra **sin Service Worker** → más fiable (sobrevive a que ITP borre el SW) y con menos batería. **Retrocompatible**: navegadores viejos/Android siguen usando el SW.

**Edge `send-push-notification`** (`supabase/functions/send-push-notification/index.ts`):
```jsonc
{
  "web_push": 8030,
  "notification": {
    "title": "...", "body": "...", "lang": "es", "dir": "ltr",
    "navigate": "https://ritmiq.app/?openTab=activity",  // URL absoluta destino (obligatoria)
    "silent": false, "app_badge": "2"
  },
  // Campos planos CONSERVADOS para el SW imperativo (retrocompat):
  "title": "...", "body": "...", "data": { "type": "playlist_pulled", ... }
}
```
- `buildNavigateUrl(data)`: URL por tipo (`share`→inbox, `friend_*`/`jam_*`→requests, `notification`/`playlist_pulled`→activity). Origen configurable con `RITMIQ_APP_ORIGIN` (fallback `https://ritmiq.app`).

**SW `apps/pwa/public/sw-push.js`**:
- `push`: lee `notification.{title,body,navigate,app_badge}` con fallback a los campos planos; normaliza `data.navigate`.
- `notificationclick`: respeta `data.navigate` si viene; añade ruta `activity` para `notification`/`playlist_pulled`.

**Deep-links de notificación** (antes **nadie** procesaba `?openTab=` → sólo abría home):
- `view store` (`packages/ui/src/stores/view.js`): `friendsTab` + `goFriends(tab)`; `FriendsView` abre en esa pestaña y la limpia.
- `App.jsx`: `?openTab=inbox|requests|activity` al arrancar → `goFriends(tab)`. Con la app abierta, escucha el `postMessage('push-click')` del SW y navega en vivo.

---

## Gesto "deslizar desde el borde para volver" (`e698f0f`)

Archivo: `packages/ui/src/lib/use-edge-swipe-back.js` + wiring en `App.jsx`.

Replica el back nativo de iOS/Android en la PWA standalone (donde no hay back del navegador).

- **Sólo táctil**; arranca sólo en una franja de **24px** del borde izquierdo (ahí no hay carruseles ni drag horizontal → no colisiona con el scroll-x de Home ni con dnd-kit de reordenar).
- Confirma "atrás" sólo si el gesto es horizontal-derecha (`dx > dy*1.4`) y supera `max(70px, 32% del ancho)`; si es vertical, es scroll normal y aborta. `preventDefault` del scroll **sólo tras confirmar**.
- **Feedback visual**: el `<main>` se desplaza con el dedo (`translateX` + fade) y se revierte/completa al soltar. El ref va en `<main>` (no en el shell) para no afectar hijos `position:fixed` (player/bottom-nav).
- **Acción jerárquica** (`edgeBackAction` en App.jsx): cierra el overlay más externo (NowPlaying → jam modal → cola → sidebar) y, si no hay, `goBack()` en el historial de vistas. `canGoBack` evita armar el gesto cuando no hay a dónde volver.

---

## Verificación

- Manifest generado con los 4 shortcuts, share_target GET, launch_handler, categories y 2 screenshots (assets copiados a `dist/`).
- Payload declarativo validado (checks: `web_push:8030`, `navigate` correcta, `app_badge`, retrocompat de campos planos). `notify-playlist-pulled` → push no rompe la cadena. Edge desplegada.
- Builds PWA + desktop verdes en cada fase. En desktop el gesto es no-op (check táctil).

## Enlaces
- [[manifest-y-service-worker]], [[sw-push]], [[apple-touch-startup]], [[IOSInstallHint]]
- ADR-037 en [[Decisiones-Tecnicas-ADR]].
