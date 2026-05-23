---
tipo: flujo
capa: flujo
plataforma: ambas
estado: estable
ultima-revision: 2026-05-22
tags: [flujo, lan, sincronizacion, modelo-y, pairing]
---

# Pareo y reproducción LAN (Modelo Y)

> Flujo de pareo de una PWA con un Desktop + reproducción posterior usando `device_token` (Modelo Y).

## Diagrama de pareo

```mermaid
sequenceDiagram
  participant PWA
  participant LAN as lan-server (Desktop)
  participant DV as devices.js
  participant DB as SQLite
  participant UI as Settings Desktop
  participant Owner as Usuario Desktop

  PWA->>PWA: generatePin(), getDeviceId()
  PWA->>LAN: POST /pair { device_id, display_name, pin, cookies? }
  LAN->>DV: createPairRequest(db, ...)
  alt device ya aprobado (idempotencia)
    DV->>DB: SELECT devices WHERE id AND approved
    DV-->>LAN: { status: 'approved', deviceToken }
    LAN-->>PWA: deviceToken (sin PIN visible)
  else nuevo / caducado
    DV->>DB: UPSERT pair_requests (TTL 10m)
    DV-->>LAN: { status: 'pending' }
    LAN->>UI: notifyOwnerNewPairRequest (push IPC)
    UI->>Owner: Notification + lista de pending
    LAN-->>PWA: { status: 'pending' }
  end

  loop polling cada 2-3s
    PWA->>LAN: GET /pair/status?device_id
    LAN->>DV: getPairStatus(db, id)
    DV-->>LAN: { status, deviceToken? }
    LAN-->>PWA: respuesta
  end

  Owner->>Owner: Comparar PIN visible con la PWA
  Owner->>UI: click "Aprobar"
  UI->>LAN: IPC devices:approve(id)
  LAN->>DV: approveDevice(db, ...)
  DV->>DB: tx[INSERT devices, DELETE pair_requests]
  DV-->>LAN: deviceToken (32 bytes random)

  PWA->>LAN: GET /pair/status (próximo tick)
  LAN-->>PWA: { status: 'approved', deviceToken }
  PWA->>PWA: setDeviceToken(token) → localStorage
```

## Diagrama de reproducción tras pareo

```mermaid
sequenceDiagram
  participant PWA
  participant LAN as lan-server
  participant Auth as findDeviceByToken
  participant DB as SQLite
  participant YT as yt-dlp

  PWA->>LAN: GET /stream/<id>?token=<device_token>&yt=<ytId>
  LAN->>Auth: token válido?
  Auth->>DB: SELECT devices WHERE token AND approved
  DB-->>Auth: DeviceRow
  Auth->>DB: UPDATE last_seen_at (best-effort)
  Auth-->>LAN: { device_id, cookies_blob? }
  LAN->>LAN: ytOptsFor(principal) — cookies del device si las subió
  LAN->>YT: getStreamUrl(ytId, ytOpts)
  YT-->>LAN: googlevideo URL
  LAN->>LAN: proxyAudio(req, res, upstream)
  LAN-->>PWA: audio stream con Range
```

## Decisiones documentadas

- **Modelo Y** ([[devices]]) — cada desktop autoriza por sí mismo, sin RLS Supabase.
- **`device_token` 32 bytes random** — Brute force inviable (2^256 espacio).
- **`?token=` en URL** — el `<audio>` HTML no acepta headers custom.
- **`cookies_blob` por device** — cifrado con safeStorage, cada PWA usa sus propias cookies de YouTube.
- **TTL 10 min** en `pair_requests` — PIN expira si el owner no aprueba a tiempo.
- **Auto-pair Supabase DESACTIVADO** (decisión 17/05) — compromiso de cuenta != compromiso de devices.

## Módulos involucrados

- PWA: [[device|ui/lib/device]], [[lan-client]], [[SettingsDialog]] (PwaPairingSection).
- Desktop: [[lan-server]], [[devices]], [[device-cookies]], [[ipc]] (handlers `devices:*`).
- DB: tabla `devices`, `pair_requests` ([[schema]]).

## Notas / Changelog
- 2026-05-22: F8.
