import { NextRequest } from "next/server";
import mongoose from "mongoose";
import { connectDB } from "@/lib/mongodb";
import { DeliveryRunModel } from "@/models/DeliveryRun";
import { json, handleApiError } from "@/lib/http/response";
import { badRequest, notFound, validationError } from "@/lib/http/errors";
import type { DeliveryCustomer, OptimizedStop } from "@/types/delivery-run";
import { assertSaveGate } from "@/lib/validation/save-gates";
import { geocodeAddress } from "@/lib/google/geocoding";
import { getDirectionsLeg, type LatLng } from "@/lib/google/directions";
import { optimizeTours } from "@/lib/google/fleetRouting";
import { sanitizeCustomers, sanitizeStops } from "@/lib/normalization/delivery-run";
import { assertRateLimit } from "@/lib/rate-limit";
import { requireAdminSession } from "@/lib/auth/requireAdmin";

type Params = { params: Promise<{ id: string }> };

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
    throw validationError(`Customer "${name}" is missing geocoded coordinates. Run Geocode All first.`);
  }
  return {
    coords: { lat: customer.lat, lng: customer.lng },
    usingNearby: false,
    nearbyRef: null,
  };
}

function parseDurationSeconds(text?: string): number {
  if (!text) return 0;
  const match = text.match(/(\d+(?:\.\d+)?)s/);
  return match ? Number(match[1]) : 0;
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

export async function POST(req: NextRequest, { params }: Params) {
  try {
    requireAdminSession(req);
    const { id } = await params;
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      throw badRequest("Invalid run ID");
    }
    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      req.headers.get("x-real-ip") ??
      "unknown";
    assertRateLimit({
      key: `optimize:${ip}`,
      windowMs: 60_000,
      maxRequests: 10,
    });

    await connectDB();
    const run = await DeliveryRunModel.findById(id);
    if (!run) throw notFound("Delivery run not found");

    const rawCustomers = JSON.parse(JSON.stringify(run.customers ?? []));
    const customers = sanitizeCustomers(rawCustomers as DeliveryCustomer[]);
    if (customers.length > 60) {
      throw validationError("Maximum 60 stops allowed for optimization.");
    }
    assertSaveGate(customers);

    const firstStops = customers
      .map((c, idx) => ({ c, idx }))
      .filter((x) => x.c.is_first_stop);
    if (firstStops.length > 1) {
      throw validationError("Only one customer can be marked as First Stop.");
    }
    const endPoints = customers
      .map((c, idx) => ({ c, idx }))
      .filter((x) => x.c.is_end_point);
    if (endPoints.length > 1) {
      throw validationError("Only one customer can be marked as End Point.");
    }

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
    let endLocationCustomerIndex: number | undefined;
    if (endPoint) {
      const endpointRouting = toRoutingCoords(endPoint.c);
      endLocationCoords = endpointRouting.coords;
      endLocationCustomerIndex = endPoint.idx;
    } else if (run.end_location?.trim()) {
      const endGeocode = await geocodeAddress(run.end_location);
      if (endGeocode) {
        endLocationCoords = { lat: endGeocode.lat, lng: endGeocode.lng };
      }
    }

    const shipments = customers
      .map((c, idx) => ({ c, idx }))
      .filter((x) => x.idx !== firstStop?.idx)
      .filter((x) => x.idx !== endLocationCustomerIndex)
      .map((x) => {
        const routing = toRoutingCoords(x.c);
        return {
          idx: x.idx,
          customer: x.c,
          routing,
          label: `c_${x.idx}`,
        };
      });

    const globalStartTime = `${run.run_date}T${run.start_time}:00-05:00`;
    const globalEndTime = `${run.run_date}T23:59:59-05:00`;

    const fleet = shipments.length
      ? await optimizeTours({
          globalStartTime,
          globalEndTime,
          shipments: shipments.map((s) => ({
            label: s.label,
            location: {
              latitude: s.routing.coords.lat,
              longitude: s.routing.coords.lng,
            },
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
    const transitions = route?.transitions ?? [];
    const routePolyline = route?.routePolyline?.points;

    const byLabel = new Map(shipments.map((s) => [s.label, s]));
    const byShipmentIndex = new Map(
      shipments.map((s, i) => [i, s] as const)
    );

    let currentTime = new Date(`${run.run_date}T${run.start_time}:00`);
    const stops: OptimizedStop[] = [];

    if (firstStop && firstStopRouting) {
      const leg0 = await getDirectionsLeg(
        startCoords,
        firstStopRouting.coords,
        run.travel_mode,
        currentTime
      );
      const distanceKm = round2((leg0?.distanceMeters ?? 0) / 1000);
      const durationMin = round2((leg0?.durationSeconds ?? 0) / 60);
      currentTime = addMinutes(currentTime, durationMin);
      stops.push({
        customer_index: firstStop.idx,
        customer_name: firstStop.c.name,
        customer_phone: firstStop.c.phone,
        customer_address: firstStop.c.address,
        notes: firstStop.c.notes,
        is_first_stop: true,
        is_end_point: firstStop.c.is_end_point,
        eta: toEtaLabel(currentTime),
        arrival_time: currentTime.toISOString(),
        distance_from_previous: distanceKm,
        duration_from_previous: durationMin,
        using_nearby_location: firstStopRouting.usingNearby,
        nearby_location_reference: firstStopRouting.nearbyRef,
        completed: false,
      });
      currentTime = addMinutes(currentTime, 5);
    }

    for (let i = 0; i < visits.length; i++) {
      const visit = visits[i];
      const shipment =
        (visit.shipmentLabel ? byLabel.get(visit.shipmentLabel) : undefined) ??
        (typeof visit.shipmentIndex === "number"
          ? byShipmentIndex.get(visit.shipmentIndex)
          : undefined);
      if (!shipment) continue;

      const transition = transitions[i];
      const distanceKm = round2((transition?.travelDistanceMeters ?? 0) / 1000);
      const durationMin = round2(parseDurationSeconds(transition?.travelDuration) / 60);
      currentTime = addMinutes(currentTime, durationMin);
      stops.push({
        customer_index: shipment.idx,
        customer_name: shipment.customer.name,
        customer_phone: shipment.customer.phone,
        customer_address: shipment.customer.address,
        notes: shipment.customer.notes,
        is_first_stop: shipment.customer.is_first_stop,
        is_end_point: shipment.customer.is_end_point,
        eta: toEtaLabel(currentTime),
        arrival_time: currentTime.toISOString(),
        distance_from_previous: distanceKm,
        duration_from_previous: durationMin,
        using_nearby_location: shipment.routing.usingNearby,
        nearby_location_reference: shipment.routing.nearbyRef,
        completed: false,
      });
      currentTime = addMinutes(currentTime, 5);
    }

    if (endPoint) {
      const endpointRouting = toRoutingCoords(endPoint.c);
      const prev = stops[stops.length - 1];
      const prevCustomer =
        prev &&
        prev.customer_index >= 0 &&
        prev.customer_index < customers.length
          ? customers[prev.customer_index]
          : undefined;
      const prevCoords = prevCustomer
        ? toRoutingCoords(prevCustomer).coords
        : firstStopRouting?.coords ?? startCoords;
      const toEndLeg = await getDirectionsLeg(
        prevCoords,
        endpointRouting.coords,
        run.travel_mode,
        currentTime
      );
      const distanceKm = round2((toEndLeg?.distanceMeters ?? 0) / 1000);
      const durationMin = round2((toEndLeg?.durationSeconds ?? 0) / 60);
      currentTime = addMinutes(currentTime, durationMin);
      stops.push({
        customer_index: endPoint.idx,
        customer_name: endPoint.c.name,
        customer_phone: endPoint.c.phone,
        customer_address: endPoint.c.address,
        notes: endPoint.c.notes,
        is_first_stop: endPoint.c.is_first_stop,
        is_end_point: true,
        eta: toEtaLabel(currentTime),
        arrival_time: currentTime.toISOString(),
        distance_from_previous: distanceKm,
        duration_from_previous: durationMin,
        using_nearby_location: endpointRouting.usingNearby,
        nearby_location_reference: endpointRouting.nearbyRef,
        completed: false,
      });
      currentTime = addMinutes(currentTime, 5);
    }

    let returnDistanceKm = 0;
    let returnDurationMinutes = 0;
    if (endLocationCoords && !endPoint && stops.length > 0) {
      const last = stops[stops.length - 1];
      const lastCustomer =
        last.customer_index >= 0 && last.customer_index < customers.length
          ? customers[last.customer_index]
          : undefined;
      if (!lastCustomer || !hasValidCoords(lastCustomer)) {
        throw validationError(
          "Cannot compute return leg: last stop has invalid customer index or missing coordinates."
        );
      }
      const lastCoords = toRoutingCoords(lastCustomer).coords;
      const returnLeg = await getDirectionsLeg(
        lastCoords,
        endLocationCoords,
        run.travel_mode,
        currentTime
      );
      returnDistanceKm = round2((returnLeg?.distanceMeters ?? 0) / 1000);
      returnDurationMinutes = round2((returnLeg?.durationSeconds ?? 0) / 60);
    }

    const travelSumKm = round2(
      stops.reduce((sum, s) => sum + (s.distance_from_previous ?? 0), 0)
    );
    const travelSumMinutes = round2(
      stops.reduce((sum, s) => sum + (s.duration_from_previous ?? 0), 0)
    );
    const serviceMinutes = stops.length * 5;

    run.customers = customers;
    run.status = "optimized";
    run.optimized_route = {
      stops: sanitizeStops(stops),
      encoded_polyline: routePolyline,
      return_distance_km: returnDistanceKm,
      return_duration_minutes: returnDurationMinutes,
      total_distance_km: round2(travelSumKm + returnDistanceKm),
      total_duration_minutes: round2(
        travelSumMinutes + serviceMinutes + returnDurationMinutes
      ),
      start_lat: startCoords.lat,
      start_lng: startCoords.lng,
    };
    await run.save();

    return json({
      run: {
        ...run.toObject(),
        _id: run._id.toString(),
      },
    });
  } catch (err) {
    return handleApiError(err);
  }
}

