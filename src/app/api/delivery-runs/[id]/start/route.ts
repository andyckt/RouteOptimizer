import { NextRequest } from "next/server";
import mongoose from "mongoose";
import { connectDB } from "@/lib/mongodb";
import { DeliveryRunModel } from "@/models/DeliveryRun";
import { json, handleApiError } from "@/lib/http/response";
import { badRequest, notFound, validationError } from "@/lib/http/errors";
import type { DeliveryCustomer, OptimizedStop } from "@/types/delivery-run";
import { geocodeAddress } from "@/lib/google/geocoding";
import { getDirectionsLeg, type LatLng } from "@/lib/google/directions";
import { verifyDriverToken } from "@/lib/security/driverToken";
import { sanitizeStops } from "@/lib/normalization/delivery-run";
import { sendSms } from "@/lib/openphone/client";
import { getServerEnv } from "@/lib/env";
import { toE164NorthAmerica } from "@/lib/phone/e164";
import { formatEtaWindowToronto } from "@/lib/time/etaWindow";
import { runKapiooDeliveryStartedBatch } from "@/lib/kapioo/delivery-started-sync";
import type { KapiooSyncState } from "@/types/delivery-run";

const SMS_TEMPLATE =
  "【Kapioo卡皮喔】您的今日餐食正在配送中，预计送达时间为：{eta}。请耐心等待喔~";

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

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      throw badRequest("Invalid run ID");
    }

    let body: { token?: string };
    try {
      body = await req.json();
    } catch {
      throw badRequest("Invalid JSON body");
    }
    const token = typeof body.token === "string" ? body.token : undefined;
    if (!token || !verifyDriverToken(id, token)) {
      throw badRequest("Invalid or missing driver token");
    }

    await connectDB();
    const run = await DeliveryRunModel.findById(id);
    if (!run) throw notFound("Delivery run not found");

    if (run.status !== "optimized") {
      throw validationError(
        `Run must be optimized before starting. Current status: ${run.status}`
      );
    }
    const route = run.optimized_route;
    if (!route?.stops?.length) {
      throw validationError("Optimized route has no stops.");
    }

    const rawCustomers = JSON.parse(JSON.stringify(run.customers ?? [])) as DeliveryCustomer[];
    const stops = route.stops as OptimizedStop[];

    const startGeocode = await geocodeAddress(run.start_location);
    if (!startGeocode) {
      throw validationError("Start location could not be geocoded.");
    }
    const startCoords: LatLng = { lat: startGeocode.lat, lng: startGeocode.lng };

    const now = new Date();
    run.status = "in_progress";
    run.actual_start_time = now.toISOString();

    let currentTime = new Date(now.getTime());
    const returnDistanceKm = route.return_distance_km ?? 0;
    const returnDurationMinutes = route.return_duration_minutes ?? 0;

    for (let i = 0; i < stops.length; i++) {
      const stop = stops[i];
      const customer =
        typeof stop.customer_index === "number" && stop.customer_index >= 0 && stop.customer_index < rawCustomers.length
          ? rawCustomers[stop.customer_index]
          : undefined;
      if (!customer) {
        throw validationError(`Stop ${i + 1}: invalid customer index ${stop.customer_index}`);
      }
      const destCoords = toRoutingCoords(customer);

      const prevCoords =
        i === 0 ? startCoords : toRoutingCoords(rawCustomers[stops[i - 1].customer_index]);

      const leg = await getDirectionsLeg(prevCoords, destCoords, run.travel_mode);
      const distanceKm = round2((leg?.distanceMeters ?? 0) / 1000);
      const durationMin = round2((leg?.durationSeconds ?? 0) / 60);

      currentTime = addMinutes(currentTime, durationMin);

      stop.eta = toEtaLabel(currentTime);
      stop.arrival_time = currentTime.toISOString();
      stop.distance_from_previous = distanceKm;
      stop.duration_from_previous = durationMin;

      currentTime = addMinutes(currentTime, 5);
    }

    const travelSumKm = round2(
      stops.reduce((sum, s) => sum + (s.distance_from_previous ?? 0), 0)
    );
    const travelSumMinutes = round2(
      stops.reduce((sum, s) => sum + (s.duration_from_previous ?? 0), 0)
    );
    const serviceMinutes = stops.length * 5;

    route.total_distance_km = round2(travelSumKm + returnDistanceKm);
    route.total_duration_minutes = round2(
      travelSumMinutes + serviceMinutes + returnDurationMinutes
    );
    route.stops = sanitizeStops(stops);

    await run.save();

    const startedAt = run.actual_start_time as string;
    const driverName =
      typeof run.driver_name === "string" && run.driver_name.trim()
        ? run.driver_name.trim()
        : undefined;

    // Run Kapioo delivery-started in parallel with SMS so driver wait ≈ max(SMS, Kapioo).
    const kapiooPromise = runKapiooDeliveryStartedBatch({
      runId: id,
      stops,
      startedAt,
      driverName,
    }).catch((err): KapiooSyncState[] => {
      console.error(
        JSON.stringify({
          event: "delivery_started_kapioo_batch_failed",
          runId: id,
          message: err instanceof Error ? err.message : String(err),
        })
      );
      const attemptedAt = new Date().toISOString();
      return stops.map(() => ({
        status: "failed" as const,
        reason: "admin-api-5xx" as const,
        attempted_at: attemptedAt,
        attempts: 1,
        error_message: err instanceof Error ? err.message : "Kapioo delivery-started batch failed",
      }));
    });

    const failedCustomers: Array<{
      customer_name: string;
      phone: string;
      error: string;
    }> = [];
    let totalSent = 0;
    const { OPENPHONE_FROM } = getServerEnv();

    for (let i = 0; i < stops.length; i++) {
      const stop = stops[i];
      const toE164 = toE164NorthAmerica(stop.customer_phone ?? "");
      if (!toE164) {
        failedCustomers.push({
          customer_name: stop.customer_name ?? "unknown",
          phone: stop.customer_phone ?? "",
          error: "Invalid phone number for North America",
        });
        continue;
      }

      const arrivalDate = stop.arrival_time
        ? new Date(stop.arrival_time)
        : null;
      if (!arrivalDate || isNaN(arrivalDate.getTime())) {
        failedCustomers.push({
          customer_name: stop.customer_name ?? "unknown",
          phone: stop.customer_phone ?? "",
          error: "No ETA available",
        });
        continue;
      }

      const eta = formatEtaWindowToronto(arrivalDate);
      const content = SMS_TEMPLATE.replace("{eta}", eta);

      const result = await sendSms({
        from: OPENPHONE_FROM,
        toE164,
        content,
      });

      if (result.success) {
        totalSent++;
        stop.sms_message_text = content;
        stop.sms_sent_at = new Date().toISOString();
      } else {
        failedCustomers.push({
          customer_name: stop.customer_name ?? "unknown",
          phone: stop.customer_phone ?? "",
          error: result.error ?? "Send failed",
        });
      }

      if (i < stops.length - 1) {
        await new Promise((r) => setTimeout(r, 1000));
      }
    }

    if (totalSent > 0) {
      run.messages_sent = true;
      run.messages_sent_at = new Date().toISOString();
    }

    const deliveryStartedSyncs = await kapiooPromise;
    for (let i = 0; i < stops.length; i++) {
      stops[i].kapioo_delivery_started_sync = deliveryStartedSyncs[i];
      const sync = deliveryStartedSyncs[i];
      if (sync.status !== "skipped" || sync.reason !== "no-order-ids") {
        console.log(
          JSON.stringify({
            event: "delivery_started_kapioo_sync",
            runId: id,
            stopIndex: i,
            status: sync.status,
            reason: sync.reason,
            updated: sync.updated_order_ids?.length ?? 0,
            missing: sync.missing_order_ids?.length ?? 0,
          })
        );
      }
    }

    route.stops = sanitizeStops(stops);
    await run.save();

    return json({
      run: {
        ...run.toObject(),
        _id: run._id.toString(),
      },
      eta_sms_result: {
        total_sent: totalSent,
        total_failed: failedCustomers.length,
        failed_customers: failedCustomers,
      },
    });
  } catch (err) {
    return handleApiError(err);
  }
}
