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

## Fase 5 — Recomendaciones backend ✓ COMPLETADA

Ver `docs/fase-5-completada.md`.

4 commits: enrich-tags edge function + cliente, Home con genero capitalizado +
pre-enrich, pg_cron 04 UTC (prune + refresh artist_tags via pg_net + vault),
heuristica hora del dia con reorderByMood (no destructivo).

Bundle delta: +6 KiB vs Fase 4.

Notas:
- `reorderByMood` aplicado pero sin efecto observable hasta que el server
  devuelva `track.tags`. Puerta trasera: cuando se anada, se activa solo.
- Cron en UTC (no por user timezone) por simplicidad del scope.

## Fase 6 — Multi-fuente recs ✓ COMPLETADA

Ver `docs/fase-6-completada.md`.

3 commits: yt-recs Innertube watch-next + scoring hibrido con consensus
boost + infraestructura Spotify OAuth PKCE (sin UI todavia, requiere
registro Spotify para activar).

Bundle delta: +3 KB vs Fase 7.

Notas:
- Spotify OAuth queda como infraestructura. La UI de "Conectar Spotify"
  + pagina /auth/spotify-callback son trabajo aparte cuando se decida
  activar (requiere registrar app en developer.spotify.com).
- `yt-recs` cache es global (mismo cache para todos los users con el
  mismo seedYtId). `user_id` se persiste solo para satisfacer FK de
  recommendation_cache.

## Fase 7 — Performance / tecnica ✓ COMPLETADA

Ver `docs/fase-7-completada.md`.

5 commits: code-splitting por ruta (10 chunks lazy), split Auth+Onboarding
(3 chunks mas), SW runtime cache de covers YT+Last.fm, container queries
en HomeRow/RowSkeleton, Playwright smoke tests + skeleton de suite.

Bundle delta vs Fase 5:
  raw: 1123 KB \u2192 931 KB (-17%)
  gzip: 323 KB \u2192 287 KB (-11%)
  13 chunks lazy generados (~144 KB raw fuera del bundle inicial)

Notas:
- 7.5 Playwright V1 cubre solo smoke (boot + code-splitting). Tests de
  flujos (Auth/Play/Share) documentados como follow-up en e2e/README.md.
- Container queries soportados desde Chrome 105 / Safari 16. Sin
  fallback explicito; degradacion gradual a fixed 180px en browsers
  viejos (~1% del trafico).

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
- ✓ Fase 5 (4 commits + docs, ver `fase-5-completada.md`).
- ✓ Fase 7 (5 commits + docs, ver `fase-7-completada.md`).
- ⧗ Restante: Fase 6 (opcional, multi-fuente recs) y Fase 8 (opcional, jam mode).
       Vault Obsidian pendiente de actualizar con Fase 5 + Fase 7.

## Decisiones tomadas

- Fase 6 (Spotify OAuth) y Fase 8 (Jam mode): al final, opcionales.
- Orden secuencial estricto, sin reordenar.
- Conservador: gate despues de **cada** commit, no de cada fase.
- Documentar todo en `docs/` (Obsidian MCP no funcional en este entorno).
