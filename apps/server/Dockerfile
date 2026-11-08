# Ritmiq Server — imagen headless 24/7 (LAN/YouTube resolver + cloudflared).
#
# Node LTS 22 (compila better-sqlite3 desde binario oficial sin toolchain
# extra) + yt-dlp + deno (runtime JS para el signature challenge) +
# cloudflared (túnel) + ffmpeg (post-proceso de audio).
#
# Build (desde la RAÍZ del monorepo):
#   docker build -f apps/server/Dockerfile -t ritmiq-server .
#
# El contexto de build es el monorepo completo (necesita los workspaces).

# ── whisper.cpp con Vulkan (sincronizar letras; GPU AMD RX 570 vía RADV) ──
# Debian 12 trae cabeceras Vulkan/SPIR-V antiguas o sin config de CMake: se
# compilan las de Khronos. Etapa aparte: la imagen final solo lleva el binario.
FROM debian:bookworm-slim AS whisper
RUN apt-get update && apt-get install -y --no-install-recommends \
      git cmake build-essential libvulkan-dev glslc glslang-tools ca-certificates \
    && rm -rf /var/lib/apt/lists/*
RUN for r in SPIRV-Headers Vulkan-Headers; do \
      git clone --depth 1 --branch vulkan-sdk-1.4.309.0 https://github.com/KhronosGroup/$r /deps/$r \
      && cmake -S /deps/$r -B /deps/$r/build -DCMAKE_INSTALL_PREFIX=/usr/local \
      && cmake --install /deps/$r/build; done
RUN git clone --depth 1 https://github.com/ggml-org/whisper.cpp /src
RUN cmake -S /src -B /build -DGGML_VULKAN=ON -DBUILD_SHARED_LIBS=OFF \
      -DCMAKE_BUILD_TYPE=Release -DGGML_NATIVE=OFF -DWHISPER_BUILD_TESTS=OFF \
      -DCMAKE_PREFIX_PATH=/usr/local -DVulkan_INCLUDE_DIR=/usr/local/include \
    && cmake --build /build -j 12 --config Release --target whisper-cli

FROM node:22-bookworm-slim

# ── Dependencias del sistema ─────────────────────────────────────────
# - python3: yt-dlp lo necesita en runtime.
# - ffmpeg: extracción/transcodificación de audio.
# - ca-certificates/curl/xz-utils: descargar binarios.
# - build-essential + python3 (node-gyp): compilar better-sqlite3 si no hay prebuilt.
# - libvulkan1 + mesa-vulkan-drivers + libgomp1: whisper-cli en la GPU (RADV).
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 ffmpeg ca-certificates curl xz-utils unzip \
      build-essential \
      docker.io \
      libvulkan1 mesa-vulkan-drivers libgomp1 \
    && rm -rf /var/lib/apt/lists/*

# whisper-cli (modelo medium: se descarga solo a /data/models la 1ª vez).
COPY --from=whisper /build/bin/whisper-cli /usr/local/bin/whisper-cli

ARG TARGETARCH

# ── yt-dlp (binario oficial) ─────────────────────────────────────────
RUN curl -fsSL https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp \
      -o /usr/local/bin/yt-dlp \
    && chmod +x /usr/local/bin/yt-dlp

# ── deno (runtime JS para yt-dlp) ────────────────────────────────────
RUN curl -fsSL https://deno.land/install.sh | DENO_INSTALL=/usr/local sh \
    && /usr/local/bin/deno --version

# ── cloudflared (túnel) ──────────────────────────────────────────────
RUN set -eux; \
    case "${TARGETARCH:-amd64}" in \
      amd64) CF_ARCH=amd64 ;; \
      arm64) CF_ARCH=arm64 ;; \
      arm)   CF_ARCH=arm ;; \
      *)     CF_ARCH=amd64 ;; \
    esac; \
    curl -fsSL "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${CF_ARCH}" \
      -o /usr/local/bin/cloudflared; \
    chmod +x /usr/local/bin/cloudflared; \
    cloudflared --version

# ── pnpm ─────────────────────────────────────────────────────────────
RUN corepack enable && corepack prepare pnpm@11.0.8 --activate

WORKDIR /app

# Copia manifests primero (mejor cache de capas).
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY packages/db/package.json        packages/db/package.json
COPY packages/yt/package.json        packages/yt/package.json
COPY packages/api/package.json       packages/api/package.json
COPY packages/server-core/package.json packages/server-core/package.json
COPY apps/server/package.json        apps/server/package.json

# Instala SOLO lo que el servidor necesita (compila better-sqlite3 para Node 22).
RUN pnpm install --filter @ritmiq/server... --config.confirmModulesPurge=false \
    || pnpm install

# Copia el código fuente de los workspaces usados por el servidor.
COPY packages/db        packages/db
COPY packages/yt        packages/yt
COPY packages/api       packages/api
COPY packages/server-core packages/server-core
COPY apps/server        apps/server

# Recompila native deps por si el copy invalidó algo.
RUN pnpm rebuild better-sqlite3 || true

# ── Configuración runtime ────────────────────────────────────────────
ENV RITMIQ_DATA_DIR=/data \
    RITMIQ_PORT=3939 \
    RITMIQ_YTDLP_PATH=/usr/local/bin/yt-dlp \
    RITMIQ_YTDLP_JS_RUNTIME=deno:/usr/local/bin/deno \
    RITMIQ_CLOUDFLARED_PATH=/usr/local/bin/cloudflared \
    RITMIQ_YTDLP_COOKIES_BROWSER=none \
    NODE_ENV=production

VOLUME ["/data"]
EXPOSE 3939

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://localhost:3939/health || exit 1

WORKDIR /app/apps/server

# Entrypoint: actualiza yt-dlp al arrancar (YouTube rompe la extracción seguido;
# yt-dlp publica releases frecuentes). Ver docker-entrypoint.sh.
COPY apps/server/docker-entrypoint.sh /usr/local/bin/ritmiq-entrypoint.sh
RUN chmod +x /usr/local/bin/ritmiq-entrypoint.sh
CMD ["/usr/local/bin/ritmiq-entrypoint.sh"]
