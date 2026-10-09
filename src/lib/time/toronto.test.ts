import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseTorontoRunTime } from "./toronto";

describe("Toronto business-clock parsing", () => {
  it("uses daylight saving for the observed October 9 departure", () => {
    assert.equal(parseTorontoRunTime("2026-10-09", "10:00").toISOString(), "2026-10-09T14:00:00.000Z");
  });
  it("uses the winter offset after daylight saving ends", () => {
    assert.equal(parseTorontoRunTime("2026-11-02", "10:00").toISOString(), "2026-11-02T15:00:00.000Z");
  });
  it("keeps the business calendar date at Toronto midnight", () => {
    assert.equal(parseTorontoRunTime("2026-10-09", "00:00").toISOString(), "2026-10-09T04:00:00.000Z");
    assert.equal(parseTorontoRunTime("2026-10-09", "23:59:59").toISOString(), "2026-10-10T03:59:59.000Z");
  });
  it("does not use the computer or server timezone", () => {
    const original = process.env.TZ;
    try {
      for (const zone of ["UTC", "Asia/Hong_Kong", "America/Toronto"]) {
        process.env.TZ = zone;
        assert.equal(parseTorontoRunTime("2026-10-09", "10:00").toISOString(), "2026-10-09T14:00:00.000Z");
      }
    } finally {
      if (original === undefined) delete process.env.TZ;
      else process.env.TZ = original;
    }
  });
  it("rejects an impossible calendar date or clock", () => {
    for (const [date, time] of [["2026-02-30", "10:00"], ["2026-10-09", "24:00"], ["2026-10-09", "10:60"]]) {
      assert.throws(() => parseTorontoRunTime(date, time), RangeError);
    }
  });
  it("rejects the nonexistent clock during the spring-forward gap", () => {
    assert.throws(() => parseTorontoRunTime("2026-03-08", "02:30"), RangeError);
  });
});
