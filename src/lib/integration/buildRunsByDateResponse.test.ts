import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildRunsByDateResponse,
  deriveRunCompletedAt,
  deriveEtaBasis,
  buildPlannedOnlyWarning,
} from "@/lib/integration/buildRunsByDateResponse";
import type { LeanRunForByDate } from "@/lib/integration/buildRunsByDateResponse";

const parsed = { date: "2026-05-31", includeDrafts: false, requireRoute: true };

function leanRun(overrides: Partial<LeanRunForByDate> & { _id?: { toString(): string } }): LeanRunForByDate {
  return {
    _id: { toString: () => "507f1f77bcf86cd799439011" },
    run_date: "2026-05-31",
    driver_name: "DT",
    status: "completed",
    start_location: "123 Kitchen St",
    start_time: "10:00",
    customers: [],
    optimized_route: { stops: [] },
    ...overrides,
  };
}

describe("deriveRunCompletedAt", () => {
  it("uses max completed_at across stops", () => {
    const result = deriveRunCompletedAt([
      { completed_at: "2026-05-31T16:00:00.000Z" },
      { completed_at: "2026-05-31T18:00:00.000Z" },
      { completed_at: "2026-05-31T17:00:00.000Z" },
    ]);
    assert.equal(result, "2026-05-31T18:00:00.000Z");
  });

  it("returns null when no completed_at exists", () => {
    assert.equal(deriveRunCompletedAt([{}, { completed_at: undefined }]), null);
  });
});

describe("deriveEtaBasis", () => {
  it("is post_start when actual_start_time exists", () => {
    assert.equal(
      deriveEtaBasis("2026-05-31T14:00:00.000Z", [{ eta: "2 PM" }]),
      "post_start"
    );
  });

  it("is planned when actual_start_time missing but eta/arrival_time exists", () => {
    assert.equal(deriveEtaBasis(null, [{ arrival_time: "2026-05-31T15:00:00.000Z" }]), "planned");
  });
});

describe("buildRunsByDateResponse", () => {
  it("returns status success with empty runs", () => {
    const res = buildRunsByDateResponse(parsed, []);
    assert.equal(res.status, "success");
    assert.equal(res.count, 0);
    assert.deepEqual(res.runs, []);
    assert.equal(res.metadata.draft_runs_excluded, true);
  });

  it("derives run_completed_at from stops", () => {
    const res = buildRunsByDateResponse(parsed, [
      leanRun({
        optimized_route: {
          stops: [
            {
              customer_index: 0,
              customer_name: "A",
              customer_phone: "",
              customer_address: "1 St",
              is_first_stop: false,
              is_end_point: false,
              completed_at: "2026-05-31T17:00:00.000Z",
            },
            {
              customer_index: 1,
              customer_name: "B",
              customer_phone: "",
              customer_address: "2 St",
              is_first_stop: false,
              is_end_point: false,
              completed_at: "2026-05-31T19:00:00.000Z",
            },
          ],
        },
      }),
    ]);
    assert.equal(res.runs[0].run_completed_at, "2026-05-31T19:00:00.000Z");
  });

  it("sets run_completed_at null when no completed_at", () => {
    const res = buildRunsByDateResponse(parsed, [
      leanRun({
        optimized_route: {
          stops: [
            {
              customer_index: 0,
              customer_name: "A",
              customer_phone: "",
              customer_address: "1 St",
              is_first_stop: false,
              is_end_point: false,
            },
          ],
        },
      }),
    ]);
    assert.equal(res.runs[0].run_completed_at, null);
  });

  it("sets eta_basis post_start when actual_start_time exists", () => {
    const res = buildRunsByDateResponse(parsed, [
      leanRun({
        actual_start_time: "2026-05-31T14:00:00.000Z",
        optimized_route: {
          stops: [
            {
              customer_index: 0,
              customer_name: "A",
              customer_phone: "",
              customer_address: "1 St",
              is_first_stop: false,
              is_end_point: false,
              arrival_time: "2026-05-31T15:00:00.000Z",
            },
          ],
        },
      }),
    ]);
    assert.equal(res.runs[0].eta_basis, "post_start");
    assert.equal(res.runs[0].stops[0].eta_basis, "post_start");
  });

  it("sets eta_basis planned and adds warning when never started", () => {
    const res = buildRunsByDateResponse(parsed, [
      leanRun({
        optimized_route: {
          stops: [
            {
              customer_index: 0,
              customer_name: "A",
              customer_phone: "",
              customer_address: "1 St",
              is_first_stop: false,
              is_end_point: false,
              arrival_time: "2026-05-31T15:00:00.000Z",
            },
          ],
        },
      }),
    ]);
    assert.equal(res.runs[0].eta_basis, "planned");
    const expected = buildPlannedOnlyWarning("507f1f77bcf86cd799439011");
    assert.ok(res.warnings.includes(expected));
    assert.ok(res.metadata.warnings.includes(expected));
  });

  it("joins lat/lng from customers by customer_index", () => {
    const res = buildRunsByDateResponse(parsed, [
      leanRun({
        customers: [
          {
            name: "A",
            phone: "4165550001",
            address: "1 St",
            is_first_stop: false,
            is_end_point: false,
            lat: 43.65,
            lng: -79.38,
            geocode_status: "success",
          },
        ],
        optimized_route: {
          stops: [
            {
              customer_index: 0,
              customer_name: "A",
              customer_phone: "4165550001",
              customer_address: "1 St",
              is_first_stop: false,
              is_end_point: false,
            },
          ],
        },
      }),
    ]);
    assert.equal(res.runs[0].stops[0].lat, 43.65);
    assert.equal(res.runs[0].stops[0].lng, -79.38);
  });

  it("joins fixed_stop_position from customer", () => {
    const res = buildRunsByDateResponse(parsed, [
      leanRun({
        customers: [
          {
            name: "A",
            phone: "",
            address: "1 St",
            is_first_stop: false,
            is_end_point: false,
            fixed_stop_position: 2,
            geocode_status: "success",
          },
        ],
        optimized_route: {
          stops: [
            {
              customer_index: 0,
              customer_name: "A",
              customer_phone: "",
              customer_address: "1 St",
              is_first_stop: false,
              is_end_point: false,
            },
          ],
        },
      }),
    ]);
    assert.equal(res.runs[0].stops[0].fixed_stop_position, 2);
  });

  it("prefers stop order_ids over customer order_ids", () => {
    const res = buildRunsByDateResponse(parsed, [
      leanRun({
        customers: [
          {
            name: "A",
            phone: "",
            address: "1 St",
            is_first_stop: false,
            is_end_point: false,
            order_ids: ["FROM-CUSTOMER"],
            geocode_status: "success",
          },
        ],
        optimized_route: {
          stops: [
            {
              customer_index: 0,
              customer_name: "A",
              customer_phone: "",
              customer_address: "1 St",
              is_first_stop: false,
              is_end_point: false,
              order_ids: ["FROM-STOP"],
            },
          ],
        },
      }),
    ]);
    assert.deepEqual(res.runs[0].stops[0].order_ids, ["FROM-STOP"]);
  });

  it("falls back to customer order_ids when stop has none", () => {
    const res = buildRunsByDateResponse(parsed, [
      leanRun({
        customers: [
          {
            name: "A",
            phone: "",
            address: "1 St",
            is_first_stop: false,
            is_end_point: false,
            order_ids: ["LEGACY-CUSTOMER"],
            geocode_status: "success",
          },
        ],
        optimized_route: {
          stops: [
            {
              customer_index: 0,
              customer_name: "A",
              customer_phone: "",
              customer_address: "1 St",
              is_first_stop: false,
              is_end_point: false,
            },
          ],
        },
      }),
    ]);
    assert.deepEqual(res.runs[0].stops[0].order_ids, ["LEGACY-CUSTOMER"]);
  });

  it("exposes synthetic handoff stop distinctly", () => {
    const res = buildRunsByDateResponse(parsed, [
      leanRun({
        customers: [
          {
            name: "Meet up",
            phone: "",
            address: "100 King St",
            is_first_stop: false,
            is_end_point: false,
            is_synthetic: true,
            stop_type: "handoff",
            geocode_status: "success",
          },
        ],
        optimized_route: {
          stops: [
            {
              customer_index: 0,
              customer_name: "Meet up",
              customer_phone: "",
              customer_address: "100 King St",
              is_first_stop: false,
              is_end_point: false,
              is_synthetic: true,
              stop_type: "handoff",
            },
          ],
        },
      }),
    ]);
    assert.equal(res.runs[0].stops[0].is_synthetic, true);
    assert.equal(res.runs[0].stops[0].stop_type, "handoff");
  });

  it("exposes is_first_stop and is_end_point", () => {
    const res = buildRunsByDateResponse(parsed, [
      leanRun({
        customers: [
          {
            name: "End",
            phone: "",
            address: "9 St",
            is_first_stop: false,
            is_end_point: true,
            geocode_status: "success",
          },
        ],
        optimized_route: {
          stops: [
            {
              customer_index: 0,
              customer_name: "End",
              customer_phone: "",
              customer_address: "9 St",
              is_first_stop: false,
              is_end_point: true,
            },
          ],
        },
      }),
    ]);
    assert.equal(res.runs[0].stops[0].is_end_point, true);
    assert.equal(res.runs[0].customers[0].is_end_point, true);
  });

  it("does not include encoded_polyline driver_link POD or SMS fields", () => {
    const res = buildRunsByDateResponse(parsed, [
      leanRun({
        optimized_route: {
          encoded_polyline: "secret-polyline",
          stops: [
            {
              customer_index: 0,
              customer_name: "A",
              customer_phone: "",
              customer_address: "1 St",
              is_first_stop: false,
              is_end_point: false,
              proof_of_delivery: "/internal/path",
              proof_of_delivery_images: ["https://r2.example.com/img.jpg"],
              sms_message_text: "Your ETA is 2pm",
            },
          ],
        },
      }),
    ]);
    const serialized = JSON.stringify(res);
    assert.ok(!serialized.includes("encoded_polyline"));
    assert.ok(!serialized.includes("driver_link"));
    assert.ok(!serialized.includes("proof_of_delivery"));
    assert.ok(!serialized.includes("sms_message_text"));
    assert.ok(!serialized.includes("secret-polyline"));
  });
});
