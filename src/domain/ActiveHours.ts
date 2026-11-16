/**
 * Seguidores en línea de un día, tal como los da Meta (`online_followers`): el
 * día acaba en `endTime` (medianoche del Pacífico) y las claves 0-23 son las
 * horas de ese día. Un día que Meta aún no ha calculado llega sin claves.
 */
export interface OnlineFollowersDay {
  endTime: string;
  counts: Readonly<Record<string, number>>;
}

export interface ActiveHour {
  hour: number;
  average: number;
}

/** Media de seguidores en línea por hora, en la zona pedida. */
export interface ActiveHours {
  timeZone: string;
  /** Días con datos que entran en la media. */
  days: number;
  /** Las 24 horas de la zona, de 0 a 23. */
  hours: readonly ActiveHour[];
  /** Las horas con más seguidores en línea, de mayor a menor. */
  peak: readonly ActiveHour[];
}

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/** true si `timeZone` es una zona IANA que el runtime conoce. */
export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone });
    return true;
  } catch {
    return false;
  }
}

/**
 * Convierte cada hora del Pacífico a la hora de `timeZone` y hace la media por
 * hora. No se da por supuesta ninguna diferencia horaria: el inicio de cada día
 * es el `endTime` del anterior (así el día del cambio de hora dura 23 o 25 h) o,
 * si no lo hay, 24 h antes de su propio `endTime`.
 */
export function summarizeActiveHours(days: readonly OnlineFollowersDay[], timeZone: string, peakSize = 3): ActiveHours {
  const hourOf = new Intl.DateTimeFormat('en-GB', { timeZone, hour: 'numeric', hourCycle: 'h23' });
  const sums = new Array<number>(24).fill(0);
  const samples = new Array<number>(24).fill(0);
  let used = 0;

  const dated = days
    .map((day) => ({ day, end: Date.parse(day.endTime) }))
    .filter((entry) => !Number.isNaN(entry.end))
    .sort((a, b) => a.end - b.end);

  dated.forEach(({ day, end }, index) => {
    const previous = dated[index - 1]?.end;
    const start = previous !== undefined && end - previous >= 22 * HOUR_MS && end - previous <= 26 * HOUR_MS ? previous : end - DAY_MS;
    let counted = false;
    for (const [key, value] of Object.entries(day.counts)) {
      const hour = Number(key);
      if (!Number.isInteger(hour) || hour < 0 || hour > 23 || typeof value !== 'number') continue;
      const local = Number(hourOf.format(new Date(start + hour * HOUR_MS)));
      sums[local] = (sums[local] ?? 0) + value;
      samples[local] = (samples[local] ?? 0) + 1;
      counted = true;
    }
    if (counted) used += 1;
  });

  const hours = sums.map((sum, hour) => {
    const count = samples[hour] ?? 0;
    return { hour, average: count === 0 ? 0 : Math.round((sum / count) * 10) / 10 };
  });
  const peak = hours
    .filter((entry) => (samples[entry.hour] ?? 0) > 0)
    .sort((a, b) => b.average - a.average || a.hour - b.hour)
    .slice(0, peakSize);
  return { timeZone, days: used, hours, peak };
}
