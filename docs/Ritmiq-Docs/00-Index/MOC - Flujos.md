---
tipo: moc
capa: flujo
plataforma: ambas
estado: estable
ultima-revision: 2026-05-27
tags: [moc, flujos]
---

# MOC — Flujos end-to-end

Diagramas Mermaid que conectan UI ↔ stores ↔ helpers ↔ main/edge ↔ DB.

## Flujos documentados

```dataview
TABLE estado, ultima-revision
FROM "10-Flujos"
WHERE tipo = "flujo"
SORT file.name ASC
```

## Los flujos documentados

- [[Reproduccion-Track-Online]] — del click play al audio sonando, cascada LAN→Tunnel→Cloud + pre-end swap iOS.
- [[Descarga-Offline]] — Desktop a disco / PWA a IndexedDB, con cache `shared_audio` entre cuentas.
- [[Sincronizacion-LAN]] — pareo Modelo Y + reproducción posterior con `device_token`.
- [[Tunnel-Cloudflared]] — Cloudflare Tunnel + auto-reconexión Quick Tunnel vía `tunnel_endpoints` Realtime.
- [[Login-y-Sesion]] — carga inicial completa con Realtime + push registration.
- [[Compartir-con-Amigos]] — share + push + Realtime al inbox + reminder.
- [[Lyrics-Sincronizadas]] — toggle Music2 → store → Edge lyrics → cache lyrics_cache → parseLrc → render línea activa + seek por click. *(Fase 4.1 + 4.2)*
- [[Import-Spotify]] — sin OAuth: parse embed → matching YouTube con mutex.
- [[Recomendaciones]] — Last.fm + Innertube + cache 12h.
- [[Push-Notifications]] — suscripción, envío y sync (iOS edge cases).
- [[Sincronizacion-Offline]] — sync queue offline-first + hidratación Dexie.
- [[p2p-knowledge-sharing]] — Fase 1 + Fase 2: cache URLs + diccionario metadata cross-user.
