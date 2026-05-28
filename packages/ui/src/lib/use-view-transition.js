/**
 * useViewTransition — hook reusable para transiciones de entrada de
 * componentes/vistas. Envoltorio fino sobre GSAP que:
 *
 *   1. Aplica un preset de entrada al montar (o cuando cambian `deps`).
 *   2. Respeta `prefers-reduced-motion` via gsap.matchMedia: si esta
 *      activo, los elementos aparecen instantaneamente sin tween.
 *   3. Cleanup automatico en unmount (ctx.revert) \u2014 mata tweens
 *      pendientes y restaura inline styles.
 *
 * API:
 *   const ref = useRef(null);
 *   useViewTransition(ref, { preset: 'fadeUp', deps: [view.kind] });
 *
 *   <div ref={ref}>...</div>
 *
 * Presets disponibles:
 *   'fadeUp'       \u2014 opacity 0 + y +12px \u2192 opacity 1 + y 0 (default).
 *   'fadeIn'       \u2014 solo opacity 0 \u2192 1.
 *   'fadeUpLg'     \u2014 fadeUp con desplazamiento mayor (24px) para hero.
 *   'stagger'      \u2014 anima los hijos directos con stagger 40ms.
 *
 * @param {React.RefObject<HTMLElement>} ref Contenedor a animar (o que
 *   contiene a los hijos cuando preset='stagger').
 * @param {{
 *   preset?: 'fadeUp' | 'fadeIn' | 'fadeUpLg' | 'stagger',
 *   deps?: any[],
 *   duration?: number,         segundos. default 0.32 (alineado --duration-lg).
 *   delay?: number,            segundos. default 0.
 *   childSelector?: string,    para preset='stagger'. default ':scope > *'.
 *   staggerEach?: number,      segundos entre hijos. default 0.04.
 *   disabled?: boolean,        si true, no hace nada.
 * }} [opts]
 */
import { useEffect } from 'react';
import { gsap } from 'gsap';

const DEFAULT_DURATION = 0.32; // 320ms \u2014 alineado con --duration-lg
const DEFAULT_STAGGER  = 0.04;
const FADE_UP_Y        = 12;
const FADE_UP_LG_Y     = 24;

export function useViewTransition(ref, opts = {}) {
  const {
    preset = 'fadeUp',
    deps = [],
    duration = DEFAULT_DURATION,
    delay = 0,
    childSelector = ':scope > *',
    staggerEach = DEFAULT_STAGGER,
    disabled = false,
  } = opts;

  useEffect(() => {
    if (disabled) return undefined;
    const node = ref?.current;
    if (!node) return undefined;

    // gsap.matchMedia gestiona prefers-reduced-motion automaticamente:
    // si reduceMotion=true, la branch correspondiente se ejecuta. Aqui la
    // usamos para garantizar que el SO setting es respetado sin lecturas
    // manuales de window.matchMedia. Cleanup automatico de la mm tambien.
    const mm = gsap.matchMedia();

    mm.add({
      reduceMotion: '(prefers-reduced-motion: reduce)',
      defaultMotion: '(prefers-reduced-motion: no-preference)',
    }, (context) => {
      const { reduceMotion } = context.conditions;

      if (reduceMotion) {
        // Reduced motion: sin tween, solo garantizar estado final visible.
        // Algunos presets podrian dejar opacity:0 si no limpiamos.
        gsap.set(node, { clearProps: 'all' });
        if (preset === 'stagger') {
          const kids = node.querySelectorAll(childSelector);
          gsap.set(kids, { clearProps: 'all' });
        }
        return;
      }

      // Animacion normal.
      if (preset === 'fadeIn') {
        gsap.fromTo(
          node,
          { opacity: 0 },
          { opacity: 1, duration, delay, ease: 'power2.out', clearProps: 'opacity' },
        );
      } else if (preset === 'fadeUpLg') {
        gsap.fromTo(
          node,
          { opacity: 0, y: FADE_UP_LG_Y },
          { opacity: 1, y: 0, duration, delay, ease: 'power3.out', clearProps: 'transform,opacity' },
        );
      } else if (preset === 'stagger') {
        const kids = node.querySelectorAll(childSelector);
        if (kids.length === 0) return;
        gsap.fromTo(
          kids,
          { opacity: 0, y: FADE_UP_Y },
          {
            opacity: 1,
            y: 0,
            duration,
            delay,
            ease: 'power2.out',
            stagger: staggerEach,
            clearProps: 'transform,opacity',
          },
        );
      } else {
        // 'fadeUp' default
        gsap.fromTo(
          node,
          { opacity: 0, y: FADE_UP_Y },
          { opacity: 1, y: 0, duration, delay, ease: 'power2.out', clearProps: 'transform,opacity' },
        );
      }
    });

    return () => {
      // mm.revert() kills todos los tweens creados dentro del matchMedia
      // y restaura inline styles. Esto es lo que hace gsap.context() pero
      // limitado a las animaciones de este hook.
      mm.revert();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset, duration, delay, disabled, ...deps]);
}
