---
tipo: indice
capa: meta
plataforma: ambas
estado: estable
ultima-revision: 2026-05-28
---

# Ritmiq-Docs

Vault de documentación técnica del proyecto **Ritmiq** (reproductor de música personal Desktop + PWA).

**~215 notas** que documentan exhaustivamente todo el código del repositorio, organizadas por capa. Actualizado tras las Fases 0-5 y 7 de mejoras (34 notas nuevas, 21 actualizadas, 11 ADRs añadidos).

Repositorio de código: `/home/lenovics/portafolio Dev/Ritmiq`

## Empezar aquí

- [[MOC - Ritmiq]] — mapa raíz de toda la documentación.
- [[Convenciones-de-Notas]] — reglas para escribir y mantener notas.
- [[Template-Funcion]] — plantilla canónica para documentar cualquier unidad de código.
- [[Como-actualizar-esta-doc]] — workflow obligatorio al tocar código.

## Plugins requeridos

- **Dataview** (los MOCs usan queries DQL para listas auto-generadas).

## Estructura

| Carpeta | Contenido | Notas |
|---|---|---|
| `00-Index/` | MOCs (Maps of Content) + glosario | 7 |
| `01-Arquitectura/` | Visión general, monorepo, env, deploy, ADRs, motion, code-splitting, cron-jobs | 8 |
| `02-Desktop/` | Electron (main, preload, renderer) | 13 |
| `03-PWA/` | App móvil instalable (manifest, SW, splash, API mark-installed, OG middleware) | 7 |
| `04-UI/Componentes/` | Componentes React | 47 |
| `04-UI/Componentes/Primitives/` | Componentes atómicos reutilizables (`CoverArt`, `ListView`) | 2 |
| `04-UI/Helpers-Lib/` | Helpers no-hook (`api`, `lan-client`, `with-retry`, `enrich-tags`, `time-of-day`, etc.) | 28 |
| `04-UI/Hooks/` | Hooks `use-*` | 19 |
| `04-UI/Stores-Zustand/` | Stores de estado global | 19 |
| `05-Core/` | Lógica de player, queue, sync, audio-source | 5 |
| `06-DB/` | Schema SQL, adapters SQLite/Dexie + índice migraciones | 4 |
| `07-API-Cliente/` | Cliente Supabase y LAN discovery | 2 |
| `08-YT/` | Wrappers yt-dlp, ffmpeg, error-translator | 3 |
| `09-Supabase-Backend/Edge-Functions/` | Edge Functions deployables | 19 |
| `09-Supabase-Backend/Tablas/` | Tablas principales del schema Postgres | 16 |
| `10-Flujos/` | Diagramas end-to-end con Mermaid | 13 |
| `50-Roadmap/` | Features postergadas (Spotify, time-of-day, onboarding, observabilidad, distribución) | 6 |
| `99-Mantenimiento/` | Plantillas, convenciones, workflow, E2E Playwright | 4 |

## Fases de construcción del vault

| Fase | Scope | Notas |
|---|---|---|
| F0 | Estructura + MOCs + plantillas | 16 |
| F1 | Desktop (main, preload, renderer) | 13 |
| F2 | packages core/db/api/yt | 13 |
| F3 | 16 stores Zustand | 16 |
| F4 | 17 hooks use-* | 17 |
| F5 | 25 helpers lib | 25 |
| F6 | 38 componentes UI + 1 índice | 39 |
| F7 | 13 Edge Functions + 12 tablas + índice migraciones | 26 |
| F8 | 9 flujos Mermaid end-to-end | 9 |
| F9 | Revisión + actualización de MOCs | — |
| F9+ | PWA (`03-PWA/`: index, main, manifest+SW, sw-push, apple-touch) | 5 |
| **F10** | **Actualización Fases 0-4 de mejoras** (lyrics, visualizer, heatmap, wrapped, retry, motion system, primitives, drag-and-drop, history, share T4/T5/T7) | **+23** |
| **F11** | **Fases 5 + 7** (enrich-tags + cron + time-of-day + code-splitting + SW covers + container queries + Playwright) | **+10** |
| **Total** | | **~215** |

## Cambios en la actualización F10 (2026-05-27)

### Notas nuevas (24)

- **Primitives**: `CoverArt`, `ListView` (en `04-UI/Componentes/Primitives/`).
- **Componentes nuevos**: `YtPlaylistView`, `HistoryView`, `LyricsPanel`, `Visualizer`, `EqCurve`, `ActivityHeatmap`, `MonthlyWrapped`.
- **Stores nuevos**: `lyrics`, `yt-playlist`, `toast` (este último retroactivo).
- **Hooks nuevos**: `use-view-transition`, `use-shortcuts-onboarding`.
- **Helpers nuevos**: `with-retry`.
- **Edge Functions nuevas**: `lyrics`, `yt-playlist-resolve`.
- **Tabla nueva**: `lyrics_cache`.
- **PWA / Vercel**: `API-mark-installed`, `Edge-Middleware-OG`.
- **Arquitectura**: `Sistema-Motion`.
- **Flujo**: `Lyrics-Sincronizadas`.

### Notas actualizadas (19)

- Componentes: `NowPlaying`, `ArtistView`, `SearchView`, `StatsView`, `Sidebar`, `Library`, `Player`, `BottomSheet`, `Home`, `Skeleton`, `TopBar`.
- Stores: `artist`, `recommendations`, `view`, `settings`.
- Hooks: `use-crossfade`, `use-bpm-pulse`, `use-presence`.
- Helpers: `share`.

### ADRs nuevos (008-015)

GSAP motion engine · `CoverArt` gradient hash · `ListView` virtualización propia · `withRetry` clasificación de errores · Crossfade simulado · EQ curve aproximada · Drag-and-drop HTML5 native · Lazy-init WebAudio graph.

## Cambios en la actualización F11 (2026-05-28)

### Notas nuevas (10)

- **Edge Functions**: `enrich-tags`.
- **Tablas**: `artist_tags` (retroactiva).
- **Helpers**: `enrich-tags` (cliente), `time-of-day`.
- **Arquitectura**: `Code-Splitting`, `Cron-Jobs`.
- **Mantenimiento**: `E2E-Playwright`.

### Notas actualizadas (5)

- `Home.md` (mood-based + capitalize + container queries).
- `recommendations.md` (link a enrich-tags + cron).
- `manifest-y-service-worker.md` (SW runtime cache covers + precache de chunks lazy).
- `MOC - UI Compartida.md`, `MOC - Backend Supabase.md`, `MOC - Ritmiq.md` (contadores).

### ADRs nuevos (016-018)

Code-splitting con `React.lazy` · CSS Container Queries · Playwright E2E (sin CI gate todavía).

## Cambios en la actualización F12 (2026-05-29)

Documentación de las **Fases 6 (recomendaciones avanzadas) y 8 (Jam mode)** que habían
quedado sin documentar, más la nueva carpeta `50-Roadmap/` y el Jam mode robusto.

### Notas nuevas

- **Carpeta `50-Roadmap/`** (6): `README`, `Activar-Spotify-OAuth`, `Time-Of-Day-Home`,
  `Onboarding-Para-Distribucion`, `Observabilidad-Error-Logs`, `Distribucion-Amigos-Plan`.
- **Edge Functions** (F6): `yt-recs`, `spotify-callback`, `innertube` (shared).
- **Tablas** (F6+F8): `spotify_tokens`, `jam_sessions`, `jam_participants`.
- **Helpers** (F6): `hybrid-scoring`, `spotify-oauth`.
- **Stores** (F6+F8): `yt-recs`, `jam`.
- **Componentes** (F8): `JamModal`.
- **Hooks** (F8): `use-jam-sync`.
- **Flujo** (F8): `Jam-Mode`.

### ADR nuevo (019)

Sync de Jam mode vía Realtime broadcast + drift compensation (no WebRTC).

## Cómo usar este vault

1. **Para entender una función concreta**: abrí su nota (ej. `04-UI/Stores-Zustand/library.md`). Cada nota tiene la firma, sus dependencias entrantes/salientes, snippets comentados, casos de borde, y matriz "qué puede romper este cambio".

2. **Para entender un flujo completo**: abrí `10-Flujos/<flujo>.md`. Cada uno tiene un diagrama Mermaid y wikilinks a todos los módulos involucrados.

3. **Para ver el grafo de dependencias**: abrí Obsidian → vista Graph. Los `[[wikilinks]]` conectan automáticamente todas las notas.

4. **Para auditar qué notas están desactualizadas**: ver [[MOC - Ritmiq]] → tabla "Notas revisadas hace > 30 días" (requiere plugin Dataview).
