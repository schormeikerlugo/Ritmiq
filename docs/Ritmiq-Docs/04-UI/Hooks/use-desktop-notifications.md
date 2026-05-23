---
tipo: hook
capa: ui
plataforma: desktop
estado: estable
ultima-revision: 2026-05-22
archivo: packages/ui/src/lib/use-desktop-notifications.js
tags: [hook, notificaciones, desktop, electron]
---

# `useDesktopNotifications()`

> Muestra notificaciones nativas del OS cuando cambia la pista en Desktop (Electron). Solo activa si la ventana NO tiene foco. Reemplaza la notificación anterior con un tag fijo.

## Ubicación
`packages/ui/src/lib/use-desktop-notifications.js:1` (78 líneas)

## Comportamiento

- Solo activo si `isDesktop === true`.
- Solo notifica cuando el **track cambia** (no en play/pause del mismo track).
- Solo notifica si **`document.hasFocus() === false`** (ventana minimizada o en segundo plano).
- Reemplaza la notificación anterior con `tag: 'ritmiq-now-playing'`.
- Click en notificación → `window.focus()`.
- `silent: true` para no añadir sonido de sistema (la música ya suena).

## Anatomía del código (snippet clave)

### Cache del permiso + detección de cambio de track
`packages/ui/src/lib/use-desktop-notifications.js:23-75`

```js
let permissionCache = null;  // módulo-level: pedir permiso solo una vez

async function ensurePermission() {
  if (permissionCache) return permissionCache;
  if (Notification.permission !== 'default') {
    permissionCache = Notification.permission;
    return permissionCache;
  }
  try {
    permissionCache = await Notification.requestPermission();
  } catch {
    permissionCache = 'denied';
  }
  return permissionCache;
}

// En la suscripción al store:
const unsub = usePlayerStore.subscribe((state, prev) => {
  const cur = state.currentTrack;
  if (!cur) return;
  if (cur.id === lastTrackIdRef.current) return;  // mismo track: no notificar
  lastTrackIdRef.current = cur.id;

  if (document.hasFocus()) return;  // ventana activa: no notificar

  ensurePermission().then((perm) => {
    if (perm !== 'granted') return;
    const n = new Notification(cur.title || 'Reproduciendo', {
      body: [cur.artist, cur.album].filter(Boolean).join(' — ') || 'Ritmiq',
      icon: cur.coverUrl || undefined,
      tag: NOTIF_TAG,     // reemplaza la notificación anterior
      silent: true,       // sin sonido de sistema
      renotify: true,     // mostrar aunque el tag ya exista (update visual)
    });
    n.onclick = () => { try { window.focus(); } catch {} n.close(); };
  });
});
```

**Por qué `permissionCache` de módulo**: el permiso se pide al primer cambio de track. Si usáramos `useState` o `useRef`, se resetearía si el componente se remonta (raro pero posible). La variable de módulo persiste para toda la sesión.

**Por qué `tag` fijo y `renotify: true`**: sin tag fijo, cada cambio de track acumula N notificaciones. Con el tag, cada nueva reemplaza la anterior. `renotify: true` es necesario para que la notificación se muestre aunque el tag ya exista (sin él, la notificación se actualiza silenciosamente pero no se re-muestra al usuario).

**Por qué `silent: true`**: el usuario ya está escuchando música. Añadir el sonido de notificación del SO encima de la música sería molesto.

## Casos de borde

- **Ventana Electron sin foco pero no minimizada**: `document.hasFocus() === false` → notifica. El usuario puede estar viendo otro app con Ritmiq visible en segundo plano.
- **Permiso denegado**: `ensurePermission` devuelve `'denied'` al primer cambio de track. No vuelve a pedir. Las notificaciones simplemente no aparecen sin error visible.
- **`Notification` no disponible** (entorno sin API): guard `if (typeof Notification === 'undefined') return` en el `useEffect`.

## Qué puede romper este cambio

| Cambio | Síntoma observable |
|---|---|
| Quitar guard `document.hasFocus()` | Notificaciones aparecen mientras el usuario mira la app → spam visual. |
| Quitar `tag` fijo | N notificaciones acumuladas en el Centro de Notificaciones (una por track). |
| `silent: false` | Sonido de notificación superpuesto a la música. |
| `permissionCache` como `useRef` | Después de un remontaje, pide permiso de nuevo aunque ya fue concedido/denegado. |

## Notas / Changelog
- 2026-05-22: nivel pleno.
