/**
 * Deterministic parser: tab-delimited Name[TAB]Address[TAB]Phone[TAB]OrderIds?.
 * Preserves customer names exactly (including trailing "-####").
 * Phone normalized to digits only.
 * Extracts notes from address when it ends with (content), e.g. (Buzz code: 1504).
 * Optional 4th column: Kapioo order IDs separated by `,`, `;`, or whitespace.
 * Order IDs are a create-time seed for `customer.order_ids` only — never read at sync time.
 */

import { normalizeOrderIds } from "@/lib/normalization/delivery-run";

export interface ParsedCustomer {
  name: string;
  address: string;
  phone: string;
  notes: string;
  /** Optional create-time seed for `customer.order_ids`. Not consumed at sync time. */
  order_ids?: string[];
}

const NOTE_IN_PARENS = /\s*\(([^)]+)\)\s*$/;

function extractAddressAndNotes(rawAddress: string): { address: string; notes: string } {
  const trimmed = rawAddress.trim();
  const match = trimmed.match(NOTE_IN_PARENS);
  if (match) {
    const address = trimmed.replace(NOTE_IN_PARENS, "").trim();
    const notes = match[1].trim();
    return { address, notes };
  }
  return { address: trimmed, notes: "" };
}

function parseOrderIdsCell(raw: string | undefined): string[] | undefined {
  if (!raw) return undefined;
  const tokens = raw.split(/[,;\s]+/);
  return normalizeOrderIds(tokens);
}

export function parseDeterministic(text: string): ParsedCustomer[] {
  const lines = text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  const customers: ParsedCustomer[] = [];
  for (const line of lines) {
    const parts = line.split(/\t/);
    if (parts.length < 3) continue;
    const [name, addressRaw, phoneRaw, orderIdsRaw] = parts;
    const nameTrimmed = name?.trim() ?? "";
    const { address, notes } = extractAddressAndNotes(addressRaw ?? "");
    if (!nameTrimmed || !address) continue;
    const phone = (phoneRaw ?? "").replace(/\D/g, "");
    const order_ids = parseOrderIdsCell(orderIdsRaw);
    customers.push({
      name: nameTrimmed,
      address,
      phone,
      notes,
      ...(order_ids ? { order_ids } : {}),
    });
  }
  return customers;
}
