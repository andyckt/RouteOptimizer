/**
 * Kapioo sync orchestrator — runs the gating logic and classifies the result into a
 * `KapiooSyncState`. Single source of truth for both the inline sync inside
 * complete-with-proof and the admin retry endpoint.
 *
 * Reads `stop.order_ids` only. Never reads `customer.order_ids`. The seed lives on the
 * customer purely as a create-time helper; by the time we reach this code, the value
 * was already copied to `stop.order_ids` at optimization.
 */

import type { KapiooSyncState, OptimizedStop } from "@/types/delivery-run";
import { getR2ConfigFromEnv } from "@/lib/r2/client";
import { normalizeOrderIds } from "@/lib/normalization/delivery-run";
import { classifyKapiooPostResult } from "./classify-sync-result";
import {
  getKapiooAdminConfigFromEnv,
  postPodToKapiooAdmin,
  type KapiooPodPayload,
} from "./admin-client";

export interface KapiooSyncInputs {
  runId: string;
  stopIndex: number;
  stop: Pick<OptimizedStop, "order_ids" | "proof_of_delivery_images" | "completed_at">;
  driverName?: string;
  /**
   * Prior `kapioo_sync.attempts` count (if any). The new value is incremented by 1.
   * Pass undefined for the initial completion path.
   */
  priorAttempts?: number;
  /** Optional caller-supplied AbortSignal forwarded to the admin call. */
  signal?: AbortSignal;
  /** Optional timeout override (ms). Defaults to 5000. */
  timeoutMs?: number;
}

/**
 * Decide and (if needed) execute the Kapioo Admin sync. Returns the new `KapiooSyncState`
 * to persist on the stop. Never throws; all failure modes fold into `failed` statuses.
 */
export async function runKapiooSync(inputs: KapiooSyncInputs): Promise<KapiooSyncState> {
  const { runId, stopIndex, stop, driverName, priorAttempts, signal, timeoutMs } = inputs;
  const attemptedAt = new Date().toISOString();
  const nextAttempts = (priorAttempts ?? 0) + 1;

  // 1. SSOT: stop.order_ids. No fallback.
  const orderIds = normalizeOrderIds(stop.order_ids) ?? [];
  if (orderIds.length === 0) {
    return {
      status: "skipped",
      reason: "no-order-ids",
      attempted_at: attemptedAt,
    };
  }

  // 2. Config check first to avoid pointlessly inspecting POD URL.
  const config = getKapiooAdminConfigFromEnv();
  if (!config) {
    return {
      status: "failed",
      reason: "missing-env",
      attempted_at: attemptedAt,
      attempts: nextAttempts,
      error_message: "KAPIOO_* env vars are not configured",
    };
  }

  // 3. POD URL: must be a real R2 public URL. Otherwise we should not send to admin.
  const firstUrl = stop.proof_of_delivery_images?.[0];
  if (!firstUrl) {
    // No POD yet — should never happen at retry time (validated upstream), but be safe.
    return {
      status: "failed",
      reason: "pod-not-r2-url",
      attempted_at: attemptedAt,
      attempts: nextAttempts,
      error_message: "No proof-of-delivery image to send",
    };
  }
  const r2 = getR2ConfigFromEnv();
  const r2Base = r2?.publicUrl ? r2.publicUrl.replace(/\/$/, "") : "";
  const isR2Url = Boolean(r2Base) && firstUrl.startsWith(r2Base + "/");
  if (!isR2Url) {
    if (process.env.NODE_ENV === "production") {
      return {
        status: "failed",
        reason: "pod-not-r2-url",
        attempted_at: attemptedAt,
        attempts: nextAttempts,
        error_message: "Proof image is not a Cloudflare R2 URL",
      };
    }
    // Local dev: keep the developer flow painless.
    return {
      status: "skipped",
      reason: "non-r2-dev-url",
      attempted_at: attemptedAt,
    };
  }

  // 4. Derive the R2 object key from the public URL — single source of truth, no schema field.
  //    Spec sends a singular `podImage`; we deliberately send only the first image.
  //    The full `proof_of_delivery_images` array is preserved untouched in our DB.
  const key = firstUrl.slice(r2Base.length + 1);

  const payload: KapiooPodPayload = {
    orderIds,
    podImage: { url: firstUrl, key },
    capturedAt: stop.completed_at ?? attemptedAt,
    stopId: `${runId}:${stopIndex}`,
    ...(driverName ? { driverId: driverName } : {}),
  };

  const result = await postPodToKapiooAdmin(config, payload, { signal, timeoutMs });

  return classifyKapiooPostResult(orderIds, result, {
    attemptedAt,
    attempts: nextAttempts,
  });
}
