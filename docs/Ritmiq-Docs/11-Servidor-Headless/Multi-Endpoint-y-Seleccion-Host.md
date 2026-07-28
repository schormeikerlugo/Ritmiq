---
tipo: modulo
capa: servidor
plataforma: ambas
estado: estable
ultima-revision: 2026-07-28
archivo: packages/ui/src/lib/use-player.js
tags: [servidor, endpoints, tunnel, seleccion-host, multi-endpoint]
---

# Multi-endpoint y selección de host (Fase 2 + servidor central)

> Cómo el cliente descubre y elige entre los distintos hosts que pueden
> resolver/transmitir audio: LAN del desktop, túnel del desktop y **servidor
> 24/7** (host primario por defecto).

## Descubrimiento del servidor (2 vías)

1. **`VITE_SERVER_URL`** (build-time, recomendado): TODO cliente apunta al
   servidor central por defecto sin config manual. `getServerUrlSync()`
   (`lan-client.js`) cae a `import.meta.env.VITE_SERVER_URL` si localStorage
   está vacío. En la PWA de **Vercel** hay que definir esta env var en
   *Settings → Environment Variables* (`VITE_SERVER_URL=https://ritmiq.org`) y
   redeployar; si no, la PWA no conoce el servidor y cae a Edge Functions.
2. **`tunnel_endpoints`** (Supabase, override dinámico): cada host publica su
   URL/token. `subscribeTunnelUrl` (PWA) y `subscribeServerEndpoint` (desktop)
   la escriben en localStorage, con prioridad sobre `VITE_SERVER_URL`.
   - **desktop** → `kind='desktop'`; **servidor** → `kind='server'`
     (`apps/server/src/endpoint-registry.js`, requiere `RITMIQ_OWNER_*`).
   - Migración `20260713000000_tunnel_endpoints_multi.sql`: columna `kind`, PK
     `(user_id, kind)`, RLS owner-only (cada usuario solo ve su fila).

## Candidatos (cliente)

`use-player.js` `endpointCandidates()` construye hasta tres:

| kind | fuente (localStorage / build) | timeout |
|---|---|---|
| `lan` | `getLanBaseUrlSync()` (IP local del desktop) | 1200ms |
| `desktop` | `getTunnelUrlSync()` (túnel del desktop) | 2500ms |
| `server` | `getServerUrlSync()` (localStorage → `VITE_SERVER_URL`) | 2500ms |

> **Descargas**: `getReachableLanBaseUrl()` (`lan-client.js`, usada por
> `downloadTrackToLocal`) también ordena los candidatos por `serverMode` e
> **incluye el servidor 24/7** (fix 2026-07). Antes solo probaba LAN/túnel del
> desktop → las descargas caían a Edge (que YouTube bloquea con 502
> "descargas desde la nube").

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
