/**
 * Driver pay profile types.
 */

export interface RateHistoryEntry {
  hourly_rate: number;
  fuel_rate_per_km: number;
  changed_at: string; // ISO
}

export interface Driver {
  _id: string;
  /** Canonical display name shown in UI and used as sheet tab title. */
  display_name: string;
  /**
   * Normalized lowercase aliases used to match free-text run driver_name.
   * Always includes normalize(display_name). Admin can add extra entries
   * for typos, casing variants (e.g. "dt", "d.t.", "donald t").
   */
  aliases: string[];
  /** Hourly pay rate in currency. */
  hourly_rate: number;
  /** Fuel reimbursement per km (billable km only; 0 = no fuel coverage). */
  fuel_rate_per_km: number;
  /** Business start date YYYY-MM-DD — drives rolling week boundaries and deposit. */
  start_date: string;
  /** Number of initial weeks held as deposit (0 = no deposit). */
  deposit_weeks: number;
  /** Payable grouping cadence in weeks after deposit period (default 2 = biweekly). */
  payout_cadence_weeks: number;
  /** ISO 4217 currency code (default "CAD"). */
  currency: string;
  /** False = soft-removed; excluded from active matching and UI by default. */
  active: boolean;
  notes?: string;
  /** Cached after first successful Sheets write. */
  sheet_tab_title?: string;
  sheet_tab_id?: number;
  /** Audit trail of past rates. Updated automatically when hourly_rate or fuel_rate_per_km changes. */
  rate_history?: RateHistoryEntry[];
  createdAt: Date;
  updatedAt: Date;
}

export interface DriverCreateInput {
  display_name: string;
  hourly_rate: number;
  fuel_rate_per_km?: number;
  start_date: string;
  deposit_weeks?: number;
  payout_cadence_weeks?: number;
  currency?: string;
  notes?: string;
  extra_aliases?: string[];
}
