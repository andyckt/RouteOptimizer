import type { PendingImage } from "./completeQueue";
import {
  invalidResponse,
  networkError,
  apiError,
  payloadTooLarge,
} from "@/lib/driver-errors";

const UPLOAD_TIMEOUT_MS = 90_000;

export interface CompleteWithProofResult {
  ok: boolean;
  run?: { _id: string; [k: string]: unknown };
  error?: string;
  isRetryable?: boolean;
}

export async function tryCompleteWithProof(
  runId: string,
  stopIndex: number,
  token: string,
  images: PendingImage[] | File[]
): Promise<CompleteWithProofResult> {
  const form = new FormData();
  form.append("token", token);
  form.append("stopIndex", String(stopIndex));

  const files: File[] = images.map((img) =>
    img instanceof File
      ? img
      : new File([img.blob], img.name, { type: img.type })
  );

  for (const file of files) {
    form.append("images", file, file.name);
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);

  try {
    const res = await fetch(
      `/api/delivery-runs/${runId}/complete-with-proof`,
      {
        method: "POST",
        body: form,
        signal: controller.signal,
      }
    );
    clearTimeout(timeoutId);

    const text = await res.text();

    if (res.status === 413) {
      return { ok: false, error: payloadTooLarge(), isRetryable: false };
    }

    let data: { run?: { _id: string; [k: string]: unknown }; error?: string };
    try {
      data = JSON.parse(text);
    } catch (parseErr) {
      const preview = text.slice(0, 300);
      console.error("[complete-with-proof] Client received non-JSON response:", {
        status: res.status,
        statusText: res.statusText,
        bodyPreview: preview,
        parseError: parseErr instanceof Error ? parseErr.message : String(parseErr),
      });
      const isRetryable = res.status >= 500;
      return {
        ok: false,
        error: invalidResponse(res.status),
        isRetryable,
      };
    }

    if (res.ok && data.run) {
      return { ok: true, run: data.run };
    }

    const isRetryable = res.status >= 500;
    return {
      ok: false,
      error:
        res.status === 413 ? payloadTooLarge() : apiError(res.status, data.error),
      isRetryable,
    };
  } catch (err) {
    clearTimeout(timeoutId);
    const msg = err instanceof Error ? err.message : String(err);
    const isAbort = err instanceof Error && err.name === "AbortError";
    console.error("[complete-with-proof] Client request failed:", {
      message: msg,
      name: err instanceof Error ? err.name : undefined,
      stack: err instanceof Error ? err.stack : undefined,
    });
    const isRetryable = err instanceof TypeError || isAbort;
    return {
      ok: false,
      error: networkError(isAbort ? "Request timed out" : msg),
      isRetryable,
    };
  }
}
