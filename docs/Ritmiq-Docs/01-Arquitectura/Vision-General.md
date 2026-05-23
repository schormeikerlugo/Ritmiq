---
tipo: arquitectura
capa: meta
plataforma: ambas
estado: estable
ultima-revision: 2026-05-22
archivo: README.md
tags: [arquitectura, vision]
---

# Visión General

Ritmiq es un reproductor de música personal multiplataforma con tres pilares:

1. **Cliente Desktop** (Electron) — fuente de verdad local, baja a YouTube con `yt-dlp` y sirve audio a la PWA por LAN.
2. **Cliente PWA** (iOS / Android) — reutiliza la UI de `@ritmiq/ui` y consume audio del Desktop (LAN) o de Supabase Edge Functions.
3. **Backend Supabase** — auth, sync de biblioteca, social, recomendaciones, Edge Functions para resolver streams.

## Diagrama alto nivel

```mermaid
flowchart LR
  subgraph Desktop["Desktop (Electron)"]
    M[main]
    P[preload]
    R[renderer]
    YT[yt-dlp + ffmpeg]
    DB1[(SQLite)]
    LAN[LAN HTTP Server]
    CF[Cloudflared tunnel]
  end

  subgraph PWA["PWA"]
    UI[renderer React]
    DB2[(Dexie / IndexedDB)]
    SW[Service Worker]
  end

  subgraph Cloud["Supabase Cloud"]
    Auth[Auth]
    PG[(Postgres + RLS)]
    EF[Edge Functions]
    RT[Realtime]
    ST[Storage]
  end

  R -- IPC --> P --> M
  M --> YT
  M --> DB1
  M --> LAN
  M --> CF

  UI <--> SW
  UI --> DB2

  R -- supabase-js --> Auth
  UI -- supabase-js --> Auth
  R -- invoke --> EF
  UI -- invoke --> EF
  R <--> RT
  UI <--> RT

  UI -- HTTP audio --> LAN
  UI -- HTTP audio --> CF
  CF -. expone .-> LAN
```

## Capas del monorepo

```mermaid
flowchart TB
  subgraph apps
    A1[apps/desktop]
    A2[apps/pwa]
  end
  subgraph packages
    U[ui]
    C[core]
    D[db]
    AP[api]
    Y[yt]
  end
  A1 --> U
  A1 --> C
  A1 --> D
  A1 --> AP
  A1 --> Y
  A2 --> U
  A2 --> C
  A2 --> D
  A2 --> AP
  U --> C
  U --> D
  U --> AP
  C --> D
  AP --> D
```

## Decisiones macro

- **JS + JSDoc** en vez de TypeScript: menor fricción de build en Electron, tipos en hot-paths.
- **Zustand + TanStack Query**: estado UI ligero + cache de red declarativo.
- **Howler.js** como abstracción de audio en Desktop; HTML Audio puro en PWA por compatibilidad con MediaSession en iOS.
- **better-sqlite3** en Desktop por sincronía y velocidad; **Dexie** en PWA porque IndexedDB es lo único disponible.
- **Cloudflared** en lugar de NAT punching: estable y gratis hasta 50 túneles.
- **yt-dlp embebido** en Desktop, no en PWA (binario no portable). PWA usa Edge Function [[resolve-stream]].

Ver detalles en [[Decisiones-Tecnicas-ADR]] y [[Monorepo-y-Workspaces]].
