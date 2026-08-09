import { promises as fs } from "node:fs";
import path from "node:path";

import { scopeKey } from "@/lib/auth/scope";

export type JsonObject = Record<string, unknown>;

export interface BuildScope {
  queries?: unknown[];
  detectors?: string[];
  tables?: Array<{ name: string; fields: Record<string, string> }>;
}

export interface BuildRecord {
  number: number;
  promoted_at: string;
  promoted_by?: string | null;
  conversation_id?: string | null;
  session_id?: string | null;
  spec?: JsonObject;
  scope?: BuildScope;
  refresh_rate?: { interval_seconds?: number; interval_hours?: number } | null;
  metadata?: JsonObject;
}

export interface BuildDocument {
  app_id: string;
  builds: BuildRecord[];
  latest_build: number | null;
  current_build: number | null;
}

const APP_ID = /^[a-z][a-z0-9_-]{0,63}$/;

export function normalizeAppId(appId: string): string {
  const normalized = appId.trim().toLowerCase();
  if (!APP_ID.test(normalized)) throw new Error("invalid app id");
  return normalized;
}

function directory(): string {
  return path.join(process.cwd(), ".data", scopeKey(), "builds");
}

function fileFor(appId: string): string {
  return path.join(directory(), `${normalizeAppId(appId)}.json`);
}

function empty(appId: string): BuildDocument {
  return { app_id: normalizeAppId(appId), builds: [], latest_build: null, current_build: null };
}

/**
 * Fresh checkouts still need a visible, inspectable build pointer. These are
 * shipped defaults (not user promotions): the first promotion simply becomes
 * build N+1 and is durably written to `.data/`.
 */
const SHIPPED_BUILDS: Record<string, BuildDocument> = {
  sreoncall: {
    app_id: "sreoncall",
    builds: [{ number: 1, promoted_at: "2026-08-09T11:00:00.000Z", promoted_by: "Trata", metadata: { shipped: true } }],
    latest_build: 1,
    current_build: 1,
  },
  dpflo: { app_id: "dpflo", builds: [{ number: 1, promoted_at: "2026-08-09T11:00:00.000Z", promoted_by: "Trata", metadata: { shipped: true } }], latest_build: 1, current_build: 1 },
  kodeshield: { app_id: "kodeshield", builds: [{ number: 1, promoted_at: "2026-08-09T11:00:00.000Z", promoted_by: "Trata", metadata: { shipped: true } }], latest_build: 1, current_build: 1 },
  auditiseasy: { app_id: "auditiseasy", builds: [{ number: 1, promoted_at: "2026-08-09T11:00:00.000Z", promoted_by: "Trata", metadata: { shipped: true } }], latest_build: 1, current_build: 1 },
};

function normalize(doc: Partial<BuildDocument>, appId: string): BuildDocument {
  const builds = Array.isArray(doc.builds)
    ? doc.builds.filter((build): build is BuildRecord => Boolean(build && Number.isInteger(build.number) && typeof build.promoted_at === "string"))
    : [];
  const latest = builds.reduce<number | null>((current, build) => current === null || build.number > current ? build.number : current, null);
  const current = builds.some((build) => build.number === doc.current_build) ? doc.current_build ?? null : latest;
  return { app_id: normalizeAppId(appId), builds: builds.sort((a, b) => b.number - a.number), latest_build: latest, current_build: current };
}

export async function listBuilds(appId: string): Promise<BuildDocument> {
  const safeAppId = normalizeAppId(appId);
  try {
    return normalize(JSON.parse(await fs.readFile(fileFor(safeAppId), "utf8")) as Partial<BuildDocument>, safeAppId);
  } catch {
    return SHIPPED_BUILDS[safeAppId] ?? empty(safeAppId);
  }
}

async function write(appId: string, document: BuildDocument): Promise<void> {
  await fs.mkdir(directory(), { recursive: true });
  const target = fileFor(appId);
  const temporary = `${target}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(document, null, 2)}\n`, "utf8");
  await fs.rename(temporary, target);
}

export async function promoteBuild(appId: string, input: Omit<BuildRecord, "number" | "promoted_at"> & { promoted_at?: string } = {}): Promise<{ app_id: string; build: BuildRecord }> {
  const document = await listBuilds(appId);
  const number = document.builds.reduce((max, build) => Math.max(max, build.number), 0) + 1;
  const build: BuildRecord = { number, promoted_at: input.promoted_at ?? new Date().toISOString(), ...input };
  const next: BuildDocument = { ...document, builds: [build, ...document.builds], latest_build: number, current_build: number };
  await write(document.app_id, next);
  return { app_id: document.app_id, build };
}

export async function setCurrentBuild(appId: string, number: number): Promise<BuildDocument> {
  const document = await listBuilds(appId);
  if (!document.builds.some((build) => build.number === number)) throw new Error("build not found");
  const next = { ...document, current_build: number };
  await write(document.app_id, next);
  return next;
}

export function buildForSession(builds: readonly BuildRecord[], startedAt: string | null | undefined): BuildRecord | null {
  if (!startedAt) return null;
  return [...builds].filter((build) => build.promoted_at <= startedAt).sort((a, b) => b.promoted_at.localeCompare(a.promoted_at) || b.number - a.number)[0] ?? null;
}
