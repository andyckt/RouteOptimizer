import { todayYYYYMMDD } from "./dates";

const MONTH_ABBREV = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

const INVALID_FILENAME_CHARS = /[\\/:*?"<>|]/g;

/**
 * Sanitizes a driver name for use in a filename.
 * Replaces invalid chars with underscore; returns "Driver" if empty after sanitization.
 */
function sanitizeDriverName(name: string): string {
  const sanitized = (name ?? "")
    .trim()
    .replace(INVALID_FILENAME_CHARS, "_")
    .trim();
  return sanitized || "Driver";
}

/**
 * Formats YYYY-MM-DD to "Mon_DD" (e.g., "2026-03-04" -> "Mar_04").
 * Uses today's date if runDate is empty or invalid.
 */
function formatRunDateForFilename(runDate: string): string {
  const dateStr = (runDate ?? "").trim();
  if (!dateStr) return formatRunDateForFilename(todayYYYYMMDD());

  const match = dateStr.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!match) return formatRunDateForFilename(todayYYYYMMDD());

  const [, , monthStr, dayStr] = match;
  const month = parseInt(monthStr!, 10);
  const day = parseInt(dayStr!, 10);
  if (month < 1 || month > 12) return formatRunDateForFilename(todayYYYYMMDD());

  const monthAbbrev = MONTH_ABBREV[month - 1];
  const dayPadded = String(Math.max(1, Math.min(31, day))).padStart(2, "0");
  return `${monthAbbrev}_${dayPadded}`;
}

/**
 * Produces the filename for the Export Labels .xlsx file.
 * Format: {DriverName}司机的_{Mon_DD}.xlsx
 * Example: "NY司机的_Mar_04.xlsx"
 */
export function formatLabelsExportFilename(driverName: string, runDate: string): string {
  const driver = sanitizeDriverName(driverName);
  const datePart = formatRunDateForFilename(runDate);
  return `${driver}司机的_${datePart}.xlsx`;
}

/**
 * Builds a Content-Disposition header value for attachment downloads.
 * Uses RFC 5987 encoding (filename*=UTF-8'') for non-ASCII filenames to avoid
 * "Cannot convert argument to a ByteString" errors when chars have codepoint > 255.
 */
export function formatContentDispositionAttachment(filename: string): string {
  const asciiFallback = "Labels.xlsx";
  const encoded = encodeURIComponent(filename);
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`;
}
