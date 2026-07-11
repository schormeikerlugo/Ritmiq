# Ritmiq Login Agent — contenedor de login de YouTube bajo demanda.
#
# Chromium (headed) + Xvfb + x11vnc + noVNC (websockify). El usuario ve el
# navegador por noVNC en el puerto 6080, hace login en YouTube, y el agente
# (Playwright) detecta la sesión, exporta las cookies y las sube al servidor.
#
# Build (desde la RAÍZ del monorepo):
#   docker build -f apps/login-agent/Dockerfile -t ritmiq-login .

FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
      chromium \
      xvfb x11vnc novnc websockify \
      fonts-liberation ca-certificates \
      dumb-init \
    && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@11.0.8 --activate

WORKDIR /app
COPY apps/login-agent/package.json apps/login-agent/package.json
# Instala playwright-core sin descargar browsers (usamos chromium del sistema).
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN cd apps/login-agent && pnpm install --prod --config.confirmModulesPurge=false || pnpm install --prod
COPY apps/login-agent/src apps/login-agent/src
COPY apps/login-agent/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENV DISPLAY=:99 \
    RITMIQ_CHROMIUM_PATH=/usr/bin/chromium \
    NOVNC_PORT=6080

EXPOSE 6080

ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["/entrypoint.sh"]
