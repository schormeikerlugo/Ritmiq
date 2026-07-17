---
tipo: modulo
capa: servidor
plataforma: ambas
estado: estable
ultima-revision: 2026-07-17
archivo: packages/ui/src/lib/use-player.js
tags: [servidor, endpoints, tunnel, seleccion-host, multi-endpoint]
---

# Multi-endpoint y selección de host (Fase 2)

> Cómo el cliente descubre y elige entre los distintos hosts que pueden
> resolver/transmitir audio: LAN del desktop, túnel del desktop y **servidor
> 24/7**.

## Endpoints publicados

Cada host publica su URL en la tabla Supabase `tunnel_endpoints`:

- **desktop** → `kind='desktop'` (túnel Cloudflare del desktop).
- **servidor** → `kind='server'` (túnel del servidor 24/7, `apps/server/src/endpoint-registry.js`).

Migración `20260713000000_tunnel_endpoints_multi.sql` (aplicada a prod): columna
`kind`, PK `(user_id, kind)`. La PWA se suscribe a **ambas** filas
(`tunnel-registry.js`) y las guarda en localStorage por separado.

## Candidatos (cliente)

`use-player.js` `endpointCandidates()` construye hasta tres:

| kind | fuente (localStorage) | timeout |
|---|---|---|
| `lan` | `getLanBaseUrlSync()` (IP local del desktop) | 1200ms |
| `desktop` | `getTunnelUrlSync()` (túnel del desktop) | 2500ms |
| `server` | `getServerUrlSync()` (túnel del servidor 24/7) | 2500ms |

## Modos de conexión (`serverMode`)

`packages/ui/src/stores/settings.js`. UI en
`ConnectionSection.jsx` ("Servidor 24/7" / "Mi PC" / "Más rápido").

| Modo | Orden de prioridad |
|---|---|
| `auto` (default) | **servidor** → lan → desktop |
| `prefer-server` | alias de `auto` (compat) |
| `prefer-desktop` | lan → desktop → servidor |
| `fastest` | carrera de pings, gana el primero que responde `/health` |

> **Cambio Fase A1**: antes `auto` priorizaba el desktop; ahora prioriza el
> servidor 24/7 (host principal donde vive el caché optimizado).

## Resolución (`getReachableCached`)

`use-player.js`: `orderCandidates(cands, mode)` ordena y hace `pingLan(/health)`
secuencial (o carrera en `fastest`). El ganador queda en `lastActiveEndpoint` y
se cachea (`REACHABLE_TTL`).

## CloudflaredManager

`server-core/cloudflared.js` (`CloudflaredManager`): arranca el túnel con
`RITMIQ_TUNNEL_TOKEN` (Named) / `RITMIQ_TUNNEL_CUSTOM_URL`, o Quick Tunnel con
`RITMIQ_TUNNEL_MODE=quick`. El túnel `ritmiq.org` se movió del desktop al
servidor 24/7.

## Ver también

- [[Cache-y-Rendimiento]], [[Tunnel-Cloudflared]], [[tunnel-registry]], [[use-player]].
