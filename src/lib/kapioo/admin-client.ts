/**
 * Kapioo Admin ingestion client (signed JSON POST).
 * Server-only. Used for POD and delivery-started integrations.
 *
 * The exact JSON body string used for HMAC signing MUST be the same string sent as the
 * fetch body. We build it once with `JSON.stringify(payload)` and reuse it for both.
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

export interface KapiooDeliveryStartedPayload {
  orderIds: string[];
  eta: string;
  startedAt: string;
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
  data?: unknown;
  updated?: string[];
  skipped?: string[];
  missing?: string[];
  errorMessage?: string;
  reasonHint?: KapiooPostReasonHint;
}

export const KAPIOO_POD_PATH = "/api/integrations/route-optimizer/proof-of-delivery";
export const KAPIOO_DELIVERY_STARTED_PATH =
  "/api/integrations/route-optimizer/delivery-started";
export const KAPIOO_ORDER_BOX_COUNTS_PATH =
  "/api/integrations/route-optimizer/order-box-counts";

const DEFAULT_TIMEOUT_MS = 5000;

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

function pickResponseData(parsed: unknown): unknown {
  if (!parsed || typeof parsed !== "object") return parsed;
  const rec = parsed as Record<string, unknown>;
  return "data" in rec ? rec.data : parsed;
}

function pickSuccessfulStringArray(parsed: unknown, field: "updated" | "skipped" | "missing") {
  const data = pickResponseData(parsed);
  if (data && typeof data === "object") {
    return pickStringArray((data as Record<string, unknown>)[field]);
  }
  return undefined;
}

function parseBoxCountsResponse(data: unknown): Record<string, number> | null {
  if (!data || typeof data !== "object") return null;
  const counts = (data as Record<string, unknown>).counts;
  if (!counts || typeof counts !== "object" || Array.isArray(counts)) return null;

  const out: Record<string, number> = {};
  for (const [orderId, count] of Object.entries(counts)) {
    if (typeof count === "number" && Number.isFinite(count)) {
      out[orderId] = count;
    }
  }
  return out;
}

/**
 * Signed POST to Kapioo Admin. Never throws; surfaces errors via `KapiooPostResult`.
 */
export async function postSignedKapiooJson(
  config: KapiooAdminConfig,
  path: string,
  payload: unknown,
  options?: { timeoutMs?: number; signal?: AbortSignal }
): Promise<KapiooPostResult> {
  const body = JSON.stringify(payload);
  const sig =
    "sha256=" +
    crypto.createHmac("sha256", config.ingestSecret).update(body, "utf8").digest("hex");

  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const internalCtrl = new AbortController();
  const timer = setTimeout(() => internalCtrl.abort(), timeoutMs);
  const onExternalAbort = () => internalCtrl.abort();
  options?.signal?.addEventListener("abort", onExternalAbort, { once: true });

  try {
    const res = await fetch(`${config.baseUrl}${path}`, {
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
      const data = pickResponseData(parsed);
      return {
        ok: true,
        status: res.status,
        data,
        updated: pickSuccessfulStringArray(parsed, "updated"),
        skipped: pickSuccessfulStringArray(parsed, "skipped"),
        missing: pickSuccessfulStringArray(parsed, "missing"),
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

export async function postPodToKapiooAdmin(
  config: KapiooAdminConfig,
  payload: KapiooPodPayload,
  options?: { timeoutMs?: number; signal?: AbortSignal }
): Promise<KapiooPostResult> {
  return postSignedKapiooJson(config, KAPIOO_POD_PATH, payload, options);
}

export async function postDeliveryStartedToKapiooAdmin(
  config: KapiooAdminConfig,
  payload: KapiooDeliveryStartedPayload,
  options?: { timeoutMs?: number; signal?: AbortSignal }
): Promise<KapiooPostResult> {
  return postSignedKapiooJson(config, KAPIOO_DELIVERY_STARTED_PATH, payload, options);
}

export async function fetchOrderBoxCounts(
  config: KapiooAdminConfig | null,
  orderIds: string[],
  options?: { timeoutMs?: number; signal?: AbortSignal }
): Promise<Record<string, number> | null> {
  if (!config || orderIds.length === 0) return null;

  const result = await postSignedKapiooJson(
    config,
    KAPIOO_ORDER_BOX_COUNTS_PATH,
    { orderIds },
    options
  );
  if (!result.ok) return null;

  return parseBoxCountsResponse(result.data);
}
