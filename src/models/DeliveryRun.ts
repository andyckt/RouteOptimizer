import mongoose, { Schema, model, models } from "mongoose";
import type {
  DeliveryCustomer,
} from "@/types/delivery-run";

const customerSchema = new Schema<DeliveryCustomer>(
  {
    name: { type: String, required: true },
    phone: { type: String, required: true, default: "" },
    address: { type: String, required: true },
    notes: { type: String },
    is_first_stop: { type: Boolean, default: false },
    is_end_point: { type: Boolean, default: false },
    lat: { type: Number },
    lng: { type: Number },
    geocode_status: {
      type: String,
      enum: ["success", "failed", "pending", "override_success"],
      default: "pending",
    },
    geocode_error: { type: String },
    nearby_address_override: { type: String },
    nearby_lat: { type: Number },
    nearby_lng: { type: Number },
    fixed_stop_position: { type: Number, default: null },
    // Create-time seed only. Sync/retry reads OptimizedStop.order_ids, never this.
    order_ids: { type: [String], default: undefined },
    is_synthetic: { type: Boolean },
    stop_type: { type: String, enum: ["customer", "handoff"] },
    service_time_minutes: { type: Number },
  },
  { _id: false }
);

const kapiooSyncSchema = new Schema(
  {
    status: {
      type: String,
      enum: ["skipped", "success", "partial", "failed"],
    },
    reason: { type: String },
    attempted_at: { type: String },
    updated_order_ids: { type: [String], default: undefined },
    skipped_order_ids: { type: [String], default: undefined },
    missing_order_ids: { type: [String], default: undefined },
    error_message: { type: String },
    attempts: { type: Number },
  },
  { _id: false }
);

const optimizedStopSchema = new Schema(
  {
    customer_index: { type: Number },
    customer_name: { type: String },
    customer_phone: { type: String },
    customer_address: { type: String },
    notes: { type: String },
    is_first_stop: { type: Boolean },
    is_end_point: { type: Boolean },
    eta: { type: String },
    arrival_time: { type: String },
    distance_from_previous: { type: Number },
    duration_from_previous: { type: Number },
    using_nearby_location: { type: Boolean },
    nearby_location_reference: { type: String },
    completed: { type: Boolean },
    completed_at: { type: String },
    proof_of_delivery: { type: String },
    proof_of_delivery_images: [String],
    proof_short_url: { type: String },
    sms_message_text: { type: String },
    sms_sent_at: { type: String },
    // SSOT for Kapioo Admin sync.
    order_ids: { type: [String], default: undefined },
    kapioo_sync: { type: kapiooSyncSchema, default: undefined },
    kapioo_delivery_started_sync: { type: kapiooSyncSchema, default: undefined },
    is_synthetic: { type: Boolean },
    stop_type: { type: String, enum: ["customer", "handoff"] },
    service_time_minutes: { type: Number },
  },
  { _id: false }
);

const optimizedRouteSchema = new Schema(
  {
    total_distance_km: { type: Number },
    total_duration_minutes: { type: Number },
    stops: [optimizedStopSchema],
    encoded_polyline: { type: String },
    return_distance_km: { type: Number },
    return_duration_minutes: { type: Number },
    start_lat: { type: Number },
    start_lng: { type: Number },
  },
  { _id: false }
);

const deliveryRunSchema = new Schema(
  {
    run_date: { type: String, required: true },
    driver_name: { type: String, required: true, default: "" },
    start_location: { type: String, required: true, default: "" },
    end_location: { type: String },
    start_time: { type: String, required: true },
    actual_start_time: { type: String },
    travel_mode: {
      type: String,
      enum: ["driving", "ebike"],
      default: "driving",
    },
    customers: { type: [customerSchema], default: [] },
    status: {
      type: String,
      enum: ["draft", "optimized", "in_progress", "completed"],
      default: "draft",
    },
    optimized_route: { type: optimizedRouteSchema },
    messages_sent: { type: Boolean, default: false },
    messages_sent_at: { type: String },
    planning_session_id: { type: String },
    external_id: { type: String },
    idempotency_key: { type: String },
    created_by_integration: { type: String },
  },
  { timestamps: true }
);

// Sparse, non-unique indexes for integration lookups. Sparse excludes existing/manual
// runs that lack these fields; non-unique avoids any write failures on legacy data.
// Duplicate prevention is enforced in application logic, not by a unique constraint.
deliveryRunSchema.index({ idempotency_key: 1 }, { sparse: true });
deliveryRunSchema.index({ external_id: 1 }, { sparse: true });

export const DeliveryRunModel =
  models.DeliveryRun ?? model("DeliveryRun", deliveryRunSchema);
