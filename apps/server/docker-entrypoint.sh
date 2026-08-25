#!/bin/sh
# Entrypoint del servidor Ritmiq.
#
# Actualiza yt-dlp al ARRANQUE (best-effort). YouTube rompe la extracción cada
# pocas semanas (bot-check, PO tokens, cambios de player) y yt-dlp publica
# releases frecuentes para adaptarse. Como la capa Docker de yt-dlp se cachea,
# la imagen podía quedar con un binario viejo → HTTP 403 al descargar/reproducir.
# Refrescar aquí garantiza el binario más reciente sin necesidad de rebuild.
#
# No bloqueante: si no hay red o GitHub falla, seguimos con el binario existente.

YTDLP_BIN="${RITMIQ_YTDLP_PATH:-/usr/local/bin/yt-dlp}"

echo "[entrypoint] yt-dlp actual: $("$YTDLP_BIN" --version 2>/dev/null || echo 'desconocido')"
echo "[entrypoint] actualizando yt-dlp (best-effort)…"
if curl -fsSL --max-time 60 \
    https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp \
    -o "${YTDLP_BIN}.new" 2>/dev/null; then
  chmod +x "${YTDLP_BIN}.new"
  # Validar que el binario nuevo responde antes de reemplazar.
  if "${YTDLP_BIN}.new" --version >/dev/null 2>&1; then
    mv -f "${YTDLP_BIN}.new" "$YTDLP_BIN"
    echo "[entrypoint] yt-dlp actualizado a: $("$YTDLP_BIN" --version 2>/dev/null)"
  else
    rm -f "${YTDLP_BIN}.new"
    echo "[entrypoint] binario nuevo inválido, se conserva el actual"
  fi
else
  echo "[entrypoint] no se pudo descargar yt-dlp (sin red?), se conserva el actual"
fi

exec node src/index.js
