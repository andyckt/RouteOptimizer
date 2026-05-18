/**
 * Kapioo Admin POD ingestion client.
 *
 * Posts delivery completion (orderIds + already-uploaded R2 image URL/key) to the Admin
 * system for downstream order-status update. Server-only.
 *
 * Correctness contracts:
 * - The exact JSON body string used for HMAC signing MUST be the same string sent as the
 *   fetch body. We build it once with `JSON.stringify(payload)` and reuse it for both.
 * - The Admin endpoint is idempotent: it returns `{ updated, skipped, missing }` arrays,
 *   so retries converge. HTTP 200 alone does NOT imply full success; the caller MUST
 *   classify by inspecting those arrays.
 * - All network errors and non-2xx responses are surfaced through the unified result
 *   shape — this function never throws.
 */

import crypto from "node:crypto";

export interface KapiooAdminConfig {
  baseUrl: string;
  ingestToken: string;
  ingestSecret: string;
}

export interface KapiooPodPayload {
  orderIds: string[];
  podImage: { url: string; key: string };
  capturedAt: string;
  stopId: string;
  driverId?: string;
  note?: string;
}

export type KapiooPostReasonHint =
  | "admin-api-timeout"
  | "admin-api-401"
  | "admin-api-400"
  | "admin-api-5xx";

export interface KapiooPostResult {
  ok: boolean;
  status: number;
  updated?: string[];
  skipped?: string[];
  missing?: string[];
  errorMessage?: string;
  reasonHint?: KapiooPostReasonHint;
}

const POD_PATH = "/api/integrations/route-optimizer/proof-of-delivery";
const DEFAULT_TIMEOUT_MS = 5000;

/**
 * Read Kapioo Admin config from environment. Returns null when any of the three vars
 * is missing — callers MUST treat that as a `failed` sync with reason `missing-env`,
 * never crash. Mirrors the optional R2 pattern.
 */
export function getKapiooAdminConfigFromEnv(): KapiooAdminConfig | null {
  const baseUrl = process.env.KAPIOO_ADMIN_BASE_URL;
  const ingestToken = process.env.ROUTE_OPTIMIZER_INGEST_TOKEN;
  const ingestSecret = process.env.ROUTE_OPTIMIZER_INGEST_SECRET;
  if (!baseUrl || !ingestToken || !ingestSecret) return null;
  return {
    baseUrl: baseUrl.replace(/\/$/, ""),
    ingestToken,
    ingestSecret,
  };
}

function pickStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((x): x is string => typeof x === "string");
}

function pickErrorMessage(parsed: unknown, fallback: string): string {
  if (parsed && typeof parsed === "object") {
    const rec = parsed as Record<string, unknown>;
    if (typeof rec.error === "string" && rec.error.trim()) return rec.error;
    if (typeof rec.message === "string" && rec.message.trim()) return rec.message;
  }
  return fallback;
}

/**
 * POST the proof-of-delivery to Kapioo Admin. Bounded by `timeoutMs` via AbortController
 * so the driver request never blocks longer than that. The body is stringified exactly
 * once and shared between the HMAC and the fetch.
 */
export async function postPodToKapiooAdmin(
  config: KapiooAdminConfig,
  payload: KapiooPodPayload,
  options?: { timeoutMs?: number; signal?: AbortSignal }
): Promise<KapiooPostResult> {
  const body = JSON.stringify(payload);
  const sig =
    "sha256=" +
    crypto
      .createHmac("sha256", config.ingestSecret)
      .update(body, "utf8")
      .digest("hex");

  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const internalCtrl = new AbortController();
  const timer = setTimeout(() => internalCtrl.abort(), timeoutMs);
  // Forward external abort into our controller so a parent cancellation also wins.
  const onExternalAbort = () => internalCtrl.abort();
  options?.signal?.addEventListener("abort", onExternalAbort, { once: true });

  try {
    const res = await fetch(`${config.baseUrl}${POD_PATH}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.ingestToken}`,
        "X-RO-Signature": sig,
        "Content-Type": "application/json",
      },
      body,
      signal: internalCtrl.signal,
    });

    const text = await res.text().catch(() => "");
    let parsed: unknown = null;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = null;
      }
    }

    if (res.ok) {
      return {
        ok: true,
        status: res.status,
        updated:
          parsed && typeof parsed === "object"
            ? pickStringArray((parsed as Record<string, unknown>).updated)
            : undefined,
        skipped:
          parsed && typeof parsed === "object"
            ? pickStringArray((parsed as Record<string, unknown>).skipped)
            : undefined,
        missing:
          parsed && typeof parsed === "object"
            ? pickStringArray((parsed as Record<string, unknown>).missing)
            : undefined,
      };
    }

    let reasonHint: KapiooPostReasonHint;
    if (res.status === 401 || res.status === 403) reasonHint = "admin-api-401";
    else if (res.status >= 500) reasonHint = "admin-api-5xx";
    else reasonHint = "admin-api-400";

    return {
      ok: false,
      status: res.status,
      errorMessage: pickErrorMessage(parsed, `HTTP ${res.status}`),
      reasonHint,
    };
  } catch (err) {
    const aborted =
      err instanceof Error &&
      (err.name === "AbortError" || /aborted|timeout/i.test(err.message));
    return {
      ok: false,
      status: 0,
      errorMessage:
        err instanceof Error ? err.message : "Network error contacting Kapioo Admin",
      reasonHint: aborted ? "admin-api-timeout" : undefined,
    };
  } finally {
    clearTimeout(timer);
    options?.signal?.removeEventListener("abort", onExternalAbort);
  }
}
