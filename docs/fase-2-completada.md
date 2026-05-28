# Fase 2 — Quick wins visuales ✓

Pulido visual de alto impacto y bajo esfuerzo. La app se siente
significativamente mas "premium" tras esta fase: splash de boot,
placeholders consistentes, skeletons fieles, progress bar viva,
cover respirando, drag refinado.

6 commits atomicos. Build PWA + AppImage verde en todos.

## Commits

| # | Commit | Hash | Resumen |
|---|---|---|---|
| 2.1 | `feat(splash): pantalla de carga inicial inline` | `847bd89` | Splash con logo pulsando + barra deslizante en `index.html`. |
| 2.2 | `feat(ui): primitive CoverArt con gradient hash placeholder` | `233f859` | `<CoverArt>` con gradient hash + iniciales para covers sin imagen. |
| 2.3 | `feat(skeleton): RowSkeleton fiel al HomeRow final` | `ac13429` | RowSkeleton ahora replica subtitle + boton Reproducir + variante circle. |
| 2.4 | `feat(player): progress bar con gradient accent + glow halo` | `7f3241c` | Progress bar usa gradient accent siempre, glow halo en hover/scrubbing. |
| 2.5 | `feat(nowplaying): breathing glow halo en cover cuando reproduce` | `ab1372f` | Keyframe `ritmiq-cover-breathing` 4s sine inOut sobre box-shadow accent. |
| 2.6 | `feat(bottomsheet): drag-to-dismiss refinado con Pointer Events` | `13fccfa` | Touch + mouse unificados via PointerEvents, backdrop dim dinamico, threshold por %. |

## Cambios por area

### Boot / first paint (2.1)
- `apps/pwa/index.html`: splash inline con CSS+JS vanilla.
- Logo 112px con pulse (scale 1.0\u21941.04, 1.8s).
- Barra deslizante con linear-gradient accent (1.4s).
- MutationObserver en `#root` para detectar primer mount de React
  y aplicar fade-out (.ritmiq-splash--hide). Fallback 8s.
- @media prefers-reduced-motion neutraliza las animaciones.

### Primitive CoverArt (2.2)
- `packages/ui/src/components/primitives/CoverArt.jsx`.
- Hash FNV-1a 32-bit del seed (titulo o artista) -> 2 hues HSL separados
  40-100 grados -> linear-gradient(135deg).
- Iniciales 1-2 letras derivadas de las primeras palabras del seed.
- `onError` del `<img>` activa fallback automaticamente.
- Props: coverUrl, seed, alt, size, radius (sm/md/lg/pill/circle/N),
  initials (boolean | string), loading, className, onClick.
- Migrado en este commit: `TrackCard`, mini-player. Resto de vistas
  pueden migrarse incrementalmente en commits futuros.

### Skeleton fieles (2.3)
- `RowSkeleton.jsx` ahora replica el HomeRow real:
  - Title + linea subtitle placeholder.
  - Boton 'Reproducir' placeholder pill.
  - Cards con anchos de lineas variables (organico).
  - Variante `shape='circle'` para skeletons de artistas.
- Layout no salta cuando datos llegan.

### Progress bar accent (2.4)
- `Player.module.css`: barFill usa linear-gradient(accent \u2192 accent+white
  30% mix) en lugar de blanco solido.
- Hover/scrubbing anade `box-shadow: 0 0 12px accent 60%` (glow halo).
- barThumb gana ring halo (0 0 0 4px accent 25%) en hover/scrubbing.
- Transiciones ease-emphasized para box-shadow.
- color-mix(in oklab) requiere Chrome 111+ (Electron 33 = OK).

### Cover breathing (2.5)
- Keyframe `ritmiq-cover-breathing`: 4s sine inOut, infinite.
- Anima el spread/offset del box-shadow accent (no transform.scale, para
  no conflictuar con el BPM pulse).
- Solo activo cuando `data-playing="true"` en el `.cover`.
- Delay 800ms al iniciar para no chocar con fade-in inicial.
- Reduced-motion ya lo cubre el reset global de tokens.css.

### BottomSheet pointer events (2.6)
- Migracion completa de touch events a Pointer Events.
- Mouse drag funciona en desktop (antes solo touch).
- `setPointerCapture` evita perder el drag si el cursor sale.
- Threshold de cierre por % del alto del sheet (35%) en lugar de px fijo.
- Backdrop dim dinamico: opacity 1 \u2192 0.4 mientras se arrastra.
- Handle visual reacciona (opacity 0.85 + width 44px) durante drag.
- Header tambien captura el drag (mas area touch).

## Bundle impact

| Stage | Precache | Delta vs Fase 1 |
|---|---|---|
| Tras 2.1 (splash) | 2266 KiB | +4 KiB (HTML inline) |
| Tras 2.2 (CoverArt) | 2268 KiB | +2 KiB |
| Tras 2.3 (skeleton) | 2270 KiB | +2 KiB |
| Tras 2.4 (progress) | 2270 KiB | sin cambio |
| Tras 2.5 (breathing) | 2270 KiB | sin cambio |
| Tras 2.6 (bottomsheet) | 2271 KiB | +1 KiB |
| **Total Fase 2** | **2271 KiB** | **+9 KiB vs 2262** |

Impacto despreciable. Todo CSS + JS minimo.

## Verificacion manual

1. **Splash (2.1)**:
   - Reload AppImage o PWA. Splash visible ~300ms-2s segun hardware.
   - Logo pulsa, barra desliza accent.
   - Al montar React, splash hace fade-out limpio.

2. **CoverArt (2.2)**:
   - Home: tracks recientes que tengan ytId sin thumbnail muestran
     gradient + iniciales del titulo. Mismo titulo = mismo gradient.
   - Mini-player: track sin cover muestra iniciales en lugar de hueco.

3. **Skeleton (2.3)**:
   - Hard reload con cache fria. Filas de Home cargando muestran
     skeleton con title placeholder + subtitle line + boton pill.
   - Cuando datos llegan, layout no salta.

4. **Progress bar (2.4)**:
   - Reproduce un track. La barra de progreso siempre se ve con
     gradient accent (sin hover).
   - Hover sobre la barra: glow accent + thumb con ring halo.

5. **Cover breathing (2.5)**:
   - Abre NowPlaying con un track sonando.
   - El glow accent alrededor del cover respira (intensidad 60-100%,
     4s por ciclo).
   - Pausa: la respiracion se detiene en el frame actual.
   - Reduced motion ON: sin breathing, glow estatico.

6. **BottomSheet (2.6)**:
   - Mobile: abre cualquier sheet (Add to playlist, share, etc.).
     Arrastra hacia abajo. El backdrop se oscurece menos a medida que
     arrastras. Suelta antes del 35% \u2192 snap-back. Suelta despues \u2192
     cierra.
   - Desktop: ahora puedes hacer mouse drag del handle (antes era
     bloqueado por touch-only handlers).

## Siguiente fase

**Fase 3 \u2014 Sistematizar** (5 commits, ~15h):
  3.1 `<ListView>` primitive + virtualizacion react-window.
  3.2 sistema central retry exponencial.
  3.3 shortcuts descubrimiento + indicators.
  3.4 desktop mini-player condensado al scroll.
  3.5 desktop cola siempre visible (3 columnas).
