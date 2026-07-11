/**
 * Verificación de JWT de Supabase para el servidor headless.
 *
 * Objetivo de seguridad: que el `supabase_user_id` de un cliente sea CONFIABLE
 * (extraído del `sub` de un token firmado por Supabase), no autodeclarado en el
 * body. Sin esto, un cliente podría suplantar a otra cuenta en el modelo de
 * administración por cuenta (sub-admin).
 *
 * El proyecto Supabase de Ritmiq firma sus JWT con **ES256** (clave asimétrica
 * ECC P-256). Verificamos contra la clave pública publicada en el JWKS del
 * proyecto — el servidor nunca necesita un secreto de firma, solo la clave
 * pública, así que no puede emitir tokens. Se mantiene un fallback a HS256
 * (clave simétrica legacy) por si un proyecto aún la usa.
 *
 * Implementación sin dependencias externas: usa `node:crypto` para verificar la
 * firma y decodificar el payload. Cachea el JWKS en memoria (TTL configurable).
 *
 * @module @ritmiq/server-core/auth-jwt
 */
import crypto from 'node:crypto';

/** @typedef {{ userId: string, email: string|null, payload: object }} VerifiedJwt */

/** Decodifica base64url → Buffer. */
function b64urlToBuf(s) {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64');
}

/** Decodifica base64url → objeto JSON (o null si falla). */
function b64urlToJson(s) {
  try {
    return JSON.parse(b64urlToBuf(s).toString('utf8'));
  } catch {
    return null;
  }
}

/**
 * Convierte la firma JWS de ECDSA (concatenación r||s, formato "raw" de JOSE)
 * al formato DER que espera `crypto.verify`.
 * @param {Buffer} raw firma de 64 bytes (P-256)
 * @returns {Buffer} firma DER
 */
function joseToDer(raw) {
  const size = raw.length / 2;
  let r = raw.subarray(0, size);
  let s = raw.subarray(size);
  // Quitar ceros a la izquierda y volver a añadir uno si el MSB está activo
  // (para que DER lo interprete como positivo).
  const trim = (b) => {
    let i = 0;
    while (i < b.length - 1 && b[i] === 0) i++;
    b = b.subarray(i);
    if (b[0] & 0x80) b = Buffer.concat([Buffer.from([0]), b]);
    return b;
  };
  r = trim(r);
  s = trim(s);
  const seqLen = 2 + r.length + 2 + s.length;
  return Buffer.concat([
    Buffer.from([0x30, seqLen]),
    Buffer.from([0x02, r.length]),
    r,
    Buffer.from([0x02, s.length]),
    s,
  ]);
}

/**
 * Crea un verificador de JWT de Supabase.
 *
 * @param {object} opts
 * @param {string} [opts.jwksUrl]   URL del JWKS (default: `${supabaseUrl}/auth/v1/.well-known/jwks.json`)
 * @param {string} [opts.supabaseUrl] Base URL del proyecto (para derivar jwksUrl e issuer)
 * @param {string} [opts.hs256Secret] Secreto HS256 legacy (opcional)
 * @param {string} [opts.audience]   Audiencia esperada (default 'authenticated')
 * @param {number} [opts.jwksTtlMs]  TTL de la caché del JWKS (default 1h)
 * @param {(url:string)=>Promise<any>} [opts.fetchImpl] fetch inyectable (tests)
 * @returns {{ verify: (token:string)=>Promise<VerifiedJwt|null>, isConfigured: ()=>boolean }}
 */
export function createJwtVerifier(opts = {}) {
  const supabaseUrl = (opts.supabaseUrl || '').replace(/\/+$/, '');
  const jwksUrl =
    opts.jwksUrl ||
    (supabaseUrl ? `${supabaseUrl}/auth/v1/.well-known/jwks.json` : null);
  const hs256Secret = opts.hs256Secret || null;
  const audience = opts.audience ?? 'authenticated';
  const issuer = supabaseUrl ? `${supabaseUrl}/auth/v1` : null;
  const jwksTtlMs = opts.jwksTtlMs ?? 60 * 60 * 1000;
  const doFetch = opts.fetchImpl || globalThis.fetch;

  /** @type {{ keys: Map<string, crypto.KeyObject>, fetchedAt: number }|null} */
  let jwksCache = null;

  function isConfigured() {
    return Boolean(jwksUrl || hs256Secret);
  }

  async function loadJwks(force = false) {
    if (!jwksUrl) return new Map();
    const fresh =
      jwksCache && !force && Date.now() - jwksCache.fetchedAt < jwksTtlMs;
    if (fresh) return jwksCache.keys;
    if (!doFetch) throw new Error('fetch no disponible para cargar JWKS');
    const res = await doFetch(jwksUrl);
    if (!res || !res.ok) throw new Error(`JWKS fetch falló (${res?.status})`);
    const body = await res.json();
    const keys = new Map();
    for (const jwk of body.keys || []) {
      if (jwk.use && jwk.use !== 'sig') continue;
      try {
        const keyObj = crypto.createPublicKey({ key: jwk, format: 'jwk' });
        keys.set(jwk.kid || `${jwk.kty}:${jwk.alg}`, { keyObj, alg: jwk.alg });
      } catch {
        // Clave no importable (p.ej. HS256 sin material público); ignorar.
      }
    }
    jwksCache = { keys, fetchedAt: Date.now() };
    return keys;
  }

  /**
   * Verifica un token. Devuelve `{ userId, email, payload }` o `null` si es
   * inválido/expirado/no verificable.
   * @param {string} token
   * @returns {Promise<VerifiedJwt|null>}
   */
  async function verify(token) {
    if (!token || typeof token !== 'string') return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [h, p, sig] = parts;
    const header = b64urlToJson(h);
    const payload = b64urlToJson(p);
    if (!header || !payload) return null;

    // Validaciones de claims temporales y de audiencia/issuer.
    const now = Math.floor(Date.now() / 1000);
    if (typeof payload.exp === 'number' && payload.exp < now) return null;
    if (typeof payload.nbf === 'number' && payload.nbf > now + 60) return null;
    if (audience && payload.aud) {
      const auds = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
      if (!auds.includes(audience)) return null;
    }
    if (issuer && payload.iss && payload.iss !== issuer) return null;
    if (!payload.sub) return null;

    const signingInput = Buffer.from(`${h}.${p}`);
    const signature = b64urlToBuf(sig);
    const alg = header.alg;

    let ok = false;
    try {
      if (alg === 'HS256') {
        if (!hs256Secret) return null;
        const expected = crypto
          .createHmac('sha256', hs256Secret)
          .update(signingInput)
          .digest();
        ok =
          expected.length === signature.length &&
          crypto.timingSafeEqual(expected, signature);
      } else if (alg === 'ES256' || alg === 'RS256') {
        let keys = await loadJwks();
        let entry = header.kid ? keys.get(header.kid) : null;
        if (!entry) {
          // kid desconocido: recargar JWKS por si rotaron claves.
          keys = await loadJwks(true);
          entry = header.kid
            ? keys.get(header.kid)
            : [...keys.values()].find((k) => k.alg === alg);
        }
        if (!entry) return null;
        if (alg === 'ES256') {
          ok = crypto.verify(
            'sha256',
            signingInput,
            { key: entry.keyObj, dsaEncoding: 'der' },
            joseToDer(signature),
          );
        } else {
          ok = crypto.verify('sha256', signingInput, entry.keyObj, signature);
        }
      } else {
        return null; // algoritmo no soportado
      }
    } catch {
      return null;
    }
    if (!ok) return null;

    return {
      userId: String(payload.sub),
      email: payload.email ? String(payload.email) : null,
      payload,
    };
  }

  return { verify, isConfigured };
}
