import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  parseGeocodeAddressesPayload,
  MAX_GEOCODE_ADDRESSES,
} from "@/lib/integration/parseGeocodeAddressesPayload";

describe("parseGeocodeAddressesPayload", () => {
  it("accepts a valid payload", () => {
    const result = parseGeocodeAddressesPayload({
      created_by_integration: "kapioo-admin",
      idempotency_key: "kapioo-geocode:2026-06-09:abc123",
      addresses: [
        {
          client_ref: "DD-90000001",
          address: "Unit 1205, 25 Greenview Ave, North York M2M 1R4, Canada",
          area: "North York",
          country: "Canada",
        },
      ],
    });
    assert.equal(result.errors.length, 0);
    assert.equal(result.payload?.addresses.length, 1);
    assert.equal(result.payload?.addresses[0].client_ref, "DD-90000001");
  });

  it("rejects missing addresses array", () => {
    const result = parseGeocodeAddressesPayload({
      created_by_integration: "kapioo-admin",
    });
    assert.ok(result.errors.some((e) => e.field === "addresses"));
  });

  it("rejects empty addresses array", () => {
    const result = parseGeocodeAddressesPayload({ addresses: [] });
    assert.ok(result.errors.some((e) => e.field === "addresses"));
  });

  it("rejects missing client_ref and address", () => {
    const result = parseGeocodeAddressesPayload({
      addresses: [{ client_ref: "", address: "" }],
    });
    assert.ok(
      result.errors.some((e) => e.field === "addresses[0].client_ref")
    );
    assert.ok(result.errors.some((e) => e.field === "addresses[0].address"));
  });

  it("rejects duplicate client_ref", () => {
    const result = parseGeocodeAddressesPayload({
      addresses: [
        { client_ref: "A", address: "1 Main St" },
        { client_ref: "A", address: "2 Main St" },
      ],
    });
    assert.ok(
      result.errors.some((e) => e.message.includes("Duplicate client_ref"))
    );
  });

  it(`rejects more than ${MAX_GEOCODE_ADDRESSES} addresses`, () => {
    const addresses = Array.from({ length: MAX_GEOCODE_ADDRESSES + 1 }, (_, i) => ({
      client_ref: `ref-${i}`,
      address: `${i} Street`,
    }));
    const result = parseGeocodeAddressesPayload({ addresses });
    assert.ok(result.errors.some((e) => e.field === "addresses"));
  });
});
