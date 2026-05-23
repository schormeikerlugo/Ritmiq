---
tipo: hook
capa: ui
plataforma: ambas
estado: estable
ultima-revision: 2026-05-22
archivo: packages/ui/src/lib/use-social-realtime.js
tags: [hook, realtime, social, supabase, presencia]
---

# `useSocialRealtime(userId)`

> Tres canales Realtime de Supabase para el sistema social: presencia de amigos, cambios de friendships y nuevos items compartidos. Sweep periódico de presencias expiradas.

## Ubicación
`packages/ui/src/lib/use-social-realtime.js:1` (118 líneas)

## Tres canales

| Canal | Tabla | Eventos | Acción |
|---|---|---|---|
| `rt-social-presence-{userId}` | `presence` | `*` (INSERT/UPDATE/DELETE) | `setFriendPresence(uid, entry\|null)` |
| `rt-social-friendships-{userId}` | `friendships` | `*` | Recarga `loadFriends` + `loadRequests` |
| `rt-social-shared-{userId}` | `shared_items` | `INSERT` | Recarga `loadInbox` |

## Anatomía del código (snippet clave)

### Presencia: ignorar la propia + sweep de expiradas
`packages/ui/src/lib/use-social-realtime.js:41-79`

```js
// Sweep de presencias expiradas cada 30s
const sweepTimer = setInterval(() => {
  for (const [uid, entry] of friendsPresence) {
    const exp = entry.expiresAt ? new Date(entry.expiresAt).getTime() : 0;
    if (exp && exp < now) setFriendPresence(uid, null);
  }
}, STALE_SWEEP_MS);

// Canal de presencia
.on('postgres_changes', { event: '*', schema: 'public', table: 'presence' },
  (payload) => {
    if (eventType === 'DELETE') {
      setPresence(oldRow?.user_id, null); return;
    }
    if (row.user_id === userId) return;  // ignorar la propia presencia
    setPresence(row.user_id, { ytId: row.yt_id, ... });
  })
```

**Por qué sweep periódico de 30s**: el server solo limpia `presence` cada 5 min via cron. Entre medias, amigos que se desconectaron sin hacer DELETE explícito quedan como presencia "activa" en el cliente. El sweep borra entradas cuyo `expires_at` ya pasó.

**Por qué ignorar `row.user_id === userId`**: la propia presencia del usuario llega por Realtime (el upsert que hace [[use-presence]] trigger el canal). Añadirla al mapa de presencia de amigos sería un bug.

### Friendships: reload vs delta

```js
.on('postgres_changes', { event: '*', table: 'friendships' },
  () => {
    loadFriends(userId);
    loadRequests(userId);
  })
```

**Por qué reload completo y no delta**: calcular deltas de friendships es complejo (hay que cruzar incoming + outgoing + accepted). Un reload completo es 2 queries (~200ms) pero garantiza consistencia. La frecuencia de cambios en friendships es muy baja (no es Realtime de plays).

### Shared items: reload vs delta

```js
.on('postgres_changes', { event: 'INSERT', table: 'shared_items', filter: `receiver_id=eq.${userId}` },
  () => { loadInbox(userId); })
```

**Por qué reload y no aplicar el payload**: el payload INSERT de Realtime llega sin el perfil del sender (nombres, avatar). Para construir el `SharedItem` completo necesitamos el perfil. Es más simple recargar el inbox entero que hacer dos queries a mano.

## Limpieza

```js
return () => {
  clearInterval(sweepTimer);
  supabase.removeChannel(presenceCh);
  supabase.removeChannel(friendshipsCh);
  supabase.removeChannel(sharedCh);
};
```

Crítico: si no se remueven los canales al cambiar `userId` (logout), el canal del usuario anterior sigue activo y modifica el estado del nuevo usuario.

## Qué puede romper este cambio

| Cambio | Síntoma observable |
|---|---|
| Quitar sweep de expiradas | Amigos desconectados aparecen como "Escuchando ahora" indefinidamente. |
| No ignorar `row.user_id === userId` | Tu propia presencia aparece en "tus amigos escuchando". |
| No remover canales en cleanup | Canales del usuario anterior activos tras logout → datos mezclados. |
| `filter` en friendships | RLS ya filtra, pero un filter adicional podría excluir cambios válidos. |

## Notas / Changelog
- 2026-05-22: nivel medio.
