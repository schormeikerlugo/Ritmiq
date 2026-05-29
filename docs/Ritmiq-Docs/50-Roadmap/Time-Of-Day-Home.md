---
tipo: flujo
capa: flujo
plataforma: ambas
estado: pendiente
ultima-revision: 2026-05-29
tags: [roadmap, home, recomendaciones, ux, futuro]
---

# Time-of-Day en Home (contextual por hora)

> El lib [[time-of-day]] existe (Fase 5) y categoriza la hora actual en
> `morning/afternoon/evening/night`, pero **no está conectado al Home**. Activarlo da un
> saludo dinámico y sesga la primera fila según el momento del día.

## Por qué se postergó

No es crítico para uso personal estable. Es una mejora de "sensación de que la app me
conoce" que aporta más al impacto de primera impresión (distribución) que al uso diario.

## Para qué sirve

- Saludo contextual ("Buenos días" / "Para terminar el día") en el [[Home]] header.
- Primera fila sesgada por momento: mañana → energético; tarde → enfoque; noche → relax.
- Sensación de personalización desde el día 1, incluso sin datos de Spotify.

## Lo que falta (checklist)

1. En [[Home|Home.jsx]], importar `getTimeOfDay()` de [[time-of-day]] y usarlo en el header
   (saludo dinámico). ~15 min.
2. Sesgar la primera `HomeRow` según slot:
   - `morning` → "Mix energético"
   - `afternoon` → "Para enfocarte"
   - `evening`/`night` → "Para relajarte"
   ~30 min.
3. La edge `auto-genre-mix` ya acepta parámetro `mood` — pasarle el slot para ordenar por
   valence/energy. ~15 min.

## Trigger para activar

- Cuando quiera mejorar la primera impresión (antes de mostrar Ritmiq a alguien), o
- Junto con la activación de Spotify (sinergia: más datos = moods más fieles).

## Esfuerzo estimado

~1h yo.

## Riesgos a vigilar

- **Poca data en `play_history`**: los moods degeneran a género dominante. Aceptable — es
  la misma fila genérica que se muestra hoy.

## Dependencias

- [[time-of-day]] (ya existe).
- [[Home]] (HomeHeader + primera HomeRow).
- Edge `auto-genre-mix` (param `mood` ya soportado).

## Notas / Changelog

- 2026-05-29: nota creada al postergar (foco en uso personal estable).
