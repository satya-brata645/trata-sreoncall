import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { promises as fs } from "node:fs";
import path from "node:path";

import { buildForSession, listBuilds, normalizeAppId, promoteBuild, setCurrentBuild } from "../store";

const ROOT = path.join(process.cwd(), ".data", "org_trata", "builds");
const APP = "build-store-test";

afterEach(async () => {
  await fs.rm(path.join(ROOT, `${APP}.json`), { force: true });
});

test("promotes monotonically from stored bytes and rolls back by pointer only", async () => {
  const first = await promoteBuild(APP, { promoted_at: "2026-01-01T00:00:00.000Z", spec: { title: "one" } });
  const second = await promoteBuild(APP, { promoted_at: "2026-01-02T00:00:00.000Z", spec: { title: "two" } });
  const third = await promoteBuild(APP, { promoted_at: "2026-01-03T00:00:00.000Z", spec: { title: "three" } });
  assert.deepEqual([first.build.number, second.build.number, third.build.number], [1, 2, 3]);

  const before = await listBuilds(APP);
  const rolledBack = await setCurrentBuild(APP, 1);
  assert.equal(rolledBack.current_build, 1);
  assert.equal(rolledBack.latest_build, 3);
  assert.deepEqual(rolledBack.builds, before.builds);
});

test("corrupt documents fail closed and app ids cannot escape the builds directory", async () => {
  await fs.mkdir(ROOT, { recursive: true });
  await fs.writeFile(path.join(ROOT, `${APP}.json`), "not json", "utf8");
  assert.deepEqual(await listBuilds(APP), { app_id: APP, builds: [], latest_build: null, current_build: null });
  assert.throws(() => normalizeAppId("../../etc"));
  assert.throws(() => normalizeAppId(""));
});

test("maps wake-ups to the newest build at or before their start", () => {
  const builds = [
    { number: 3, promoted_at: "2026-01-03T00:00:00.000Z" },
    { number: 1, promoted_at: "2026-01-01T00:00:00.000Z" },
  ];
  assert.equal(buildForSession(builds, "2025-12-31T23:59:59.000Z"), null);
  assert.equal(buildForSession(builds, "2026-01-02T00:00:00.000Z")?.number, 1);
  assert.equal(buildForSession(builds, "2026-01-04T00:00:00.000Z")?.number, 3);
});
