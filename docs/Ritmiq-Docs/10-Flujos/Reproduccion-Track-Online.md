---
tipo: flujo
capa: flujo
plataforma: ambas
estado: estable
ultima-revision: 2026-05-22
tags: [flujo, reproduccion, streaming, audio]
---

# Reproducción de un track online (PWA)

> Flujo completo desde que el usuario clickea play hasta que el audio empieza a sonar. Cubre la cascada LAN → Tunnel → Cloud y la precarga del siguiente track.

## Diagrama

```mermaid
sequenceDiagram
  participant U as Usuario
  participant UI as Player/NowPlaying
  participant PS as player store
  participant Hook as use-player
  participant AS as resolveAudioSource
  participant LC as lan-client
  participant LS as lan-server (Desktop)
  participant Edge as resolve-stream
  participant YT as yt-dlp
  participant BE as html-audio-backend
  participant AUDIO as <audio>

  U->>UI: click play(track)
  UI->>PS: playNow(track)
  PS->>Hook: useEffect[currentTrack]
  Hook->>BE: pause() + reset src
  Hook->>AS: resolveAudioSource(track, deps)
  AS->>AS: getLocalUrl(track.id)
  alt offline local
    AS-->>Hook: { url: blob:/file:, origin: local }
  else con LAN reachable
    AS->>LC: getLanBaseUrl + buildLanStreamUrl
    LC->>LC: getSignedStreamUrl (HMAC via Edge sign-stream)
    LC-->>AS: lanBaseUrl + url firmada
    AS-->>Hook: { url: http://...?sig=...&exp=..., origin: lan }
  else fallback cloud
    AS->>Edge: resolve-stream?ytId=&proxy=1
    Edge->>YT: Innertube IOS/ANDROID/WEB
    YT-->>Edge: googlevideo URL
    Edge-->>AS: { url, contentType }
    AS-->>Hook: { url, origin: cloud-stream }
  end
  Hook->>BE: load(url)
  BE->>AUDIO: src = url
  AUDIO-->>BE: 'loadeddata' event
  BE-->>Hook: resolve
  Hook->>BE: play()
  BE->>AUDIO: play()
  AUDIO-->>BE: timeupdate (cada ~100ms)
  BE-->>Hook: onPosition(pos)
  Hook->>PS: patch({ positionSeconds, durationSeconds })

  Note over Hook: 200ms después: precarga del siguiente
  Hook->>AS: resolveAudioSource(nextTrack, deps)
  AS-->>Hook: nextUrl
  Hook->>Hook: nextUrlRef.current = nextUrl

  Note over Hook,AUDIO: ~0.4s antes del fin
  AUDIO-->>Hook: onPosition(pos cerca de duration)
  Hook->>BE: swapAndPlay(nextUrl) [SÍNCRONO]
  Hook->>PS: patch({ currentTrack: nextTrack, index })
```

## Decisiones críticas

- **LAN > Tunnel > Cloud** en orden de prioridad ([[connectivity#recomputeSource]]) — minimiza latencia + costos.
- **HMAC firmada** ([[sign-stream]]) — el LAN server NO consulta Supabase, valida solo con el secret.
- **Pre-end swap** ([[use-player]]) — iOS background playback requiere `play()` SÍNCRONO mientras el `<audio>` aún está reproduciendo (no en `ended`).
- **Precarga 200ms tras play** — el siguiente URL está listo cuando llega el swap.

## Módulos involucrados

- UI: [[Player]], [[NowPlaying]], [[QueuePanel]].
- Lógica: [[use-player]], [[audio-source]], [[html-audio-backend]].
- Red: [[lan-client]], [[connectivity]].
- Servidor LAN: [[lan-server]] (Desktop).
- Edge: [[sign-stream]], [[resolve-stream]].
- YT: [[ytdlp-wrapper]].

## Notas / Changelog
- 2026-05-22: F8 — flujo end-to-end documentado.
