---
tipo: paquete
capa: servidor
plataforma: ambas
estado: estable
ultima-revision: 2026-07-17
archivo: packages/server-core/src/index.js
tags: [servidor, server-core, host-aware, monorepo]
---

# `@ritmiq/server-core`

> Paquete que contiene **toda la lógica del LAN server** compartida entre el
> desktop (Electron) y el [[apps-server|servidor headless]]. Es *host-aware*:
> se configura con `setHost({...})` para funcionar tanto dentro de Electron
> (con `safeStorage`, binarios empaquetados) como en un entorno Node puro
> (Docker, systemd).

## Ubicación
`packages/server-core/src/`

## Motivación (Fase 1)

Antes, el LAN server, la DB, el manejo de cookies, etc. vivían en
`apps/desktop/main/`. Para reutilizarlos en un servidor sin Electron se
extrajeron a `@ritmiq/server-core`. El desktop ahora **consume** este paquete
sin regresión; el servidor headless lo consume igual con un host distinto.

## API de host (`host.js`)

```js
import { setHost, dataPath, dataSubdir } from '@ritmiq/server-core/host';

setHost({
  dataDir,          // carpeta writable (userData en desktop, RITMIQ_DATA_DIR en server)
  safeStorage,      // Electron safeStorage o null (fallback plaintext 0600)
  resourcesBinDir,  // binarios empaquetados (yt-dlp/cloudflared) o null
  devBinDir,        // binarios en dev o null
});
```

- **Desktop**: `setHost({ dataDir: app.getPath('userData'), safeStorage, ... })`.
- **Servidor**: `setHost({ dataDir: RITMIQ_DATA_DIR, safeStorage: null, ... })`.

De `dataDir` derivan la SQLite (`ritmiq.sqlite`) y los subdirectorios
(`shared-audio/`, `yt-dlp-cache/`, etc.).

## Módulos exportados

| Export | Archivo | Qué |
|---|---|---|
| `setHost`, `dataPath`, `dataSubdir` | `host.js` | configuración host-aware |
| `initDb` | `db.js` | abre/crea la SQLite + aplica schema |
| `startLanServer` | [[lan-server]] | servidor HTTP principal |
| `getOrCreateAccessToken`, `regenerateAccessToken` | `access-token.js` | token del dueño |
| `getYtDlpPath` | `ytdlp-path.js` | resolución del binario yt-dlp |
| `detectCookiesBrowser`, `exportCookiesToFile` | `cookies-detect.js` | cookies del owner |
| `createPairRequest`, `approveDevice`, `listDevices`, ... | `devices.js` | administración de dispositivos |
| `encryptCookies`, `getCookieFileForDevice` | `device-cookies.js` | cifrado de cookies por device |
| `createJwtVerifier` | `auth-jwt.js` | verificación de JWT Supabase |
| `CloudflaredManager` | `cloudflared.js` | túnel Cloudflare |
| `startLoginSession`, ... | `youtube-login.js` | login noVNC bajo demanda |

## Archivos clave (nuevos en esta capa)

- `auth-jwt.js` — ver [[Autenticacion-y-JWT]]. Verifica JWT sin dependencias
  externas (ES256 contra JWKS o HS256 legacy).
- `devices.js` — pareo, aprobación, listados por cuenta (`listDevicesForUser`,
  `getDeviceOwnerUserId`).
- `device-cookies.js` — AES-256-GCM / plaintext / safeStorage.
- `youtube-login.js` — orquestador del contenedor noVNC.

## Consumo desde desktop vs servidor

- **Desktop** (`apps/desktop/main/index.js`): `setHost(...)` + `startLanServer({ port: 3939, db, accessToken })`. Administración vía IPC (`devices:*`).
- **Servidor** (`apps/server/src/index.js`): `setHost(...)` + `startLanServer({ port, db, accessToken })` + túnel + publicación de endpoint. Administración vía CLI / panel `/admin` / desktop remoto.

## Ver también

- [[apps-server]] — el bootstrap headless que lo consume.
- [[lan-server]] — el servidor HTTP.
- [[Autenticacion-y-JWT]], [[Administracion-Dispositivos]], [[Cache-y-Rendimiento]].
