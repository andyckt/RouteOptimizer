/**
 * Kapioo Admin delivery-started sync — runs when the driver starts delivery.
 * Reads `stop.order_ids` and `stop.arrival_time` only. Never throws.
 */

import type { KapiooSyncState, OptimizedStop } from "@/types/delivery-run";
import { normalizeOrderIds } from "@/lib/normalization/delivery-run";
import { classifyKapiooPostResult } from "./classify-sync-result";
import {
  getKapiooAdminConfigFromEnv,
  postDeliveryStartedToKapiooAdmin,
  type KapiooDeliveryStartedPayload,
} from "./admin-client";

const DEFAULT_TIMEOUT_MS = 5000;

export interface KapiooDeliveryStartedSyncInputs {
  runId: string;
  stopIndex: number;
  stop: Pick<OptimizedStop, "order_ids" | "arrival_time">;
  startedAt: string;
  driverName?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface KapiooDeliveryStartedBatchInputs {
  runId: string;
  stops: Array<Pick<OptimizedStop, "order_ids" | "arrival_time">>;
  startedAt: string;
  driverName?: string;
  timeoutMs?: number;
}

function parseArrivalIso(arrivalTime: string | undefined): string | null {
  if (!arrivalTime) return null;
  const arrival = new Date(arrivalTime);
  if (isNaN(arrival.getTime())) return null;
  return arrival.toISOString();
}

/**
 * Sync one stop to Kapioo Admin delivery-started. Returns state to persist on
 * `stop.kapioo_delivery_started_sync`.
 */
export async function runKapiooDeliveryStartedSync(
  inputs: KapiooDeliveryStartedSyncInputs
): Promise<KapiooSyncState> {
  const { runId, stopIndex, stop, startedAt, driverName, signal } = inputs;
  const timeoutMs = inputs.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const attemptedAt = new Date().toISOString();
  const attempts = 1;

  const orderIds = normalizeOrderIds(stop.order_ids) ?? [];
  if (orderIds.length === 0) {
    return {
      status: "skipped",
      reason: "no-order-ids",
      attempted_at: attemptedAt,
    };
  }

  const eta = parseArrivalIso(stop.arrival_time);
  if (!eta) {
    return {
      status: "failed",
      reason: "missing-arrival-time",
      attempted_at: attemptedAt,
      attempts,
      error_message: "Stop has no valid arrival_time for Kapioo ETA",
    };
  }

  const config = getKapiooAdminConfigFromEnv();
  if (!config) {
    return {
      status: "failed",
      reason: "missing-env",
      attempted_at: attemptedAt,
      attempts,
      error_message: "KAPIOO_* env vars are not configured",
    };
  }

  const payload: KapiooDeliveryStartedPayload = {
    orderIds,
    eta,
    startedAt,
    stopId: `${runId}:${stopIndex}`,
    ...(driverName ? { driverId: driverName } : {}),
  };

  const result = await postDeliveryStartedToKapiooAdmin(config, payload, {
    signal,
    timeoutMs,
  });

  return classifyKapiooPostResult(orderIds, result, { attemptedAt, attempts });
}

/** Parallel sync for all stops; wall-clock ~one timeout window, not N sequential. */
export async function runKapiooDeliveryStartedBatch(
  inputs: KapiooDeliveryStartedBatchInputs
): Promise<KapiooSyncState[]> {
  const { runId, stops, startedAt, driverName, timeoutMs } = inputs;
  return Promise.all(
    stops.map((stop, stopIndex) =>
      runKapiooDeliveryStartedSync({
        runId,
        stopIndex,
        stop,
        startedAt,
        driverName,
        timeoutMs,
      })
    )
  );
}
