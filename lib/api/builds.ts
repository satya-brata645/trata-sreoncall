/**
 * Builds — an app's releases.
 *
 * A build is a promoted snapshot of an app's logic (scope, scoring, what gets
 * computed), not just its presentation. That is why an output belongs to the
 * build that was current when it was produced: `this report came from this
 * logic, on this date`.
 */

import type { AuthParams } from "./client";

export interface Build {
  number: number;
  /** When this build was promoted. Also what maps the app's wake-ups to it. */
  promoted_at: string;
  promoted_by?: string | null;
  /** The build chat this came from — lineage, surfaced in Dev Mode. */
  conversation_id?: string | null;
  /** The wake-up whose dashboard was promoted. */
  session_id?: string | null;
  metadata?: Record<string, unknown>;
  spec?: Record<string, unknown>;
  scope?: {
    queries?: unknown[];
    detectors?: string[];
    tables?: Array<{ name: string; fields: Record<string, string> }>;
  };
  refresh_rate?: { interval_seconds?: number; interval_hours?: number } | null;
}

export interface BuildsResponse {
  app_id: string;
  /** Newest first. */
  builds: Build[];
  latest_build: number | null;
  /**
   * What the app opens on. Equals `latest_build` unless someone rolled back —
   * the difference is shown rather than hidden, because a silent pin to an old
   * build is how people end up stranded on a worse version.
   */
  current_build: number | null;
}

async function local<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/builds/${path.split("/").map(encodeURIComponent).join("/")}`, {
    cache: "no-store",
    headers: init?.body ? { "content-type": "application/json" } : undefined,
    ...init,
  });
  if (!response.ok) throw new Error(`builds unavailable (${response.status}): ${await response.text()}`);
  return response.json() as Promise<T>;
}

export async function getBuilds(_auth: AuthParams, appId: string): Promise<BuildsResponse> {
  return local<BuildsResponse>(appId);
}

export interface PromoteBuildBody {
  conversation_id?: string;
  session_id?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Promote the current state to a new build.
 *
 * Builds belong to the workspace, so this changes what colleagues open — worth
 * a confirm at the call site.
 */
export async function promoteBuild(
  _auth: AuthParams,
  appId: string,
  body: PromoteBuildBody = {},
): Promise<{ app_id: string; build: Build }> {
  return local(`${appId}/promote`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/**
 * Roll the app back to an existing build.
 *
 * Kept distinct from promotion because the difference between `latest_build`
 * and `current_build` is shown rather than hidden — a silent pin to an old
 * build is how people end up stranded on a worse version.
 */
export async function setCurrentBuild(
  _auth: AuthParams,
  appId: string,
  buildNumber: number,
): Promise<BuildsResponse> {
  return local(`${appId}/current`, {
    method: "POST",
    body: JSON.stringify({ build: buildNumber }),
  });
}
