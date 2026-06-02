import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  buildRunsByDateMongoFilter,
  filterRunsWithRoute,
} from "@/lib/integration/fetchRunsByDate";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("buildRunsByDateMongoFilter", () => {
  it("filters by run_date exact match", () => {
    const filter = buildRunsByDateMongoFilter({
      date: "2026-05-31",
      includeDrafts: false,
      requireRoute: true,
    });
    assert.equal(filter.run_date, "2026-05-31");
  });

  it("excludes draft status by default", () => {
    const filter = buildRunsByDateMongoFilter({
      date: "2026-05-31",
      includeDrafts: false,
      requireRoute: true,
    });
    assert.deepEqual(filter.status, {
      $in: ["optimized", "in_progress", "completed"],
    });
  });

  it("includes draft when includeDrafts is true", () => {
    const filter = buildRunsByDateMongoFilter({
      date: "2026-05-31",
      includeDrafts: true,
      requireRoute: true,
    });
    assert.equal(filter.status, undefined);
  });
});

describe("filterRunsWithRoute", () => {
  it("excludes runs without stops when requireRoute is true", () => {
    const runs = [
      { optimized_route: { stops: [] } },
      { optimized_route: { stops: [{ id: 1 }] } },
      {},
    ];
    const filtered = filterRunsWithRoute(runs, true);
    assert.equal(filtered.length, 1);
  });

  it("includes empty-route runs when requireRoute is false", () => {
    const runs = [
      { optimized_route: { stops: [] } },
      { optimized_route: { stops: [{ id: 1 }] } },
    ];
    const filtered = filterRunsWithRoute(runs, false);
    assert.equal(filtered.length, 2);
  });
});

describe("fetchRunsByDate module imports", () => {
  it("does not import optimization create or geocode services", () => {
    const source = readFileSync(join(__dirname, "fetchRunsByDate.ts"), "utf8");
    assert.ok(!source.includes("delivery-run-service"));
    assert.ok(!source.includes("createAndOptimizeIntegrationRun"));
    assert.ok(!source.includes("geocodeAddressesBatch"));
    assert.ok(!source.includes("optimizeDeliveryRun"));
  });
});
