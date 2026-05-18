import { NextRequest } from "next/server";
import mongoose from "mongoose";
import { connectDB } from "@/lib/mongodb";
import { DeliveryRunModel } from "@/models/DeliveryRun";
import { json, handleApiError } from "@/lib/http/response";
import { badRequest, notFound, validationError } from "@/lib/http/errors";
import type { DeliveryCustomer, OptimizedStop } from "@/types/delivery-run";
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
import { assertRateLimit } from "@/lib/rate-limit";
import { requireAdminSession } from "@/lib/auth/requireAdmin";
import { computeOptimizedRouteFromSequence } from "@/lib/routing/computeRouteFromSequence";

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
      const byShipmentIndex = new Map(
        shipments.map((s, i) => [i, s] as const)
      );

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
