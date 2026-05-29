---
tipo: flujo
capa: flujo
plataforma: ambas
estado: pendiente
ultima-revision: 2026-05-29
tags: [roadmap, onboarding, distribucion, pwa, android, privacy, futuro]
---

# Onboarding para distribución a terceros

> El onboarding actual (Fase 3) solo enseña shortcuts de teclado post-login. Para usuarios
> que no soy yo, falta un flow guiado que conecte fuentes, maneje empty states y prepare la
> instalación en Android + página de privacidad.

## Por qué se postergó

Para uso personal no hace falta: ya sé usar mi propia app. Esto es estrictamente para
cuando alguien que no soy yo abra Ritmiq por primera vez.

## Para qué sirve

Tus amigos no leen READMEs. Necesitan un primer minuto guiado o abandonan. Resuelve:
- Home vacío silencioso → empty state amable con CTA.
- Falta de fuentes conectadas → prompt para Last.fm/Spotify.
- Instalación PWA en Android (hoy solo iOS tiene la cookie de install, T4 Fase 0).

## Lo que falta (checklist)

1. **Step "Conecta Last.fm o Spotify"** en el flow de [[Auth]]/[[Onboarding]],
   skippeable con CTA "Saltar — conectar luego". ~45 min.
2. **Empty state amable** en [[Home]] si no hay fuentes ni historial: "Importa tus gustos en
   Settings → Conexiones" en vez de Home vacío. ~30 min.
3. **Toast de bienvenida** primera sesión: "Hola, $nombre. Busca algo y dale play." ~15 min.
4. **Android install prompt**: listener `beforeinstallprompt` + UI (equivalente a
   [[IOSInstallHint]] / `/api/mark-installed` de T4). ~1h.
5. **Página `/privacy`** mencionando Last.fm, Spotify (si activo), YouTube como terceros.
   Link desde [[AboutInfoView]]. ~30 min.

## Trigger para activar

- Antes de invitar a la primera persona que no soy yo.
- Si la distribución es urgente, recortar a solo (2) + (3) — lo crítico para que el Home no
  se vea roto.

## Esfuerzo estimado

~3h yo (completo); ~45 min si solo el mínimo (2 + 3).

## Dependencias

- [[Auth]], [[Onboarding]] (extender flow).
- [[Home]] (empty state).
- [[toast]] store (bienvenida).
- [[IOSInstallHint]] (patrón para el equivalente Android).
- [[AboutInfoView]] (link a privacy).
- Relacionado con [[Activar-Spotify-OAuth]] (step 1 ofrece conectar Spotify).

## Notas / Changelog

- 2026-05-29: nota creada al postergar (foco en uso personal estable).
