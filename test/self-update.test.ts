// Self-update rollbacks must leave a trace and must not re-run the AI medic every hour for the same failure.
import { expect, test } from "bun:test";
import { failingTests, shouldCallMedic } from "../src/setup";

test("failing tests are read from bun output without colours or timings", () => {
  const out = [
    "\x1b[31m(fail) webclient > unpack > keeps relative names\x1b[0m [0.55ms]",
    "(pass) core > journal [0.01ms]",
    "(fail) checkWaits > wakes when the PR merges [1.20ms]",
    "(fail) webclient > unpack > keeps relative names [0.70ms]", // the same test twice → once
    " 7 fail",
  ].join("\n");
  expect(failingTests(out)).toEqual(["webclient > unpack > keeps relative names", "checkWaits > wakes when the PR merges"]);
});

test("a broken run stays one line: at most `max` failing tests", () => {
  const out = Array.from({ length: 9 }, (_, i) => `(fail) suite > test ${i} [1ms]`).join("\n");
  expect(failingTests(out, 3)).toEqual(["suite > test 0", "suite > test 1", "suite > test 2"]);
  expect(failingTests("", 3)).toEqual([]);
});

test("the medic runs once a day per rolling-back pair, not once per retry", () => {
  const now = Date.parse("2026-11-08T12:00:00Z");
  expect(shouldCallMedic({}, "32cd814→8fbe4e4", now)).toBe(true);
  const seen = { "32cd814→8fbe4e4": { at: "2026-11-08T11:00:00Z", tests: [] } };
  expect(shouldCallMedic(seen, "32cd814→8fbe4e4", now)).toBe(false); // same pair, one hour later
  expect(shouldCallMedic(seen, "32cd814→b6d8bc7", now)).toBe(true); // a new target is a new failure
  expect(shouldCallMedic(seen, "32cd814→8fbe4e4", Date.parse("2026-11-09T12:00:00Z"))).toBe(true);
});
