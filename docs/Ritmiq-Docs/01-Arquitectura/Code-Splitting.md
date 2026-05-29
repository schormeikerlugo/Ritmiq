---
tipo: modulo
capa: meta
plataforma: pwa
estado: estable
ultima-revision: 2026-05-28
archivo: packages/ui/src/App.jsx
tags: [performance, bundle, code-splitting, react-lazy, suspense]
---

# Code-Splitting

> Estrategia de splitting de la PWA: vistas frecuentes en el bundle inicial, vistas raras en chunks lazy via `React.lazy + Suspense`. Implementado en Fases 7.1 y 7.2. Ver [[Decisiones-Tecnicas-ADR|ADR-016]].

## Estado actual (post-Fase 7.2)

| Métrica | Valor |
|---|---|
| Bundle inicial raw | 931 KB |
| Bundle inicial gzipped | 287 KB |
| Chunks lazy generados | 13 |
| Peso total lazy (raw) | ~144 KB |

## Catálogo

### Eager (en el bundle inicial)

| Componente | Razón |
|---|---|
| [[Home]] | Primera vista que ve el user logueado |
| [[Library]] | Segunda vista más visitada |
| [[PlaylistView]] | Click frecuente desde Sidebar |
| [[SearchView]] | Trigger desde TopBar siempre disponible |
| [[Player]] | Always-mounted bottom |
| [[TopBar]] | Always-mounted top |
| [[Sidebar]] | Always-mounted desktop |
| [[BottomNav]] | Always-mounted mobile |
| [[NowPlaying]] | Mount cuando user toca el mini-player; modal grande |
| [[QueuePanel]] | Toggle frecuente |
| [[BottomSheetHost]] | Container global |
| [[ToastHost]] | Container global |
| [[Downloads]] | Vista pequeña, navegación común |
| [[SharedView]] | Landing pública del share link |

### Lazy (chunks separados)

| Chunk | Raw | Trigger |
|---|---|---|
| `SettingsView` | 72 KB | User abre Ajustes |
| `FriendsView` | 12 KB | User abre Amigos |
| `AuthScreen` | 10.8 KB | Logout o primer ingreso |
| `StatsView` | 10 KB | User abre Stats |
| `YtPlaylistView` | 6.6 KB | Click playlist YT desde Search |
| `ArtistView` | 6.2 KB | User navega a un artista |
| `AlbumView` | 5.3 KB | User navega a un álbum |
| `MonthlyWrapped` | 5.0 KB | 1 vez al mes (auto-trigger) |
| `ProfileView` | 5.0 KB | User abre perfil de amigo |
| `HistoryView` | 4.3 KB | User abre historial |
| `Onboarding` | 3.0 KB | 1 vez por device |
| `ResetPasswordView` | 3.0 KB | Solo si llega vía link recovery |
| `ShortcutsHelp` | 1.1 KB | User pulsa `?` |

## Patrón

### Para named exports

```js
const Foo = lazy(() => import('./components/Foo/Foo.jsx')
  .then((m) => ({ default: m.Foo })));
```

`.then(m => ({ default: m.X }))` es **necesario** porque `React.lazy` espera un dynamic import que resuelva a `{ default: Component }`, pero los componentes Ritmiq usan named exports.

### Suspense con skeleton

```jsx
<Suspense fallback={<TrackRowSkeleton count={6} />}>
  <SettingsView />
</Suspense>
```

Para vistas con UI visible.

### Suspense con null fallback

```jsx
<Suspense fallback={null}>
  <Onboarding />
</Suspense>
```

Para componentes invisibles condicionalmente (deciden internamente si renderizar). El splash inline del `index.html` o el componente padre ya provee el visual durante la descarga.

## Decisión: qué se lazyfica

| Criterio | Decisión |
|---|---|
| Vista visible en el primer paint | **eager** |
| Vista usada > 1 vez por sesión típica | **eager** |
| Vista usada < 1 vez por semana típica | **lazy** |
| Vista que tiene > 10 KB raw | **lazy** (independiente de frecuencia) |
| Componente que decide internamente si renderizar (auto-triggers) | **lazy** con `fallback={null}` |

## Cómo medir

```bash
cd apps/pwa
pnpm run build
ls -la dist/assets/*.js | sort -k 5 -n
```

El bundle principal (`index-*.js`) debe estar < 1 MB raw / 300 KB gzipped.

```bash
# Tamaño gzipped
gzip -c dist/assets/index-*.js | wc -c
```

## Cuándo añadir un chunk lazy nuevo

1. Componente nuevo > 10 KB raw → lazy desde el inicio.
2. Vista que claramente cae en "< 1 vez por semana" → lazy.
3. Componente que es null la mayoría del tiempo (auto-triggers) → lazy con fallback null.

Para añadir uno nuevo:

1. En `App.jsx`, eliminar el import estático.
2. Agregar `const X = lazy(() => import('...').then(m => ({ default: m.X })));`.
3. Envolver el render en `<Suspense fallback={...}>`.
4. Build y verificar que el chunk aparece en `dist/assets/`.
5. Documentar en este archivo bajo "Lazy".

## Service Worker + chunks

Workbox precachea **todos** los chunks (eager + lazy) automáticamente. La 2da sesión del user, todos los chunks ya están en cache → navegar a Settings es instantáneo.

`precache` final: 67 entries / 2320 KB (incluye chunks + assets + iconos + manifest).

## Qué rompe esto

| Cambio | Síntoma |
|---|---|
| Importar una vista lazy desde otro componente eager | El chunk se vuelve eager por dependencia |
| Cambiar `m.X` por `m.default` cuando el componente es named export | Runtime error: `undefined is not a function` |
| Quitar Suspense | React lanza error de "component suspended" |

## Changelog

- 2026-05-28 — Documentado tras Fase 7.1 (commit `8cfe9c1`) + Fase 7.2 (commit `2df884c`).
