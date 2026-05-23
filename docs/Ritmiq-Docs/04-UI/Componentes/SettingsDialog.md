---
tipo: componente
capa: ui
plataforma: ambas
estado: estable
ultima-revision: 2026-05-22
archivo: packages/ui/src/components/SettingsDialog/SettingsDialog.jsx
tags: [componente, settings, secciones, conexion, dispositivos, tunnel]
---

# `SettingsDialog`

> **El modal raíz fue eliminado** en el refactor a [[SettingsView]] (Spotify-style). Este archivo se mantiene porque exporta funciones de sección que [[SettingsView]] consume.

## Ubicación
`packages/ui/src/components/SettingsDialog/SettingsDialog.jsx:1` (1597 líneas)

## Lo que exporta (funciones de sección)

| Export | Usado en |
|---|---|
| `PwaPairingSection` | [[SettingsView]] `ConnectionSection` |
| `PwaLanSection` | [[SettingsView]] `ConnectionSection` |
| `PwaRemoteSection` | [[SettingsView]] `ConnectionSection` |
| `PwaDiagnosticsSection` | [[SettingsView]] `ConnectionSection` |
| `DevicesSection` | [[SettingsView]] `ConnectionSection` (Desktop) |
| `SharedCacheSection` | [[SettingsView]] `StorageSection` |
| `YtDlpSection` | [[SettingsView]] `StorageSection` (Desktop) |
| `DesktopTunnelSection` | [[SettingsView]] `ConnectionSection` (Desktop) |
| `DesktopAccessTokenSection` | [[SettingsView]] `ConnectionSection` (Desktop) |

## Funcionalidades por sección

### `DevicesSection` (Desktop)
- Lista devices pareados (aprobados + revocados) via [[api]] `devicesList`.
- Lista pair_requests pendientes via `devicesPending`.
- Botones: Approve, Reject, Revoke, Forget, Rename.
- Escucha evento push `onPairRequest` → muestra nuevas solicitudes en vivo.

### `DesktopTunnelSection` (Desktop)
- Estado del tunnel Cloudflared (`tunnelStatus`).
- Input de token de Named Tunnel.
- Input de URL custom.
- Botones: Start Quick, Start Named, Stop.
- Estado en vivo via `tunnelOnState(cb)`.

### `PwaPairingSection` (PWA)
- Flujo de pareo con el Desktop via [[device]] helpers.
- Muestra PIN generado localmente.
- Polling `getPairStatusRemote` cada 2s hasta aprobación.

### `SharedCacheSection`
- Stats (`count`, `totalBytes`) del shared_audio via LAN server.
- Botón "Limpiar caché compartido".

## Migración futura
Las secciones pueden moverse a `SettingsView/sections/` cuando se rediseñen con `SettingRow`/`SettingsGroup`. Por ahora se renderizan dentro de un wrapper `.embed` que neutraliza estilos legacy.

## Notas / Changelog
- 2026-05-22: nivel pleno. El modal original ya no existe; solo viven las secciones.
