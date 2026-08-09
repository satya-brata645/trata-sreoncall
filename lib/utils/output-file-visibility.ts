import type { ProjectFile } from "@/lib/api/types";

/**
 * The visibility gate every file surface applies.
 *
 * Wake-ups write working files alongside the outputs a person is meant to see —
 * traces, scratch JSON, the agent's own notes. Those are hidden outside
 * development, because a Files window that lists them reads as clutter rather
 * than as evidence.
 */
const INTERNAL_PREFIXES = ["_", "."];
const INTERNAL_SUFFIXES = [".trace.json", ".debug.json", ".raw.json"];

export function filterCustomerOutputFiles(
  files: ProjectFile[],
  opts: { email?: string; isProd?: boolean } = {},
): ProjectFile[] {
  if (!opts.isProd) return files;
  return files.filter((f) => {
    if (INTERNAL_PREFIXES.some((p) => f.filename.startsWith(p))) return false;
    if (INTERNAL_SUFFIXES.some((s) => f.filename.endsWith(s))) return false;
    return true;
  });
}
