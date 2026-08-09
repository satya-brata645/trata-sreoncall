import assert from "node:assert/strict";
import { test } from "node:test";
import { due, type ScheduledJob } from "../due";

const now = new Date("2026-08-09T12:00:00.000Z");
const base: ScheduledJob = { app_id: "sreoncall", enabled: true, interval_seconds: 60, last_run: null, run_count: 0, max_runs: null };

test("due respects first run, interval boundaries and stopping conditions", () => {
  assert.equal(due(base, now), true);
  assert.equal(due({ ...base, last_run: "2026-08-09T11:59:00.000Z" }, now), true);
  assert.equal(due({ ...base, last_run: "2026-08-09T11:59:01.000Z" }, now), false);
  assert.equal(due({ ...base, enabled: false }, now), false);
  assert.equal(due({ ...base, run_count: 2, max_runs: 2 }, now), false);
  assert.equal(due({ ...base, end_at: "2026-08-09T11:59:59.000Z" }, now), false);
});
