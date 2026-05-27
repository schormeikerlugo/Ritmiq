/**
 * Scoring simple de fortaleza de contraseña sin dependencias.
 *
 * Criterios (cada uno suma puntos):
 *  - longitud >= 8       (+1)
 *  - longitud >= 12      (+1)
 *  - tiene minuscula     (+1)
 *  - tiene mayuscula     (+1)
 *  - tiene numero        (+1)
 *  - tiene simbolo       (+1)
 *  - no es secuencia trivial (qwerty, 12345, password, etc.) (+1)
 *
 * Mapeo final a 4 niveles (0..3) para mostrar 4 segmentos visuales:
 *  score < 3  → 0 (weak)
 *  score 3-4  → 1 (fair)
 *  score 5-6  → 2 (good)
 *  score >= 7 → 3 (strong)
 *
 * @param {string} pwd
 * @returns {{ score: 0|1|2|3, label: string, suggestions: string[] }}
 */
const COMMON_PATTERNS = [
  /^123/, /^abc/i, /password/i, /qwerty/i, /letmein/i, /admin/i,
  /^[0-9]+$/, /^[a-z]+$/i, /(.)\1{3,}/,
];

export function scorePassword(pwd) {
  const p = String(pwd ?? '');
  if (!p) return { score: 0, label: 'Vacía', suggestions: [] };

  let raw = 0;
  const sugg = [];

  if (p.length >= 8) raw += 1; else sugg.push('Usa al menos 8 caracteres');
  if (p.length >= 12) raw += 1;
  if (/[a-z]/.test(p)) raw += 1; else sugg.push('Incluye una minúscula');
  if (/[A-Z]/.test(p)) raw += 1; else sugg.push('Incluye una mayúscula');
  if (/[0-9]/.test(p)) raw += 1; else sugg.push('Incluye un número');
  if (/[^a-zA-Z0-9]/.test(p)) raw += 1; else sugg.push('Incluye un símbolo');

  const trivial = COMMON_PATTERNS.some((rx) => rx.test(p));
  if (!trivial) raw += 1; else sugg.push('Evita secuencias o palabras comunes');

  let score = 0;
  let label = 'Débil';
  if (raw >= 7) { score = 3; label = 'Muy segura'; }
  else if (raw >= 5) { score = 2; label = 'Buena'; }
  else if (raw >= 3) { score = 1; label = 'Aceptable'; }

  return { score, label, suggestions: sugg.slice(0, 2) };
}

/**
 * Determina si la contraseña es lo suficientemente fuerte para permitir signup.
 * Permitimos a partir de "Aceptable" (score >= 1) para no ser demasiado estrictos
 * y bloquear usuarios reales.
 */
export function isPasswordAcceptable(pwd) {
  return scorePassword(pwd).score >= 1 && String(pwd ?? '').length >= 8;
}
