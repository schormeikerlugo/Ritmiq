---
tipo: store
capa: ui
plataforma: ambas
estado: estable
ultima-revision: 2026-05-27
archivo: packages/ui/src/stores/settings.js
tags: [store, settings, audio, eq, crossfade, persistencia]
---

# `stores/settings.js`

> Settings persistentes de audio: crossfade y ecualizador (EQ). Persiste en `localStorage`. Cada cambio se aplica al backend de audio en tiempo real vía el hook [[use-apply-audio-settings]].

## Ubicación
`packages/ui/src/stores/settings.js:1` (116 líneas)

## Estado

```js
{
  crossfadeSeconds: number,   // 0..8
  eqEnabled: boolean,
  eqGains: number[6],         // dB por banda, cada una -12..+12
  eqPreset: string,           // 'flat'|'bass'|'vocal'|'rock'|'pop'|'classic'|'electro'|'custom'
}
```

## Constante exportada

```js
export const EQ_PRESETS: Record<string, number[6]>
```

7 presets predefinidos + `'custom'` (cuando el usuario ajusta una banda manualmente).

## Acciones

| Acción | Descripción |
|---|---|
| `setCrossfade(s)` | Clamp 0..8. Persiste. |
| `setEqEnabled(enabled)` | Persiste. |
| `setEqBand(idx, gainDb)` | Ajusta una banda (0..5). Pasa automáticamente a preset `'custom'`. |
| `setEqPreset(name)` | Aplica el array de gains del preset. Ignora si nombre no existe. |
| `resetAudio()` | Restaura DEFAULTS completos. |

## Anatomía del código (snippets clave)

### 1. `setEqBand` pasa a 'custom' automáticamente
`packages/ui/src/stores/settings.js:95-101`

```js
setEqBand(idx, gainDb) {
  if (idx < 0 || idx > 5) return;
  const gains = get().eqGains.slice();
  gains[idx] = clamp(gainDb, -12, 12);
  set({ eqGains: gains, eqPreset: 'custom' });
  persist(get());
},
```

**Por qué**: si el usuario tiene el preset "Rock" y mueve el slider de bajos, el preset deja de corresponder a su configuración. Mostrar "Rock" como preset activo con ganancias distintas sería confuso. `'custom'` es el indicador de "modificado por el usuario".

### 2. `readInitial`: clamp de valores guardados
`packages/ui/src/stores/settings.js:39-56`

```js
crossfadeSeconds: clamp(parsed.crossfadeSeconds ?? 0, 0, 8),
eqGains: Array.isArray(parsed.eqGains) && parsed.eqGains.length === 6
  ? parsed.eqGains.map((g) => clamp(Number(g) || 0, -12, 12))
  : DEFAULTS.eqGains.slice(),
```

**Por qué clamp al leer**: si una versión futura cambia los rangos válidos (ej. crossfade de 0..8 a 0..12), las preferencias guardadas con valor 10 serían inválidas. Clampear al leer previene que valores fuera de rango lleguen al backend de audio.

## Persistencia

| Clave | Formato |
|---|---|
| `ritmiq.settings.v1` | `{ crossfadeSeconds, eqEnabled, eqGains, eqPreset }` |

Versión `v1` en la clave permite migrar en el futuro con `v2` sin leer datos incompatibles.

## Relación con el motor de audio

Este store almacena **preferencias**, no aplica nada. La aplicación al backend ocurre en [[use-apply-audio-settings]] que observa el store y llama `howler.stereo()`, `howler.eq()`, etc.

## Qué puede romper este cambio

| Cambio | Síntoma observable |
|---|---|
| Quitar auto-`'custom'` en `setEqBand` | La UI muestra preset "Rock" aunque los gains sean distintos → confusión. |
| Cambiar `eqGains.length` a 10 | `readInitial` rechaza arrays guardados de 6 → fallback a `DEFAULTS`. Todos los usuarios pierden su EQ personalizado. |
| Quitar la clave `v1` | Si se cambia a `ritmiq.settings`, versiones viejas y nuevas leen del mismo bucket → incompatibilidades. |

## Notas / Changelog
- 2026-05-22: nivel medio.
- 2026-05-27 (Fase 4.5): nuevo setting `visualizerEnabled` (default `false`) + setter `setVisualizerEnabled(enabled)`. Persistido en localStorage junto al resto. Consumido por [[Visualizer]] vía [[NowPlaying]]. Commit `5f7ec2e`.
