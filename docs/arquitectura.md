# Ritmiq — Arquitectura

Resumen de las decisiones técnicas del proyecto. Para el contexto y casos de
uso, ver `Especificaciones-Técnicas.md`.

## 1. Visión

App personal multiplataforma para escuchar música obtenida de YouTube
(streaming + descarga offline), sincronizada entre dispositivos vía Supabase
y servida en LAN desde el PC al móvil cuando ambos están en la misma WiFi.

## 2. Plataformas

| Plataforma | Stack | Distribución |
|---|---|---|
| **Desktop** (Linux/Win/Mac) | Electron + Vite + React | AppImage / NSIS / DMG |
| **iPhone** | PWA instalada desde Safari | Hosting (Vercel/Cloudflare Pages) |
| **Android** | PWA instalada desde Chrome | Mismo hosting |
| **iOS nativo** *(futuro)* | Capacitor + GitHub Actions macOS | App Store |

## 3. Stack técnico

- **Lenguaje**: JavaScript ESM. JSDoc + `checkJs: true` en `packages/core`,
  `packages/db`, `packages/yt` y edge functions.
- **Estilos**: CSS Modules + variables CSS (`packages/ui/src/styles/`).
- **Estado**: Zustand (reactividad simple) + TanStack Query (cache de
  consultas a Supabase).
- **Audio**: Howler.js en web/desktop. `<audio>` HTML5 + MediaSession API en
  móvil (lockscreen + AirPods).
- **DB local**:
  - Desktop → `better-sqlite3` (síncrono, rápido, en proceso main).
  - PWA → IndexedDB vía Dexie (incluye blobs de audio descargados).
- **Backend**: Supabase. Local con Docker para desarrollo, Cloud Free Tier
  para producción.
- **Audio source**: `yt-dlp` + `ffmpeg` embebidos en Electron.

## 4. Estrategia de fuente de audio

`packages/core/src/audio-source.js` resuelve la URL reproducible aplicando
este orden de prioridad:

1. **Local**: track descargado en disco (desktop) o en IndexedDB (PWA).
2. **LAN**: servidor HTTP del Electron PC (descubrimiento por mDNS o IP
   guardada). Ahorra ancho de banda y latencia cuando estás en casa.
3. **Cloud**: edge function `resolve-stream` de Supabase. Usado fuera de
   casa.

## 5. Sincronización offline-first

`packages/core/src/sync` implementa una cola FIFO persistida (en SQLite o
IndexedDB según plataforma). Las mutaciones del cliente se aplican local
primero y se replican al servidor cuando hay red. Política de conflictos:
last-write-wins por `client_updated_at`.

## 5b. Dónde vive cada dato

| Tipo de dato | Desktop (Electron) | PWA (móvil) | Sincroniza entre dispositivos |
|---|---|---|---|
| Cuenta y contraseña | Supabase Auth | Supabase Auth | Sí |
| Metadata de tracks (título, artista, ytId, duración) | SQLite local + Supabase | Solo Supabase | Sí (Realtime) |
| Playlists (nombre, isOffline, coverUrl) | SQLite local + Supabase | Solo Supabase | Sí (Realtime) |
| Contenido de playlists (orden de tracks) | SQLite local + Supabase | Solo Supabase | Sí (Realtime) |
| Carátulas de playlists (imágenes) | Supabase Storage | Supabase Storage | Sí (URL pública) |
| **Archivos de audio descargados** | Disco: `~/.config/@ritmiq/desktop/audio/<id>.opus` | IndexedDB (Bloque 2) | **No, por dispositivo** |
| Estado `isDownloaded` y `filePath` | SQLite local | Computado desde IndexedDB | **No, por dispositivo** |
| Cola de mutaciones offline | localStorage | localStorage | No, local del cliente |
| Estado del player (queue, posición, volumen) | Memoria | Memoria | No, efímero |

**Reglas claras**:

1. **El audio nunca se sube a Supabase Storage**: free tier 1GB se llenaría rápido y hay consideraciones legales. Cada dispositivo descarga su propia copia.
2. **La metadata SÍ vive en Supabase**: pesa kilobytes, sincroniza entre dispositivos vía Realtime.
3. **Los flags por-dispositivo (descargado/no descargado) NO se sincronizan**: son estado local que cada cliente computa según lo que tiene en su disco/IndexedDB.

## 5c. Dev vs Prod (Supabase local vs cloud)

| Entorno | URL de Supabase | Cuándo se usa |
|---|---|---|
| **Dev** | `http://127.0.0.1:54421` (Docker local) | `pnpm dev:*` |
| **Prod** | `https://<proyecto>.supabase.co` (free tier) | `pnpm build` y deploy de la PWA |

Cada `pnpm db:push` sube las migraciones del repo al cloud. El schema, RLS y edge functions son idénticos. Auth, storage y Realtime configurados igual.

**Nunca conviven simultáneamente**: Vite carga `.env.development` o `.env.production` según el modo.

## 6. Supabase: dos entornos

| Entorno | URL | Para |
|---|---|---|
| **Local** | `http://127.0.0.1:54321` | Desarrollo, migraciones, edge fn debug |
| **Cloud** | `https://<proj>.supabase.co` | Producción 24/7, accesible desde iPhone fuera de casa |

`supabase db push` aplica migraciones del repo a Cloud. Local se resetea con
`supabase db reset`. Auth, schema y edge functions son los mismos en ambos.

## 7. Seguridad

- **Row Level Security** habilitada en todas las tablas. Cada usuario sólo
  ve sus propias filas (`auth.uid() = user_id`).
- Auth **email + password** con confirmación opcional.
- Bucket `covers` público en lectura, escritura sólo para autenticados.

## 8. Estructura del monorepo

```
apps/
  desktop/     Electron (main + preload + renderer)
  pwa/         PWA estática
packages/
  ui/          Componentes React + CSS Modules + Zustand stores
  core/        Player, queue, audio-source, sync (con JSDoc)
  db/          Schema + adapters SQLite/Dexie
  api/         Cliente Supabase + LAN discovery
  yt/          yt-dlp + ffmpeg wrappers (desktop only)
supabase/
  migrations/
  functions/
docs/
```

## 9. Roadmap

- **Fase 0** ✅ Setup monorepo
- **Fase 1** MVP Desktop: Electron + UI + yt-dlp + SQLite + player híbrido
- **Fase 2** Auth + sync Supabase
- **Fase 3** PWA + LAN streaming
- **Fase 4** Edge Functions móvil (resolve-stream productivo)
- **Fase 5** Importación de Spotify
- **Fase 6** Importación de archivos locales (mp3 propios)
- **Fase 7** Pulido: smart downloads, ecualizador, letras, atajos
