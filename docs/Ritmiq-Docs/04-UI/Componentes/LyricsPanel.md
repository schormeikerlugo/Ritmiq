---
tipo: componente
capa: ui
plataforma: ambas
estado: estable
ultima-revision: 2026-05-27
archivo: packages/ui/src/components/NowPlaying/LyricsPanel.jsx
tags: [componente, lyrics, now-playing, sync, scroll]
---

# `<LyricsPanel>`

> Panel de letras sincronizadas dentro de [[NowPlaying]]. Se renderiza **post-fold** sustituyendo al [[ArtistInfoPanel|Acerca del artista]] cuando `lyricsOpen=true`. Click en línea hace seek al tiempo correspondiente.

## Ubicación
`packages/ui/src/components/NowPlaying/LyricsPanel.jsx:1` (~190 líneas)

## Props

```js
<LyricsPanel track={currentTrack} />
```

| Prop | Tipo | Notas |
|---|---|---|
| `track` | `Track` | Debe tener `artist` y `title`; `durationSeconds` opcional |

## Stores consumidos

| Fuente | Uso |
|---|---|
| [[lyrics|stores/lyrics.js]] | `fetch({ artist, title, duration })`, `entries[key]` |
| [[player]] store | `positionSeconds`, `patch` (para seek) |

## Estados visuales

1. **Loading**: skeleton 3 líneas con shimmer.
2. **Error**: `<AlertCircle>` + mensaje.
3. **Instrumental**: badge "Instrumental".
4. **Not found**: mensaje "No encontramos letra para esta canción".
5. **Synced (`parsed.length > 0`)**: lista con línea activa resaltada + scroll auto.
6. **Plain only**: `<pre>` scrollable.

## Línea activa

```js
function findActiveLineIdx(parsed, positionMs) {
  // Binary search O(log n) por la última línea cuyo timeMs <= positionMs
}
```

Recompute en cada cambio de `positionSeconds` (el player ya lo throttle a ~4Hz).

## Auto-scroll

```js
useEffect(() => {
  const el = activeRef.current;
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
}, [activeIdx]);
```

El ancestor scrollable más cercano es el `.root` de [[NowPlaying]]. El `.lineItem` tiene `scroll-margin-top/bottom: 30vh` para que el scroll centre correctamente respecto al viewport.

## Click en línea

```js
const seekToSeconds = (seconds) => {
  patch({ positionSeconds: seconds });
  window.dispatchEvent(new CustomEvent('ritmiq:seek', { detail: { seconds } }));
};
```

Replica el patrón de [[NowPlaying]] `onScrubCommit`: actualiza el store + dispatch del evento custom que [[use-player]] consume para llamar a `backend.seek()`.

## Cómo se activa

[[NowPlaying]] footer → botón `Music2` (data-active accent cuando activo) → toggle `lyricsOpen`. Cuando `true`:

- `hasLowerPanel = true` (mantiene min-height del mainArea).
- `<LyricsPanel>` reemplaza a `<ArtistInfoPanel>` post-fold.

## Estilo activo de línea

```css
.lineActive {
  color: var(--color-text-1);
  font-weight: var(--fw-bold);
  font-size: clamp(var(--fs-lg), 4vw, var(--fs-2xl));
}
.lineNear { opacity: 0.85; }
.lineFar  { opacity: 0.45; }
```

## Qué rompe esto

| Cambio | Impacto |
|---|---|
| Cambiar el `key` del lookup en el store | Cache miss; re-fetch innecesario |
| Quitar `scroll-margin` | El scroll auto centra mal |
| Cambiar `findActiveLineIdx` a O(n) linear | Imperceptible (líneas < 200) pero cuesta cuando se hace en cada frame |

## Casos de borde

- **Track sin letra (lrclib 404)**: estado "Not found" — mensaje informativo.
- **Track instrumental marcado en lrclib**: estado "Instrumental".
- **`parsed` con un único timestamp** (canción de una línea o LRC raro): se renderiza la línea sin auto-scroll efectivo.
- **`positionSeconds` excede el último `timeMs`** (final del track): línea activa = última. Sin scroll adicional.

## Changelog

- 2026-05-27 — Creado en Fase 4.2. Commits `555231e` (UI inicial) + `1220428` (reposicionado a panel inferior).
- 2026-05-29 — Fix UX desktop: en el panel lateral (`min-width:769px`) la letra **se solapaba con el header** del [[NowPlaying]] (el `margin-bottom` del header no separa porque vive en `.mainArea`, contenedor hermano del panel). Añadidos estilos desktop a `.panel`: `padding-top: space-3` (separación del header divisor), `padding-bottom: space-6`, tipografía contenida (`.lineActive` clamp md→lg, `.lineItem` fs-sm) por el ancho estrecho (380px). Verificado con screenshot Playwright (chromium headless). Se descartó `position:sticky` en `.head` porque tapaba el header al scrollear.
