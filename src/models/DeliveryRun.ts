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
  },
  { timestamps: true }
);

export const DeliveryRunModel =
  models.DeliveryRun ?? model("DeliveryRun", deliveryRunSchema);
