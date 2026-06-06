/**
 * Google Sheets JWT client.
 * Reuses GOOGLE_SERVICE_ACCOUNT_JSON from the existing env pattern.
 * Optional: if GOOGLE_SHEETS_PAYROLL_SPREADSHEET_ID is unset, sync is disabled.
 */

export interface SheetsConfig {
  spreadsheetId: string;
  serviceAccountJson: string;
}

export function getSheetsConfig(): SheetsConfig | null {
  const spreadsheetId = process.env.GOOGLE_SHEETS_PAYROLL_SPREADSHEET_ID;
  const serviceAccountJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!spreadsheetId || !serviceAccountJson) return null;
  return { spreadsheetId, serviceAccountJson };
}

export interface ServiceAccount {
  client_email: string;
  private_key: string;
}

export function parseServiceAccount(json: string): ServiceAccount {
  const parsed = JSON.parse(json) as { client_email?: string; private_key?: string };
  if (!parsed.client_email || !parsed.private_key) {
    throw new Error("Invalid service account JSON: missing client_email or private_key");
  }
  return { client_email: parsed.client_email, private_key: parsed.private_key };
}
