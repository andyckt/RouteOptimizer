/**
 * DeliveryRun types aligned with MongoDB schema.
 */

export type TravelMode = "driving" | "ebike";
export type GeocodeStatus = "success" | "failed" | "pending" | "override_success";
export type RunStatus = "draft" | "optimized" | "in_progress" | "completed";

/** Stop classification. Effective default `"customer"` is applied in code, not the schema. */
export type StopType = "customer" | "handoff";

export interface DeliveryCustomer {
  name: string;
  phone: string;
  address: string;
  notes?: string;
  is_first_stop: boolean;
  is_end_point: boolean;
  lat?: number;
  lng?: number;
  geocode_status: GeocodeStatus;
  geocode_error?: string;
  nearby_address_override?: string;
  nearby_lat?: number;
  nearby_lng?: number;
  /** Admin-only: exact 1-based position in the final optimized stop list; null/omit = flexible. */
  fixed_stop_position?: number | null;
  /**
   * Kapioo order IDs — CREATE-TIME SEED ONLY.
   * Populated by paste (order IDs in the first column) or Add Single Customer. Copied to `OptimizedStop.order_ids`
   * on the first optimization. After that, the stop value wins on re-optimizations
   * and is the only field read at sync/retry time. Do NOT read this at sync time.
   */
  order_ids?: string[];
  /**
   * True for synthetic operational stops (e.g. meet-up handoff). Effective default `false`
   * is applied in code, not the schema.
   */
  is_synthetic?: boolean;
  /** Effective default `"customer"` is applied in code, not the schema. */
  stop_type?: StopType;
  /** Optional meet-up instruction shown prominently to the driver. */
  meetup_note?: string;
  /** Service time at stop in minutes. Effective default `5` is applied in code, not the schema. */
  service_time_minutes?: number;
}

/** Outcome of pushing a completed stop to Kapioo Admin's POD ingestion endpoint. */
export type KapiooSyncStatus = "skipped" | "success" | "partial" | "failed";

export type KapiooSyncReason =
  | "no-order-ids"
  | "synthetic-stop"
  | "missing-env"
  | "pod-not-r2-url"
  | "non-r2-dev-url"
  | "admin-api-timeout"
  | "admin-api-401"
  | "admin-api-400"
  | "admin-api-5xx"
  | "partial-success"
  | "missing-arrival-time";

export interface KapiooSyncState {
  status: KapiooSyncStatus;
  reason?: KapiooSyncReason;
  attempted_at?: string;
  updated_order_ids?: string[];
  skipped_order_ids?: string[];
  missing_order_ids?: string[];
  error_message?: string;
  attempts?: number;
}

export interface OptimizedStop {
  customer_index: number;
  customer_name: string;
  customer_phone: string;
  customer_address: string;
  notes?: string;
  is_first_stop: boolean;
  is_end_point: boolean;
  eta?: string;
  arrival_time?: string;
  distance_from_previous?: number;
  duration_from_previous?: number;
  using_nearby_location?: boolean;
  nearby_location_reference?: string | null;
  completed?: boolean;
  completed_at?: string;
  proof_of_delivery?: string;
  proof_of_delivery_images?: string[];
  proof_short_url?: string;
  sms_message_text?: string;
  sms_sent_at?: string;
  /**
   * Kapioo order IDs — SOURCE OF TRUTH for Kapioo Admin sync.
   * Read at completion and retry. Editable only via the run-details stop card.
   * Empty/undefined means this stop is intentionally not a Kapioo order.
   */
  order_ids?: string[];
  /** Last Kapioo Admin POD sync outcome (admin-side surface only). */
  kapioo_sync?: KapiooSyncState;
  /** Kapioo Admin delivery-started sync (Start Delivery). Separate from POD. */
  kapioo_delivery_started_sync?: KapiooSyncState;
  /** Copied from customer on optimize. Effective default `false` is applied in code, not the schema. */
  is_synthetic?: boolean;
  /** Copied from customer on optimize. Effective default `"customer"` is applied in code, not the schema. */
  stop_type?: StopType;
  /** Stop-level source of truth for meet-up instructions after optimization. */
  meetup_note?: string;
  /** Copied from customer on optimize. Effective default `5` is applied in code, not the schema. */
  service_time_minutes?: number;
}

export interface OptimizedRoute {
  total_distance_km?: number;
  total_duration_minutes?: number;
  stops: OptimizedStop[];
  encoded_polyline?: string;
  return_distance_km?: number;
  return_duration_minutes?: number;
  start_lat?: number;
  start_lng?: number;
}

export interface DeliveryRun {
  _id: string;
  run_date: string;
  driver_name: string;
  start_location: string;
  end_location?: string;
  start_time: string;
  actual_start_time?: string;
  travel_mode: TravelMode;
  customers: DeliveryCustomer[];
  status: RunStatus;
  optimized_route?: OptimizedRoute;
  messages_sent?: boolean;
  messages_sent_at?: string;
  /** Groups DT / UT / Self runs created together by Kapioo Admin integration. */
  planning_session_id?: string;
  /** External reference from Kapioo Admin for this run. */
  external_id?: string;
  /** Idempotency key for integration-created runs; duplicate prevention SSOT. */
  idempotency_key?: string;
  /** Integration source identifier (e.g. kapioo-admin). */
  created_by_integration?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface DeliveryRunCreateInput {
  run_date?: string;
  driver_name?: string;
  start_location?: string;
  end_location?: string;
  start_time?: string;
  travel_mode?: TravelMode;
}
