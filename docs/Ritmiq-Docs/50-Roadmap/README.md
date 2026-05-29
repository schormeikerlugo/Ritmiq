---
tipo: flujo
capa: meta
plataforma: ambas
estado: pendiente
ultima-revision: 2026-05-29
tags: [roadmap, futuro, indice]
---

# 50 — Roadmap / Features Futuras

> Carpeta viva de trabajo **postergado conscientemente**, no cancelado. Cada nota explica
> qué es, por qué se dejó para después, cuál es el trigger para retomarlo y cuánto cuesta.
> Si vuelvo en 3 meses, abro la nota y recupero todo el contexto sin reconstruir el razonamiento.

## Contexto

Las 8 fases del plan general están completas (~60 commits). El objetivo actual es **uso
personal estable**, por lo que todo lo orientado a **distribución a terceros** quedó fuera
de scope inmediato. Esta carpeta lo preserva.

## Notas

| Nota | Qué es | Esfuerzo | Trigger para activar |
|---|---|---|---|
| [[Activar-Spotify-OAuth]] | Conectar Spotify (lectura) para enriquecer recomendaciones | ~4-5h | Cuando invite al primer amigo o quiera resolver mi propio cold start |
| [[Time-Of-Day-Home]] | Home contextual por hora del día (saludo + mood de la primera fila) | ~1h | Cuando quiera una primera impresión más "personal" |
| [[Onboarding-Para-Distribucion]] | Flow guiado para usuarios nuevos + Android install + privacy | ~3h | Antes de invitar a alguien que no soy yo |
| [[Observabilidad-Error-Logs]] | Captura de errores client-side para debug remoto | ~1h | Cuando haya 5+ usuarios y no pueda pedir screenshots |
| [[Distribucion-Amigos-Plan]] | Plan agregador de los 4 bloques anteriores con orden de ejecución | meta | Cuando decida abrir Ritmiq a amigos/familia |

## Otras ideas sueltas (no priorizadas)

- **Cron jobs por timezone**: los 3 cron de daily mix corren en UTC (04:00/04:15/04:30).
  Si hay usuarios fuera de mi zona, las recs no llegan "a su hora". Requiere columna
  `timezone` en `profiles` + cron per-user o agrupado por offset.
- **`yt-recs.track.tags` + `reorderByMood`**: funciones cliente inertes esperando que el
  server emita tags por track. Activar modificando `yt-recs` para incluir tags via
  `enrich-tags` o Last.fm `track.getInfo`. ~2h.
- **Crossfade real** (dos `<audio>` solapados + WebAudio graph). Ver [[Decisiones-Tecnicas-ADR|ADR-012]].
- **`react-virtual` para altura variable** en [[ListView]] si hace falta. Ver ADR-010.
- **Playwright V2** (Auth/Play/Share flows + CI gate). Ver ADR-018.

## Reglas de esta carpeta

1. Una feature postergada = una nota.
2. `estado: pendiente` en el frontmatter de todas.
3. Cuando una se implemente: mover la nota a su carpeta definitiva (ej. Edge-Functions),
   cambiar `estado: estable`, y borrar la entrada de la tabla de arriba.
