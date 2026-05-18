import { normalizeOrderIds } from "@/lib/normalization/delivery-run";

/** Parse comma/semicolon/space-separated Kapioo order IDs from a single text field. */
export function parseOrderIdsFromText(raw: string): string[] | undefined {
  if (!raw.trim()) return undefined;
  return normalizeOrderIds(raw.split(/[,;\s]+/));
}

export const CUSTOMER_PASTE_FORMAT_LINES = [
  "Tab-delimited: Kapioo order IDs (optional) [TAB] Name [TAB] Address [TAB] Phone.",
  "Notes in parentheses in the address (e.g. Buzz code: 123) are extracted automatically.",
  "Kapioo order IDs: one ID or several separated by commas (e.g. ORD-1001 or ORD-1001, ORD-1002). Use 3 columns with no order IDs for non-Kapioo stops.",
] as const;

export const CUSTOMER_PASTE_PLACEHOLDER =
  "ORD-1001\tJohn Smith\t123 Main St Toronto ON M5V 1A1\t4161234567\n" +
  "ORD-1002, ORD-1003\tJane Doe\tUnit 506 456 Queen St W\t4169876543";
