---
tipo: componente
capa: ui
plataforma: ambas
estado: estable
ultima-revision: 2026-05-22
archivo: packages/ui/src/components/ShareReminder/ShareReminderModal.jsx
tags: [componente, share, reminder, inbox, notificacion]
---

# `ShareReminderModal`

> Modal que aparece automáticamente cuando el hook [[use-share-reminder]] detecta shares no leídos con > 2 minutos de antigüedad. Muestra hasta 3 items y permite reproducir o marcar como leído.

## Ubicación
`packages/ui/src/components/ShareReminder/ShareReminderModal.jsx:1` (318 líneas)

## Props
Sin props.

## Stores consumidos

| Store | Uso |
|---|---|
| [[use-share-reminder]] | `useShareReminderStore` — `pendingReminders`, `dismiss` |
| [[social]] store | `markInboxItemRead`, `markInboxItemSaved` |
| [[player]] store | `playNow` |
| [[view]] store | `goFriends` |

## Comportamiento

- Se renderiza como [[BottomSheet]] (si mobile) o modal fijo (si desktop).
- Cada item muestra: cover + título + "Te compartió X · hace Y min".
- Botones: `▶ Reproducir` y `Marcar como leído`.
- Reproducir → `playNow([metaToCandidate(item)])` + `markInboxItemRead`.
- "Ver todos" → `goFriends()` + `dismiss()`.
- Dismiss de todo el modal → `dismiss()`.

## Orquestación

El hook [[use-share-reminder]] (montado en App.jsx) hace el polling cada 30s y llama `useShareReminderStore.getState().show(items)` cuando hay candidatos. Este componente solo reacciona al store — no hace polling propio.

## Notas / Changelog
- 2026-05-22: nivel simple.
