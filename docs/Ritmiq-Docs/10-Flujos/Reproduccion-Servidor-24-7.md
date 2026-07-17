---
tipo: flujo
capa: flujo
plataforma: ambas
estado: estable
ultima-revision: 2026-07-17
tags: [flujo, servidor, headless, streaming, cache, prewarm]
---

# Reproducción vía Servidor 24/7

> Flujo desde que el usuario busca hasta que suena, usando el **servidor casero
> 24/7** como host primario (modo `auto`). Complementa a
> [[Reproduccion-Track-Online]] (que cubre la cascada desktop/cloud).

## Diagrama

```mermaid
sequenceDiagram
  participant U as Usuario
  participant SV as SearchView
  participant LC as lan-client
  participant SRV as Servidor 24/7 (ritmiq.org)
  participant YT as yt-dlp
  participant FS as shared-audio/

  U->>SV: escribe query
  SV->>LC: ytSearch / ytSearchAll
  LC->>SRV: GET /yt/search?q=...
  SRV->>SRV: cache de búsqueda por query (TTL 10min)
  alt cache HIT
    SRV-->>LC: items (~0.001s)
  else MISS
    SRV->>YT: ytsearch (yt-dlp)
    YT-->>SRV: items (~2s)
    SRV-->>LC: items
  end
  SV->>LC: prewarmStream(top-5) · top-1 con download=1
  LC->>SRV: GET /yt/prewarm?q=<ytId>[&download=1]
  SRV->>YT: resolver URL / descargar m4a (background)
  YT-->>FS: <ytId>.m4a (si download)
  U->>SV: click play(track)
  SV->>LC: buildLanStreamUrl (?yt=<ytId>)
  LC->>SRV: GET /stream/yt:<ytId>?yt=<ytId>&token=
  alt archivo en shared-audio
    SRV-->>U: 206 (~0.004s)
  else URL cacheada
    SRV-->>U: proxy stream (~0.14s)
  else cold
    SRV->>YT: resolveCached(ytId, 10)
    SRV-->>U: proxy stream
  end
```

## Selección de host

`use-player.js` `getReachableCached()` ordena los candidatos según `serverMode`
(default `auto` → servidor primero) y hace `pingLan(/health)`. Ver
[[Multi-Endpoint-y-Seleccion-Host]].

## Persistencia de la búsqueda

La búsqueda (query, resultados, tab, scroll) persiste al navegar fuera y volver;
solo se limpia con el botón X. Ver [[SearchView]] y el store `search.js`.

## Fix relacionado (efímeros en desktop)

En el desktop, los tracks efímeros (`yt:<ytId>`, resultados de búsqueda) se
resuelven por el **lan-server local** (`getLanBaseUrl` ya no los excluye). Antes
caían al cloud, cuyas URLs de googlevideo están IP-locked → 403 → "audio load
failed (code 4)". Ver `use-player.js` `getLanBaseUrl`.

## Ver también

- [[Cache-y-Rendimiento]] — detalle de las capas de caché y prewarm.
- [[Reproduccion-Track-Online]] — cascada general.
- [[Sincronizacion-LAN]], [[Tunnel-Cloudflared]].
