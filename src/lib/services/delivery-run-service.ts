/**
 * Shared DeliveryRun service functions used by both the admin route handlers and the
 * inbound integration endpoints. Logic here is extracted verbatim from the existing
 * handlers so manual admin behavior is unchanged.
 */

import { connectDB } from "@/lib/mongodb";
import { DeliveryRunModel } from "@/models/DeliveryRun";
import { notFound, validationError } from "@/lib/http/errors";
import { todayYYYYMMDD } from "@/lib/dates";
import type {
  DeliveryCustomer,
  OptimizedStop,
  TravelMode,
} from "@/types/delivery-run";
import { assertSaveGate } from "@/lib/validation/save-gates";
import {
  assertFixedStopPositionsValid,
  buildRouteSkeletonSlots,
  fillSkeletonWithFlexibleOrder,
  getFlexibleCustomerIndices,
  isFullyFixedRoute,
} from "@/lib/validation/fixed-stop-position";
import { geocodeAddress } from "@/lib/google/geocoding";
import { type LatLng } from "@/lib/google/directions";
import { optimizeTours } from "@/lib/google/fleetRouting";
import { sanitizeCustomers, sanitizeStops } from "@/lib/normalization/delivery-run";
import { computeOptimizedRouteFromSequence } from "@/lib/routing/computeRouteFromSequence";
import type { GeocodeFailure } from "@/lib/integration/buildRunIntegrationResponse";
import { getEffectiveServiceTimeMinutes } from "@/lib/stops/synthetic";

/** Hydrated DeliveryRun document type (inferred from the model). */
export type DeliveryRunDoc = InstanceType<typeof DeliveryRunModel>;

function hasValidCoords(c: DeliveryCustomer): boolean {
  if (
    c.geocode_status === "override_success" &&
    typeof c.nearby_lat === "number" &&
    typeof c.nearby_lng === "number"
  ) {
    return true;
  }
  return typeof c.lat === "number" && typeof c.lng === "number";
}

function toRoutingCoords(customer: DeliveryCustomer): {
  coords: LatLng;
  usingNearby: boolean;
  nearbyRef: string | null;
} {
  if (
    customer.geocode_status === "override_success" &&
    typeof customer.nearby_lat === "number" &&
    typeof customer.nearby_lng === "number"
  ) {
    return {
      coords: { lat: customer.nearby_lat, lng: customer.nearby_lng },
      usingNearby: true,
      nearbyRef: customer.nearby_address_override ?? null,
    };
  }
  if (typeof customer.lat !== "number" || typeof customer.lng !== "number") {
    const name = customer?.name ?? "unknown";
    throw validationError(
      `Customer "${name}" is missing geocoded coordinates. Run Geocode All first.`
    );
  }
  return {
    coords: { lat: customer.lat, lng: customer.lng },
    usingNearby: false,
    nearbyRef: null,
  };
}

export interface CreateDeliveryRunInput {
  run_date?: string;
  driver_name?: string;
  start_location?: string;
  end_location?: string;
  start_time?: string;
  travel_mode?: TravelMode;
  customers?: Array<DeliveryCustomer | Record<string, unknown>>;
  // Optional integration metadata (only set when provided).
  planning_session_id?: string;
  external_id?: string;
  idempotency_key?: string;
  created_by_integration?: string;
}

/**
 * Creates a draft DeliveryRun. Mirrors the existing POST /api/delivery-runs behavior
 * and additionally persists integration metadata when present.
 */
export async function createDeliveryRunFromPayload(
  payload: CreateDeliveryRunInput
): Promise<DeliveryRunDoc> {
  await connectDB();
  const run_date = payload.run_date ?? todayYYYYMMDD();
  const travel_mode = payload.travel_mode ?? "driving";
  const start_time = payload.start_time ?? "09:00";

  const doc: Record<string, unknown> = {
    run_date,
    driver_name: payload.driver_name ?? "",
    start_location: payload.start_location ?? "",
    end_location: payload.end_location ?? undefined,
    start_time,
    travel_mode,
    customers: sanitizeCustomers(payload.customers ?? []),
    status: "draft",
  };

  if (payload.planning_session_id !== undefined)
    doc.planning_session_id = payload.planning_session_id;
  if (payload.external_id !== undefined) doc.external_id = payload.external_id;
  if (payload.idempotency_key !== undefined)
    doc.idempotency_key = payload.idempotency_key;
  if (payload.created_by_integration !== undefined)
    doc.created_by_integration = payload.created_by_integration;

  return DeliveryRunModel.create(doc) as Promise<DeliveryRunDoc>;
}

/**
 * Geocodes a run's customers in place and saves. Returns the list of failures.
 * - Skips stops already resolved via override_success.
 * - Skips stops that already have valid lat/lng with geocode_status "success"
 *   (so caller-provided coordinates are not re-geocoded).
 */
export async function geocodeRunCustomers(
  run: DeliveryRunDoc
): Promise<GeocodeFailure[]> {
  const rawCustomers = JSON.parse(JSON.stringify(run.customers ?? []));
  const customers = sanitizeCustomers(rawCustomers as DeliveryCustomer[]);
  const failures: GeocodeFailure[] = [];

  for (let i = 0; i < customers.length; i++) {
    const c = customers[i];
    if (c.geocode_status === "override_success") continue;
    if (
      typeof c.lat === "number" &&
      typeof c.lng === "number" &&
      c.geocode_status === "success"
    ) {
      continue;
    }

    const addrRaw = c.nearby_address_override ?? c.address ?? "";
    const address = typeof addrRaw === "string" ? addrRaw.trim() : "";
    if (!address) {
      c.geocode_status = "failed";
      c.geocode_error = "No address to geocode";
      failures.push({
        index: i,
        name: c.name ?? "",
        address: c.address ?? "",
        error: "No address to geocode",
      });
      continue;
    }

    const result = await geocodeAddress(address);
    if (result) {
      c.lat = result.lat;
      c.lng = result.lng;
      c.geocode_status = "success";
      c.geocode_error = undefined;
    } else {
      c.geocode_status = "failed";
      c.geocode_error = `Could not geocode: ${address}`;
      failures.push({
        index: i,
        name: c.name ?? "",
        address,
        error: c.geocode_error,
      });
    }
  }

  run.customers = sanitizeCustomers(customers);
  await run.save();
  return failures;
}

/**
 * Optimizes a run by id and persists the result. Extracted verbatim from
 * POST /api/delivery-runs/{id}/optimize so admin behavior is unchanged.
 */
export async function optimizeDeliveryRunById(
  id: string
): Promise<DeliveryRunDoc> {
  await connectDB();
  const run = await DeliveryRunModel.findById(id);
  if (!run) throw notFound("Delivery run not found");

  const rawCustomers = JSON.parse(JSON.stringify(run.customers ?? []));
  const customers = sanitizeCustomers(rawCustomers as DeliveryCustomer[]);
  if (customers.length === 0) {
    throw validationError("No valid customers to optimize.");
  }
  if (customers.length > 60) {
    throw validationError("Maximum 60 stops allowed for optimization.");
  }
  assertSaveGate(customers);
  assertFixedStopPositionsValid(customers);

  const firstStops = customers
    .map((c, idx) => ({ c, idx }))
    .filter((x) => x.c.is_first_stop);
  const endPoints = customers
    .map((c, idx) => ({ c, idx }))
    .filter((x) => x.c.is_end_point);

  const startGeocode = await geocodeAddress(run.start_location);
  if (!startGeocode) {
    throw validationError("Start location could not be geocoded.");
  }
  const startCoords: LatLng = { lat: startGeocode.lat, lng: startGeocode.lng };

  const firstStop = firstStops[0];
  const endPoint = endPoints[0];

  const usedIndices = new Set<number>();
  if (firstStop) usedIndices.add(firstStop.idx);
  if (endPoint) usedIndices.add(endPoint.idx);
  customers.forEach((_, idx) => {
    if (firstStop?.idx !== idx && endPoint?.idx !== idx) usedIndices.add(idx);
  });
  const missingCoords = Array.from(usedIndices)
    .map((idx) => ({ idx, c: customers[idx] }))
    .filter((x) => !hasValidCoords(x.c))
    .map((x) => `#${x.idx + 1} "${x.c?.name ?? "(no name)"}"`);
  if (missingCoords.length > 0) {
    throw validationError(
      `The following customers are missing geocoded coordinates. Run Geocode All first: ${missingCoords.join(", ")}`
    );
  }

  const firstStopRouting = firstStop ? toRoutingCoords(firstStop.c) : null;

  let endLocationCoords: LatLng | undefined;
  if (endPoint) {
    const endpointRouting = toRoutingCoords(endPoint.c);
    endLocationCoords = endpointRouting.coords;
  } else if (run.end_location?.trim()) {
    const endGeocode = await geocodeAddress(run.end_location);
    if (endGeocode) {
      endLocationCoords = { lat: endGeocode.lat, lng: endGeocode.lng };
    }
  }

  const skeleton = buildRouteSkeletonSlots(customers);
  const flexIndices = getFlexibleCustomerIndices(skeleton);

  const shipments = flexIndices.map((idx) => {
    const routing = toRoutingCoords(customers[idx]);
    return {
      idx,
      customer: customers[idx],
      routing,
      label: `c_${idx}`,
    };
  });

  const globalStartTime = `${run.run_date}T${run.start_time}:00-05:00`;
  const globalEndTime = `${run.run_date}T23:59:59-05:00`;

  const fleet =
    shipments.length > 0
      ? await optimizeTours({
          globalStartTime,
          globalEndTime,
          shipments: shipments.map((s) => ({
            label: s.label,
            location: {
              latitude: s.routing.coords.lat,
              longitude: s.routing.coords.lng,
            },
            serviceTimeSeconds: getEffectiveServiceTimeMinutes(s.customer) * 60,
          })),
          vehicle: {
            startLocation: {
              latitude: firstStopRouting?.coords.lat ?? startCoords.lat,
              longitude: firstStopRouting?.coords.lng ?? startCoords.lng,
            },
            endLocation: endLocationCoords
              ? {
                  latitude: endLocationCoords.lat,
                  longitude: endLocationCoords.lng,
                }
              : undefined,
            travelMode: run.travel_mode === "ebike" ? "BICYCLING" : "DRIVING",
          },
        })
      : { routes: [] };

  const route = fleet.routes?.[0];
  const visits = route?.visits ?? [];

  let finalOrder: number[];

  if (isFullyFixedRoute(skeleton)) {
    finalOrder = skeleton.map((s) => s as number);
  } else {
    if (flexIndices.length > 0) {
      if (visits.length !== flexIndices.length) {
        throw validationError(
          "Unable to build a valid optimized route with the current fixed stop positions."
        );
      }
    }

    const byLabel = new Map(shipments.map((s) => [s.label, s]));
    const byShipmentIndex = new Map(shipments.map((s, i) => [i, s] as const));

    const flexOrdered: number[] = [];
    for (let i = 0; i < visits.length; i++) {
      const visit = visits[i];
      const shipment =
        (visit.shipmentLabel ? byLabel.get(visit.shipmentLabel) : undefined) ??
        (typeof visit.shipmentIndex === "number"
          ? byShipmentIndex.get(visit.shipmentIndex)
          : undefined);
      if (!shipment) {
        throw validationError(
          "Unable to build a valid optimized route with the current fixed stop positions."
        );
      }
      flexOrdered.push(shipment.idx);
    }

    if (flexOrdered.length !== flexIndices.length) {
      throw validationError(
        "Unable to build a valid optimized route with the current fixed stop positions."
      );
    }

    finalOrder = fillSkeletonWithFlexibleOrder(skeleton, flexOrdered);
  }

  const priorStops = (run.optimized_route?.stops ?? []) as OptimizedStop[];

  const computed = await computeOptimizedRouteFromSequence({
    customerIndicesInOrder: finalOrder,
    customers,
    run: {
      run_date: run.run_date,
      start_time: run.start_time,
      travel_mode: run.travel_mode,
      end_location: run.end_location,
    },
    startCoords,
    endLocationCoords: !endPoint ? endLocationCoords : undefined,
    hasEndPointCustomer: Boolean(endPoint),
    priorStops,
  });

  run.customers = customers;
  run.status = "optimized";
  run.optimized_route = {
    stops: sanitizeStops(computed.stops),
    encoded_polyline: computed.encodedPolyline,
    return_distance_km: computed.returnDistanceKm,
    return_duration_minutes: computed.returnDurationMinutes,
    total_distance_km: computed.totalDistanceKm,
    total_duration_minutes: computed.totalDurationMinutes,
    start_lat: computed.startLat,
    start_lng: computed.startLng,
  };
  await run.save();

  return run;
}
