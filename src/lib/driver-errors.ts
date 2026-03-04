/**
 * User-friendly error messages for drivers.
 * Format: [REF] What happened. What to do: ...
 * Screenshot-friendly so admin can diagnose from driver report.
 */

function ref(): string {
  return `ERR-${Date.now().toString(36).slice(-6).toUpperCase()}`;
}

/** Server returned non-JSON (HTML error page, truncated response, etc.) */
export function invalidResponse(status: number): string {
  const r = ref();
  if (status >= 500) {
    return `[${r}] Server error (${status}). Response was corrupted—often due to poor signal. What to do: Try again when you have better connection.`;
  }
  return `[${r}] Invalid server response (${status}). What to do: Try again or refresh the page.`;
}

/** Network failed, timeout, or connection dropped */
export function networkError(original?: string): string {
  const r = ref();
  const hint = original?.includes("abort") ? "Request timed out." : "";
  return `[${r}] Connection failed. ${hint}What to do: Check your internet, try again. Photo is saved—will upload when back online.`;
}

/** API returned an error (we have the message) */
export function apiError(status: number, message?: string): string {
  const r = ref();
  const msg = message?.trim() || "Unknown error";
  if (status === 401 || status === 403) {
    return `[${r}] Session expired. What to do: Use the driver link from your message again.`;
  }
  if (status >= 500) {
    return `[${r}] Server error (${status}): ${msg}. What to do: Try again in a minute.`;
  }
  return `[${r}] ${msg} What to do: Try again.`;
}

/** Failed to load run initially */
export function loadError(status: number, message?: string): string {
  const r = ref();
  if (status === 401 || status === 404) {
    return `[${r}] Invalid or expired link. What to do: Use the driver link from your message again.`;
  }
  return `[${r}] Failed to load route (${status}). ${message || "What to do: Check connection and refresh."}`;
}

/** Failed to start delivery */
export function startError(status: number, message?: string): string {
  const r = ref();
  if (status === 401) {
    return `[${r}] Session expired. What to do: Use the driver link again.`;
  }
  return `[${r}] Could not start: ${message || "Try again."}`;
}

/** Unexpected error (e.g. from catch block) */
export function unexpectedError(message: string): string {
  const r = ref();
  return `[${r}] Unexpected error: ${message}. What to do: Try again or refresh the page.`;
}

/** Photo queued due to connection issue (informational) */
export function photoQueuedOffline(): string {
  const r = ref();
  return `Photo saved [${r}]. Will complete when you're back online—you can continue to next stop.`;
}
