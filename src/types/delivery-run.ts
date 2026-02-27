/**
 * DeliveryRun types aligned with MongoDB schema.
 */

export type TravelMode = "driving" | "ebike";
export type GeocodeStatus = "success" | "failed" | "pending" | "override_success";
export type RunStatus = "draft" | "optimized" | "in_progress" | "completed";

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
