import { Schema, model, models } from "mongoose";
import type { DriverPaymentRecord, SheetSyncState } from "@/types/driver-payment";

const sheetSyncSchema = new Schema<SheetSyncState>(
  {
    status: {
      type: String,
      enum: ["pending", "success", "failed", "disabled"],
      default: "pending",
    },
    attempted_at: { type: String },
    error_message: { type: String },
    attempts: { type: Number, default: 0 },
  },
  { _id: false }
);

const driverPaymentRecordSchema = new Schema<DriverPaymentRecord>(
  {
    run_id: { type: String, required: true },
    driver_id: { type: String, default: null },
    driver_name_raw: { type: String, required: true },
    run_date: { type: String, required: true },
    completed_at: { type: String, default: null },

    hours_actual: { type: Number, default: null },
    hours_override: { type: Number, default: null },
    override_reason: { type: String },
    hours_effective: { type: Number, required: true, default: 0 },

    total_distance_km: { type: Number, required: true, default: 0 },
    return_distance_km: { type: Number, required: true, default: 0 },
    billable_distance_km: { type: Number, required: true, default: 0 },

    hourly_rate_snapshot: { type: Number, required: true, default: 0 },
    fuel_rate_snapshot: { type: Number, required: true, default: 0 },

    subtotal_labor: { type: Number, required: true, default: 0 },
    fuel_amount: { type: Number, required: true, default: 0 },
    total: { type: Number, required: true, default: 0 },

    pay_week_index: { type: Number, required: true, default: 0 },
    is_deposit_week: { type: Boolean, required: true, default: false },

    status: {
      type: String,
      enum: ["computed", "pending_rate", "needs_review"],
      default: "pending_rate",
    },
    sheet_sync: { type: sheetSyncSchema, default: () => ({ status: "pending", attempts: 0 }) },
  },
  { timestamps: true }
);

// Unique index: only one payment record per run
driverPaymentRecordSchema.index({ run_id: 1 }, { unique: true });
// Query indexes
driverPaymentRecordSchema.index({ driver_id: 1, run_date: 1 });
driverPaymentRecordSchema.index({ status: 1 });
driverPaymentRecordSchema.index({ driver_id: 1, pay_week_index: 1 });

export const DriverPaymentRecordModel =
  models.DriverPaymentRecord ??
  model<DriverPaymentRecord>("DriverPaymentRecord", driverPaymentRecordSchema);
