import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { confidenceFromLocationType } from "@/lib/google/geocodeConfidence";

describe("confidenceFromLocationType", () => {
  it("maps ROOFTOP to high", () => {
    assert.equal(confidenceFromLocationType("ROOFTOP", false), "high");
  });

  it("maps RANGE_INTERPOLATED to medium", () => {
    assert.equal(confidenceFromLocationType("RANGE_INTERPOLATED", false), "medium");
  });

  it("maps APPROXIMATE to low", () => {
    assert.equal(confidenceFromLocationType("APPROXIMATE", false), "low");
  });

  it("downgrades high to medium when partial_match", () => {
    assert.equal(confidenceFromLocationType("ROOFTOP", true), "medium");
  });

  it("downgrades medium to low when partial_match", () => {
    assert.equal(confidenceFromLocationType("GEOMETRIC_CENTER", true), "low");
  });
});
