import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ApiError } from "@/lib/http/errors";
import {
  buildGeocodeQuery,
  geocodeAddressesBatch,
} from "@/lib/integration/geocodeAddressesBatch";

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

describe("buildGeocodeQuery", () => {
  it("appends area and country when not in address", () => {
    const q = buildGeocodeQuery({
      client_ref: "A",
      address: "25 Greenview Ave",
      area: "North York",
      country: "Canada",
    });
    assert.equal(q, "25 Greenview Ave, North York, Canada");
  });

  it("skips area/country already present in address", () => {
    const q = buildGeocodeQuery({
      client_ref: "A",
      address: "25 Greenview Ave, North York, Canada",
      area: "North York",
      country: "Canada",
    });
    assert.equal(q, "25 Greenview Ave, North York, Canada");
  });
});

describe("geocodeAddressesBatch", () => {
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

  it("geocodes all addresses successfully", async () => {
    global.fetch = async () =>
      ({
        json: async () => ({
          status: "OK",
          results: [
            {
              formatted_address: "Formatted A",
              geometry: {
                location_type: "ROOFTOP",
                location: { lat: 1, lng: 2 },
              },
            },
          ],
        }),
      }) as Response;

    const result = await geocodeAddressesBatch([
      { client_ref: "A", address: "Addr A" },
      { client_ref: "B", address: "Addr B" },
    ]);

    assert.equal(result.status, "completed");
    assert.equal(result.total_requested, 2);
    assert.equal(result.total_succeeded, 2);
    assert.equal(result.total_failed, 0);
    assert.equal(result.results[0].status, "success");
    assert.equal(result.results[0].lat, 1);
    assert.equal(result.results[0].input_address, "Addr A");
  });

  it("returns partial success when some addresses fail", async () => {
    let call = 0;
    global.fetch = async () => {
      call++;
      if (call === 1) {
        return {
          json: async () => ({
            status: "OK",
            results: [
              {
                formatted_address: "OK Addr",
                geometry: {
                  location_type: "ROOFTOP",
                  location: { lat: 10, lng: 20 },
                },
              },
            ],
          }),
        } as Response;
      }
      return {
        json: async () => ({ status: "ZERO_RESULTS", results: [] }),
      } as Response;
    };

    const result = await geocodeAddressesBatch([
      { client_ref: "OK", address: "Valid St" },
      { client_ref: "BAD", address: "Invalid St" },
    ]);

    assert.equal(result.total_succeeded, 1);
    assert.equal(result.total_failed, 1);
    assert.equal(result.results[0].status, "success");
    assert.equal(result.results[1].status, "failed");
    assert.equal(result.results[1].geocode_status, "ZERO_RESULTS");
    assert.equal(result.results[1].error, "Address could not be geocoded");
  });

  it("throws 429 when Google returns OVER_QUERY_LIMIT", async () => {
    global.fetch = async () =>
      ({
        json: async () => ({ status: "OVER_QUERY_LIMIT", results: [] }),
      }) as Response;

    await assert.rejects(
      () =>
        geocodeAddressesBatch([{ client_ref: "A", address: "1 Main St" }]),
      (err: unknown) =>
        err instanceof ApiError &&
        err.statusCode === 429 &&
        err.code === "RATE_LIMITED"
    );
  });

  it("does not import run persistence modules", () => {
    const src = readFileSync(
      join(process.cwd(), "src/lib/integration/geocodeAddressesBatch.ts"),
      "utf8"
    );
    assert.ok(!src.includes("mongoose"));
    assert.ok(!src.includes("createAndOptimizeIntegrationRun"));
    assert.ok(!src.includes("DeliveryRun"));
  });
});
