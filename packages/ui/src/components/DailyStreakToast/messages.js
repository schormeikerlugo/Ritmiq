/**
 * Sets de mensajes motivacionales rotativos para el DailyStreakToast.
 *
 * Cada nivel (intensity) tiene un pool grande de frases para que el user
 * no perciba repeticion entre dias consecutivos. La seleccion es
 * pseudoaleatoria pero estable PER DAY (mismo dia = mismo mensaje, para
 * que si recarga la app no vea uno distinto).
 *
 * Niveles:
 *   ember:   1d  (primer dia / vuelta tras break)
 *   spark:   2-6d
 *   flame:   7-29d
 *   bloom:   30-99d
 *   fanfare: 100-364d
 *   legend:  365+d
 *
 * @module @ritmiq/ui/components/DailyStreakToast/messages
 */

/**
 * Pool de frases por nivel. Mantener cada lista con 12+ items para que
 * el user no perciba ciclos al alcanzar varios dias del mismo nivel.
 */
const MESSAGES = {
  ember: [
    { title: '¡Empezamos!', body: 'Hoy arranca tu nueva racha. A por ello.' },
    { title: '¡Primer dia!', body: 'Cada gran racha empieza con un dia. Sigue.' },
    { title: '¡Nueva racha!', body: 'Bienvenido de vuelta. La musica te esperaba.' },
    { title: '¡Aqui vamos!', body: 'Un dia escuchando. Manana sera el segundo.' },
    { title: '¡Buen comienzo!', body: 'Hoy es el dia 1. Construye algo grande.' },
    { title: '¡Volviste!', body: 'Tu musica te extranaba. Hoy reinicias el conteo.' },
    { title: '¡Primer paso!', body: 'Una cancion hoy, un habito manana.' },
    { title: '¡Encendido!', body: 'La chispa de tu racha acaba de prenderse.' },
    { title: '¡Hoy cuenta!', body: 'Dia 1. Cada uno suma. Vamos a por mas.' },
    { title: '¡Listo!', body: 'Comienza la racha. Te veo manana.' },
    { title: '¡Arrancamos!', body: 'Hoy es el dia 1 de algo grande.' },
    { title: '¡Bienvenido!', body: 'Tu racha empieza ahora. No la pares.' },
  ],
  spark: [
    { title: '¡Dia {n}!', body: 'Vas tomando ritmo. Sigue asi.' },
    { title: '¡{n} dias!', body: 'No pierdas el ritmo. Manana sumas otro.' },
    { title: '¡Llevas {n}!', body: 'Construyendo el habito. Cada dia cuenta.' },
    { title: '¡Dia {n} activado!', body: 'Tu racha sigue creciendo.' },
    { title: '¡Sumas {n}!', body: 'Esto va en serio. Manana otro mas.' },
    { title: '¡Otro dia mas!', body: 'Ya son {n} dias. Vas perfecto.' },
    { title: '¡{n} y subiendo!', body: 'Hoy escuchaste musica. Manana tambien.' },
    { title: '¡Imparable!', body: 'Dia {n} de tu racha. No te detengas.' },
    { title: '¡En marcha!', body: 'Llevas {n} dias seguidos. Sigue al ritmo.' },
    { title: '¡Dia {n}!', body: 'La constancia es tu mejor playlist.' },
    { title: '¡{n} dias!', body: 'Pequeno gran logro. Sigue construyendo.' },
    { title: '¡Vamos por {n}!', body: 'Hoy lo lograste. Manana lo repetimos.' },
  ],
  flame: [
    { title: '¡Dia {n}!', body: 'Una semana ya quedo atras. Eres consistente.' },
    { title: '¡{n} dias seguidos!', body: 'La constancia es tu superpoder.' },
    { title: '¡Eres fuego!', body: '{n} dias sin parar. Esto es serio.' },
    { title: '¡Dia {n}!', body: 'Ya no es coincidencia. Es habito.' },
    { title: '¡Sigues fuerte!', body: '{n} dias. La musica es parte de tu vida.' },
    { title: '¡Imparable!', body: '{n} dias de racha. Vas como una bala.' },
    { title: '¡{n} dias!', body: 'Tu racha esta firme. Sigue alimentandola.' },
    { title: '¡Dia {n}!', body: 'Mas de una semana. Estas en zona de habito.' },
    { title: '¡{n} y contando!', body: 'Esto se siente bien, verdad?' },
    { title: '¡Constante!', body: 'Llevas {n} dias. Pocos llegan aqui.' },
    { title: '¡Dia {n}!', body: 'La disciplina musical te define.' },
    { title: '¡{n} dias activos!', body: 'Esta es tu nueva normalidad.' },
  ],
  bloom: [
    { title: '¡Dia {n}!', body: 'Mas de un mes. Increible dedicacion.' },
    { title: '¡{n} dias!', body: 'Tu racha florece. La musica te acompana.' },
    { title: '¡Sigues brillando!', body: 'Dia {n}. Esto ya es parte de ti.' },
    { title: '¡Dia {n}!', body: 'Un mes es solo el comienzo. Vas por mas.' },
    { title: '¡{n} dias seguidos!', body: 'Constancia digna de admiracion.' },
    { title: '¡Imparable!', body: '{n} dias. Tu racha es una obra de arte.' },
    { title: '¡Dia {n}!', body: 'Pocas personas llegan tan lejos. Sigue.' },
    { title: '¡Dia {n} brillando!', body: 'Cada dia es una nota en tu sinfonia.' },
    { title: '¡{n} dias!', body: 'Eres una inspiracion. Sigue tu ritmo.' },
    { title: '¡Constante!', body: '{n} dias seguidos. La disciplina florece.' },
    { title: '¡Dia {n}!', body: 'Tu racha es testimonio de tu pasion.' },
    { title: '¡{n} y subiendo!', body: 'Esto es ya un estilo de vida.' },
  ],
  fanfare: [
    { title: '¡Dia {n}!', body: 'Mas de 100 dias. Estas en territorio epico.' },
    { title: '¡{n} dias seguidos!', body: 'Logro impresionante. Sigue brillando.' },
    { title: '¡Leyenda en formacion!', body: '{n} dias. Estas haciendo historia.' },
    { title: '¡Dia {n}!', body: 'Tu pasion por la musica es ejemplar.' },
    { title: '¡{n} dias!', body: 'Mas de cien. Mucha gente sonaria con esto.' },
    { title: '¡Imparable!', body: 'Dia {n}. Esto no es suerte, es dedicacion.' },
    { title: '¡Dia {n}!', body: 'Eres parte del club de los consistentes.' },
    { title: '¡{n} dias!', body: 'Tu racha es ejemplo para otros.' },
    { title: '¡Impresionante!', body: 'Llevas {n} dias. Asi se hace.' },
    { title: '¡Dia {n}!', body: 'Sigues escribiendo tu historia musical.' },
    { title: '¡{n} dias firmes!', body: 'Pocos llegan aqui. Tu lo lograste.' },
    { title: '¡Maestria!', body: 'Dia {n}. La constancia define al maestro.' },
  ],
  legend: [
    { title: '¡Dia {n}!', body: 'Mas de un ano. Eres una leyenda viva.' },
    { title: '¡{n} dias!', body: 'Esto no es una racha. Es una vida con musica.' },
    { title: '¡Inmortal!', body: '{n} dias seguidos. Inspiras a otros.' },
    { title: '¡Dia {n}!', body: 'Eres el ejemplo. Sigue alimentando la pasion.' },
    { title: '¡Leyenda!', body: '{n} dias. Eres parte del 0.01% de Ritmiq.' },
    { title: '¡Dia {n}!', body: 'Mas que una racha: tu firma musical.' },
    { title: '¡{n} dias!', body: 'La musica es tu lenguaje diario.' },
    { title: '¡Mitologico!', body: 'Dia {n}. Lo tuyo merece un trofeo.' },
    { title: '¡Dia {n}!', body: 'Cada nota cuenta. Y has contado muchas.' },
    { title: '¡{n} dias eternos!', body: 'La constancia te define como artista del oido.' },
    { title: '¡Dia {n}!', body: 'Eres testimonio vivo de la dedicacion.' },
    { title: '¡{n} dias!', body: 'Bienvenido al panteon Ritmiq.' },
  ],
};

/**
 * Decide el nivel de intensidad segun los dias de racha.
 *
 * @param {number} days
 * @returns {'ember'|'spark'|'flame'|'bloom'|'fanfare'|'legend'}
 */
export function pickIntensity(days) {
  if (days >= 365) return 'legend';
  if (days >= 100) return 'fanfare';
  if (days >= 30)  return 'bloom';
  if (days >= 7)   return 'flame';
  if (days >= 2)   return 'spark';
  return 'ember';
}

/**
 * Hash determinista de una fecha a un indice del pool. Asegura que el
 * mismo dia muestre siempre el mismo mensaje (consistente entre reloads).
 *
 * @param {string} dateStr 'YYYY-MM-DD'
 * @param {number} poolLen
 * @returns {number}
 */
function hashDateToIndex(dateStr, poolLen) {
  let h = 0;
  for (let i = 0; i < dateStr.length; i++) {
    h = ((h << 5) - h + dateStr.charCodeAt(i)) | 0;
  }
  return Math.abs(h) % poolLen;
}

/**
 * Devuelve un mensaje motivacional para los dias indicados.
 *
 * @param {number} days
 * @param {string} todayStr 'YYYY-MM-DD' — para seleccion estable por dia.
 * @returns {{ intensity:string, title:string, body:string }}
 */
export function pickMessage(days, todayStr) {
  const intensity = pickIntensity(days);
  const pool = MESSAGES[intensity];
  const idx = hashDateToIndex(todayStr ?? '0000-00-00', pool.length);
  const tpl = pool[idx];
  return {
    intensity,
    title: tpl.title.replace('{n}', String(days)),
    body:  tpl.body.replace('{n}',  String(days)),
  };
}

/**
 * Mensajes especificos para hitos de horas escuchadas (no se rotan, son
 * trofeos puntuales). Llamado desde el modal de MilestoneToast cuando
 * type='hours'.
 *
 * @param {number} hours
 * @returns {{ title:string, body:string }}
 */
export function pickHourMessage(hours) {
  switch (hours) {
    case 1:
      return { title: '¡Tu primera hora!', body: '60 minutos de musica. Esto recien empieza.' };
    case 10:
      return { title: '¡10 horas!', body: 'Una jornada laboral entera de musica.' };
    case 50:
      return { title: '¡50 horas!', body: 'Mas de dos dias completos con tu banda sonora.' };
    case 100:
      return { title: '¡100 horas!', body: 'Cuatro dias enteros. Una pasion real.' };
    case 500:
      return { title: '¡500 horas!', body: 'Tres semanas de musica. Mas que muchos.' };
    case 1000:
      return { title: '¡1.000 horas!', body: 'Casi seis semanas seguidas. Maestria.' };
    case 5000:
      return { title: '¡5.000 horas!', body: 'Mas de medio ano completo. Leyenda.' };
    default:
      return { title: `¡${hours} horas!`, body: 'Que viaje musical el tuyo.' };
  }
}
