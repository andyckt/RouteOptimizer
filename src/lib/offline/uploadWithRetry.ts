import type { PendingImage } from "./completeQueue";
import {
  invalidResponse,
  networkError,
  apiError,
  payloadTooLarge,
} from "@/lib/driver-errors";

const UPLOAD_TIMEOUT_MS = 90_000;
const DIRECT_UPLOAD_TIMEOUT_MS = 120_000;

export interface CompleteWithProofResult {
  ok: boolean;
  run?: { _id: string; [k: string]: unknown };
  error?: string;
  isRetryable?: boolean;
}

function toFiles(images: PendingImage[] | File[]): File[] {
  return images.map((img) =>
    img instanceof File ? img : new File([img.blob], img.name, { type: img.type })
  );
}

/** Upload file to presigned URL, then call complete-with-proof with imageUrls. */
async function completeViaDirectUpload(
  runId: string,
  stopIndex: number,
  token: string,
  files: File[],
  signal?: AbortSignal
): Promise<CompleteWithProofResult> {
  const urlRes = await fetch(`/api/delivery-runs/${runId}/proof-upload-url`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      token,
      stopIndex,
      files: files.map((f) => ({ name: f.name, type: f.type })),
    }),
    signal,
  });

  const urlData = await urlRes.json().catch(() => ({}));
  if (urlRes.status === 404 && urlData.useFormDataFallback) {
    return completeViaFormData(runId, stopIndex, token, files, signal);
  }
  if (!urlRes.ok) {
    return {
      ok: false,
      error: apiError(urlRes.status, urlData.error ?? urlData.message),
      isRetryable: urlRes.status >= 500,
    };
  }

  const uploads = urlData.uploads as Array<{ uploadUrl: string; publicUrl: string; contentType: string }>;
  if (!Array.isArray(uploads) || uploads.length !== files.length) {
    return { ok: false, error: apiError(502, "Invalid presigned URL response"), isRetryable: true };
  }

  for (let i = 0; i < files.length; i++) {
    const putRes = await fetch(uploads[i].uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": uploads[i].contentType },
      body: files[i],
      signal,
    });
    if (!putRes.ok) {
      return {
        ok: false,
        error: apiError(putRes.status, `Upload failed (${putRes.status})`),
        isRetryable: putRes.status >= 500,
      };
    }
  }

  const publicUrls = uploads.map((u) => u.publicUrl);
  const completeRes = await fetch(`/api/delivery-runs/${runId}/complete-with-proof`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, stopIndex, imageUrls: publicUrls }),
    signal,
  });

  const text = await completeRes.text();
  let data: { run?: { _id: string; [k: string]: unknown }; error?: string };
  try {
    data = JSON.parse(text);
  } catch {
    return {
      ok: false,
      error: invalidResponse(completeRes.status),
      isRetryable: completeRes.status >= 500,
    };
  }

  if (completeRes.ok && data.run) {
    return { ok: true, run: data.run };
  }
  return {
    ok: false,
    error: apiError(completeRes.status, data.error),
    isRetryable: completeRes.status >= 500,
  };
}

/** Fallback: send files through API (hits Vercel 4.5MB limit). */
async function completeViaFormData(
  runId: string,
  stopIndex: number,
  token: string,
  files: File[],
  signal?: AbortSignal
): Promise<CompleteWithProofResult> {
  const form = new FormData();
  form.append("token", token);
  form.append("stopIndex", String(stopIndex));
  for (const file of files) {
    form.append("images", file, file.name);
  }

  const controller = !signal ? new AbortController() : null;
  const effectiveSignal = signal ?? controller!.signal;
  const timeoutId = controller
    ? setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS)
    : null;

  try {
    const res = await fetch(`/api/delivery-runs/${runId}/complete-with-proof`, {
      method: "POST",
      body: form,
      signal: effectiveSignal,
    });
    if (timeoutId != null) clearTimeout(timeoutId);
    const text = await res.text();

    if (res.status === 413) {
      return { ok: false, error: payloadTooLarge(), isRetryable: false };
    }

    let data: { run?: { _id: string; [k: string]: unknown }; error?: string };
    try {
      data = JSON.parse(text);
    } catch (parseErr) {
      console.error("[complete-with-proof] Client received non-JSON response:", {
        status: res.status,
        bodyPreview: text.slice(0, 300),
      });
      return {
        ok: false,
        error: invalidResponse(res.status),
        isRetryable: res.status >= 500,
      };
    }

    if (res.ok && data.run) return { ok: true, run: data.run };
    return {
      ok: false,
      error: res.status === 413 ? payloadTooLarge() : apiError(res.status, data.error),
      isRetryable: res.status >= 500,
    };
  } catch (err) {
    if (timeoutId != null) clearTimeout(timeoutId);
    const isAbort = err instanceof Error && err.name === "AbortError";
    return {
      ok: false,
      error: networkError(isAbort ? "Request timed out" : err instanceof Error ? err.message : "Network error"),
      isRetryable: err instanceof TypeError || isAbort,
    };
  }
}

/**
 * Complete stop with proof. Tries direct upload to R2 first (bypasses 4.5MB limit),
 * falls back to FormData when R2 is not configured.
 */
export async function tryCompleteWithProof(
  runId: string,
  stopIndex: number,
  token: string,
  images: PendingImage[] | File[]
): Promise<CompleteWithProofResult> {
  const files = toFiles(images);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), DIRECT_UPLOAD_TIMEOUT_MS);

  try {
    const result = await completeViaDirectUpload(runId, stopIndex, token, files, controller.signal);
    clearTimeout(timeoutId);
    return result;
  } catch (err) {
    clearTimeout(timeoutId);
    if (err instanceof Error && err.name === "AbortError") {
      return {
        ok: false,
        error: networkError("Request timed out"),
        isRetryable: true,
      };
    }
    return {
      ok: false,
      error: networkError(err instanceof Error ? err.message : "Upload failed"),
      isRetryable: true,
    };
  }
}
