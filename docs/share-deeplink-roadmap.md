# Share deep-link — solución completa pendiente

> Contexto: Apple bloquea deliberadamente el "link capturing" automatico
> para PWAs en iOS (Safari nunca abre la PWA instalada al tocar un link
> del mismo origen). El MVP entregado en commit `3d92fc8` cubre el 80%
> del problema con landing publica + instrucciones contextuales. Este
> documento describe lo PENDIENTE para llegar al 100%.

## Estado actual (commit `3d92fc8`)

Implementado:

- Manifest con `id: '/'` + `start_url: '/?source=pwa'`.
- URLs path-based: `https://ritmiq.app/share/track/<ytId>?meta=<b64>` (+
  retrocompat con `?share=track:...`).
- `lib/share.js`: `isStandalonePWA`, `markPwaInstalled`,
  `hasPwaInstalledFlag`, `detectPlatform`, `clearShareFromUrl`.
- `SharedView` con banners contextuales por plataforma + estado
  instalada.
- `App.jsx`: marca `installed=1` al primer boot standalone.

Limitacion iOS conocida:

- Safari y la PWA standalone tienen storage SEGREGADO en iOS — no
  comparten cookies ni localStorage. Por eso el flag
  `ritmiq.pwa-installed` en localStorage solo se ve dentro de la PWA;
  Safari nunca lo lee y siempre muestra el banner "Instala Ritmiq" aunque
  el usuario YA la tenga instalada.

---

## Tareas pendientes (T4 + T5 + T6)

> Estado actualizado 2026-05-27:
>   - **T4**: DONE en commit `697ab4f` — endpoint `apps/pwa/api/mark-installed.js`.
>   - **T5**: DONE en commit pendiente — `pingMarkInstalled()` + listener
>     `visibilitychange` en `App.jsx`.
>   - **T6**: diferido (depende de modelo "amigos" que aun no existe).
>   - **T7**: pendiente — OG meta tags server-side para previews ricas.

### T4 — Deteccion cross-context con cookie HttpOnly (~1h) ✓ DONE

Cookies de primer origen SI son compartidas entre Safari y la PWA
standalone en iOS (a diferencia de localStorage). Plan:

1. Crear endpoint `apps/pwa/api/mark-installed.js` (Vercel Function).
   - Lee el header `User-Agent`, valida que sea iOS/Android/desktop.
   - Set-Cookie: `ritmiq_installed=1; Path=/; Max-Age=31536000; Secure;
     SameSite=Lax`. NO usar HttpOnly aqui — necesitamos leerla desde JS
     en la landing (Safari, no PWA).
   - Devuelve `{ ok: true }`.

2. En `App.jsx` (justo despues de `markPwaInstalled()`):

   ```js
   if (isStandalonePWA()) {
     markPwaInstalled();
     // Cookie cross-context para que Safari iOS sepa que la PWA esta
     // instalada. fire-and-forget.
     fetch('/api/mark-installed', { method: 'POST', credentials: 'same-origin' })
       .catch(() => {});
   }
   ```

3. En `lib/share.js`, agregar:

   ```js
   export function hasPwaInstalledCookie() {
     if (typeof document === 'undefined') return false;
     return document.cookie.split(';').some((c) => c.trim().startsWith('ritmiq_installed=1'));
   }
   ```

4. En `SharedView` cambiar la condicion del banner iOS:

   ```js
   const hasInstalled = hasPwaInstalledFlag() || hasPwaInstalledCookie();
   ```

5. Verificar en Vercel que `/api/*` se enrute como Function (revisar
   `vercel.json` — actualmente solo declara rewrites SPA; las Functions
   en `/api/` deberian funcionar sin config extra si el archivo existe).

Resultado: Safari iOS detecta correctamente que el device tiene la PWA y
muestra el banner "Abrir en Ritmiq" en vez del de instalacion.

---

### T5 — Refresh periodico del flag (~15min) ✓ DONE

La cookie expira en 1 año (Max-Age 31536000). Si el usuario reinstala la
PWA o cambia de device, el flag puede quedar stale.

Implementado:
- `pingMarkInstalled({ force? })` en `packages/ui/src/lib/share.js`:
  llama a `/api/mark-installed`, throttle de 24h via timestamp en
  localStorage (`ritmiq.pwa-installed-pinged-at`). Si la llamada falla,
  NO actualiza el timestamp para que el siguiente intento re-pruebe.
- `App.jsx` boot: `pingMarkInstalled({ force: true })` al detectar
  standalone — primer ping garantizado.
- `App.jsx` useEffect: listener `visibilitychange` que llama a
  `pingMarkInstalled()` (respetando throttle) cada vez que la PWA
  vuelve a estar visible. Solo se registra en standalone.

---

### T6 — Web Push para abrir la PWA (4-6h, opcional, iOS 16.4+)

Unico metodo de Apple que abre una PWA instalada desde fuera del
contexto del usuario. Util si en el futuro queremos un modelo de
"amigos" donde un share dispara una notificacion al device del
destinatario.

Plan:

1. Generar VAPID keys (`web-push generate-vapid-keys`) — variables de
   entorno `VAPID_PUBLIC_KEY` y `VAPID_PRIVATE_KEY` en Vercel.
2. Service worker: handler `push` + `notificationclick` → `clients.openWindow`.
3. En la PWA pedir permiso de notificaciones al primer login + suscribir
   con `pushManager.subscribe({ applicationServerKey: VAPID_PUBLIC_KEY })`.
4. Guardar la subscription en Supabase (`push_subscriptions` table:
   user_id, endpoint, keys p256dh + auth, created_at).
5. Edge Function `send-share-notification` que recibe `{ userId, payload }`
   y envia push usando `web-push` package.
6. UI: en `SharedView`, cuando el usuario A comparte y el destinatario B
   es conocido (modelo de "amigos" — NO existe hoy), ofrecer "Enviar
   notificacion a B" como CTA adicional.

Dependencia critica: **no tenemos modelo de "amigos / seguidores"** en
Ritmiq. Hasta que exista, T6 no aplica. Diferir a Fase 3.

---

### T7 — Open Graph + Twitter Card meta tags (~30min, opcional)

Para que cuando alguien pegue el link en WhatsApp / Twitter / iMessage
se vea una preview rica (cover + titulo + artista). Hoy se ve URL plana.

Plan:

1. Como es SPA, los meta tags deben ser inyectados server-side. Opciones:
   - **A**: Vercel Edge Middleware que detecte `/share/track/*` y genere
     HTML con OG tags personalizados antes de servir el index.html.
   - **B**: pre-renderizar a build time es imposible (URLs dinamicas).
   - **C**: usar `<meta property="og:image" content="...">` con el cover
     desde el query param `?meta=<b64>`. Pero los scrapers
     (WhatsApp/Twitter) NO ejecutan JS, asi que esto solo lo veria un
     navegador. Para previews ricas hace falta server-side (A).

2. Implementacion A — `apps/pwa/middleware.js` (Vercel Edge):

   ```js
   import { NextResponse } from 'next/server';
   export const config = { matcher: '/share/track/:ytId*' };
   export default function middleware(req) {
     const url = new URL(req.url);
     const match = url.pathname.match(/^\/share\/track\/([^/]+)/);
     if (!match) return NextResponse.next();
     const meta = url.searchParams.get('meta');
     // Decodifica meta, inyecta OG tags en el HTML response...
   }
   ```

---

## Decision

- **T4 + T5** son los mas valiosos — completan la deteccion cross-context
  en iOS. Recomendado retomarlos cuando el deploy a Vercel este estable
  y validemos el MVP con usuarios reales.
- **T6** depende de feature de "amigos" que no existe — diferir.
- **T7** mejora ranking de comparticion social — nice to have, no critico.

Cuando se retome: hacer commit independiente por T, no agrupar.
