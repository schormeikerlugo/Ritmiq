# Fase 1 — Sistema de motion ✓

Fundacion visual para las fases 2+. Sin esto, las transiciones de vista
y las entradas de cards se sentian discretas e inconsistentes. Ahora hay
un sistema unificado de motion respetando prefers-reduced-motion.

5 commits atomicos. Build PWA + AppImage verde en todos.

## Commits

| # | Commit | Hash | Resumen |
|---|---|---|---|
| 1.1 | `feat(tokens): sistema completo de motion` | `e7bff43` | Duration tokens xs/sm/md/lg/xl + easings out/in/inout/spring + @media reduced-motion global. |
| 1.2 | `chore(deps): instalar gsap@3.15.0 en @ritmiq/ui` | `a159408` | Dep nueva sin impacto en bundle hasta que se importe. |
| 1.3 | `feat(motion): hook useViewTransition` | `893e42c` | Hook reusable con presets fadeUp/fadeIn/fadeUpLg/stagger + gsap.matchMedia para reduced-motion. |
| 1.4 | `feat(motion): transiciones de vista con GSAP en ViewSlot` | `5141bc9` | Reemplaza animacion CSS de .viewSlot por GSAP via componente ViewSlot. |
| 1.5 | `feat(motion): stagger entrada de cards en HomeRow` | `2766c51` | Cards de HomeRow aparecen secuenciadas (35ms entre cada una) al mount. |

## Cambios por area

### Tokens y media query global
- Nueva escala canonica `--duration-xs/sm/md/lg/xl` (80/120/200/320/500 ms).
- Nuevos easings semanticos: `--ease-out` (entradas), `--ease-in`
  (salidas), `--ease-inout` (A\u2192B), `--ease-spring` (overshoot).
- Aliases legacy `--dur-fast/normal/slow` apuntando a los nuevos tokens
  para no romper ~206 usos existentes.
- `@media (prefers-reduced-motion: reduce)` global que neutraliza
  animation-duration, transition-duration, animation-iteration-count y
  scroll-behavior. Las animaciones JS (GSAP) usan gsap.matchMedia para
  el mismo efecto.

### Hook useViewTransition
- `packages/ui/src/lib/use-view-transition.js`.
- API: `useViewTransition(ref, { preset, duration, delay, deps,
  staggerEach, childSelector, disabled })`.
- Presets:
  - `fadeUp` (default): opacity 0 + y +12px \u2192 1 + y 0.
  - `fadeIn`: solo opacity.
  - `fadeUpLg`: y +24px para heroes.
  - `stagger`: anima children directos del ref con offset secuencial.
- gsap.matchMedia gestiona prefers-reduced-motion: salta tweens y
  garantiza estado final visible.
- Cleanup automatico via `mm.revert()` en unmount.
- `clearProps: 'transform,opacity'` al terminar evita styles inline
  residuales que rompan hover/focus posterior.

### Transiciones de vista (ViewSlot)
- `App.jsx`: nuevo componente `ViewSlot` con `useRef` +
  `useViewTransition({ preset:'fadeUp' })`. MainView retorna
  `<ViewSlot key={key}>{content}</ViewSlot>`. La key remontaje sigue
  garantizando que cada nueva vista dispare la transicion.
- `App.module.css`: removido `animation: ritmiq-fade-in-up` del
  `.viewSlot`. Se conserva `will-change: transform, opacity` para que
  el compositor reserve la capa.

### Stagger en HomeRow
- `HomeRow.jsx` usa el hook con `preset='stagger'` apuntando a la clase
  CSS-modules hasheada de los items. `staggerEach: 35ms`. Solo en primer
  mount (`deps=[]`). Items anadidos por paginacion no se re-animan.

## Bundle impact

| Stage | Precache | Main JS gzipped |
|---|---|---|
| Antes de 1.4 | 2191 KiB | ~251 KB |
| Despues de 1.4 | 2262 KiB | ~317 KB |
| Delta | +71 KiB | +66 KB |

GSAP core completo entra al primer import. Tree-shaking solo aplica a
plugins (ScrollTrigger, Flip, etc.) que no usamos todavia. En Fase 7
(performance) se puede code-splittear gsap de la ruta principal cargando
las transiciones perezosamente para usuarios que solo entran al share
link.

## Verificacion manual

1. **Tokens y reduced-motion** (todas las vistas):
   - macOS: System Settings \u2192 Accessibility \u2192 Display \u2192 Reduce motion ON.
   - Resultado: navegaciones instantaneas, sin fades ni slides.
   - OFF: comportamiento normal.

2. **Transicion de vista** (1.4):
   - Home \u2192 Library: la nueva vista hace fade-up sutil (~320ms).
   - Repetir navegacion: cada cambio reanima desde 0.
   - No quedan "fantasmas" de la vista anterior (clearProps al terminar).

3. **Stagger HomeRow** (1.5):
   - Recargar app o navegar a Home desde otra vista.
   - Cards de cada fila aparecen secuenciadas izquierda \u2192 derecha.
   - Scroll horizontal funciona normal post-animacion.

## Riesgos conocidos

- Si una vista monta otra cosa con animacion CSS propia (ej. modales,
  bottomsheets), pueden combinarse con la entrada de ViewSlot. La gran
  mayoria abren sobre overlays separados, no dentro del slot.
- GSAP fixed delay maximo: si el primer paint del browser tarda mas que
  el tween (320ms), la entrada se pierde. No deberia pasar con bundle
  actual; monitorear en device mobile.

## Siguiente fase

**Fase 2 \u2014 Quick wins visuales** (6 commits, ~10h):
- 2.1 splash pantalla de carga inicial.
- 2.2 `<CoverArt>` con gradient hash placeholder.
- 2.3 skeletons fieles por seccion.
- 2.4 progress bar player con gradient accent.
- 2.5 nowplaying cover breathing animation.
- 2.6 bottomsheet drag-to-dismiss real.
