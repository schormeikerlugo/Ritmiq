---
tipo: hook
capa: ui
plataforma: pwa
estado: estable
ultima-revision: 2026-05-22
archivo: packages/ui/src/lib/use-share-reminder.js
tags: [hook, share, reminder, notificaciones, ux]
---

# `useShareReminder(userId)` + `useShareReminderStore`

> Revisa periódicamente el inbox de shares y muestra un recordatorio a los items no leídos con > 2 minutos. Una vez mostrado, se persiste en localStorage para no repetirlo.

## Ubicación
`packages/ui/src/lib/use-share-reminder.js:1` (108 líneas)

## Por qué existe

Si el usuario recibió una push notification y la ignoró, o si las notificaciones push están desactivadas, puede que nunca sepa que tiene un share pendiente. Este hook cubre ese gap revisando el inbox periódicamente.

## Constantes

```js
const CHECK_INTERVAL_MS = 30_000;   // revisar cada 30s
const MIN_AGE_MS = 2 * 60_000;     // el share debe tener al menos 2 min sin abrir
```

## Store interno

```js
export const useShareReminderStore = create((set) => ({
  pendingReminders: ReminderItem[],
  show(items): void,
  dismiss(): void,
}))
```

## Anatomía del código (snippet clave)

### Marcar como recordado ANTES de mostrar
`packages/ui/src/lib/use-share-reminder.js:87-96`

```js
// Marcar todos como recordados ANTES de mostrar — evita loops si el
// usuario cierra el modal sin marcar como leído.
for (const c of candidates) markReminded(c.id);

const top3 = candidates
  .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
  .slice(0, 3);

useShareReminderStore.getState().show(top3);
```

**Por qué marcar antes y no después**: si el usuario cierra el modal sin abrir el share (simplemente descarta el recordatorio), el item sigue con `readAt === null`. En el próximo `check()` (30s) volvería a aparecer en candidates. Marcándolo antes de mostrar, garantizamos "una sola vez por share".

**Por qué top 3**: no abrumar con un modal que lista 20 shares. El usuario verá los 3 más recientes; los demás estarán en la bandeja de entrada de FriendsView.

### Guard: no molestar si ya está en FriendsView

```js
if (view.kind === 'friends') return;  // ya los está viendo
```

**Por qué**: si el usuario está en la vista de amigos, ya ve el inbox. Mostrar el modal encima sería redundante e intrusivo.

## Persistencia

```
localStorage.ritmiq.share-reminded.<itemId> = '1'
```

Un entry por share. No expira — la idea es no recordar nunca dos veces el mismo share.

## Casos de borde

- **Share muy reciente (< 2 min)**: no aparece como candidato. Da tiempo a que la push notification llegue y el usuario la abra.
- **Share leído externamente (otro dispositivo)**: `item.readAt !== null` → no es candidato. Realtime actualiza el inbox.

## Notas / Changelog
- 2026-05-22: nivel medio.
