/**
 * LLM fallback stub when deterministic parsing yields 0 customers.
 * Uses exact prompt from spec. Returns empty customers array until real LLM is wired.
 */

export const LLM_EXTRACT_PROMPT = `Parse this customer delivery data and extract each customer's information.
IMPORTANT: Preserve customer names exactly as given. Do NOT remove trailing "-####" codes.
Extract: name, full address, phone digits only, notes.
Return JSON object with "customers" array; notes must be "" if none.`;

export interface LlmCustomer {
  name: string;
  address: string;
  phone: string;
  notes: string;
}

export function extractWithLlmStub(_rawText: string): { customers: LlmCustomer[] } {
  // Stub: no LLM key wired; return empty. Real implementation would call LLM here.
  return { customers: [] };
}
