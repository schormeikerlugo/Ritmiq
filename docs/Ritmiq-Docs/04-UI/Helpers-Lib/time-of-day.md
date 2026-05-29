---
tipo: modulo
capa: ui
plataforma: ambas
estado: estable
ultima-revision: 2026-05-27
archivo: packages/ui/src/lib/time-of-day.js
tags: [helper, recommendations, mood, hour, locale, home]
---

# `lib/time-of-day`

> Heurística pura que reordena recomendaciones según la hora local del usuario. Genera bias **suave** (no filtra) hacia tracks energéticos en la mañana y mellow en la noche. Saludo dinámico + titles contextuales.

## Ubicación
`packages/ui/src/lib/time-of-day.js:1` (~155 líneas)

## Exports

| Función | Descripción |
|---|---|
| `getTimeOfDay(date?)` | `'morning' \| 'afternoon' \| 'evening' \| 'night'` |
| `getMoodBias(date?)` | `'energetic' \| 'mellow' \| null` (afternoon = null) |
| `getGreeting(date?)` | Saludo en español ("Buenos días", etc.) |
| `getMoodSubtitle(tod?)` | Subtitle contextual para una fila |
| `reorderByMood(tracks, opts?)` | Ordena no destructivo según mood |

## Franjas horarias

| Franja | Horario | Mood |
|---|---|---|
| `morning` | 06:00-11:59 | `energetic` |
| `afternoon` | 12:00-17:59 | `null` (sin bias) |
| `evening` | 18:00-22:59 | `mellow` |
| `night` | 23:00-05:59 | `mellow` |

## `reorderByMood`

```js
const reordered = reorderByMood(tracks, { mood: 'energetic' });
// score = -idx + trackMoodScore(track, mood)
// sort desc
// retorna nuevo array (input no mutado)
```

**No filtra**: nunca elimina un track. Solo sube los que matchean y baja los opuestos. Bias máximo ±1.0; preserva la variedad y el orden raw del server para los top tracks.

## `trackMoodScore` (heurística)

```js
for tag in track.tags:
  if mood === 'energetic':
    if tag in ENERGETIC → matchedSame++
    if tag in MELLOW    → matchedOpposite++
  // y vice versa para mellow
return matchedSame * 1.0 - matchedOpposite * 0.5;
```

### `ENERGETIC_TAGS`
`rock`, `pop`, `hip-hop`, `electronic`, `reggaeton`, `salsa`, `funk`, `metal`, etc.

### `MELLOW_TAGS`
`ambient`, `chill`, `lofi`, `jazz`, `classical`, `acoustic`, `bossa nova`, etc.

## Estado actual: **inert hasta que el server devuelva `track.tags`**

`trackMoodScore` lee `track.tags`. Hoy [[recommendations]] no devuelve tags por track → el score siempre es 0 → `reorderByMood` mantiene el orden original.

**Puerta trasera deliberada**: cuando se añada `tags` al payload del server (Fase 6 o un commit dedicado), la heurística empieza a funcionar SIN tocar este lib ni los consumers.

## Quién usa esto

| Componente | Uso |
|---|---|
| [[Home]] | `getGreeting()` para el header, `getMoodBias()` para reordenar `genreRec`/`discoverRec`, `getTimeOfDay()` para titles ("Para empezar el día" / "Para la noche"). |

## Qué rompe esto

| Cambio | Impacto |
|---|---|
| Cambiar las franjas horarias | Usuarios ven greetings diferentes al esperado |
| Cambiar los pesos del score (1.0 / -0.5) | Bias se vuelve muy agresivo (filtra de facto) o desaparece |
| Mover ENERGETIC/MELLOW a una edge function | Reordering deja de ser instantáneo en cliente |

## Casos de borde

- **Track sin `tags`**: score = 0; mantiene posición original.
- **Track con tags mixtos** (ej. "indie rock acoustic"): se cancelan parcialmente. Si predomina un mood se ve reflejado.
- **`mood = null` (afternoon)**: retorna el array original sin tocar.

## Changelog

- 2026-05-27 — Creado en Fase 5.4. Commit `bae3b42`.
