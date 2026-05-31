import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { assertRateLimit } from "@/lib/rate-limit";
import { ApiError } from "@/lib/http/errors";

describe("assertRateLimit", () => {
  it("throws RATE_LIMITED when max requests exceeded", () => {
    const key = `test-limit-${Date.now()}-${Math.random()}`;
    const opts = { key, windowMs: 60_000, maxRequests: 2 };
    assertRateLimit(opts);
    assertRateLimit(opts);
    assert.throws(
      () => assertRateLimit(opts),
      (err: unknown) =>
        err instanceof ApiError &&
        err.statusCode === 429 &&
        err.code === "RATE_LIMITED"
    );
  });
});
