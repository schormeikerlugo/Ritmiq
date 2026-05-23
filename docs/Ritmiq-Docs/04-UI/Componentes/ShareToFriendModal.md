---
tipo: componente
capa: ui
plataforma: ambas
estado: estable
ultima-revision: 2026-05-22
archivo: packages/ui/src/components/ShareToFriendModal/ShareToFriendModal.jsx
tags: [componente, social, share, modal, amigos]
---

# `ShareToFriendModal`

> Modal para compartir un track o playlist con amigos de Ritmiq. Muestra lista de amigos mutuos, selección múltiple y mensaje opcional (280 chars). Llama a Edge Function `send-share` via [[social#sendShare]].

## Ubicación
`packages/ui/src/components/ShareToFriendModal/ShareToFriendModal.jsx:1` (460 líneas)

## Props

```js
{
  track?: Track,
  playlist?: { id, name, coverUrl, tracks },  // mutuamente excluyente con track
  onClose: () => void
}
```

## Stores consumidos

| Store | Uso |
|---|---|
| [[social]] store | `friends`, `sendShare` |
| [[haptics]] | `hapticSuccess`, `hapticError` |

## Flujo

1. Muestra lista de amigos con avatar + nombre.
2. Usuario selecciona uno o varios (`selectedIds: Set<string>`).
3. Input de mensaje opcional.
4. Click "Enviar" → `sendShare({ receiverIds, kind: 'track' | 'playlist', ...datos })`.
5. Feedback: `hapticSuccess()` en éxito, `hapticError()` en fallo.

## Invocado desde

- [[Player]] → botón "Compartir" en la barra del player.
- [[NowPlaying]] → botón "..." → "Compartir con amigo".
- [[PlaylistView]] → menú contextual del header.

## Notas / Changelog
- 2026-05-22: nivel medio.
