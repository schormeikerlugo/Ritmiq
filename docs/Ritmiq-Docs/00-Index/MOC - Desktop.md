---
tipo: moc
capa: desktop-main
plataforma: desktop
estado: estable
ultima-revision: 2026-05-22
tags: [moc, desktop]
---

# MOC — Desktop (Electron)

Ruta en repo: `apps/desktop/`

## Procesos

- **Main**: `apps/desktop/main/` (Node + Electron)
- **Preload**: `apps/desktop/preload/index.cjs` (puente seguro)
- **Renderer**: `apps/desktop/renderer/` (React + Vite, monta `@ritmiq/ui`)

## Notas (auto-generado)

```dataview
TABLE file.folder AS "Carpeta", tipo, estado, ultima-revision
FROM "02-Desktop"
WHERE tipo != "moc"
SORT file.folder, file.name ASC
```

## Funcionalidades clave

- IPC entre main y renderer → [[ipc]]
- Servidor LAN para streaming a PWA → [[lan-server]]
- DB local SQLite → [[db]]
- Tunnel Cloudflared → [[cloudflared]]
- Detección de cookies del navegador → [[cookies-detect]]
- Binarios yt-dlp/ffmpeg → [[ytdlp-path]]
- Emparejamiento de dispositivos → [[devices]]
