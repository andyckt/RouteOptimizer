/**
 * ETA window helpers for Toronto timezone (America/Toronto).
 * Used for SMS ETA messages: floor to 30-min window, format as "h:mm–h:mm AM/PM".
 */

const TORONTO = "America/Toronto";

/**
 * Floor a date down to the nearest 30 minutes in Toronto timezone.
 * Extracts Toronto-local hour/minute, floors minute, returns equivalent Date.
 */
export function floorTo30MinToronto(date: Date): Date {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: TORONTO,
    hour: "numeric",
    minute: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(date);
  const hour = parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10);
  const minute = parseInt(parts.find((p) => p.type === "minute")?.value ?? "0", 10);
  const flooredMin = Math.floor(minute / 30) * 30;

  const minsDiff = minute - flooredMin;
  const msBack = minsDiff * 60 * 1000;
  return new Date(date.getTime() - msBack);
}

/**
 * Format a date as a 30-minute window in Toronto time: "h:mm–h:mm AM/PM".
 * Expects the date to be the START of the window; adds 30 min for end.
 */
export function formatEtaWindowToronto(startDate: Date): string {
  const endDate = new Date(startDate.getTime() + 30 * 60 * 1000);
  const opts: Intl.DateTimeFormatOptions = {
    timeZone: TORONTO,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  };
  const startStr = new Intl.DateTimeFormat("en-US", opts).format(startDate);
  const endStr = new Intl.DateTimeFormat("en-US", opts).format(endDate);
  return `${startStr}–${endStr}`;
}
