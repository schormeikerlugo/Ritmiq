# Ritmiq

Reproductor de música personal multiplataforma. Desktop (Electron) + PWA (iPhone/Android).
Streaming desde YouTube vía `yt-dlp`, descarga offline, sincronización con Supabase y
streaming en LAN desde el PC al móvil.

## Stack

- **Lenguaje**: JavaScript ESM + JSDoc en módulos críticos
- **Estilos**: CSS Modules + variables CSS
- **Desktop**: Electron + Vite + React
- **Móvil**: PWA (instalable en iOS/Android)
- **Estado**: Zustand + TanStack Query
- **Player**: Howler.js + MediaSession API
- **DB local**: better-sqlite3 (desktop) / Dexie/IndexedDB (PWA)
- **Backend**: Supabase (local en Docker para dev, cloud free tier en prod)
- **Audio source**: yt-dlp + ffmpeg embebidos en Electron

## Estructura

```
apps/
  desktop/   Electron app (main + renderer)
  pwa/       PWA standalone para hosting
packages/
  ui/        Componentes React + CSS Modules compartidos
  core/      Lógica del player, queue, sync (JSDoc)
  db/        Schema SQL + adapters SQLite/IndexedDB (JSDoc)
  api/       Cliente Supabase + LAN discovery
  yt/        Wrapper yt-dlp + ffmpeg (solo desktop) (JSDoc)
supabase/
  migrations/  SQL versionado
  functions/   Edge Functions (resolve-stream, search-youtube, match-spotify)
docs/          Especificaciones y arquitectura
```

## Setup inicial

```bash
# 1. Instalar dependencias
pnpm install

# 2. Levantar Supabase local (necesita Docker)
pnpm supabase:start

# 3. Aplicar migraciones a la DB local
pnpm supabase:reset

# 4. Desarrollo
pnpm dev:desktop   # Electron
pnpm dev:pwa       # PWA en navegador
```

## Variables de entorno

- `.env.development` → apunta a Supabase local (`http://127.0.0.1:54321`)
- `.env.production` → apunta a Supabase Cloud (rellenar con tu proyecto)

Ver `docs/arquitectura.md` para más detalles.
