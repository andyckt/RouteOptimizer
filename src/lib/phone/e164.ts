/**
 * Phone normalization for North America (Canada/US).
 * E.164: +1 followed by 10 digits.
 */

export function digitsOnly(input: string): string {
  return (input ?? "").replace(/\D/g, "");
}

/**
 * Normalize to E.164 for North America.
 * - 10 digits -> +1{digits}
 * - 11 digits starting with 1 -> +{digits}
 * - Already has + and 11/12+ digits -> keep if valid
 * - Else invalid -> null
 */
export function toE164NorthAmerica(digits: string): string | null {
  const d = digitsOnly(digits);
  if (d.length === 0) return null;

  if (d.length === 10) {
    return `+1${d}`;
  }
  if (d.length === 11 && d.startsWith("1")) {
    return `+${d}`;
  }
  if (digits.trimStart().startsWith("+") && (d.length === 11 || d.length === 12)) {
    const withPlus = d.length === 11 ? `+1${d}` : `+${d}`;
    if (withPlus.startsWith("+1") && withPlus.length === 12) return withPlus;
  }

  return null;
}
