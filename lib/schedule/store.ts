import { promises as fs } from "node:fs";
import path from "node:path";

import { scopeKey } from "@/lib/auth/scope";
import { normalizeAppId } from "@/lib/builds/store";
import type { ScheduledJob } from "./due";

const root = () => path.join(process.cwd(), ".data", scopeKey(), "schedules");
const file = (appId: string) => path.join(root(), `${normalizeAppId(appId)}.json`);

export async function getSchedule(appId: string): Promise<ScheduledJob | null> {
  try { return JSON.parse(await fs.readFile(file(appId), "utf8")) as ScheduledJob; } catch { return null; }
}

export async function putSchedule(appId: string, input: Partial<ScheduledJob>): Promise<ScheduledJob> {
  const safeAppId = normalizeAppId(appId);
  const job: ScheduledJob = {
    app_id: safeAppId,
    enabled: input.enabled ?? true,
    interval_hours: input.interval_hours,
    interval_seconds: input.interval_seconds,
    last_run: input.last_run ?? null,
    run_count: input.run_count ?? 0,
    max_runs: input.max_runs ?? null,
    end_at: input.end_at ?? null,
  };
  if (!(typeof job.interval_hours === "number" && job.interval_hours > 0) && !(typeof job.interval_seconds === "number" && job.interval_seconds > 0)) {
    throw new Error("a positive interval_hours or interval_seconds is required");
  }
  await fs.mkdir(root(), { recursive: true });
  await fs.writeFile(file(safeAppId), `${JSON.stringify(job, null, 2)}\n`, "utf8");
  return job;
}

export async function deleteSchedule(appId: string): Promise<void> {
  await fs.rm(file(appId), { force: true });
}

export async function listSchedules(): Promise<ScheduledJob[]> {
  let names: string[];
  try { names = await fs.readdir(root()); } catch { return []; }
  return (await Promise.all(names.filter((name) => name.endsWith(".json")).map((name) => getSchedule(name.slice(0, -5))))).filter((job): job is ScheduledJob => job !== null);
}
