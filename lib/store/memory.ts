import { promises as fs } from "node:fs";
import path from "node:path";

import type { MemoryTrace } from "@/lib/agent/memory/traces";
import { scopeKey } from "@/lib/auth/scope";

export interface MemoryProtocolState {
  lastRunAt?: string;
  lastError?: string;
}

export interface MemorySnapshot {
  working: MemoryTrace[];
  episodes: MemoryTrace[];
  longTerm: MemoryTrace[];
  protocols: Record<string, MemoryProtocolState>;
  updatedAt?: string;
}

function root(): string {
  return path.join(process.cwd(), ".data", scopeKey());
}

const workingPath = () => path.join(root(), "working-set.json");
const episodesPath = () => path.join(root(), "episodes.ndjson");
const longTermPath = () => path.join(root(), "ltm.ndjson");

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

async function readTraceLog(file: string): Promise<MemoryTrace[]> {
  let raw: string;
  try {
    raw = await fs.readFile(file, "utf8");
  } catch {
    return [];
  }
  const byId = new Map<string, MemoryTrace>();
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const trace = JSON.parse(line) as MemoryTrace;
      if (trace && typeof trace.id === "string" && !byId.has(trace.id)) byId.set(trace.id, trace);
    } catch {
      // One torn append must not hide the rest of a durable memory log.
    }
  }
  return [...byId.values()];
}

export async function readMemory(): Promise<MemorySnapshot> {
  const working = await readJson<{ traces?: MemoryTrace[]; protocols?: Record<string, MemoryProtocolState>; updatedAt?: string }>(
    workingPath(),
    {},
  );
  const [episodes, longTerm] = await Promise.all([readTraceLog(episodesPath()), readTraceLog(longTermPath())]);
  return {
    working: Array.isArray(working.traces) ? working.traces : [],
    episodes,
    longTerm,
    protocols: working.protocols ?? {},
    updatedAt: working.updatedAt,
  };
}

/** Single-writer atomic replacement, matching heartbeat-state.json's discipline. */
export async function writeWorkingMemory(
  working: MemoryTrace[],
  protocols: Record<string, MemoryProtocolState>,
  updatedAt: string,
): Promise<void> {
  await fs.mkdir(root(), { recursive: true });
  const target = workingPath();
  const temp = `${target}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  await fs.writeFile(temp, JSON.stringify({ traces: working, protocols, updatedAt }, null, 2), "utf8");
  await fs.rename(temp, target);
}

async function appendTraces(file: string, traces: readonly MemoryTrace[]): Promise<void> {
  if (traces.length === 0) return;
  await fs.mkdir(root(), { recursive: true });
  await fs.appendFile(file, `${traces.map((trace) => JSON.stringify(trace)).join("\n")}\n`, "utf8");
}

export const appendEpisodes = (traces: readonly MemoryTrace[]) => appendTraces(episodesPath(), traces);
export const appendLongTerm = (traces: readonly MemoryTrace[]) => appendTraces(longTermPath(), traces);
