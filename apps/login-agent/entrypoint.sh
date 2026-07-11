#!/usr/bin/env bash
# Arranca el stack de login: Xvfb (X virtual) → x11vnc → noVNC (websockify)
# → agente Playwright. Cuando el agente termina (login OK o timeout), se
# apaga todo y el contenedor sale.
set -u

DISPLAY_NUM="${DISPLAY:-:99}"
NOVNC_PORT="${NOVNC_PORT:-6080}"
SCREEN="${RITMIQ_LOGIN_SCREEN:-1280x800x24}"

echo "[login] arrancando Xvfb en ${DISPLAY_NUM} (${SCREEN})"
Xvfb "${DISPLAY_NUM}" -screen 0 "${SCREEN}" -nolisten tcp &
XVFB_PID=$!
sleep 1

echo "[login] arrancando x11vnc"
x11vnc -display "${DISPLAY_NUM}" -nopw -forever -shared -quiet -rfbport 5900 &
VNC_PID=$!
sleep 1

echo "[login] arrancando noVNC en :${NOVNC_PORT}"
# websockify sirve el cliente noVNC y hace de puente a x11vnc:5900.
websockify --web=/usr/share/novnc "${NOVNC_PORT}" localhost:5900 &
NOVNC_PID=$!
sleep 1

cleanup() {
  echo "[login] limpiando…"
  kill "$AGENT_PID" "$NOVNC_PID" "$VNC_PID" "$XVFB_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo "[login] lanzando agente Playwright"
node /app/apps/login-agent/src/index.js &
AGENT_PID=$!

# El contenedor vive mientras el agente viva.
wait "$AGENT_PID"
AGENT_EXIT=$?
echo "[login] agente terminó (code=${AGENT_EXIT})"
exit "$AGENT_EXIT"
