import { it } from "node:test";
import assert from "node:assert/strict";
import { computeOptimizedRouteFromSequence } from "./computeRouteFromSequence";

it("requests Toronto morning traffic and returns Toronto labels on a UTC server", async (t) => {
  const previousZone = process.env.TZ;
  process.env.TZ = "UTC";
  const names = ["MONGODB_URI", "GOOGLE_MAPS_API_KEY", "GOOGLE_CLOUD_PROJECT_ID", "GOOGLE_SERVICE_ACCOUNT_JSON",
    "OPENPHONE_API_KEY", "OPENPHONE_FROM", "DRIVER_LINK_SECRET", "ADMIN_PASSWORD_HASH", "ADMIN_SESSION_SECRET"];
  const previous = new Map(names.map((name) => [name, process.env[name]]));
  names.forEach((name) => { process.env[name] = "fixture-only"; });
  t.after(() => {
    if (previousZone === undefined) delete process.env.TZ; else process.env.TZ = previousZone;
    for (const [name, value] of Array.from(previous)) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  });
  let requestedDeparture: string | null = null;
  t.mock.method(globalThis, "fetch", async (url: string | URL | Request) => {
    requestedDeparture = new URL(String(url)).searchParams.get("departure_time");
    return new Response(JSON.stringify({ status: "OK", routes: [{ legs: [{
      distance: { value: 3000 }, duration: { value: 300 }, duration_in_traffic: { value: 600 },
    }] }] }), { status: 200 });
  });
  const result = await computeOptimizedRouteFromSequence({
    customerIndicesInOrder: [0],
    customers: [{ name: "Fixture", phone: "", address: "Fixture building", lat: 43.75, lng: -79.4,
      geocode_status: "success", order_ids: ["fixture-order"], is_first_stop: false, is_end_point: false }],
    run: { run_date: "2030-07-01", start_time: "10:00", travel_mode: "driving" },
    startCoords: { lat: 43.7, lng: -79.35 }, hasEndPointCustomer: false,
  });
  assert.equal(requestedDeparture, String(Date.parse("2030-07-01T14:00:00Z") / 1000));
  assert.equal(result.stops[0].arrival_time, "2030-07-01T14:10:00.000Z");
  assert.equal(result.stops[0].eta, "10:10 AM");
  assert.equal(result.totalDurationMinutes, 15);
  assert.deepEqual(result.stops[0].order_ids, ["fixture-order"]);
});
