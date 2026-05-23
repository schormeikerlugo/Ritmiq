---
tipo: componente
capa: ui
plataforma: pwa
estado: estable
ultima-revision: 2026-05-22
archivo: packages/ui/src/components/SharedView/SharedView.jsx
tags: [componente, share, landing, ios, deeplink]
---

# `SharedView`

> Landing pública de un track compartido. Accesible sin login. Muestra cover/título/artista y CTAs según el contexto: iOS sin PWA (instrucciones de instalación), iOS con PWA (instrucciones de "Abrir en Ritmiq"), Android/Desktop (abrir en app o YouTube).

## Ubicación
`packages/ui/src/components/SharedView/SharedView.jsx:1` (441 líneas)

## Props

```js
{ share: { ytId, title, artist, coverUrl } }
```

Recibido desde `App.jsx` que llama `parseShareFromUrl()` al montar.

## Detección de contexto

| Contexto | CTA mostrado |
|---|---|
| PWA standalone | Bypass — App.jsx reproduce directamente sin mostrar SharedView |
| iOS + PWA instalada (`hasPwaInstalledCookie`) | "Abre el link en Ritmiq" con instrucciones |
| iOS + sin PWA | "Instala Ritmiq" — tutorial Add to Home Screen |
| Android / Desktop | Botón "Abrir en Ritmiq" (`ritmiq://` deep link) + fallback YouTube |

## Limitación iOS localStorage

Safari y la PWA standalone tienen localStorage segregado. Por eso se usa una **cookie** (`ritmiq_installed=1`) para detectar la instalación cross-context. Ver [[share#hasPwaInstalledCookie]].

## Notas / Changelog
- 2026-05-22: nivel medio.
