---
tipo: componente
capa: ui
plataforma: ambas
estado: estable
ultima-revision: 2026-05-27
archivo: packages/ui/src/components/SettingsView/sections/EqCurve.jsx
tags: [componente, eq, settings, svg, visualization]
---

# `<EqCurve>`

> SVG con la curva de respuesta combinada del EQ de 6 bandas. Reacciona en tiempo real a los sliders. Aproximación analítica (gaussianas + sigmoides) — **no** usa `BiquadFilter.getFrequencyResponse()` para no necesitar un `AudioContext` activo. Ver [[Decisiones-Tecnicas-ADR|ADR-013]].

## Ubicación
`packages/ui/src/components/SettingsView/sections/EqCurve.jsx:1` (~175 líneas)

## Props

```js
<EqCurve gains={[0, 2, 0, -1, 3, 0]} />
```

| Prop | Tipo | Notas |
|---|---|---|
| `gains` | `number[6]` | dB por banda en el orden de `EQ_BANDS`. Defaults a `[0,0,0,0,0,0]` si malformed |

## Setup gráfico

| Constante | Valor |
|---|---|
| `WIDTH` | 320 |
| `HEIGHT` | 80 |
| `DB_MIN` / `DB_MAX` | -12 / +12 |
| `FREQ_MIN` / `FREQ_MAX` | 20 Hz / 20 kHz |
| `SAMPLES` | 80 (puntos de la curva) |

## Eje X log-freq

```js
function freqToX(f) {
  const lf = Math.log10(f);
  // mapeo lineal de log10(20)..log10(20000) → [PAD_X, WIDTH-PAD_X]
}
```

## Función de respuesta por banda

| Tipo de banda | Aproximación |
|---|---|
| `peaking` | Gaussiana `gain * exp(-((lf-lfc)/width)²)` con `width = 1/Q / log2(10)` |
| `lowshelf` | Sigmoide logística `gain / (1 + exp(4 * dist))` |
| `highshelf` | Sigmoide logística `gain / (1 + exp(-4 * dist))` |

Suma de las 6 contribuciones por sample, clamp al rango [DB_MIN, DB_MAX].

## Render SVG

```jsx
<linearGradient id="ritmiq-eqcurve-fill" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0%" stopColor="var(--color-accent)" stopOpacity="0.35" />
  <stop offset="100%" stopColor="var(--color-accent)" stopOpacity="0" />
</linearGradient>

<!-- baseline 0 dB punteada -->
<!-- área rellena debajo de la curva (gradient accent fade-out) -->
<!-- curva con stroke accent 2px round -->
<!-- 6 dots en las freq de banda -->
```

## Dónde se usa

[[PlaybackSection]] en [[SettingsView]], **solo cuando `eqEnabled=true`**. Vive entre el `<SegmentedControl>` de presets y el grid de sliders.

## Por qué no `getFrequencyResponse`

La API correcta `BiquadFilterNode.getFrequencyResponse(freqs, magResponse, phaseResponse)` requiere:

1. Un `AudioContext` activo (problema iOS sin gesto previo).
2. Frecuencias precalculadas como `Float32Array`.
3. Output como magnitud lineal (no dB) → conversión adicional.

Para un indicador visual el coste no se justifica. La aproximación es suficiente para que el usuario vea la forma de la curva.

## Qué rompe esto

| Cambio | Impacto |
|---|---|
| Añadir una banda 7+ a `EQ_BANDS` | La curva calcula `EQ_BANDS.length`, automático. Re-validar tipografía dots |
| Cambiar el rango de dB | Ajustar `DB_MIN`/`DB_MAX` para mantener proporciones |
| Migrar a `BiquadFilter.getFrequencyResponse` | Hay que asegurar que el graph esté inicializado antes de renderizar |

## Casos de borde

- **Todos los gains a 0**: la curva queda plana sobre la baseline. Comportamiento correcto.
- **Gains saturados al máximo**: la curva golpea el techo `+12 dB` clamped; visualmente la cima se "aplana".

## Changelog

- 2026-05-27 — Creado en Fase 4.4. Commit `6b88414`.
