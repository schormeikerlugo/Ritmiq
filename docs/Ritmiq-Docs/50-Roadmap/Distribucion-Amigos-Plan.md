---
tipo: flujo
capa: flujo
plataforma: ambas
estado: pendiente
ultima-revision: 2026-05-29
tags: [roadmap, distribucion, plan, futuro]
---

# Plan — Distribución a amigos / familia

> Plan agregador que reúne las features postergadas. Cuando decida abrir Ritmiq a personas
> cercanas, este es el orden de ejecución. Llevar Ritmiq de "feature-complete personal" a
> "distribuible sin que la primera impresión sea mala".

## Por qué se postergó

El objetivo actual es **uso personal estable**. Este plan se activa cuando la meta cambie a
distribución.

## Bloques (orden recomendado)

| Orden | Bloque | Nota detallada | Esfuerzo |
|---|---|---|---|
| 1 | Hardening previo (rotar token, validar AppImage, revisar RLS de las 18 tablas) | — | ~30 min |
| 2 | Activar Spotify completo (resuelve cold start) | [[Activar-Spotify-OAuth]] | ~4-5h |
| 3 | Time-of-day en Home | [[Time-Of-Day-Home]] | ~1h |
| 4 | Onboarding + Android install + privacy | [[Onboarding-Para-Distribucion]] | ~3h |
| 5 | Observabilidad mínima | [[Observabilidad-Error-Logs]] | ~1h |
| 6 | Build final + deploy + invitar 1-2 beta | — | manual |

**Total estimado**: ~10-13h implementación + 1-2h acciones manuales.

## Calendario sugerido

| Día | Trabajo |
|---|---|
| 1 | Bloque 1 (hardening) |
| 2-3 | Bloque 2 (Spotify) |
| 3 | Bloque 3 (time-of-day) |
| 4 | Bloque 4 (onboarding) |
| 5 | Bloque 5 (observabilidad) |
| 6 | Build + deploy + beta |
| 7+ | Iterar sobre feedback real |

## Decisiones pendientes (resolver al activar)

- Spotify con `client_secret` (recomendado) o PKCE puro.
- Observabilidad: `error_logs` propio (recomendado) o Sentry.
- Onboarding step "conectar fuente": obligatorio o skippeable (recomendado skippeable).
- Dominio prod confirmado para redirect URIs (`ritmiq.app`).
- Nº de amigos en primera ronda (define si activar observabilidad desde el día 1).

## Lo que queda explícitamente fuera de este plan

- Jam mode avanzado → **ya implementado** en uso personal (ver [[Jam-Mode]]).
- Docs F6+F8 → **ya documentado** en uso personal.
- Cron por timezone, `yt-recs.track.tags`, Playwright V2 → ver [[README]] de esta carpeta.

## Notas / Changelog

- 2026-05-29: plan creado al postergar la distribución (foco en uso personal estable).
