---
tipo: adr
capa: meta
plataforma: ambas
estado: estable
ultima-revision: 2026-05-22
tags: [adr, decisiones]
---
# ADR — Decisiones Técnicas

Cada decisión sigue el formato:

> **ADR-NNN — Título**
> Contexto · Decisión · Consecuencias.

## ADR-001 — Monorepo pnpm + Turbo

- **Contexto**: dos clientes (Desktop, PWA) comparten ~80% del código de UI y lógica.
- **Decisión**: monorepo con `apps/*` y `packages/*` en pnpm workspaces + Turbo.
- **Consecuencias**: un solo `pnpm install`, scripts cacheados, riesgo de acoplar packages → mitigado con boundaries por dominio (ui/core/db/api/yt).

## ADR-002 — JavaScript + JSDoc en vez de TypeScript

- **Contexto**: Electron + Vite + nativos. TS suma fricción de build en multiplataforma.
- **Decisión**: JS ESM con JSDoc en módulos críticos (`core`, `db`, `yt`).
- **Consecuencias**: menos seguridad de tipos en compile-time, pero IntelliSense suficiente. Reevaluar si el proyecto crece > 50k LOC.

## ADR-003 — yt-dlp embebido solo en Desktop

- **Contexto**: PWA no puede ejecutar binarios. Resolver streams desde el cliente sería bloqueado por CORS.
- **Decisión**: Desktop usa yt-dlp local; PWA usa Edge Function [[resolve-stream]] + LAN del Desktop como fallback rápido.
- **Consecuencias**: dependencia de Edge Function en PWA (cuesta invocaciones), pero permite reproducir sin Desktop encendido.

## ADR-004 — Howler en Desktop, HTML Audio en PWA

- **Contexto**: iOS Safari tiene comportamientos peculiares con Web Audio y MediaSession.
- **Decisión**: Desktop usa [[howler-backend]]; PWA usa [[html-audio-backend]] directo.
- **Consecuencias**: dos backends que mantener pero ambos delgados detrás de la misma interfaz en [[player|core/player]].

## ADR-005 — Cloudflared para tunneling

- **Contexto**: usuario quiere escuchar fuera de casa sin VPN ni router config.
- **Decisión**: ejecutar `cloudflared` como subproceso del main de Desktop.
- **Consecuencias**: dependencia externa, pero gratis y estable. Alternativas evaluadas: tailscale, ngrok, propio relay. Documentado en [[cloudflared]].

## ADR-006 — Supabase como BaaS

- **Contexto**: necesitamos auth + DB + storage + realtime + edge functions sin operar infra.
- **Decisión**: Supabase (Postgres + Auth + Storage + Edge + Realtime).
- **Consecuencias**: vendor lock-in moderado (Postgres es portable, Auth y RLS no). Free tier alcanza para uso personal.

## ADR-007 — Zustand + TanStack Query

- **Contexto**: necesitábamos estado global ligero y cache de red.
- **Decisión**: Zustand para 16 slices (`player`, `library`, `social`, …) + TanStack Query para fetch.
- **Consecuencias**: stores muy granulares (ver [[MOC - UI Compartida]]); evita prop drilling.

---

> Agregá nuevos ADRs aquí cuando tomes decisiones que afecten la arquitectura.
