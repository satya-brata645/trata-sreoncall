/**
 * `getFileIcon` (components/shared/FileItem) now delegates to `getFileSymbol`
 * instead of holding its own switch. Three legacy viewers render its result, so
 * this pins that the delegation changed no glyph any of them shows.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  Boxes,
  File as FileIcon,
  FileArchive,
  FileCode,
  FileImage,
  FileJson,
  FileSpreadsheet,
  FileText,
} from "lucide-react";
import { getFileSymbol } from "@/lib/os/fileSymbols";

/** The legacy switch's exact choices, transcribed before it was replaced. */
const LEGACY = {
  json: FileJson,
  js: Boxes, jsx: Boxes, ts: Boxes, tsx: Boxes,
  md: FileText, txt: FileText, log: FileText,
  csv: FileSpreadsheet, xls: FileSpreadsheet, xlsx: FileSpreadsheet,
  pdf: FileText, doc: FileText, docx: FileText,
  html: FileCode,
  png: FileImage, jpg: FileImage, jpeg: FileImage,
  gif: FileImage, svg: FileImage, webp: FileImage,
  zip: FileArchive, tar: FileArchive, gz: FileArchive, rar: FileArchive,
  someunknownext: FileIcon,
} as const;

test("delegation preserves every glyph the legacy mapping chose", () => {
  // Compared by identity, not by displayName: lucide exports some icons under
  // an alias (FileJson resolves to FileBraces), so names differ where the
  // rendered component is the same object.
  const drift: string[] = [];
  for (const [ext, expected] of Object.entries(LEGACY)) {
    if (getFileSymbol(`x.${ext}`).icon !== expected) drift.push(ext);
  }
  assert.deepEqual(drift, [], `glyph changed for: ${drift.join(", ")}`);
});

test("a dotfile has no extension and falls back rather than guessing", () => {
  assert.equal(getFileSymbol(".env").icon, FileIcon);
});
