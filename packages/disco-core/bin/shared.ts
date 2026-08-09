import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { DatasetProfile, FieldProfile, TableProfile } from "../src/types";

export const ROOT = resolve(import.meta.dirname, "../../..");

export const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");
export const readJson = <T>(p: string): T => JSON.parse(read(p)) as T;
export const bytes = (p: string) => readFileSync(resolve(ROOT, p)).byteLength;

export function writeJson(p: string, value: unknown): string {
  const full = resolve(ROOT, p);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, `${JSON.stringify(value, null, 2)}\n`);
  return full;
}

export const exists = (p: string) => existsSync(resolve(ROOT, p));

export function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 48) || "dashboard"
  );
}

export function die(message: string): never {
  process.stderr.write(`\n  disco: ${message}\n\n`);
  process.exit(1);
}

// Moved into core so the web route can compose without importing CLI plumbing.
export { digest, candidateDigest } from "../src/digest";
