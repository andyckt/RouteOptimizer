import { ApiError } from "@/lib/http/errors";

const buckets = new Map<string, number[]>();

export function assertRateLimit(input: {
  key: string;
  windowMs: number;
  maxRequests: number;
}): void {
  const now = Date.now();
  const from = now - input.windowMs;
  const existing = buckets.get(input.key) ?? [];
  const recent = existing.filter((t) => t >= from);
  if (recent.length >= input.maxRequests) {
    throw new ApiError(429, "Too many requests. Please try again shortly.", "RATE_LIMITED");
  }
  recent.push(now);
  buckets.set(input.key, recent);
}

