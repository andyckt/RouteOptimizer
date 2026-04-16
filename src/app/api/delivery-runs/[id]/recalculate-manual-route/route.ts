import { NextRequest } from "next/server";
import mongoose from "mongoose";
import { connectDB } from "@/lib/mongodb";
import { DeliveryRunModel } from "@/models/DeliveryRun";
import { json, handleApiError } from "@/lib/http/response";
import { badRequest, notFound, validationError } from "@/lib/http/errors";
import type { DeliveryCustomer, OptimizedStop } from "@/types/delivery-run";
import { geocodeAddress } from "@/lib/google/geocoding";
import { getDirectionsLeg, type LatLng } from "@/lib/google/directions";
import {
  sanitizeCustomers,
  sanitizeStops,
  sanitizeRunForResponse,
} from "@/lib/normalization/delivery-run";
import { assertManualOrderRespectsFixedStops } from "@/lib/validation/fixed-stop-position";
import { requireAdminSession } from "@/lib/auth/requireAdmin";

type Params = { params: Promise<{ id: string }> };

function toRoutingCoords(customer: DeliveryCustomer): LatLng {
  if (
    customer.geocode_status === "override_success" &&
    typeof customer.nearby_lat === "number" &&
    typeof customer.nearby_lng === "number"
  ) {
    return { lat: customer.nearby_lat, lng: customer.nearby_lng };
  }
  if (typeof customer.lat === "number" && typeof customer.lng === "number") {
    return { lat: customer.lat, lng: customer.lng };
  }
  throw validationError(
    `Customer "${customer?.name ?? "unknown"}" is missing geocoded coordinates.`
  );
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

function toEtaLabel(date: Date): string {
  return date.toLocaleTimeString("en-US", {
    timeZone: "America/Toronto",
    hour12: true,
    hour: "2-digit",
    minute: "2-digit",
  });
}

function parseBaseTime(runDate: string, startTime: string): Date {
  const [h, m] = (startTime || "09:00").split(":").map(Number);
  const dateStr = `${runDate}T${String(h ?? 9).padStart(2, "0")}:${String(m ?? 0).padStart(2, "0")}:00`;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) {
    return new Date(new Date().toISOString().slice(0, 10) + "T09:00:00");
  }
  return d;
}

export async function POST(req: NextRequest, { params }: Params) {
  try {
    requireAdminSession(req);
    const { id } = await params;
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      throw badRequest("Invalid run ID");
    }

    let body: { stops?: OptimizedStop[] };
    try {
      body = await req.json();
    } catch {
      throw badRequest("Invalid JSON body");
    }
    const stops = Array.isArray(body.stops) ? body.stops : undefined;
    if (!stops?.length) {
      throw badRequest("Request body must include a non-empty stops array.");
    }

    await connectDB();
    const run = await DeliveryRunModel.findById(id);
    if (!run) throw notFound("Delivery run not found");

    if (run.status !== "optimized") {
      throw validationError(
        `Run must be optimized to recalculate. Current status: ${run.status}`
      );
    }

    const rawCustomers = JSON.parse(JSON.stringify(run.customers ?? [])) as DeliveryCustomer[];
    const customers = sanitizeCustomers(rawCustomers);
    assertManualOrderRespectsFixedStops(stops, customers);

    const startGeocode = await geocodeAddress(run.start_location);
    if (!startGeocode) {
      throw validationError("Start location could not be geocoded.");
    }
    const startCoords: LatLng = { lat: startGeocode.lat, lng: startGeocode.lng };

    let currentTime = parseBaseTime(run.run_date ?? "", run.start_time ?? "09:00");
    const reorderedStops = JSON.parse(JSON.stringify(stops)) as OptimizedStop[];

    for (let i = 0; i < reorderedStops.length; i++) {
      const stop = reorderedStops[i];
      const customer =
        typeof stop.customer_index === "number" &&
        stop.customer_index >= 0 &&
        stop.customer_index < customers.length
          ? customers[stop.customer_index]
          : undefined;
      if (!customer) {
        throw validationError(`Stop ${i + 1}: invalid customer index ${stop.customer_index}`);
      }
      const destCoords = toRoutingCoords(customer);

      const prevCoords =
        i === 0
          ? startCoords
          : toRoutingCoords(customers[reorderedStops[i - 1].customer_index]);

      const leg = await getDirectionsLeg(
        prevCoords,
        destCoords,
        run.travel_mode,
        currentTime
      );
      if (!leg) {
        throw validationError(
          `Directions API failed for leg to stop ${i + 1} (${stop.customer_name})`
        );
      }
      const distanceKm = round2(leg.distanceMeters / 1000);
      const durationMin = round2(leg.durationSeconds / 60);

      currentTime = addMinutes(currentTime, durationMin);

      stop.eta = toEtaLabel(currentTime);
      stop.arrival_time = currentTime.toISOString();
      stop.distance_from_previous = distanceKm;
      stop.duration_from_previous = durationMin;
      stop.completed = false;

      currentTime = addMinutes(currentTime, 5);
    }

    let returnDistanceKm = 0;
    let returnDurationMinutes = 0;
    if (run.end_location?.trim()) {
      const endGeocode = await geocodeAddress(run.end_location);
      if (endGeocode) {
        const lastStop = reorderedStops[reorderedStops.length - 1];
        const lastCustomer =
          lastStop &&
          typeof lastStop.customer_index === "number" &&
          lastStop.customer_index >= 0 &&
          lastStop.customer_index < customers.length
            ? customers[lastStop.customer_index]
            : undefined;
        if (lastCustomer) {
          const lastCoords = toRoutingCoords(lastCustomer);
          const endCoords: LatLng = { lat: endGeocode.lat, lng: endGeocode.lng };
          const returnLeg = await getDirectionsLeg(
            lastCoords,
            endCoords,
            run.travel_mode,
            currentTime
          );
          if (returnLeg) {
            returnDistanceKm = round2(returnLeg.distanceMeters / 1000);
            returnDurationMinutes = round2(returnLeg.durationSeconds / 60);
          }
        }
      }
    }

    const travelSumKm = round2(
      reorderedStops.reduce((sum, s) => sum + (s.distance_from_previous ?? 0), 0)
    );
    const travelSumMinutes = round2(
      reorderedStops.reduce((sum, s) => sum + (s.duration_from_previous ?? 0), 0)
    );
    const serviceMinutes = reorderedStops.length * 5;

    run.optimized_route = {
      stops: sanitizeStops(reorderedStops),
      return_distance_km: returnDistanceKm,
      return_duration_minutes: returnDurationMinutes,
      total_distance_km: round2(travelSumKm + returnDistanceKm),
      total_duration_minutes: round2(
        travelSumMinutes + serviceMinutes + returnDurationMinutes
      ),
      encoded_polyline: undefined,
      start_lat: startCoords.lat,
      start_lng: startCoords.lng,
    };
    await run.save();

    const doc = run.toObject() as { _id: { toString(): string }; [k: string]: unknown };
    return json({
      run: { ...sanitizeRunForResponse(doc), _id: doc._id.toString() },
    });
  } catch (err) {
    return handleApiError(err);
  }
}
