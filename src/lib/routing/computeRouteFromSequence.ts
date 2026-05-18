import type { DeliveryCustomer, OptimizedStop } from "@/types/delivery-run";
import { getDirectionsLeg, type LatLng } from "@/lib/google/directions";
import { validationError } from "@/lib/http/errors";

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

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

function toEtaLabel(date: Date): string {
  return date.toLocaleTimeString("en-US", {
    hour12: true,
    hour: "2-digit",
    minute: "2-digit",
  });
}

export interface ComputeRouteFromSequenceParams {
  customerIndicesInOrder: number[];
  customers: DeliveryCustomer[];
  run: {
    run_date: string;
    start_time: string;
    travel_mode: "driving" | "ebike";
    end_location?: string;
  };
  startCoords: LatLng;
  /** When set and hasEndPointCustomer is false, add return leg from last stop to this location. */
  endLocationCoords?: LatLng | null;
  hasEndPointCustomer: boolean;
  /**
   * Existing optimized stops from the previous route (if any). Used solely to preserve
   * `order_ids` on the freshly-built stops, so admin edits to `stop.order_ids` survive
   * re-optimization. Lookup is by `customer_index`. When no match exists, we seed once
   * from `customer.order_ids`. After this snapshot, `customer.order_ids` is never read again.
   */
  priorStops?: OptimizedStop[];
}

/**
 * Builds optimized stops and totals by walking the exact customer order with Directions API legs.
 * Matches optimize/recalculate behavior for ETAs, service time, and return leg rules.
 */
export async function computeOptimizedRouteFromSequence(
  params: ComputeRouteFromSequenceParams
): Promise<{
  stops: OptimizedStop[];
  returnDistanceKm: number;
  returnDurationMinutes: number;
  totalDistanceKm: number;
  totalDurationMinutes: number;
  encodedPolyline: string | undefined;
  startLat: number;
  startLng: number;
}> {
  const {
    customerIndicesInOrder,
    customers,
    run,
    startCoords,
    endLocationCoords,
    hasEndPointCustomer,
    priorStops,
  } = params;

  if (customerIndicesInOrder.length === 0) {
    throw validationError("No valid customers to build a route.");
  }

  const priorOrderIdsByCustomer = new Map<number, string[]>();
  if (priorStops) {
    for (const ps of priorStops) {
      if (
        typeof ps?.customer_index === "number" &&
        Array.isArray(ps.order_ids) &&
        ps.order_ids.length > 0
      ) {
        priorOrderIdsByCustomer.set(ps.customer_index, [...ps.order_ids]);
      }
    }
  }

  let currentTime = new Date(`${run.run_date}T${run.start_time}:00`);
  const stops: OptimizedStop[] = [];

  for (let i = 0; i < customerIndicesInOrder.length; i++) {
    const custIdx = customerIndicesInOrder[i];
    if (custIdx < 0 || custIdx >= customers.length) {
      throw validationError(`Invalid customer index in route sequence: ${custIdx}`);
    }
    const customer = customers[custIdx];
    const routing = toRoutingCoords(customer);

    const prevCoords: LatLng =
      i === 0
        ? startCoords
        : toRoutingCoords(customers[customerIndicesInOrder[i - 1]]).coords;

    const leg = await getDirectionsLeg(
      prevCoords,
      routing.coords,
      run.travel_mode,
      currentTime
    );
    if (!leg) {
      throw validationError(
        `Unable to build a valid optimized route with the current fixed stop positions.`
      );
    }

    const distanceKm = round2(leg.distanceMeters / 1000);
    const durationMin = round2(leg.durationSeconds / 60);
    currentTime = addMinutes(currentTime, durationMin);

    // Preserve admin edits to stop.order_ids across re-optimizations; otherwise seed once
    // from customer.order_ids. After this point, customer.order_ids is never read again.
    const priorIds = priorOrderIdsByCustomer.get(custIdx);
    const seedIds = customer.order_ids;
    const resolvedOrderIds =
      priorIds && priorIds.length > 0
        ? priorIds
        : Array.isArray(seedIds) && seedIds.length > 0
          ? [...seedIds]
          : undefined;

    stops.push({
      customer_index: custIdx,
      customer_name: customer.name,
      customer_phone: customer.phone,
      customer_address: customer.address,
      notes: customer.notes,
      is_first_stop: customer.is_first_stop,
      is_end_point: customer.is_end_point,
      eta: toEtaLabel(currentTime),
      arrival_time: currentTime.toISOString(),
      distance_from_previous: distanceKm,
      duration_from_previous: durationMin,
      using_nearby_location: routing.usingNearby,
      nearby_location_reference: routing.nearbyRef,
      completed: false,
      ...(resolvedOrderIds ? { order_ids: resolvedOrderIds } : {}),
    });

    currentTime = addMinutes(currentTime, 5);
  }

  let returnDistanceKm = 0;
  let returnDurationMinutes = 0;
  if (endLocationCoords && !hasEndPointCustomer && stops.length > 0) {
    const last = stops[stops.length - 1];
    const lastCustomer =
      last.customer_index >= 0 && last.customer_index < customers.length
        ? customers[last.customer_index]
        : undefined;
    if (!lastCustomer) {
      throw validationError(
        "Cannot compute return leg: last stop has invalid customer index."
      );
    }
    const lastCoords = toRoutingCoords(lastCustomer).coords;
    const returnLeg = await getDirectionsLeg(
      lastCoords,
      endLocationCoords,
      run.travel_mode,
      currentTime
    );
    if (returnLeg) {
      returnDistanceKm = round2(returnLeg.distanceMeters / 1000);
      returnDurationMinutes = round2(returnLeg.durationSeconds / 60);
    }
  }

  const travelSumKm = round2(
    stops.reduce((sum, s) => sum + (s.distance_from_previous ?? 0), 0)
  );
  const travelSumMinutes = round2(
    stops.reduce((sum, s) => sum + (s.duration_from_previous ?? 0), 0)
  );
  const serviceMinutes = stops.length * 5;

  return {
    stops,
    returnDistanceKm,
    returnDurationMinutes,
    totalDistanceKm: round2(travelSumKm + returnDistanceKm),
    totalDurationMinutes: round2(
      travelSumMinutes + serviceMinutes + returnDurationMinutes
    ),
    encodedPolyline: undefined,
    startLat: startCoords.lat,
    startLng: startCoords.lng,
  };
}
