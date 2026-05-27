/**
 * Mapea errores de Supabase Auth al español, con tono claro y accionable.
 * Toma el `error.message` crudo (en inglés) y devuelve un mensaje amigable.
 *
 * Si el mensaje no esta mapeado, devuelve un fallback genérico para no exponer
 * detalles tecnicos al usuario.
 *
 * @param {Error|{ message?: string, code?: string, status?: number } | null | undefined} err
 * @param {{ context?: 'signin' | 'signup' | 'forgot' | 'reset' }} [opts]
 * @returns {string}
 */
export function translateAuthError(err, opts = {}) {
  if (!err) return '';
  const msg = String(err.message ?? err.error_description ?? err ?? '').toLowerCase();
  const code = err.code ?? '';
  const status = err.status ?? err.statusCode ?? 0;
  const ctx = opts.context ?? 'signin';

  // Credenciales invalidas (signin)
  if (msg.includes('invalid login credentials') || code === 'invalid_credentials') {
    return 'Correo o contraseña incorrectos. Verifica e inténtalo de nuevo.';
  }

  // Email ya registrado (signup)
  if (msg.includes('user already registered') || msg.includes('already been registered') || code === 'user_already_exists') {
    return 'Ya existe una cuenta con este correo. Inicia sesión en su lugar.';
  }

  // Email no confirmado
  if (msg.includes('email not confirmed') || code === 'email_not_confirmed') {
    return 'Aún no has confirmado tu correo. Revisa tu bandeja de entrada.';
  }

  // Rate limit
  if (msg.includes('rate limit') || msg.includes('too many') || status === 429) {
    return ctx === 'forgot'
      ? 'Has solicitado demasiados correos. Espera unos minutos antes de reintentar.'
      : 'Demasiados intentos. Espera un momento antes de reintentar.';
  }

  // Password debil (signup / reset)
  if (msg.includes('password should be') || msg.includes('password is too')) {
    return 'La contraseña es demasiado débil. Usa al menos 8 caracteres.';
  }

  // Email mal formado
  if (msg.includes('invalid email') || msg.includes('email address is invalid') || code === 'validation_failed') {
    return 'El correo no tiene un formato válido.';
  }

  // Usuario no encontrado (forgot password)
  if (msg.includes('user not found') || code === 'user_not_found') {
    return ctx === 'forgot'
      ? 'Si existe una cuenta con ese correo, recibirás un enlace en breve.'
      : 'No encontramos una cuenta con esos datos.';
  }

  // Sesion expirada / token invalido (reset)
  if (msg.includes('expired') || msg.includes('invalid token') || msg.includes('jwt')) {
    return 'El enlace expiró o no es válido. Solicita uno nuevo.';
  }

  // Network / sin conexion
  if (msg.includes('network') || msg.includes('fetch') || msg.includes('failed to fetch')) {
    return 'No pudimos conectar. Verifica tu conexión a internet.';
  }

  // Server error generico
  if (status >= 500) {
    return 'Tuvimos un problema. Inténtalo de nuevo en unos segundos.';
  }

  // Fallback por contexto
  switch (ctx) {
    case 'signup': return 'No pudimos crear tu cuenta. Inténtalo de nuevo.';
    case 'forgot': return 'No pudimos enviar el correo. Inténtalo de nuevo.';
    case 'reset': return 'No pudimos actualizar tu contraseña. Inténtalo de nuevo.';
    case 'signin':
    default: return 'No pudimos iniciar sesión. Inténtalo de nuevo.';
  }
}
