import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

export function writeJson(file: string, value: unknown): string {
  const target = resolve(process.cwd(), file);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`);
  return target;
}

export function die(message: string): never {
  throw new Error(message);
}
