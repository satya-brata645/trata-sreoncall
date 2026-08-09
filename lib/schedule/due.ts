export interface ScheduledJob {
  app_id: string;
  enabled: boolean;
  interval_hours?: number;
  interval_seconds?: number;
  last_run?: string | null;
  run_count: number;
  max_runs?: number | null;
  end_at?: string | null;
}

export function intervalMs(job: ScheduledJob): number | null {
  if (typeof job.interval_seconds === "number" && job.interval_seconds > 0) return job.interval_seconds * 1_000;
  if (typeof job.interval_hours === "number" && job.interval_hours > 0) return job.interval_hours * 3_600_000;
  return null;
}

/** Pure by design: the scheduler passes its current instant in. */
export function due(job: ScheduledJob, now: Date): boolean {
  if (!job.enabled || (job.max_runs !== null && job.max_runs !== undefined && job.run_count >= job.max_runs)) return false;
  if (job.end_at && Date.parse(job.end_at) <= now.getTime()) return false;
  const interval = intervalMs(job);
  if (!interval) return false;
  if (!job.last_run) return true;
  return now.getTime() - Date.parse(job.last_run) >= interval;
}
