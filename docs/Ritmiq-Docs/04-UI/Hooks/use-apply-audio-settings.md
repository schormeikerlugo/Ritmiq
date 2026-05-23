---
tipo: hook
capa: ui
plataforma: ambas
estado: estable
ultima-revision: 2026-05-22
archivo: packages/ui/src/lib/use-apply-audio-settings.js
tags: [hook, audio, eq, settings]
---

# `useApplyAudioSettings(backend)`

> Suscribe al [[settings]] store y aplica EQ gains al backend de audio cada vez que cambian. No inicializa el WebAudio graph — solo aplica si ya existe.

## Ubicación
`packages/ui/src/lib/use-apply-audio-settings.js:1` (36 líneas)

## Firma

```js
function useApplyAudioSettings(
  backend: ReturnType<typeof createHtmlAudioBackend>
): void
```

## Anatomía (archivo completo)

`packages/ui/src/lib/use-apply-audio-settings.js:22-35`

```js
export function useApplyAudioSettings(backend) {
  useEffect(() => {
    if (!backend) return;
    function apply(state) {
      if (!backend.isGraphReady?.()) return;  // no-op si WebAudio no está listo
      backend.setEqEnabled(state.eqEnabled);
      backend.setEqGains(state.eqGains);
    }
    apply(useSettingsStore.getState());           // aplica el estado actual al montar
    const unsub = useSettingsStore.subscribe((state) => apply(state)); // suscripción
    return () => unsub();
  }, [backend]);
}
```

**Por qué `isGraphReady()`**: el WebAudio graph solo existe tras un gesto de usuario (`backend.initGraphFromGesture()`). Antes de eso, `setEqEnabled`/`setEqGains` serían no-op en el backend, pero hacer guard aquí evita llamadas redundantes y warnings innecesarios.

**Por qué `apply(getState())` al montar**: la suscripción solo reacciona a cambios futuros. Si el usuario ya tenía EQ configurado en el store antes de que se montara el hook, el `apply` inicial lo aplica de inmediato.

## Casos de borde

- **`backend` null al montar**: guard `if (!backend) return`. Sucede si el engine aún no creó el backend (muy breve ventana al inicio).
- **WebAudio no inicializado**: el usuario puede cambiar sliders de EQ antes de reproducir. Los cambios quedan en el store pero no se aplican hasta que se crea el graph (primer gesto → play).

## Dependencias entrantes
- [[App]] (o el nivel donde se monta el engine) lo llama con el backend singleton.

## Dependencias salientes
- [[settings]] store → `subscribe`, `getState`.
- [[html-audio-backend]] → `isGraphReady`, `setEqEnabled`, `setEqGains`.

## Notas / Changelog
- 2026-05-22: nivel simple.
