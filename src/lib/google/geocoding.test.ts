import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { geocodeAddressDetailed } from "@/lib/google/geocoding";

const ENV_KEYS = [
  "MONGODB_URI",
  "GOOGLE_MAPS_API_KEY",
  "GOOGLE_CLOUD_PROJECT_ID",
  "GOOGLE_SERVICE_ACCOUNT_JSON",
  "OPENPHONE_API_KEY",
  "OPENPHONE_FROM",
  "DRIVER_LINK_SECRET",
  "ADMIN_PASSWORD_HASH",
  "ADMIN_SESSION_SECRET",
] as const;

function stubEnv(): Record<string, string | undefined> {
  const saved: Record<string, string | undefined> = {};
  for (const key of ENV_KEYS) {
    saved[key] = process.env[key];
    process.env[key] = key === "GOOGLE_MAPS_API_KEY" ? "test-geocode-key" : "test-value";
  }
  return saved;
}

function restoreEnv(saved: Record<string, string | undefined>): void {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
}

describe("geocodeAddressDetailed", () => {
  let savedEnv: Record<string, string | undefined>;
  let originalFetch: typeof fetch;

  beforeEach(() => {
    savedEnv = stubEnv();
    originalFetch = global.fetch;
  });

  afterEach(() => {
    restoreEnv(savedEnv);
    global.fetch = originalFetch;
  });

  it("returns success with location_type and confidence for OK", async () => {
    global.fetch = async () =>
      ({
        json: async () => ({
          status: "OK",
          results: [
            {
              formatted_address: "25 Greenview Ave, North York, ON, Canada",
              partial_match: false,
              geometry: {
                location_type: "ROOFTOP",
                location: { lat: 43.8123, lng: -79.4012 },
              },
            },
          ],
        }),
      }) as Response;

    const result = await geocodeAddressDetailed("25 Greenview Ave, North York");
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.geocode_status, "OK");
    assert.equal(result.confidence, "high");
    assert.equal(result.location_type, "ROOFTOP");
    assert.equal(result.lat, 43.8123);
  });

  it("returns failure for ZERO_RESULTS", async () => {
    global.fetch = async () =>
      ({
        json: async () => ({ status: "ZERO_RESULTS", results: [] }),
      }) as Response;

    const result = await geocodeAddressDetailed("not a real place xyz");
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.geocode_status, "ZERO_RESULTS");
    assert.equal(result.error, "Address could not be geocoded");
    assert.equal(result.rate_limited, false);
  });

  it("flags rate_limited for OVER_QUERY_LIMIT", async () => {
    global.fetch = async () =>
      ({
        json: async () => ({ status: "OVER_QUERY_LIMIT", results: [] }),
      }) as Response;

    const result = await geocodeAddressDetailed("123 Main St");
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.rate_limited, true);
    assert.equal(result.geocode_status, "OVER_QUERY_LIMIT");
  });

  it("rejects empty address without calling fetch", async () => {
    let called = false;
    global.fetch = async () => {
      called = true;
      return { json: async () => ({}) } as Response;
    };

    const result = await geocodeAddressDetailed("   ");
    assert.equal(result.ok, false);
    assert.equal(called, false);
  });
});
