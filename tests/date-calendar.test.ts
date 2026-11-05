import test from "node:test";
import assert from "node:assert/strict";
import { calendarDate } from "../src/server/training/dates";

test("Lisbon training dates preserve summer and winter midnight boundaries across repeated projections", () => {
  const examples = [
    ["2026-07-01T23:30:00Z", "2026-07-02"],
    ["2026-11-05T23:30:00Z", "2026-11-05"],
    ["2026-11-06T00:01:00Z", "2026-11-06"],
    ["2026-07-01T22:59:00Z", "2026-07-01"],
  ];
  for (let i = 0; i < 100; i++)
    for (const [instant, expected] of examples)
      assert.equal(calendarDate(new Date(instant)), expected);
});
