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

UI: `components/Jam/TvConnect.jsx` (bloque QR+código de la barra y ventana del QR grande con conectados, "Desconectar" y "Cambiar código"), `components/Jam/QrCode.jsx` (SVG con `qrcode-generator`), `lib/jam-link.js` (`https://ritmiq.app/jam/<CODE>`; en TV/escritorio el origen no es público). Ver [[Google-TV]], ADR-043.

## Notas / Changelog
- 2026-11-04: creación.
