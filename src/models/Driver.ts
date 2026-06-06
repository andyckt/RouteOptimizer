import { Schema, model, models } from "mongoose";
import type { Driver, RateHistoryEntry } from "@/types/driver";

const rateHistorySchema = new Schema<RateHistoryEntry>(
  {
    hourly_rate: { type: Number, required: true },
    fuel_rate_per_km: { type: Number, required: true },
    changed_at: { type: String, required: true },
  },
  { _id: false }
);

const driverSchema = new Schema<Driver>(
  {
    display_name: { type: String, required: true },
    aliases: { type: [String], default: [] },
    hourly_rate: { type: Number, required: true, min: 0 },
    fuel_rate_per_km: { type: Number, required: true, default: 0, min: 0 },
    start_date: { type: String, required: true },
    deposit_weeks: { type: Number, required: true, default: 0, min: 0 },
    payout_cadence_weeks: { type: Number, required: true, default: 2, min: 1 },
    currency: { type: String, required: true, default: "CAD" },
    active: { type: Boolean, required: true, default: true },
    notes: { type: String },
    sheet_tab_title: { type: String },
    sheet_tab_id: { type: Number },
    rate_history: { type: [rateHistorySchema], default: undefined },
  },
  { timestamps: true }
);

// Sparse index on display_name for fast lookups
driverSchema.index({ display_name: 1 });
// Index on aliases for fast name matching
driverSchema.index({ aliases: 1 });

export const DriverModel = models.Driver ?? model<Driver>("Driver", driverSchema);
