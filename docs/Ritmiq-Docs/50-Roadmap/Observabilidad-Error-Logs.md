---
tipo: flujo
capa: flujo
plataforma: ambas
estado: pendiente
ultima-revision: 2026-05-29
tags: [roadmap, observabilidad, errores, debug, futuro]
---

# Observabilidad — captura de errores client-side

> Hoy no hay forma de saber qué falló en el cliente de otro usuario sin pedirle
> screenshots. Para debug remoto a escala (5+ usuarios), capturar errores no manejados a
> una tabla propia o a Sentry.

## Por qué se postergó

Para uso personal soy yo el único usuario: si algo falla, lo veo en la consola del
Desktop/DevTools. La observabilidad remota solo aporta valor cuando hay terceros usando la
app y no puedo pedirles que abran DevTools.

## Para qué sirve

Cuando un amigo diga "no me funciona", poder ver el error real (stack, URL, user-agent) sin
intermediarios. Acelera el diagnóstico de regresiones que solo aparecen en ciertos devices.

## Lo que falta (checklist)

### Opción A — `error_logs` propio (recomendada)

1. Tabla `error_logs` (`user_id`, `error`, `stack`, `url`, `ua`, `created_at`) + RLS
   owner-insert. ~20 min.
2. Global `window.onerror` + `unhandledrejection` que escribe a `error_logs`, rate-limited
   a 1/min por user para no spammear. ~30 min.
3. Lectura: query SQL ad-hoc en Supabase dashboard (lo más simple) o vista admin con
   querystring secreta. ~15 min.

### Opción B — Sentry free tier

- 5k errores/mes gratis, más profesional, pero añade dependencia externa y SDK al bundle.

**Recomendación**: Opción A para uso personal/familiar (menos deps, ya tengo Supabase,
suficiente para 5-20 users).

## Trigger para activar

- Cuando haya 5+ usuarios activos y no pueda depurar pidiendo screenshots.

## Esfuerzo estimado

~1h yo (Opción A).

## Riesgos a vigilar

- **Spam de logs**: sin rate-limit, un error en loop puede llenar la tabla. El rate-limit
  1/min por user lo mitiga.
- **PII**: no loguear tokens ni datos sensibles en el `stack`/`url`.

## Dependencias

- Supabase (tabla + RLS).
- Punto de init global en [[App|App.jsx]] o `main.jsx`.

## Notas / Changelog

- 2026-05-29: nota creada al postergar (foco en uso personal estable).
