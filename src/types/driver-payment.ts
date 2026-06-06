/**
 * Driver payment record types.
 * One record per completed DeliveryRun. RO MongoDB is the source of truth.
 */

export type PaymentRecordStatus =
  | "computed"      // has rate + hours; amounts are valid
  | "pending_rate"  // driver profile / rate not set yet; amounts are 0
  | "needs_review"; // driver matched but hours could not be derived (missing actual_start_time / completed_at)

export type SheetSyncStatus = "pending" | "success" | "failed" | "disabled";

export interface SheetSyncState {
  status: SheetSyncStatus;
  attempted_at?: string; // ISO
  error_message?: string;
  attempts: number;
}

export interface DriverPaymentRecord {
  _id: string;
  /** DeliveryRun._id as string — unique per record. */
  run_id: string;
  /** Linked Driver._id; null = unassigned (no matching profile). */
  driver_id?: string | null;
  /** Raw driver_name string from the run, preserved for audit. */
  driver_name_raw: string;
  /** run_date from the run (YYYY-MM-DD). */
  run_date: string;
  /** ISO timestamp: max(stops[].completed_at) at the time of computation. */
  completed_at?: string | null;

  // --- Hours ---
  /** Derived from actual_start_time → max(completed_at), in hours. Null if unavailable. */
  hours_actual?: number | null;
  /** Admin override (replaces hours_actual in calculation). */
  hours_override?: number | null;
  /** Reason for the override (free text). */
  override_reason?: string;
  /** Effective hours used for payment: hours_override ?? hours_actual ?? 0 */
  hours_effective: number;

  // --- Distance ---
  total_distance_km: number;
  return_distance_km: number;
  /** total_distance_km - return_distance_km — used for fuel calculation. */
  billable_distance_km: number;

  // --- Snapshotted rates (from driver profile at time of computation) ---
  hourly_rate_snapshot: number;
  fuel_rate_snapshot: number;

  // --- Computed amounts (2 decimal places) ---
  subtotal_labor: number;
  fuel_amount: number;
  total: number;

  // --- Pay period classification ---
  /** 0-based week index from driver start_date. */
  pay_week_index: number;
  /** True when this record falls within the driver's deposit_weeks. */
  is_deposit_week: boolean;

  status: PaymentRecordStatus;
  sheet_sync: SheetSyncState;

  createdAt: Date;
  updatedAt: Date;
}
