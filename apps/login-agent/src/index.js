#!/usr/bin/env node
/**
 * Ritmiq Login Agent — corre DENTRO del contenedor de login (Chromium +
 * Xvfb + noVNC). Abre YouTube en un Chromium visible (que el usuario ve por
 * noVNC), espera a que inicie sesión, y cuando detecta la cookie de sesión
 * de Google, exporta TODAS las cookies a formato Netscape y las sube al
 * servidor principal (`/cookies/upload`) con el device_token de la sesión.
 *
 * Variables de entorno:
 *   RITMIQ_SERVER_URL   URL del servidor principal (p.ej. http://host:3939)
 *   RITMIQ_DEVICE_TOKEN device_token del usuario que vincula
 *   RITMIQ_LOGIN_TIMEOUT_MS  timeout total (default 300000 = 5 min)
 *   DISPLAY             X display (lo setea el contenedor, p.ej. :99)
 *
 * Al terminar (éxito, timeout o cierre), sale con código 0/1 y el contenedor
 * se apaga.
 *
 * @module @ritmiq/login-agent
 */
import { chromium } from 'playwright-core';

const SERVER = process.env.RITMIQ_SERVER_URL;
const TOKEN = process.env.RITMIQ_DEVICE_TOKEN;
const TIMEOUT = Number(process.env.RITMIQ_LOGIN_TIMEOUT_MS ?? 300000);
const CHROMIUM_PATH = process.env.RITMIQ_CHROMIUM_PATH || '/usr/bin/chromium';

// Cookie que indica sesión de Google iniciada.
const SESSION_COOKIE = /^__Secure-1PSID$|^SID$/;

if (!SERVER || !TOKEN) {
  console.error('[login-agent] faltan RITMIQ_SERVER_URL / RITMIQ_DEVICE_TOKEN');
  process.exit(1);
}

/** Convierte cookies de Playwright a formato Netscape (cookies.txt). */
function toNetscape(cookies) {
  const lines = ['# Netscape HTTP Cookie File', '# Generado por Ritmiq Login Agent'];
  for (const c of cookies) {
    const domain = c.domain.startsWith('.') ? c.domain : c.domain;
    const includeSub = domain.startsWith('.') ? 'TRUE' : 'FALSE';
    const secure = c.secure ? 'TRUE' : 'FALSE';
    // expires 0 → sesión; Netscape usa epoch seconds.
    const expires = c.expires && c.expires > 0 ? Math.floor(c.expires) : 0;
    lines.push([domain, includeSub, c.path || '/', secure, expires, c.name, c.value].join('\t'));
  }
  return lines.join('\n') + '\n';
}

async function uploadCookies(netscape) {
  const b64 = Buffer.from(netscape, 'utf8').toString('base64');
  const r = await fetch(`${SERVER.replace(/\/$/, '')}/cookies/upload`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ cookies_b64: b64 }),
  });
  if (!r.ok) throw new Error(`upload falló ${r.status}: ${await r.text().catch(() => '')}`);
  return r.json();
}

async function main() {
  console.log('[login-agent] lanzando Chromium…');
  const browser = await chromium.launch({
    headless: false,
    executablePath: CHROMIUM_PATH,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--start-maximized'],
  });
  const context = await browser.newContext({ viewport: null });
  const page = await context.newPage();
  await page.goto('https://accounts.google.com/ServiceLogin?service=youtube', {
    waitUntil: 'domcontentloaded',
  }).catch(() => {});

  console.log('[login-agent] esperando login del usuario (vía noVNC)…');

  const deadline = Date.now() + TIMEOUT;
  let done = false;

  while (Date.now() < deadline && !done) {
    await new Promise((r) => setTimeout(r, 3000));
    let cookies = [];
    try { cookies = await context.cookies(['https://www.youtube.com', 'https://accounts.google.com']); }
    catch { continue; }
    const hasSession = cookies.some((c) => SESSION_COOKIE.test(c.name) && c.value && c.value.length > 10);
    if (hasSession) {
      // Damos un pequeño margen para que se asienten todas las cookies.
      await new Promise((r) => setTimeout(r, 2000));
      const all = await context.cookies();
      const netscape = toNetscape(all);
      console.log(`[login-agent] sesión detectada, ${all.length} cookies → subiendo…`);
      try {
        await uploadCookies(netscape);
        console.log('[login-agent] cookies subidas y vinculadas ✓');
        done = true;
      } catch (e) {
        console.error('[login-agent] upload error:', e?.message ?? e);
      }
    }
  }

  try { await browser.close(); } catch {}
  if (!done) {
    console.error('[login-agent] timeout sin login — sin cambios');
    process.exit(1);
  }
  process.exit(0);
}

main().catch((e) => { console.error('[login-agent] fatal:', e); process.exit(1); });
