import type { PendingImage } from "./completeQueue";

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

    const data = await res.json();

    if (res.ok && data.run) {
      return { ok: true, run: data.run };
    }

    const error = data.error ?? "Upload failed";
    const isRetryable = res.status >= 500;
    return { ok: false, error, isRetryable };
  } catch (err) {
    clearTimeout(timeoutId);
    const isRetryable =
      err instanceof TypeError ||
      (err instanceof Error && err.name === "AbortError");
    const error =
      err instanceof Error ? err.message : "Network error";
    return { ok: false, error, isRetryable };
  }
}
