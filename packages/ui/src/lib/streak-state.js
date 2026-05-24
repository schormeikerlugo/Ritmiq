/**
 * Estado de racha estilo TikTok — calcula el "humor" de la racha del
 * usuario segun la hora local y la ultima fecha que reproduzco algo.
 *
 * Estados:
 *   inactive    sin actividad ni record historico
 *   fulfilled   ya escucho HOY (racha cumplida, calida)
 *   calm        no escucho hoy, hora < 12 (tranquila, no urgente)
 *   danger      no escucho hoy, 12-18 (en peligro, halo azul)
 *   urgent      no escucho hoy, 18-23 (urgente, jitter, ceniza)
 *   last-hour   no escucho hoy, 23-23:59 (countdown MM:SS dramatico)
 *   broken      ultimo play fue ANTES de ayer (racha rota)
 *
 * Funcion pura: depende solo del streakSnapshot del store + new Date().
 * Si snapshot null o invalido, devuelve 'inactive' (silencio seguro).
 *
 * @module @ritmiq/ui/lib/streak-state
 */

/**
 * @typedef {Object} StreakState
 * @property {'inactive'|'fulfilled'|'calm'|'danger'|'urgent'|'last-hour'|'broken'} status
 * @property {number} currentStreak
 * @property {number} longestStreak
 * @property {number|null} minutesRemaining  Minutos hasta medianoche local
 *                                            (null si no aplica).
 * @property {number|null} daysSinceBroken   Solo para status='broken'.
 * @property {string} label                  Texto principal para la card.
 * @property {string} subLabel               Texto secundario.
 * @property {string|null} countdown         'MM:SS' solo si last-hour.
 */

/**
 * Genera 'YYYY-MM-DD' del dia LOCAL para una fecha (no UTC).
 * @param {Date} d
 * @returns {string}
 */
function localDayKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Diferencia de dias entre dos claves locales 'YYYY-MM-DD'.
 * Asume que ambas son fechas LOCALES del mismo timezone.
 * @param {string} fromKey  fecha mas antigua
 * @param {string} toKey    fecha mas reciente
 * @returns {number}
 */
function daysBetween(fromKey, toKey) {
  try {
    const a = new Date(`${fromKey}T00:00:00`);
    const b = new Date(`${toKey}T00:00:00`);
    return Math.round((b.getTime() - a.getTime()) / 86400_000);
  } catch {
    return 0;
  }
}

/**
 * Minutos restantes hasta medianoche LOCAL.
 * @param {Date} now
 * @returns {number}
 */
function minutesUntilMidnight(now) {
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  const diff = end.getTime() - now.getTime();
  return Math.max(0, Math.ceil(diff / 60_000));
}

/**
 * Formato MM:SS de minutos restantes a partir de `now` hasta medianoche.
 * Solo se usa para last-hour. Incluye segundos.
 * @param {Date} now
 * @returns {string}
 */
function countdownToMidnight(now) {
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  let secs = Math.max(0, Math.ceil((end.getTime() - now.getTime()) / 1000));
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/**
 * Texto humano "Te quedan X h" o "X min" segun magnitud.
 * @param {number} minutes
 * @returns {string}
 */
function humanRemaining(minutes) {
  if (minutes <= 0) return 'menos de 1 min';
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 1 && m === 0) return '1 h';
  if (m === 0) return `${h} h`;
  if (h === 1) return `1 h ${m} min`;
  return `${h} h`;
}

/**
 * Calcula el estado actual de la racha del usuario.
 *
 * @param {Object} params
 * @param {Object|null} params.streakSnapshot  Snapshot autoritativo del
 *   store. Tiene currentStreak, longestStreak, lastPlayedDate.
 * @param {number} [params.fallbackStreak]    Si no hay snapshot,
 *   calculo local de events (selectStatsForPeriod.streak).
 * @param {Date} [params.now]                  Fecha de referencia
 *   (default: new Date()). Util para tests.
 * @returns {StreakState}
 */
export function selectStreakState({ streakSnapshot, fallbackStreak = 0, now = new Date() } = {}) {
  // Sin snapshot: usar fallback (calculo local desde events).
  const snap = streakSnapshot ?? null;
  const currentStreak = snap?.currentStreak ?? fallbackStreak ?? 0;
  const longestStreak = snap?.longestStreak ?? currentStreak;
  const lastPlayedDate = snap?.lastPlayedDate ?? null;

  // Caso 1: sin actividad ni record historico.
  if (currentStreak === 0 && longestStreak === 0 && !lastPlayedDate) {
    return {
      status: 'inactive',
      currentStreak: 0,
      longestStreak: 0,
      minutesRemaining: null,
      daysSinceBroken: null,
      label: 'Empieza tu racha hoy',
      subLabel: 'Escucha cualquier canción',
      countdown: null,
    };
  }

  const todayKey = localDayKey(now);
  const yesterdayKey = localDayKey(new Date(now.getTime() - 86400_000));

  // Caso 2: ya escucho hoy → cumplida.
  if (lastPlayedDate === todayKey) {
    return {
      status: 'fulfilled',
      currentStreak,
      longestStreak,
      minutesRemaining: null,
      daysSinceBroken: null,
      label: '¡Día cumplido!',
      subLabel:
        currentStreak === longestStreak && longestStreak >= 3
          ? '¡tu mejor racha!'
          : currentStreak === 1
          ? 'primer día'
          : 'consecutivos',
      countdown: null,
    };
  }

  // Caso 3: ultimo play fue ayer → racha viva pero pendiente HOY.
  if (lastPlayedDate === yesterdayKey) {
    const hour = now.getHours();
    const minutesRemaining = minutesUntilMidnight(now);

    if (hour < 12) {
      return {
        status: 'calm',
        currentStreak,
        longestStreak,
        minutesRemaining,
        daysSinceBroken: null,
        label: 'Mantén tu racha hoy',
        subLabel: `${currentStreak} ${currentStreak === 1 ? 'día' : 'días'} acumulados`,
        countdown: null,
      };
    }
    if (hour < 18) {
      return {
        status: 'danger',
        currentStreak,
        longestStreak,
        minutesRemaining,
        daysSinceBroken: null,
        label: `Te quedan ${humanRemaining(minutesRemaining)}`,
        subLabel: `racha de ${currentStreak} ${currentStreak === 1 ? 'día' : 'días'}`,
        countdown: null,
      };
    }
    if (hour < 23) {
      return {
        status: 'urgent',
        currentStreak,
        longestStreak,
        minutesRemaining,
        daysSinceBroken: null,
        label: `¡Quedan ${humanRemaining(minutesRemaining)}!`,
        subLabel: `salva tu racha de ${currentStreak}`,
        countdown: null,
      };
    }
    // hour >= 23 → ultima hora con countdown MM:SS.
    return {
      status: 'last-hour',
      currentStreak,
      longestStreak,
      minutesRemaining,
      daysSinceBroken: null,
      label: 'Tu racha se apaga',
      subLabel: `racha de ${currentStreak} ${currentStreak === 1 ? 'día' : 'días'}`,
      countdown: countdownToMidnight(now),
    };
  }

  // Caso 4: ultimo play fue ANTES de ayer → racha rota.
  if (lastPlayedDate && lastPlayedDate < yesterdayKey) {
    const daysSince = daysBetween(lastPlayedDate, todayKey);
    return {
      status: 'broken',
      currentStreak: 0,
      longestStreak,
      minutesRemaining: null,
      daysSinceBroken: daysSince,
      label: longestStreak > 0
        ? `Tu mejor racha fue ${longestStreak} ${longestStreak === 1 ? 'día' : 'días'}`
        : 'Empieza tu racha',
      subLabel: 'Empieza de nuevo. Escucha algo hoy.',
      countdown: null,
    };
  }

  // Caso fallback: hay currentStreak local desde events pero no
  // lastPlayedDate fiable (snapshot incompleto). Tratamos como calm
  // para no asustar al user con falso peligro.
  if (currentStreak > 0) {
    return {
      status: 'calm',
      currentStreak,
      longestStreak,
      minutesRemaining: minutesUntilMidnight(now),
      daysSinceBroken: null,
      label: 'Mantén tu racha',
      subLabel: `${currentStreak} ${currentStreak === 1 ? 'día' : 'días'}`,
      countdown: null,
    };
  }

  // Sin nada — pero hubo record historico alguna vez.
  return {
    status: 'inactive',
    currentStreak: 0,
    longestStreak,
    minutesRemaining: null,
    daysSinceBroken: null,
    label: longestStreak > 0 ? 'Recupera tu racha' : 'Empieza tu racha hoy',
    subLabel: longestStreak > 0
      ? `tu mejor: ${longestStreak} días`
      : 'escucha cualquier canción',
    countdown: null,
  };
}
