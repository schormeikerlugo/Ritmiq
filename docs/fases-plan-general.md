# Plan general de mejoras Ritmiq (fases 0-8)

Plan maestro acordado para iterar la app por fases secuenciales. Filosofia:
**1 commit = 1 cosa probable**, gate manual entre commits, no fases.

## Fase 0 — Cerrar deuda comprometida ✓ COMPLETADA

Ver `docs/fase-0-completada.md`.

5 commits: T4 cookie iOS, T5 refresh visibility, T7 Open Graph SSR,
guardar discografia, abrir playlist YT.

## Fase 1 — Sistema de motion ✓ COMPLETADA

Ver `docs/fase-1-completada.md`.

5 commits: duration+ease tokens + reduced-motion global, install gsap,
useViewTransition hook, ViewSlot con GSAP, stagger HomeRow.

Bundle delta: +71 KiB precache, +66 KB gzipped (GSAP core).

## Fase 2 — Quick wins visuales ✓ COMPLETADA

Ver `docs/fase-2-completada.md`.

6 commits: splash inline, CoverArt primitive, RowSkeleton fiel,
progress bar gradient, cover breathing, BottomSheet PointerEvents.

Bundle delta: +9 KiB vs Fase 1 (despreciable).

## Fase 3 — Sistematizar ✓ COMPLETADA

Ver `docs/fase-3-completada.md`.

5 commits: ListView primitive, withRetry helper, shortcuts onboarding,
player compacto auto, queue persist.

Bundle delta: +5 KiB vs Fase 2.

Cambios de scope vs plan original:
- 3.1 sin react-window: virtualizacion propia con IntersectionObserver +
  slice + rAF throttle. 0 KB extra. Limitado a itemHeight uniforme.
- 3.4 no es "condensado al scroll" sino "compacto cuando viewport
  altura < 720px" \u2014 mas previsible que toggle por scroll, sin UI extra.

## Fase 4 — Features diferenciadoras ✓ COMPLETADA

Ver `docs/fase-4-completada.md`.

9 commits: lyrics infra + UI, crossfade fade-out, EQ curve SVG,
visualizer canvas, heatmap, wrapped mensual, drag-to-playlist, history.

Bundle delta: +35 KiB vs Fase 3. Mejor ratio feature/peso del proyecto.

Cambios de scope vs plan:
- 4.3 crossfade simulado (fade-in + fade-out compuestos) en lugar de
  crossfade real con dos audios solapados. Documentado en la docstring.
- 4.4 EQ ya tenia 6 bandas implementadas; lo nuevo fue el visualizer
  SVG de la curva combinada.
- 4.8 drag-and-drop con HTML5 native en lugar de dnd-kit (que ya esta
  en uso en PlaylistView para sortable interno; cross-context con
  sortable es complejo).

## Fase 5 — Recomendaciones Fase 3 backend (siguiente)

Ver `docs/RECOMMENDATIONS.md` lineas 262-280.

| # | Commit | Esfuerzo |
|---|---|---|
| 5.1 | edge function enrich-tags (artist_tags cache) | 3h |
| 5.2 | Home: filas "Mix por genero real" | 1.5h |
| 5.3 | Daily Mix pg_cron 4am | 3h |
| 5.4 | heuristica hora del dia | 1.5h |

Total: ~9h.

## Fase 6 — Multi-fuente recs (OPCIONAL — al final)

Decidido diferir hasta el final.

| # | Commit | Esfuerzo |
|---|---|---|
| 6.1 | recs fuente YouTube Music Innertube | 4h |
| 6.2 | scoring hibrido | 2h |
| 6.3 | Spotify Web API OAuth opcional | 8h |

Total: ~14h.

## Fase 7 — Performance / tecnica

Bundle hoy: 936 KB en un solo chunk. Objetivo < 400 KB inicial.

| # | Commit | Esfuerzo |
|---|---|---|
| 7.1 | code-splitting por ruta (React.lazy) | 2h |
| 7.2 | split Auth + Onboarding | 1h |
| 7.3 | SW runtime cache de covers | 1.5h |
| 7.4 | container queries en cards/rows | 2h |
| 7.5 | Playwright E2E smoke critical flows | 4h |

Total: ~10.5h.

## Fase 8 — Jam mode (OPCIONAL — al final)

Decidido diferir hasta el final.

| # | Commit | Esfuerzo |
|---|---|---|
| 8.1 | protocolo sync supabase realtime | 6h |
| 8.2 | UI invitar + unirse a jam | 4h |
| 8.3 | cola colaborativa | 4h |

Total: ~14h.

## Workflow por commit

1. Usuario da luz verde al commit N.
2. Implementacion solo de ese commit.
3. Build PWA + AppImage.
4. Usuario prueba en device real (desktop + PWA cuando aplica).
5. Si OK \u2192 commit + sigo al N+1. Si no OK \u2192 revert o fix antes del commit.

## Documentacion

Cada fase completada genera un doc `docs/fase-N-completada.md` con
commits, hashes, verificacion manual, deploys requeridos.

## Estado actual

- ✓ Fase 0 (5 commits + docs, ver `fase-0-completada.md`).
- ✓ Fase 1 (5 commits + docs, ver `fase-1-completada.md`).
- ✓ Fase 2 (6 commits + docs, ver `fase-2-completada.md`).
- ✓ Fase 3 (5 commits + docs, ver `fase-3-completada.md`).
- ✓ Fase 4 (9 commits + docs, ver `fase-4-completada.md`).
- ⧗ Siguiente: Fase 5.1.

## Decisiones tomadas

- Fase 6 (Spotify OAuth) y Fase 8 (Jam mode): al final, opcionales.
- Orden secuencial estricto, sin reordenar.
- Conservador: gate despues de **cada** commit, no de cada fase.
- Documentar todo en `docs/` (Obsidian MCP no funcional en este entorno).
