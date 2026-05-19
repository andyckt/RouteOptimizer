/**
 * Classify Kapioo Admin ingestion HTTP results into `KapiooSyncState`.
 * Shared by POD completion sync and delivery-started sync.
 */

import type { KapiooSyncState, KapiooSyncReason } from "@/types/delivery-run";
import type { KapiooPostResult } from "./admin-client";

export function classifyKapiooPostResult(
  orderIds: string[],
  result: KapiooPostResult,
  meta: { attemptedAt: string; attempts?: number }
): KapiooSyncState {
  const { attemptedAt, attempts } = meta;

  if (!result.ok) {
    const reason = (result.reasonHint ?? "admin-api-5xx") as KapiooSyncReason;
    return {
      status: "failed",
      reason,
      attempted_at: attemptedAt,
      ...(attempts !== undefined ? { attempts } : {}),
      error_message: result.errorMessage ?? `HTTP ${result.status}`,
    };
  }

  const expected = new Set(orderIds);
  const updated = result.updated ?? [];
  const skipped = result.skipped ?? [];
  const missing = result.missing ?? [];
  const allUpdated =
    updated.length === expected.size && updated.every((id) => expected.has(id));
  const fullSuccess = allUpdated && missing.length === 0 && skipped.length === 0;

  return {
    status: fullSuccess ? "success" : "partial",
    ...(fullSuccess ? {} : { reason: "partial-success" as const }),
    attempted_at: attemptedAt,
    ...(attempts !== undefined ? { attempts } : {}),
    ...(updated.length > 0 ? { updated_order_ids: updated } : {}),
    ...(skipped.length > 0 ? { skipped_order_ids: skipped } : {}),
    ...(missing.length > 0 ? { missing_order_ids: missing } : {}),
  };
}
