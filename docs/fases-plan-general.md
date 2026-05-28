# Plan general de mejoras Ritmiq (fases 0-8)

Plan maestro acordado para iterar la app por fases secuenciales. Filosofia:
**1 commit = 1 cosa probable**, gate manual entre commits, no fases.

## Fase 0 — Cerrar deuda comprometida ✓ COMPLETADA

Ver `docs/fase-0-completada.md`.

5 commits: T4 cookie iOS, T5 refresh visibility, T7 Open Graph SSR,
guardar discografia, abrir playlist YT.

## Fase 1 — Sistema de motion (siguiente)

Fundacion visual para las fases 2+. Sin esto, transiciones se sienten
desconectadas.

| # | Commit | Esfuerzo | Riesgo |
|---|---|---|---|
| 1.1 | `feat(tokens): duration + motion system` | 30min | nulo |
| 1.2 | `chore(deps): instalar gsap` | 15min | bajo |
| 1.3 | `feat(motion): hook useViewTransition` | 1h | bajo |
| 1.4 | `feat(motion): transiciones entre vistas top-level` | 1.5h | medio |
| 1.5 | `feat(motion): stagger entrada HomeRow cards` | 1h | bajo |

Total: ~4.5h.

## Fase 2 — Quick wins visuales

Alto impacto, bajo esfuerzo. Demo a tercero al final.

| # | Commit | Esfuerzo |
|---|---|---|
| 2.1 | splash pantalla de carga inicial | 1.5h |
| 2.2 | CoverArt con gradient hash placeholder | 2h |
| 2.3 | skeletons fieles por seccion | 2h |
| 2.4 | progress bar player con gradient accent | 45min |
| 2.5 | nowplaying cover breathing animation | 1h |
| 2.6 | bottomsheet drag-to-dismiss real | 2.5h |

Total: ~10h.

## Fase 3 — Sistematizar (deuda de arquitectura UI)

| # | Commit | Esfuerzo | Riesgo |
|---|---|---|---|
| 3.1 | `<ListView>` primitive + virtualizacion react-window | 4h | alto |
| 3.2 | sistema central retry exponencial | 3h | medio |
| 3.3 | shortcuts descubrimiento + indicators | 2h | bajo |
| 3.4 | desktop mini-player condensado al scroll | 3h | medio |
| 3.5 | desktop cola siempre visible (3 columnas) | 3h | medio |

Total: ~15h.

## Fase 4 — Features diferenciadoras

| # | Commit | Esfuerzo |
|---|---|---|
| 4.1 | edge function lyrics (lrclib.net) | 3h |
| 4.2 | vista lyrics sincronizadas en NowPlaying | 3h |
| 4.3 | crossfade + gapless | 4h |
| 4.4 | EQ visual 5 bandas | 4h |
| 4.5 | visualizer canvas en NowPlaying | 3h |
| 4.6 | stats heatmap GitHub-style | 2h |
| 4.7 | wrapped mensual | 3h |
| 4.8 | drag & drop tracks entre playlists (desktop) | 3h |
| 4.9 | historial buscable con filtros | 3h |

Total: ~28h.

## Fase 5 — Recomendaciones Fase 3 backend

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

- ✓ Fase 0 (5 commits, ver `fase-0-completada.md`).
- ⧗ Siguiente: Fase 1.1.

## Decisiones tomadas

- Fase 6 (Spotify OAuth) y Fase 8 (Jam mode): al final, opcionales.
- Orden secuencial estricto, sin reordenar.
- Conservador: gate despues de **cada** commit, no de cada fase.
- Documentar todo en `docs/` (Obsidian MCP no funcional en este entorno).
