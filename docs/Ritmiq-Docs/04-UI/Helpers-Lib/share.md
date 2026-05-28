---
tipo: modulo
capa: ui
plataforma: ambas
estado: estable
ultima-revision: 2026-05-27
archivo: packages/ui/src/lib/share.js
tags: [helper, share, link, pwa, ios, clipboard]
---

# `lib/share.js`

> Helpers para compartir tracks por link público (base64url + ytId), detección de entorno (standalone PWA, plataforma), manejo de cookie de instalación, y copia al portapapeles.

## Ubicación
`packages/ui/src/lib/share.js:1` (282 líneas)

## Exports

| Función | Descripción |
|---|---|
| `buildShareLink(track)` | Construye URL pública `origin/share/track/<ytId>?meta=<b64>` |
| `parseShareFromUrl()` | Parsea la URL actual buscando un share (nuevo o legacy) |
| `clearShareFromUrl()` | Limpia el share de la URL sin recargar |
| `isStandalonePWA()` | Detecta si corre como PWA instalada (no en pestaña) |
| `markPwaInstalled()` | Setea `localStorage.ritmiq.pwa-installed = '1'` |
| `hasPwaInstalledFlag()` | Lee el flag anterior |
| `pingMarkInstalled({force?})` | **(T5)** POST a [[API-mark-installed|/api/mark-installed]] con throttle 24h. Refresca la cookie cross-context |
| `hasPwaInstalledCookie()` | Lee cookie `ritmiq_installed=1` (cross-context iOS) |
| `detectPlatform()` | `'ios'` \| `'android'` \| `'desktop'` |
| `copyToClipboard(text)` | Clipboard API con fallback execCommand |

## Formato del link público

```
https://ritmiq.app/share/track/<ytId>?meta=<base64url>

base64url = JSON({ t: title, a: artist, c: coverUrl })
```

El payload en la URL permite que la landing pública muestre metadata **sin llamar al servidor** (SEO + UX). Si falta o está corrupto, la landing usa solo el `ytId` para reproducir desde YouTube.

## Anatomía del código (snippets clave)

### 1. `buildShareLink`: origin desde `window.location`
`packages/ui/src/lib/share.js:48-67`

```js
export function buildShareLink(track) {
  if (!track?.ytId) return '';  // sin ytId no es compartible
  const payload = { t: track.title ?? null, a: track.artist ?? null, c: track.coverUrl ?? null };
  const encoded = b64urlEncode(JSON.stringify(payload));
  let origin = 'https://ritmiq.app';
  if (typeof window !== 'undefined' && window.location?.origin) {
    const o = window.location.origin;
    if (o.startsWith('http')) origin = o;  // usa el origin real si hay uno HTTP
  }
  return `${origin}/share/track/${encodeURIComponent(track.ytId)}?meta=${encoded}`;
}
```

**Por qué usar `window.location.origin`**: en dev la app corre en `http://localhost:5175`. Los links compartidos en dev apuntan a localhost (solo útil para testing). En prod corre en `https://ritmiq.app` → los links son públicamente accesibles.

**Por qué solo compartir tracks con `ytId`**: tracks `source: 'local'` (archivos del usuario) no tienen una URL pública en YouTube → no hay forma de reproducirlos para alguien que recibe el link.

### 2. Backwards compat: formato legacy `?share=track:<ytId>:<b64>`
`packages/ui/src/lib/share.js:102-119`

```js
// Formato legacy: ?share=track:<ytId>:<payload>
const raw = params.get('share');
if (!raw) return null;
const [kind, ytIdRaw, encoded] = raw.split(':');
if (kind !== 'track' || !ytIdRaw) return null;
```

**Por qué mantener el formato viejo**: los links ya compartidos (en WhatsApp, Twitter, emails) con el formato antiguo deben seguir funcionando. El nuevo formato path-based es más limpio y mejor para SEO, pero el legacy se parseará indefinidamente.

### 3. Cookie vs localStorage para instalación iOS
`packages/ui/src/lib/share.js:176-194`

```js
// hasPwaInstalledFlag: localStorage — solo en la propia PWA
// hasPwaInstalledCookie: cookie — compartida entre Safari y la PWA en iOS
```

**El problema iOS**: Safari y la PWA standalone tienen `localStorage` segregado. Si la PWA guarda `ritmiq.pwa-installed=1`, Safari no lo ve (y viceversa). Las cookies del mismo origen SÍ se comparten entre contextos en iOS.

**Por qué la cookie no es HttpOnly**: necesitamos leerla desde JS del cliente (`document.cookie`) para que Safari pueda mostrar el banner correcto ("Abrir en Ritmiq" si está instalada, "Instala Ritmiq" si no).

### 4. `detectPlatform()`: iPadOS 13+ como Mac
`packages/ui/src/lib/share.js:205-210`

```js
const isIOS = /iPad|iPhone|iPod/.test(ua) ||
  (ua.includes('Macintosh') && 'ontouchend' in document);
```

**Por qué `Macintosh && ontouchend`**: iPadOS 13+ reporta su UA como `Macintosh` (igual que Mac), no como `iPad`. La combinación `Macintosh + touchend` distingue un iPad de un Mac real.

## Casos de borde

- **Track sin `coverUrl`**: el campo `c` del payload es null → la landing pública muestra un placeholder de imagen.
- **`copyToClipboard` sin Clipboard API**: fallback a `textarea + execCommand('copy')`. En algunos contextos (iframes de 3rd party, Firefox) también puede fallar → devuelve `false`.
- **`clearShareFromUrl` en `/share/track/...`**: hace `history.replaceState` a `/` para que el usuario vea la home y no la URL de share.

## Qué puede romper este cambio

| Cambio | Síntoma |
|---|---|
| Quitar backwards compat del formato legacy | Links viejos compartidos dejan de funcionar (404 o share no parseado). |
| `hasPwaInstalledCookie` que sea HttpOnly | JS no puede leer la cookie → Safari siempre muestra "Instala Ritmiq" aunque esté instalada. |
| `detectPlatform` sin el check `ontouchend` | iPadOS 13+ detectado como `'desktop'` → instrucciones incorrectas de instalación ("click los 3 puntos" en lugar de "botón compartir"). |

## Notas / Changelog
- 2026-05-22: nivel pleno.
- 2026-05-27 (Fase 0.1 + 0.2): añadido `pingMarkInstalled({force?})` con throttle 24h vía `localStorage.ritmiq.pwa-installed-pinged-at`. Llamado en boot standalone con `force:true` (commit `697ab4f`) y en cada `visibilitychange` en standalone (commit `e6f0bff`). Ver [[API-mark-installed]] y [[Decisiones-Tecnicas-ADR|ADR-N/A: T4/T5 share roadmap]].
