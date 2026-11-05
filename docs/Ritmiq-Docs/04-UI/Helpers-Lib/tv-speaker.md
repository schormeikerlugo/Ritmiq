---
tipo: helper
capa: ui
plataforma: tv
estado: estable
ultima-revision: 2026-11-04
archivo: packages/ui/src/lib/tv-speaker.js
tags: [tv, jam, altavoz]
---

# `tv-speaker.js` — sesión altavoz permanente de la TV

> Solo en la app de TV (`IS_TV`). `useTvSpeakerSession(userId)` (montado en `App.jsx`).

- Con sesión iniciada y jam en `idle`, a los 1,5 s llama `ensureSpeakerSession()`: si hay código guardado (`localStorage ritmiq:tv:speakerCode`) hace `joinSession`; lo retoma solo si es `speaker` y este aparato quedó como host ([[jam]] `hostedHere`). Si no, sale y crea una nueva `createSession('speaker')`.
- Si la sesión se cierra, el modo vuelve a `idle` y se recrea sola. El latido del host refresca `jam_sessions.updated_at` para que el cron de 24 h no la borre.
- Depuración: `window.__ritmiqJam` = store del jam (solo TV).

UI: `components/Jam/TvConnect.jsx` (bloque con el código en la barra y ventana con el código grande, conectados, "Desconectar" y "Cambiar código"). Sin QR (en iPhone abría Safari, no la app). En el móvil/PC de la misma cuenta, `JamModal` muestra «Conectar a mi TV» con [[jam]] `findMySpeakers()`. Ver [[Google-TV]], ADR-043.

## Notas / Changelog
- 2026-11-04 (b): fuera el QR; «Conectar a mi TV».
- 2026-11-04: creación.
