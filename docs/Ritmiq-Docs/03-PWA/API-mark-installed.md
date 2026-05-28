---
tipo: modulo
capa: pwa
plataforma: pwa
estado: estable
ultima-revision: 2026-05-27
archivo: apps/pwa/api/mark-installed.js
tags: [pwa, vercel, edge, cookie, ios, share-deeplink, T4]
---

# `apps/pwa/api/mark-installed.js`

> Vercel **Edge Function** que setea la cookie `ritmiq_installed=1` para detección cross-context de PWA instalada en iOS. Resuelve T4 del [[share-deeplink-roadmap]] (los iOS tienen `localStorage` segregado entre Safari y PWA standalone, pero las cookies del mismo origen sí se comparten).

## Ubicación
`apps/pwa/api/mark-installed.js:1` (73 líneas)

## Endpoint

```
POST /api/mark-installed
```

Sin body. Sin query params. Cualquier otro método → 405.

## Respuesta

```http
HTTP/1.1 200 OK
Content-Type: application/json
Set-Cookie: ritmiq_installed=1; Path=/; Max-Age=31536000; Secure; SameSite=Lax
Cache-Control: no-store

{ "ok": true }
```

| Atributo Cookie | Valor | Por qué |
|---|---|---|
| `Path=/` | raíz | Visible desde cualquier ruta del origin |
| `Max-Age` | 31536000 (1 año) | Refrescado por `pingMarkInstalled({force?})` periódicamente |
| `Secure` | sí | HTTPS only en prod |
| `SameSite=Lax` | sí | Permite la cookie en navegaciones cross-context del mismo origen (WhatsApp → Safari) |
| `HttpOnly` | **NO** | El cliente JS necesita leerla con `document.cookie` |

## Quién la llama

Desde el cliente, [[share|share.js]] `pingMarkInstalled()`:

- En boot del `App.jsx` si `isStandalonePWA()` (force=true, ignora throttle).
- En cada `visibilitychange` cuando la PWA standalone pasa de hidden→visible (throttle 24h vía localStorage).

## Quién la lee

[[SharedView]] vía `hasPwaInstalledCookie()` en [[share]]:

```js
const hasInstalled = hasPwaInstalledFlag() || hasPwaInstalledCookie();
```

Si `hasInstalled === true`, muestra "Abrir en Ritmiq" en vez de "Instala Ritmiq".

## Runtime

```js
export const config = { runtime: 'edge' };
```

Vercel Edge runtime: low-latency, sin cold start, sin DB. Este endpoint es **stateless write-only**.

## Por qué Edge y no Serverless Function normal

- Latencia: fire-and-forget desde el boot de la PWA. Edge añade ~10ms vs ~200ms de serverless con cold start.
- Sin DB: no necesitamos acceso a Postgres ni a Supabase.
- Sin secretos: no hay que cuidar key rotation.

## Deploy

Vercel autodetecta archivos en `apps/pwa/api/` si el **Root Directory** del proyecto Vercel es `apps/pwa`. Sin config adicional.

## Qué puede romper este cambio

| Cambio | Impacto |
|---|---|
| Quitar `Secure` | Cookie se manda por HTTP también — riesgo MITM |
| Cambiar a `SameSite=Strict` | La cookie no se envía cuando el user navega desde WhatsApp → falla detección iOS |
| Activar `HttpOnly` | `document.cookie` no la lee → `hasPwaInstalledCookie()` siempre false |
| Mover el archivo fuera de `apps/pwa/api/` | Vercel no la detecta como Function |

## Casos de borde

- **Cliente sin cookies habilitadas**: la respuesta llega pero no persiste. `hasPwaInstalledCookie()` devolverá false. `hasPwaInstalledFlag()` (localStorage) puede salvar la situación si la PWA ya lo seteó.
- **OPTIONS preflight desde otro origin**: no se gestiona; este endpoint es same-origin. No hay headers CORS.
- **Múltiples llamadas en rápida sucesión**: stateless, idempotente. La cookie se setea N veces con el mismo valor.

## Changelog

- 2026-05-27 — Creado en Fase 0.1. Commit `697ab4f`. Refresco periódico añadido en Fase 0.2 (commit `e6f0bff`) vía `pingMarkInstalled` en [[share]].
