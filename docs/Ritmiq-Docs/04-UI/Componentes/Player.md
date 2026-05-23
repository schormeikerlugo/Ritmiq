---
tipo: componente
capa: ui
plataforma: ambas
estado: estable
ultima-revision: 2026-05-22
archivo: packages/ui/src/components/Player/Player.jsx
tags: [componente, player, miniplayer, desktop, mobile]
---

# `Player`

> Mini-player persistente (barra inferior en desktop / overlay en mobile). Muestra cover giratoria, título/artista, controles play/pause/prev/next, volumen, shuffle, repeat, favorito y acciones "guardar" y "compartir". Tap en cover/meta → abre [[NowPlaying]].

## Ubicación
`packages/ui/src/components/Player/Player.jsx:1` (252 líneas)

## Props
Sin props. Lee todo desde stores.

## Stores consumidos

| Store | Campos leídos |
|---|---|
| [[player]] | `currentTrack`, `isPlaying`, `positionSeconds`, `durationSeconds`, `volume`, `shuffle`, `repeat`, `error`, `togglePlay`, `setVolume`, `toggleShuffle`, `cycleRepeat`, `next`, `prev` |
| [[library]] | `tracks` (para saber si inLibrary), `persistEphemeral` |
| [[playlists]] | `toggleFavorite`, `isFavorite`, `favoritesId`, `addTrack` |
| [[view]] | `openNowPlaying` |

## Estado local

```js
const [saveOpen, setSaveOpen] = useState(false);   // abre SaveDialog
const [shareOpen, setShareOpen] = useState(false); // abre ShareToFriendModal
```

## Sub-componentes usados
- [[SaveDialog]] (modal de guardar en playlist)
- [[ShareToFriendModal]]
- [[Icon]]

## Comportamiento clave

- **Cover giratoria**: `data-spinning={isPlaying && !!coverUrl}` — CSS rotation animation.
- **Barra de progreso mini**: `<div style={{ width: \`${progress}%\` }}` en la parte superior.
- **Botón corazón (like)**: si el track es efímero, llama `persistEphemeral` antes de añadir a Favoritas. Con [[haptics#hapticTap]] en Android.
- **`data-empty={!currentTrack}`**: el CSS colapsa el player cuando no hay track (height: 0 en mobile).
- Seek: emite evento `window.dispatchEvent(new CustomEvent('ritmiq:seek', { detail: { seconds } }))` para que [[use-player]] lo procese sin acoplamiento directo.

## Qué puede romper este cambio

| Cambio | Síntoma |
|---|---|
| Quitar `e?.stopPropagation()` en botones | Click en botón corazón también abre NowPlaying. |
| `persistEphemeral` no actualiza `currentTrack` | Track efímero no refleja el ID real tras guardar → isFavorite siempre false. |
| Evento `ritmiq:seek` con nombre diferente | [[use-player]] no recibe el seek → barra de progreso no funciona. |

## Notas / Changelog
- 2026-05-22: nivel pleno.
