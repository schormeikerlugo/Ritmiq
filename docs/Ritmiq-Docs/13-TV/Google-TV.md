---
tipo: aplicacion
capa: tv
plataforma: android-tv
estado: prototipo
ultima-revision: 2026-11-04
archivo: apps/tv/capacitor.config.json
tags:
  - tv
  - google-tv
  - android
  - capacitor
  - lan
---

# App de Google TV (`apps/tv`)

> Ritmiq en el televisor (Google TV / Android TV, probado para un onn. con Google TV). Es la misma interfaz `@ritmiq/ui` empaquetada con **Capacitor 8** como APK, que habla con el servidor 24/7 **por la red local** y cae al túnel si no está en casa.

## Por qué Google TV y no webOS / iOS
- iOS: App Store prohíbe el contenido de YouTube (5.2.3); TestFlight/Ad Hoc requieren cuenta de 99 USD/año y Mac.
- LG webOS: el Modo Desarrollador caduca cada 1000 h y webOS limita a un `<audio>` sin MediaElementSource (sin EQ ni visualizador).
- Google TV: instalación por ADB que no caduca, audio en segundo plano posible, build desde Linux.

## Estructura
| Archivo | Qué |
|---|---|
| `vite.config.js` | Build de la UI sin service worker; define `VITE_SERVER_LAN_URL` (env `RITMIQ_TV_SERVER_LAN_URL`, default `http://192.168.68.117:3939`). |
| `src/main.jsx` | Monta `<App />` (sin `setupPwaUpdates`). |
| `capacitor.config.json` | `appId org.ritmiq.tv`, `androidScheme: "http"` (origen `http://localhost`: ya permitido por el CORS del lan-server y sin contenido mixto hacia la LAN), `cleartext: true`. |
| `android/` | Proyecto Android generado. Manifiesto con `LEANBACK_LAUNCHER`, `banner` 320×180, `leanback`/`touchscreen` no obligatorios (el APK sirve también en teléfonos). |

## Red: LAN primero, túnel de respaldo
`lan-client.js` `probeServerLan()`: si el build define `VITE_SERVER_LAN_URL`, hace `GET /health` (timeout 1,2 s) al arrancar, al volver a primer plano, al recuperar red y cada 60 s. Si responde, `getServerUrlSync()` devuelve la URL LAN y todo (búsqueda, prewarm, stream, pareo) va por ahí; si no, el túnel `ritmiq.org`. Es el mismo host, así que el `device_token` vale para ambas rutas. En la PWA la variable no existe → no-op.

Medido (2026-11-04): primer byte de una canción en disco **~10 ms por LAN vs ~600 ms por túnel**; clic → suena 2,1 s incluyendo la búsqueda.

**Firewall del servidor**: se añadió `ufw allow from 192.168.68.0/24 to any port 3939 proto tcp` (comentario "Ritmiq LAN (app TV)"), igual que el resto de servicios: solo LAN. Si el servidor cambia de IP hay que recompilar con `RITMIQ_TV_SERVER_LAN_URL` (conviene IP fija en el router).

## Compilar e instalar
Herramientas en espacio de usuario (sin sudo): JDK 21 en `~/.local/opt/jdk-21.0.13+9`, Android SDK en `~/.local/opt/android-sdk` (platform-tools, platforms 35/36, build-tools 35/36).

```bash
export JAVA_HOME=~/.local/opt/jdk-21.0.13+9 ANDROID_HOME=~/.local/opt/android-sdk
export PATH=$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$PATH
cd apps/tv && pnpm apk          # → android/app/build/outputs/apk/debug/app-debug.apk
adb connect <IP-del-onn>:5555   # aceptar el aviso en la TV la primera vez
pnpm install-tv
```
En el onn.: Ajustes → Sistema → Información → pulsar 7 veces "Compilación del SO" → Opciones de desarrollador → **Depuración por red/USB**.

## Pendiente (fases siguientes)
1. Reproductor nativo en segundo plano (servicio en primer plano + MediaSession) para controles del mando/asistente y que no lo mate el sistema.
2. Interfaz de TV: navegación con flechas (foco), tamaños para ver de lejos, inicio de sesión con código desde el teléfono.
3. Antes de 2027: registrar el paquete con la cuenta gratuita de **distribución limitada** de Android (verificación de desarrollador global); ADB sigue exento.
4. APK de release firmado + auto-actualización desde el servidor.

## Notas / Changelog
- 2026-11-04: prototipo (fase 1): APK debug, LAN directa + túnel, verificado en navegador con viewport TV. Ver ADR-040.
