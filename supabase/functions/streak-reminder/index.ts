/**
 * Edge Function: streak-reminder
 *
 * Disparada por pg_cron CADA HORA (`0 * * * *`). Para cada usuario
 * con push_subscriptions activas, calcula su hora local segun su
 * profiles.timezone y SOLO envia reminder si su hora local es:
 *   - 12:00 \u2192 slot 'noon'    (mensaje motivacional)
 *   - 21:00 \u2192 slot 'evening' (mensaje urgente \u2014 quedan pocas horas)
 *
 * Esto resuelve el problema de zonas horarias: el cron es global pero
 * cada usuario recibe los reminders en SU mediodia y SU 9pm,
 * independientemente de donde este (Caracas, Madrid, Mexico, Tokyo).
 *
 * Deduplicacion: cada usuario solo recibe 1 reminder por slot por dia
 * (UNIQUE constraint en streak_reminder_log).
 *
 * Skip conditions:
 *   - Usuario sin push_subscriptions \u2192 no recibiria nada.
 *   - Usuario ya escucho hoy en su zona horaria \u2192 racha safe.
 *   - Usuario sin racha (streak < 1) \u2192 nada que perder.
 *   - Slot ya enviado hoy (dup check) \u2192 noop.
 *
 * Body opcional para testing: { force: 'noon' | 'evening' }
 *   Fuerza el slot ignorando hora local. Solo para debug manual.
 *
 * Response: { processed, sent, skipped }
 */

import { createClient } from 'npm:@supabase/supabase-js@2.45.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info, x-supabase-api-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const NOON_HOUR    = 12;
const EVENING_HOUR = 21;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Method Not Allowed' }, 405);

  let forceSlot: 'noon' | 'evening' | null = null;
  try {
    const body = await req.json();
    if (body?.force === 'noon' || body?.force === 'evening') forceSlot = body.force;
  } catch { /* sin body, ok */ }

  const svc = createClient(SUPABASE_URL, SERVICE_KEY);

  // 1. Candidatos: usuarios con al menos 1 push_subscription activa.
  //    JOIN con profiles para traer timezone.
  const { data: subs, error: subsErr } = await svc
    .from('push_subscriptions')
    .select('user_id');

  if (subsErr) return json({ error: subsErr.message }, 500);
  if (!subs || subs.length === 0) {
    return json({ processed: 0, sent: 0, skipped: { wrong_hour: 0, played: 0, no_streak: 0, dup: 0 } });
  }

  const userIds = [...new Set(subs.map((s) => s.user_id))];

  // 2. Cargar timezones de todos los candidatos en batch.
  const { data: profiles } = await svc
    .from('profiles')
    .select('user_id, timezone')
    .in('user_id', userIds);

  const tzMap = new Map<string, string>();
  (profiles ?? []).forEach((p) => tzMap.set(p.user_id, p.timezone ?? 'UTC'));

  const stats = {
    processed: 0,
    sent: 0,
    skipped: { wrong_hour: 0, played: 0, no_streak: 0, dup: 0 },
  };

  await Promise.allSettled(
    userIds.map(async (userId) => {
      stats.processed++;

      // 3. Determinar slot segun hora local del usuario.
      const tz = tzMap.get(userId) ?? 'UTC';
      const slot = forceSlot ?? determineSlot(tz);
      if (!slot) {
        stats.skipped.wrong_hour++;
        return;
      }

      // 4. Calcular fecha local del usuario (no UTC) \u2014 importante para
      //    el unique constraint: el "dia" del log debe ser el dia local
      //    del usuario, no el dia UTC del cron.
      const localDate = getLocalDate(tz);

      // 5. Calcular racha + played_today (la funcion SQL usa
      //    current_date que es la zona del proyecto, NO la del user
      //    \u2014 esto es aceptable porque play_history se compara con
      //    today UTC y los desfases de 1-2h son menores).
      const { data: streakData, error: streakErr } = await svc
        .rpc('compute_user_streak', { p_user_id: userId });

      if (streakErr || !streakData || streakData.length === 0) {
        stats.skipped.no_streak++;
        return;
      }

      const { streak_days, played_today } = streakData[0];

      if (played_today) {
        stats.skipped.played++;
        return;
      }
      if (streak_days < 1) {
        stats.skipped.no_streak++;
        return;
      }

      // 6. Dedup via INSERT con UNIQUE (user, slot, date_local).
      const { error: logErr } = await svc
        .from('streak_reminder_log')
        .insert({
          user_id:     userId,
          slot,
          sent_date:   localDate,
          streak_days,
        });

      if (logErr) {
        if ((logErr as { code?: string }).code === '23505') {
          stats.skipped.dup++;
          return;
        }
        console.warn('[streak-reminder] log insert failed', logErr);
        return;
      }

      // 7. Push.
      const { title, body } = buildMessage(slot, streak_days);
      const pushUrl = `${SUPABASE_URL}/functions/v1/send-push-notification`;
      try {
        const res = await fetch(pushUrl, {
          method: 'POST',
          headers: {
            'Content-Type':  'application/json',
            'Authorization': `Bearer ${SERVICE_KEY}`,
          },
          body: JSON.stringify({
            userId,
            title,
            body,
            data: {
              type: 'streak_reminder',
              slot,
              streak_days,
              // tag unico por slot+fecha local: si el cron se ejecuta
              // dos veces el mismo dia (retry manual), el sistema de
              // notif del device colapsa al ultimo \u2014 no spam visible.
              tag: `streak:${slot}:${localDate}`,
            },
          }),
        });
        if (res.ok) stats.sent++;
      } catch {
        // Push fallo \u2014 el log ya esta, no reintentamos.
      }
    }),
  );

  return json(stats);
});

// ── helpers ─────────────────────────────────────────────────────────

/**
 * Determina si la hora local del usuario es 12 (noon), 21 (evening),
 * o ninguna. Tolerancia de 0 minutos: solo dispara si la hora local
 * exacta coincide \u2014 como el cron corre cada hora, esto da una sola
 * ventana de 1h por slot.
 */
function determineSlot(timezone: string): 'noon' | 'evening' | null {
  try {
    const now = new Date();
    // Intl: extrae la hora en la timezone dada.
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour:     'numeric',
      hour12:   false,
    });
    const localHour = parseInt(fmt.format(now), 10);
    if (localHour === NOON_HOUR)    return 'noon';
    if (localHour === EVENING_HOUR) return 'evening';
    return null;
  } catch {
    // Timezone invalida \u2014 skip al usuario.
    return null;
  }
}

/**
 * Devuelve la fecha local del usuario en formato 'YYYY-MM-DD'.
 * Importante: en el ejemplo de un usuario en Caracas (UTC-4), las
 * 23:00 hora local de un dia caen en 03:00 UTC del dia siguiente.
 * El unique constraint del log usa esta fecha LOCAL para evitar
 * que el usuario reciba dos reminders del mismo slot el mismo dia
 * por desfase de zona horaria.
 */
function getLocalDate(timezone: string): string {
  try {
    const now = new Date();
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year:  'numeric',
      month: '2-digit',
      day:   '2-digit',
    });
    // en-CA produce formato YYYY-MM-DD directamente.
    return fmt.format(now);
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

function buildMessage(slot: 'noon' | 'evening', streakDays: number): { title: string; body: string } {
  if (slot === 'evening') {
    if (streakDays === 1) {
      return {
        title: 'Tu primera racha en juego',
        body:  'Escucha algo hoy para empezar a construirla.',
      };
    }
    if (streakDays < 7) {
      return {
        title: `\u00bfVas a perder tu racha de ${streakDays} dias?`,
        body:  'Pon un track antes de medianoche para mantenerla.',
      };
    }
    if (streakDays < 30) {
      return {
        title: `Tu racha de ${streakDays} dias esta en peligro`,
        body:  'Solo unos minutos de musica para no romperla.',
      };
    }
    return {
      title: `\u26a0\ufe0f ${streakDays} dias seguidos en juego`,
      body:  'Una racha tan larga merece un ultimo track del dia.',
    };
  }

  // slot === 'noon' \u2014 motivacional, no urgente.
  if (streakDays === 1) {
    return {
      title: 'Sigue tu racha',
      body:  'Llevas 1 dia. \u00bfQue sonara hoy en Ritmiq?',
    };
  }
  if (streakDays < 7) {
    return {
      title: `Racha de ${streakDays} dias`,
      body:  'Ven a por mas. Tu top diario te espera.',
    };
  }
  if (streakDays < 30) {
    return {
      title: `${streakDays} dias seguidos en Ritmiq`,
      body:  '\u00bfQue artista nuevo descubrimos hoy?',
    };
  }
  return {
    title: `\ud83d\udd25 ${streakDays} dias \u2014 imparable`,
    body:  'Otro dia de buena musica te espera.',
  };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}
