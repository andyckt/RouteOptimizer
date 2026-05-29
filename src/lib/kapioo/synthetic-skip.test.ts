import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { runKapiooSync } from "@/lib/kapioo/sync";
import { runKapiooDeliveryStartedSync } from "@/lib/kapioo/delivery-started-sync";

const syntheticStop = {
  is_synthetic: true,
  stop_type: "handoff" as const,
  order_ids: ["ORD-SHOULD-NOT-SYNC"],
  proof_of_delivery_images: ["https://example.com/pod.jpg"],
  completed_at: new Date().toISOString(),
  arrival_time: "10:30",
};

describe("Kapioo sync skips synthetic stops", () => {
  it("runKapiooSync returns synthetic-stop skipped without network", async () => {
    const state = await runKapiooSync({
      runId: "run-1",
      stopIndex: 0,
      stop: syntheticStop,
      driverName: "Driver",
    });
    assert.equal(state.status, "skipped");
    assert.equal(state.reason, "synthetic-stop");
    assert.ok(state.attempted_at);
  });

  it("runKapiooDeliveryStartedSync returns synthetic-stop skipped without network", async () => {
    const state = await runKapiooDeliveryStartedSync({
      runId: "run-1",
      stopIndex: 0,
      stop: syntheticStop,
      startedAt: new Date().toISOString(),
      driverName: "Driver",
    });
    assert.equal(state.status, "skipped");
    assert.equal(state.reason, "synthetic-stop");
    assert.ok(state.attempted_at);
  });
});
