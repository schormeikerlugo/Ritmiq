---
tipo: store
capa: ui
plataforma: ambas
estado: estable
ultima-revision: 2026-05-27
archivo: packages/ui/src/stores/toast.js
tags: [store, toast, snackbar, feedback, global]
---

# `stores/toast.js`

> Store global de toasts/snackbars con cola FIFO máximo 3 en pantalla. Auto-dismiss configurable. Variantes `default | success | error | info` con action button opcional.

## Ubicación
`packages/ui/src/stores/toast.js:1` (86 líneas)

## Estado

```js
{
  toasts: Array<{
    id: number,
    message: string,
    variant: 'default' | 'success' | 'error' | 'info',
    icon?: string,             // nombre de Icon registrado
    duration: number,          // ms; 0 = permanente hasta dismiss manual
    action?: { label: string, onClick: () => void },
  }>
}
```

## API pública

```js
const showToast = useToastStore((s) => s.show);
showToast({
  message: 'Añadida a Favoritas',
  variant: 'success',     // default 'default'
  icon: 'Heart',
  duration: 3500,         // default 3500ms
  action: { label: 'Ver', onClick: () => goSomewhere() },
});
```

### Atajos

```js
toast.success('Guardado');                    // variant='success'
toast.error('Falló', { duration: 6000 });     // variant='error', duration default 5000ms
toast.info('Sincronizando...');                // variant='info'
toast.show({ message, ... });                  // explicit
toast.dismiss(id);                             // cerrar manual
```

`toast` se importa directamente:

```js
import { toast } from '../../stores/toast.js';
```

Útil para llamar desde fuera de componentes (otros stores, libs).

## Cola FIFO

`MAX_VISIBLE = 3`. Si llega un cuarto toast, el más viejo se descarta (sale por la izquierda, no muestra animación). Esto evita acumulación si el usuario hace múltiples acciones rápidas.

## Auto-dismiss

`duration > 0` programa un `setTimeout(dismiss, duration)`. `duration === 0` mantiene el toast hasta `dismiss(id)` manual — útil para "Guardando..." que se reemplaza por "Guardado" o "Error".

## Dónde se renderiza

[[ToastHost]] (`packages/ui/src/components/Toast/ToastHost.jsx`) consume el store con `useToastStore((s) => s.toasts)`. Stack vertical bottom-center en mobile, bottom-right en desktop.

## Qué rompe esto

| Cambio | Impacto |
|---|---|
| Subir `MAX_VISIBLE` a 5+ | Spam visual en errores en serie |
| Cambiar default duration a >5s | Bloquea visibilidad del UI debajo |
| Quitar el atajo `toast.show` global | Hay que refactorizar todos los callers (stores, libs, edge functions) |

## Casos de borde

- **Mismo mensaje disparado N veces seguidas**: se apilan; no hay deduplicación. Si se vuelve un problema, agregar `key` opcional.
- **Toast con `duration: 0` y sin `action`**: queda pegado para siempre. El usuario solo puede cerrarlo si hay un swipe handler en `ToastHost`.
- **Server-side rendering**: el store usa `setTimeout` que no existe en Node. En el contexto Vite SSR no se importa el store; nunca debería ejecutarse en server.

## Changelog

- 2026-05-27 — Documentado retroactivamente. Existe desde commit `54a9291` (sesión anterior).
