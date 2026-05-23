---
tipo: flujo
capa: flujo
plataforma: ambas
estado: estable
ultima-revision: 2026-05-22
tags: [flujo, tunnel, cloudflare, registry, realtime]
---

# Cloudflare Tunnel + Tunnel Registry

> Flujo de exposición del LAN server vía Cloudflare Tunnel + descubrimiento automático de la URL del tunnel por la PWA usando Supabase Realtime.

## Diagrama

```mermaid
sequenceDiagram
  participant Desktop as Desktop main
  participant CF as cloudflared
  participant Edge as CF Edge (internet)
  participant Reg as tunnel_endpoints (Supabase)
  participant PWA
  participant LC as lan-client

  Desktop->>Desktop: getStoredToken() (existe)
  Desktop->>CF: spawn cloudflared --token=...
  CF->>Edge: registrar túnel
  Edge-->>CF: connected, asigna URL
  CF-->>Desktop: stdout "Registered tunnel connection" + URL
  Desktop->>Reg: publishTunnelUrl(userId, url, access_token)
  Reg-->>Desktop: OK

  Note over PWA: arranque o regreso de background
  PWA->>Reg: subscribeTunnelUrl(userId)
  Reg-->>PWA: { url, access_token } (pull inicial)
  PWA->>LC: setTunnelUrl(url) + setAccessToken(token)

  Note over Desktop,CF: red se cae 5s
  CF--xDesktop: exit
  Desktop->>Desktop: setState(error) + timer 10s
  Desktop->>CF: spawn nuevo (auto-restart)
  CF->>Edge: re-conectado (Quick Tunnel cambia URL)
  CF-->>Desktop: nueva URL
  Desktop->>Reg: publishTunnelUrl(userId, nuevaUrl)
  Reg->>PWA: Realtime UPDATE
  PWA->>LC: setTunnelUrl(nuevaUrl)

  Note over PWA: PWA reproduce sin intervención manual
  PWA->>Edge: GET <tunnelUrl>/stream/<id>?token=...
  Edge->>Desktop: forward via tunnel
  Desktop-->>Edge: audio stream
  Edge-->>PWA: bytes
```

## Decisiones documentadas

- **Quick Tunnel cambia de URL al reiniciar** → registry resuelve sin intervención manual del usuario.
- **NUNCA borrar `tunnelUrl` local aunque Supabase devuelva null** ([[tunnel-registry]]) — las cuentas pareadas no son owners, su query a `tunnel_endpoints` siempre devuelve null.
- **`access_token` persistido en Supabase** — iOS evict localStorage tras ~7 días, este permite rehidratar.
- **Auto-restart con backoff 10s** ([[cloudflared]]) — bug transitorio de red se recupera solo.
- **Keepalive cada 3 min** ([[lan-client#startTunnelKeepalive]]) — el Quick Tunnel se cierra por inactividad tras ~5 min.

## Módulos involucrados

- Desktop: [[cloudflared|main/cloudflared]], [[ipc]] (handlers `tunnel:*`).
- Cloud: [[tunnel_endpoints]] tabla.
- PWA: [[tunnel-registry]], [[lan-client]], [[connectivity]].

## Notas / Changelog
- 2026-05-22: F8.
