/**
 * Sugiere un @username a partir del email del usuario.
 *
 * Reglas:
 *  - Toma la parte antes del `@`
 *  - Reemplaza `.`, `-`, `+` por `_`
 *  - Quita cualquier otro caracter no permitido (regex backend: ^[a-z0-9_]+$)
 *  - Convierte a lowercase
 *  - Trunca a 24 chars
 *  - Pad a 3 chars con sufijo numerico si quedo muy corto
 *
 * Ejemplos:
 *   "pedro.lopez@gmail.com"   → "pedro_lopez"
 *   "JOHN+DOE@example.com"    → "john_doe"
 *   "a@b.c"                   → "a23" (pad)
 *   "user!name@x.com"         → "username"
 *   "averylongusernamemorethantwentyfourchars@x.com" → "averylongusernamemorethant"
 *
 * @param {string} email
 * @returns {string} username sugerido, ya validable
 */
export function suggestUsernameFromEmail(email) {
  const raw = String(email ?? '').trim().toLowerCase();
  if (!raw || !raw.includes('@')) return '';

  let local = raw.split('@')[0] ?? '';
  // Reemplaza separadores comunes por underscore
  local = local.replace(/[.\-+]/g, '_');
  // Quita cualquier caracter no permitido
  local = local.replace(/[^a-z0-9_]/g, '');
  // Colapsa underscores repetidos
  local = local.replace(/_{2,}/g, '_');
  // Quita underscores al inicio/final
  local = local.replace(/^_+|_+$/g, '');

  if (!local) return '';

  // Trunca a 24
  if (local.length > 24) local = local.slice(0, 24);

  // Si quedo demasiado corto (<3), pad con numero pseudoaleatorio
  if (local.length < 3) {
    const pad = String(Math.floor(Math.random() * 900) + 100); // 3 digitos
    local = (local + pad).slice(0, 24);
  }

  return local;
}
