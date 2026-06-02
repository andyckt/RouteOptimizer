import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ApiError } from "@/lib/http/errors";
import { parseRunsByDateQuery } from "@/lib/integration/parseRunsByDateQuery";

describe("parseRunsByDateQuery", () => {
  it("throws 400 VALIDATION_ERROR when date is missing", () => {
    assert.throws(
      () => parseRunsByDateQuery(new URLSearchParams()),
      (err: unknown) =>
        err instanceof ApiError &&
        err.statusCode === 400 &&
        err.code === "VALIDATION_ERROR"
    );
  });

  it("throws 400 VALIDATION_ERROR for invalid date format", () => {
    assert.throws(
      () => parseRunsByDateQuery(new URLSearchParams("date=05-31-2026")),
      (err: unknown) =>
        err instanceof ApiError &&
        err.statusCode === 400 &&
        err.code === "VALIDATION_ERROR"
    );
  });

  it("parses valid date", () => {
    const parsed = parseRunsByDateQuery(new URLSearchParams("date=2026-05-31"));
    assert.equal(parsed.date, "2026-05-31");
    assert.equal(parsed.includeDrafts, false);
    assert.equal(parsed.requireRoute, true);
  });

  it("parses include_drafts=true", () => {
    const parsed = parseRunsByDateQuery(
      new URLSearchParams("date=2026-05-31&include_drafts=true")
    );
    assert.equal(parsed.includeDrafts, true);
  });

  it("parses require_route=false", () => {
    const parsed = parseRunsByDateQuery(
      new URLSearchParams("date=2026-05-31&require_route=false")
    );
    assert.equal(parsed.requireRoute, false);
  });

  it("defaults includeDrafts=false and requireRoute=true", () => {
    const parsed = parseRunsByDateQuery(new URLSearchParams("date=2026-01-01"));
    assert.equal(parsed.includeDrafts, false);
    assert.equal(parsed.requireRoute, true);
  });
});
