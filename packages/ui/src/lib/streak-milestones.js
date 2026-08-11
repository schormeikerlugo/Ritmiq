/**
 * Fuente unica de verdad de los TROFEOS de racha (milestones por dias).
 *
 * Estrategia hibrida progresiva (decision 2026-08-10):
 *   - Arranque frecuente (3, 7, 14 dias) para enganchar al usuario nuevo.
 *   - Un trofeo CADA 30 DIAS entre el mes 1 y el ano (30, 60, ... 365) para
 *     que mantener la racha siga siendo relevante todo el ano.
 *   - Legendarios espaciados despues del ano (500, 730 = 2 anos, 1000).
 *
 * Estos umbrales DEBEN coincidir con:
 *   - El CHECK constraint y el trigger check_streak_milestones() en
 *     supabase/migrations/20260810000000_streak_tz_and_milestones.sql
 *   - El mapa VARIANTS en components/MilestoneToast/MilestoneToast.jsx
 *     (que consume STREAK_MILESTONES / tierToVariant de este modulo).
 *
 * Tiers visuales:
 *   bronze     3 – 30
 *   silver     60 – 150
 *   gold       180 – 330
 *   diamond    365
 *   legendary  500+
 *
 * @module @ritmiq/ui/lib/streak-milestones
 */

/**
 * @typedef {Object} StreakMilestoneDef
 * @property {number} value  Dias de racha requeridos.
 * @property {string} label  Texto humano ('30 días', '1 año'...).
 * @property {string} icon   Nombre de icono (Icon.jsx).
 * @property {'bronze'|'silver'|'gold'|'diamond'|'legendary'} tier
 */

/** @type {StreakMilestoneDef[]} */
export const STREAK_MILESTONES = [
  // Arranque
  { value: 3,    label: '3 días',   icon: 'Flame',       tier: 'bronze' },
  { value: 7,    label: '7 días',   icon: 'Flame',       tier: 'bronze' },
  { value: 14,   label: '2 semanas', icon: 'Sparkles',   tier: 'bronze' },
  // Cada 30 días hasta el año
  { value: 30,   label: '1 mes',    icon: 'Star',        tier: 'bronze' },
  { value: 60,   label: '2 meses',  icon: 'Star',        tier: 'silver' },
  { value: 90,   label: '3 meses',  icon: 'Star',        tier: 'silver' },
  { value: 120,  label: '4 meses',  icon: 'CalendarDays', tier: 'silver' },
  { value: 150,  label: '5 meses',  icon: 'CalendarDays', tier: 'silver' },
  { value: 180,  label: '6 meses',  icon: 'Trophy',      tier: 'gold' },
  { value: 210,  label: '7 meses',  icon: 'Trophy',      tier: 'gold' },
  { value: 240,  label: '8 meses',  icon: 'Trophy',      tier: 'gold' },
  { value: 270,  label: '9 meses',  icon: 'Trophy',      tier: 'gold' },
  { value: 300,  label: '10 meses', icon: 'Award',       tier: 'gold' },
  { value: 330,  label: '11 meses', icon: 'Award',       tier: 'gold' },
  { value: 365,  label: '1 año',    icon: 'Award',       tier: 'diamond' },
  // Legendarios
  { value: 500,  label: '500 días', icon: 'Crown',       tier: 'legendary' },
  { value: 730,  label: '2 años',   icon: 'Crown',       tier: 'legendary' },
  { value: 1000, label: '1000 días', icon: 'Crown',      tier: 'legendary' },
];

/**
 * Umbrales LEGACY de la estrategia anterior (50, 100, 200). Ya no se
 * otorgan a usuarios nuevos, pero algunos los desbloquearon antes. Se
 * incluyen en la galeria SOLO si el usuario los tiene desbloqueados, para
 * no perder logros historicos. No forman parte de STREAK_MILESTONES para
 * que no aparezcan como "por desbloquear".
 * @type {StreakMilestoneDef[]}
 */
export const LEGACY_STREAK_MILESTONES = [
  { value: 50,  label: '50 días',  icon: 'Star',   tier: 'silver' },
  { value: 100, label: '100 días', icon: 'Trophy', tier: 'gold' },
  { value: 200, label: '200 días', icon: 'Award',  tier: 'gold' },
];

/** Array plano de umbrales (para validaciones/backfill en el cliente). */
export const STREAK_MILESTONE_VALUES = STREAK_MILESTONES.map((m) => m.value);

/** Lookup rapido value -> def (incluye legacy para toasts/variants). */
const BY_VALUE = new Map(
  [...STREAK_MILESTONES, ...LEGACY_STREAK_MILESTONES].map((m) => [m.value, m]),
);

/**
 * Devuelve la def de un milestone por su valor de dias.
 * @param {number} value
 * @returns {StreakMilestoneDef|null}
 */
export function getMilestoneDef(value) {
  return BY_VALUE.get(value) ?? null;
}

/**
 * Mapea un tier a la variante visual del MilestoneToast. Reutiliza las 4
 * animaciones existentes escalando por magnitud (no por numero exacto).
 * @param {StreakMilestoneDef['tier']} tier
 * @returns {'spark'|'bloom'|'fanfare'|'legend'}
 */
export function tierToVariant(tier) {
  switch (tier) {
    case 'bronze':    return 'spark';
    case 'silver':    return 'bloom';
    case 'gold':      return 'fanfare';
    case 'diamond':   return 'legend';
    case 'legendary': return 'legend';
    default:          return 'spark';
  }
}

/**
 * Variante visual para un milestone dado (por dias). Fallback 'spark'.
 * @param {number} value
 * @returns {'spark'|'bloom'|'fanfare'|'legend'}
 */
export function variantForMilestone(value) {
  const def = getMilestoneDef(value);
  return def ? tierToVariant(def.tier) : 'spark';
}
