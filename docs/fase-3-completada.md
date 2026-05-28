# Fase 3 — Sistematizar ✓

Deuda de arquitectura UI. Primitives, retry centralizado, descubrimiento
de shortcuts, layout responsive del player, persistencia de preferencias
del desktop.

6 commits atomicos. Build PWA + AppImage verde en todos.

## Commits

| # | Commit | Hash | Resumen |
|---|---|---|---|
| 3.1 | `feat(primitive): ListView con virtualizacion opt-in (sin deps)` | `70ba5a0` | Primitive ListView standalone con virt opcional. 0 KB extra. |
| 3.2 | `feat(retry): helper withRetry + integracion en 3 stores edge` | `e12cf95` | withRetry generico + integracion en recommendations, artist, yt-playlist. |
| 3.3 | `feat(shortcuts): onboarding toast + indicator kbd hint en TopBar` | `57a0647` | Toast first-time `? para atajos` + hint Cmd/Ctrl+K en search input. |
| 3.4 | `feat(player): modo compacto automatico en laptops max-height 720px` | `6c6ca11` | Player 88->60px en viewports cortos, reorganiza children. |
| 3.5 | `feat(desktop): persistir queueOpen entre sesiones` | `4e49180` | localStorage persiste el toggle de queue panel en desktop. |

## Cambios por area

### Primitive ListView (3.1)
- `packages/ui/src/components/primitives/ListView.jsx`.
- API: items, renderItem, itemHeight, virtualize, overscan, keyExtractor,
  className, style, empty, ariaLabel, onScroll.
- Modo no virtualizado: renderiza todos los items (listas < 100).
- Modo virtualizado: ventana con overscan, spacers top/bottom, throttle
  con requestAnimationFrame. itemHeight uniforme (V1).
- Sin react-window ni @tanstack/react-virtual \u2014 0 KB extra al bundle.
- Standalone: no se migran Library/Downloads en este commit, migracion
  incremental cuando aplique.

### Retry exponencial (3.2)
- `packages/ui/src/lib/with-retry.js`.
- Backoff baseDelayMs * 2^n + jitter 20%. Default 500ms/1s/2s.
- Clasificacion: 5xx, 408, 429, network failure = retriable. 4xx, abort
  = no retriable.
- Cancelable via AbortSignal.
- Integrado en: recommendations.js, artist.js (artist-detail + album-resolve),
  yt-playlist.js.
- 3 intentos con onRetry log para observabilidad.

### Shortcuts descubrimiento (3.3)
- `packages/ui/src/lib/use-shortcuts-onboarding.js`.
- Hook que muestra UN toast la primera vez que un user (logged in) entra
  con teclado fisico probable (pointer:fine + ancho >= 768px).
- Toast con `Ver` action que abre ShortcutsHelp via bottom-sheet.
- Persistencia: localStorage `ritmiq.shortcuts-seen`.
- Hint `\u2318 K` / `Ctrl K` en TopBar search input (desktop only, oculto
  al focus/escribir).
- Detector `isMac` memoizado para mostrar simbolo correcto.

### Player compacto (3.4)
- `tokens.css`: `@media (min-width: 769px) and (max-height: 720px)`
  override `--layout-player-h: 60px`.
- `Player.module.css`: nuevo bloque con misma media reorganiza children:
    * .controls de column a row.
    * Cover 56->40px, playBtn 40->36px.
    * Timestamps ocultos (siguen visibles en NowPlaying).
    * Padding/gap reducidos.
- Transicion automatica al redimensionar ventana.

### Queue persistence (3.5)
- `view.js`: queueOpen ahora se persiste en localStorage `ritmiq.queue-open-desktop`.
- Solo aplica en desktop. En mobile siempre arranca cerrada (cola es
  modal full-screen alli).
- loadQueueOpenInitial() + persistQueueOpen() con guards SSR-safe.
- toggleQueue() y closeQueue() actualizan localStorage automaticamente.

## Bundle impact

| Stage | Precache | Delta vs Fase 2 |
|---|---|---|
| Tras 3.1 (ListView) | 2271 KiB | sin cambio (no importado todavia) |
| Tras 3.2 (withRetry) | 2273 KiB | +1.6 KiB |
| Tras 3.3 (shortcuts onboarding) | 2275 KiB | +2.2 KiB |
| Tras 3.4 (player compacto) | 2275 KiB | +480 B |
| Tras 3.5 (queue persist) | 2276 KiB | +600 B |
| **Total Fase 3** | **2276 KiB** | **+5 KiB vs 2271** |

## Verificacion manual

1. **Retry (3.2)**:
   - Provoca un fallo: en DevTools network throttle a `Offline` y navega
     a un artista. Vuelve `Online` rapido \u2014 deberias ver en console
     los retry logs.
   - Sin throttle: no debe haber diferencia perceptible (fastpath).

2. **Shortcuts onboarding (3.3)**:
   - Borra localStorage entry `ritmiq.shortcuts-seen`.
   - Reload \u2014 4s tras el login, toast con CTA `Ver`.
   - Click `Ver` \u2014 ShortcutsHelp abre.
   - Reload de nuevo \u2014 no debe re-aparecer.
   - Search input en desktop: ve el hint `\u2318 K` (o `Ctrl K` en
     no-Mac). Click en el input o escribe \u2014 hint desaparece.

3. **Player compacto (3.4)**:
   - Redimensiona la ventana a una altura < 720px.
   - El player baja a ~60px, los botones se reorganizan en una fila.
   - Vuelve a > 720px \u2014 layout normal.

4. **Queue persist (3.5)**:
   - Click toggle queue (boton del Player). Cierra y reabre la AppImage.
   - El panel queue debe estar en el mismo estado que lo dejaste.
   - En mobile: nunca cambia (siempre arranca cerrada).

## Siguiente fase

**Fase 4 \u2014 Features diferenciadoras** (9 commits, ~28h):
  4.1 edge function lyrics (lrclib.net).
  4.2 vista lyrics sincronizadas en NowPlaying.
  4.3 crossfade + gapless.
  4.4 EQ visual 5 bandas.
  4.5 visualizer canvas en NowPlaying.
  4.6 stats heatmap GitHub-style.
  4.7 wrapped mensual.
  4.8 drag & drop tracks entre playlists (desktop).
  4.9 historial buscable con filtros.
