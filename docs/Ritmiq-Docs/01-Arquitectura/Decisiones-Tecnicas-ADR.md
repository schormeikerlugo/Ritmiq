---
tipo: adr
capa: meta
plataforma: ambas
estado: estable
ultima-revision: 2026-05-27
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

## ADR-008 — GSAP como motion engine

- **Contexto**: las transiciones CSS funcionaban pero no había una API uniforme para componer secuencias (stagger, timelines, cleanup en unmount React) ni un único lugar donde gestionar `prefers-reduced-motion`.
- **Decisión**: instalar `gsap@3.15.0` en `@ritmiq/ui` y centralizar todas las animaciones de entrada de vista vía el hook [[use-view-transition]]. Las animaciones de keyframes CSS se mantienen donde ya estaban (modales, BottomSheet) sin migrar.
- **Consecuencias**: +66 KB gzipped al bundle inicial. `gsap.matchMedia()` cubre reduced-motion automáticamente. Se evita añadir `@gsap/react` (otra dep) usando `useEffect + ctx.revert()` manual. Code-splitting de GSAP queda para Fase 7 si el peso molesta.

## ADR-009 — `CoverArt` primitive con gradient hash determinístico

- **Contexto**: tracks sin `coverUrl` mostraban un hueco gris o un icono `<Music>` plano. Las cards de la Home y la mini-player se veían rotas para tracks importados sin thumbnail.
- **Decisión**: nuevo primitive [[CoverArt]] que computa un gradient HSL a partir de un hash FNV-1a del `seed` (título o artista) + iniciales centradas. Mismo seed = mismo gradient siempre.
- **Consecuencias**: visualmente consistente entre sesiones. Migración incremental: el mini-player original quedó revertido a `<img>` directo para conservar el `vinyl-spin` animation (ver commit `270da70`). `CoverArt` se usa en `TrackCard`, `YtPlaylistView`, `HistoryView`, `MonthlyWrapped`.

## ADR-010 — Virtualización propia en `ListView` (sin react-window)

- **Contexto**: la `Library` con > 200 tracks empezaba a notar jank en mobile. Necesitábamos virtualización.
- **Decisión**: implementar la virtualización dentro de [[ListView]] con `ResizeObserver` + slice de items visibles + spacers top/bottom + throttle por `requestAnimationFrame`. **No** se instala `react-window` ni `@tanstack/react-virtual`.
- **Consecuencias**: 0 KB extra al bundle. Limitación V1: `itemHeight` uniforme. Si en el futuro hace falta altura variable, evaluar `@tanstack/react-virtual` (~10 KB gzip). El primitive es opt-in: `virtualize=false` por default para listas pequeñas.

## ADR-011 — `withRetry` con clasificación de errores transitorios

- **Contexto**: las llamadas a Edge Functions que dependen de Last.fm e Innertube tienen ~3% de tasa de error 5xx/429. Cada store manejaba el fallo distinto; el usuario veía `ErrorState` para errores que se resolverían en el siguiente intento.
- **Decisión**: helper genérico [[with-retry]] en `packages/ui/src/lib/`. Backoff exponencial 500ms→1s→2s con jitter 20%. Clasificador `defaultIsRetriable` reconoce 5xx/408/429 + `TypeError` de red. Integrado en `recommendations`, `artist`, `yt-playlist` stores.
- **Consecuencias**: errores transitorios desaparecen del UX sin coste perceptible. Cancellation via `AbortSignal`. Es responsabilidad del caller decidir maxAttempts (default 3). El bundle delta es despreciable (~1 KB).

## ADR-012 — Crossfade simulado con dos fades secuenciales

- **Contexto**: el usuario quería transiciones suaves entre tracks. Crossfade real requiere dos `<audio>` solapados + WebAudio graph + reescritura del flujo en [[use-player|use-player.js]]. El flujo actual es delicado en iOS background.
- **Decisión**: componer dos fades sobre el único `<audio>` existente:
  1. **fade-OUT** cuando `positionSeconds` entra en `dur - crossfadeSeconds`.
  2. **fade-IN** cuando arranca el nuevo `currentTrack`.
  Ambos en [[use-crossfade]] vía `setInterval @ 30Hz` para resistir background throttling de Electron.
- **Consecuencias**: percepción de cruce continuo sin tocar el backend de audio. **No es crossfade real** — está documentado explícitamente en el header del hook. Si en el futuro se justifica el coste de duplicar `<audio>`, hacerlo en un commit propio con su propio ADR.

## ADR-013 — Curva del EQ aproximada con gaussianas y sigmoides

- **Contexto**: el EQ ya existía (6 bandas BiquadFilter). Faltaba visualizar la forma de la curva combinada para que el usuario entienda qué hace cada preset.
- **Decisión**: componente [[EqCurve]] que suma respuestas analíticas:
  - `peaking` → gaussiana en escala log-freq con ancho derivado del Q.
  - `lowshelf` / `highshelf` → sigmoide (logística).
  - 80 samples interpolados, eje X log10(20Hz..20kHz), eje Y dB clamped al rango de sliders.
- **Consecuencias**: SVG estático que reacciona en tiempo real a los sliders sin tocar `AudioContext`. **No reproduce la respuesta exacta de BiquadFilter** — la API correcta sería `BiquadFilterNode.getFrequencyResponse()`, pero requiere un graph activo y muestreo en cada cambio. Aceptable porque el componente es un **indicador visual**, no un analizador profesional.

## ADR-014 — Drag-and-drop con HTML5 native (no dnd-kit cross-context)

- **Contexto**: `@dnd-kit` ya está en uso en `PlaylistView` y `QueuePanel` para sortable interno. Necesitábamos drag desde `Library` hacia los items del `Sidebar` (cross-context entre dos zonas con su propio scroll).
- **Decisión**: usar HTML5 native drag API con MIME custom `application/x-ritmiq-track`. `Library` rows: `draggable=true` + `setData`. `Sidebar` playlist items: `onDragOver`/`onDrop`. Highlight visual con `data-drag-over=true`.
- **Consecuencias**: 0 KB extra. Cero interferencia con el sortable de dnd-kit. Funciona en desktop (mouse) y mobile WebView (touch). Si en el futuro queremos `DragOverlay` consistente con el resto, migrar `PlaylistView` también a HTML5 o aceptar la heterogeneidad.

## ADR-015 — Lazy-init del WebAudio graph + auto-init en gestos de usuario

- **Contexto**: el backend [[html-audio-backend]] crea el `AudioContext + MediaElementSource + Analyser` solo cuando alguien llama a `ensureGraph()`. Una vez creado, el audio del `<audio>` pasa siempre por el graph (no se puede volver atrás). Riesgo de regresión en iOS background → init lazy deliberado.
- **Decisión**: cada feature que requiere el `AnalyserNode` (EQ, Visualizer, BPM Pulse) tiene la responsabilidad de invocar `backend.initGraphFromGesture()` **sincrónicamente dentro de un onClick** del usuario. iOS Safari y Electron requieren ese token de gesto para hacer `resume()` del AudioContext.
- **Consecuencias**: si el toggle no se activa dentro de un gesto, el graph queda `suspended` → silencio. El patrón se replica en `PlaybackSection.handleEqToggle` y `NowPlaying.handleVisualizerToggle`. [[use-bpm-pulse]] usa polling de re-attach hasta 8 veces para enganchar al graph cuando otro feature lo cree después.

---

> Agregá nuevos ADRs aquí cuando tomes decisiones que afecten la arquitectura.
