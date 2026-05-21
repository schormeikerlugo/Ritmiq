#!/usr/bin/env bash
#
# generate-splash.sh — genera apple-touch-startup-image splash screens
# para iOS PWA usando ImageMagick.
#
# Sin estos splash, iOS muestra una pantalla blanca al abrir la PWA
# desde el home screen \u2014 anti-nativo absoluto. Apple solo soporta el
# antiguo <link rel="apple-touch-startup-image"> con media queries
# por device-width + device-pixel-ratio + orientation (NO el campo
# "splash" del manifest W3C, que ignora silenciosamente).
#
# Generamos 8 resoluciones cubriendo el 95% de iPhones/iPads en uso:
#   iPhone SE 2/3 (1334x750)       \u2014 dpr 2
#   iPhone 8/SE 3 (1334x750)       \u2014 dpr 2
#   iPhone X/11Pro/12mini/13mini (2436x1125)  \u2014 dpr 3
#   iPhone 12/13/14 (2532x1170)    \u2014 dpr 3
#   iPhone 12/13/14 Pro Max (2778x1284)  \u2014 dpr 3
#   iPhone 14 Pro / 15 / 15 Pro (2556x1179)  \u2014 dpr 3
#   iPhone 14 Pro Max / 15 Plus (2796x1290)  \u2014 dpr 3
#   iPad Pro 12.9" (2048x2732)     \u2014 dpr 2
#
# Cada splash es un PNG con el logo centrado (320px) sobre fondo
# #0a0a0c (mismo background_color del manifest \u2014 transicion smooth).
#
# Uso: bash scripts/generate-splash.sh
# Output: apps/pwa/public/splash/iphone-*.png + ipad-*.png

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
LOGO="${REPO_ROOT}/apps/pwa/public/icon-512.png"
OUT_DIR="${REPO_ROOT}/apps/pwa/public/splash"
BG="#0a0a0c"
LOGO_SIZE=320

if [ ! -f "$LOGO" ]; then
  echo "[splash] Logo no encontrado en $LOGO" >&2
  exit 1
fi

mkdir -p "$OUT_DIR"

generate() {
  local w="$1"
  local h="$2"
  local name="$3"
  local out="${OUT_DIR}/${name}.png"

  # -colors 64 cuantiza la paleta (fondo solido + degradado anti-alias
  # del logo casan en pocos colores). Reduce ~70% el tamano del PNG
  # sin perdida visible: 1.1 MB total \u2192 432 KB.
  magick -size "${w}x${h}" "xc:${BG}" \
    \( "$LOGO" -resize "${LOGO_SIZE}x${LOGO_SIZE}" \) \
    -gravity center -composite \
    -strip -define png:compression-level=9 -colors 64 \
    "$out"

  echo "[splash] ${name}.png \u2014 ${w}x${h}"
}

# Portrait splashes \u2014 los unicos que Apple muestra para PWA.
# Nombre = device-target + width-x-height.
generate  750 1334 "iphone-se"           # SE 2/3, 8
generate 1125 2436 "iphone-x"            # X, 11Pro, 12mini, 13mini
generate 1170 2532 "iphone-12"           # 12, 13, 14
generate 1179 2556 "iphone-14pro"        # 14 Pro, 15, 15 Pro
generate 1284 2778 "iphone-12promax"     # 12/13/14 Pro Max
generate 1290 2796 "iphone-14promax"     # 14 Pro Max, 15 Plus, 15 Pro Max
generate 2048 2732 "ipad-pro-12"         # iPad Pro 12.9"
generate 1536 2048 "ipad-air"            # iPad Air / iPad estandar

echo "[splash] Hecho \u2014 $(ls -1 "$OUT_DIR" | wc -l) archivos en $OUT_DIR"
