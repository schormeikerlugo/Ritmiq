---
tipo: modulo
capa: servidor
plataforma: ambas
estado: estable
ultima-revision: 2026-07-17
archivo: packages/server-core/src/devices.js
tags: [servidor, dispositivos, pareo, admin, allowlist, cookies]
---

# Administración de dispositivos (Fases 3c + 4)

> Modelo de acceso multi-cuenta: pareo con PIN, allowlist opcional, panel web
> `/admin`, administración desde la app desktop y **dos niveles** (dueño +
> sub-admin por cuenta). Incluye aportar cookies del desktop a un dispositivo.

## Conceptos

- **Pareo**: un dispositivo (PWA) genera un PIN y hace `POST /pair`. Queda
  `pending` hasta que se aprueba, o se **auto-aprueba** si su cuenta está en la
  allowlist. Al aprobar se emite un `device_token` (no caduca).
- **Owner (dueño)**: quien tiene el access-token del servidor. Gestiona **todos**
  los dispositivos.
- **Sub-admin (por cuenta)**: un usuario autenticado (JWT) gestiona **solo** sus
  dispositivos (mismo `supabase_user_id`). No ve ni toca los de otras cuentas (403).

## Allowlist (cuentas aprobadas)

Un dispositivo cuya cuenta esté aprobada se **auto-aprueba sin PIN** al parear
(auto-pareo silencioso). El `user_id` se toma del JWT verificado
([[Autenticacion-y-JWT]]). Dos fuentes de aprobación (unión):

1. **`RITMIQ_ALLOWED_USERS`** (env): lista de `user_id` separada por comas. Fija.
2. **Tabla `allowed_accounts`** (2026-07): gestionable **en caliente** desde el
   panel `/admin` sin reiniciar. `isAccountAllowed(db, userId)` la consulta.

### Auto-pareo silencioso (cliente)

`packages/ui/src/lib/device.js` `ensureServerPairing()`: al reproducir del
servidor sin `device_token`, el cliente hace `POST /pair` con su JWT de sesión.
Si la cuenta está aprobada → recibe un **device_token permanente** (no caduca,
resuelve la expiración del JWT). Si no → `pending` y se registra en
`access_requests`.

### Solicitudes de acceso (`access_requests`)

Cuando una cuenta **no aprobada** intenta parear, se registra (`user_id`,
`email`, `display_name`, `attempts`). Aparece en el panel `/admin` bajo "Cuentas
por aprobar" para aprobar con un clic. Al aprobar, se auto-aprueban sus
`pair_requests` pendientes.

### Panel `/admin` — cuentas

`GET /admin/api/state` incluye `accounts` (aprobadas) y `accessRequests`
(pendientes). Acciones owner: `POST /admin/api/accounts/allow` y
`/admin/api/accounts/revoke`.

## `devices.js` — funciones

Archivo: `packages/server-core/src/devices.js`.

| Función | Qué |
|---|---|
| `createPairRequest({ ..., allowedUsers })` | crea solicitud; auto-aprueba si está en allowlist |
| `approveDevice`, `rejectPairRequest`, `revokeDevice` | transición de estado |
| `renameDevice`, `forgetDevice` | mantenimiento |
| `listDevices`, `listPairRequests` | listados globales (owner) |
| `listDevicesForUser`, `listPairRequestsForUser` | listados por cuenta (sub-admin) |
| `getDeviceOwnerUserId` | resuelve el dueño de un device (guard de pertenencia) |
| `updateDeviceCookies`, `clearDeviceCookies` | cookies por device |

## Vías de administración

### 1. Panel web `/admin` (owner-only)

- `GET /admin` → página HTML autocontenida. El dueño pega su access-token.
- API: `GET /admin/api/state`, `POST /admin/api/{approve,reject,revoke}`.
- Muestra pendientes (con PIN) y dispositivos; marca los que tienen YouTube propio.
- URL: `https://<servidor>/admin` (p.ej. `ritmiq.org/admin`).

### 2. App desktop (`DevicesSection`)

`packages/ui/src/components/SettingsDialog/SettingsDialog.jsx` +
`packages/ui/src/lib/remote-admin.js`.

- **Modo host local**: administra la DB local vía IPC (`devices:*`).
- **Modo remoto**: si hay servidor 24/7 configurado, administra vía HTTP
  (`/devices/mine`, `/devices/{approve,reject,revoke,rename,cookies}`) con el
  server-token (owner) o el JWT de la sesión (sub-admin).
- Botón **"Aprobar + mis cookies"**: aporta las cookies de YouTube del navegador
  del desktop al dispositivo (ver abajo).

### 3. CLI `ritmiq-admin`

`ritmiq-admin pending|approve|reject|devices|revoke|token` (ver [[apps-server]]).

## Endpoints `/devices/*` (auth por cuenta)

`authorizeAdmin` resuelve owner / device_token / JWT. Guard de pertenencia:
un sub-admin solo opera sobre devices con su `supabase_user_id` (si no → 403).

```
GET  /devices/mine                    → { owner, userId, devices[], pending[] }
POST /devices/approve   { device_id }
POST /devices/reject    { device_id }
POST /devices/revoke    { device_id }
POST /devices/rename    { device_id, name }
POST /devices/cookies   { device_id, cookies_b64 }   → aportar cookies
```

## Cookies vía desktop (Fase 4c)

- IPC `owner:exportCookies` exporta las cookies del navegador del desktop a
  Netscape → base64 (`exportCookiesToFile` de `cookies-detect.js`).
- La UI las sube con `POST /devices/:id/cookies`, que cifra (`encryptCookies`) y
  llama `updateDeviceCookies` + `invalidateDeviceCookies`.
- Alternativas de cookies por usuario: subida manual de `cookies.txt`
  (`/cookies/upload`) o login noVNC ([[Login-noVNC]]).

## Tests

`packages/server-core/src/devices-admin.test.js` — filtrado por cuenta,
verificación de pertenencia (un usuario no coincide con device de otra cuenta).

## Ver también

- [[Autenticacion-y-JWT]], [[Login-noVNC]], [[device-cookies]], [[devices]].
