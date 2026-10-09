/** Convert a delivery business clock to an instant without using the host timezone. */
export const TORONTO_TIMEZONE = "America/Toronto";

const clock = new Intl.DateTimeFormat("en-CA", {
  timeZone: TORONTO_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

export function parseTorontoRunTime(runDate: string, runTime: string): Date {
  const date = /^(\d{4})-(\d{2})-(\d{2})$/.exec(runDate);
  const time = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(runTime);
  if (!date || !time) throw new RangeError("Invalid delivery date or time");
  const [, year, month, day] = date.map(Number);
  const [, hour, minute, second = 0] = time.map((part) => part === undefined ? 0 : Number(part));
  const target = Date.UTC(year, month - 1, day, hour, minute, second);
  const nominal = new Date(target);
  if (nominal.getUTCFullYear() !== year || nominal.getUTCMonth() !== month - 1 ||
      nominal.getUTCDate() !== day || hour > 23 || minute > 59 || second > 59) {
    throw new RangeError("Invalid delivery date or time");
  }
  let instant = target;
  for (let attempt = 0; attempt < 4; attempt++) {
    const parts = Object.fromEntries(clock.formatToParts(new Date(instant))
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]));
    const displayed = Date.UTC(parts.year, parts.month - 1, parts.day,
      parts.hour, parts.minute, parts.second);
    const correction = target - displayed;
    if (correction === 0) return new Date(instant);
    instant += correction;
  }
  throw new RangeError("Delivery time does not exist in America/Toronto");
}
