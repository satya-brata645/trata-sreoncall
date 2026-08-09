/**
 * The file-kind table is the one thing three surfaces share — the Spotlight
 * badge, the Files tree and the app's output list. It was three tables once, and
 * this pins the merged one against the glyphs the original mapping chose, so a
 * later edit cannot quietly change what a `.docx` looks like in one window and
 * not the next.
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
  Folder,
} from "lucide-react";
import { fileGlyph, getFileGlyph, getFileKind } from "@/lib/os/fileGlyphs";

/** The original switch's exact choices, transcribed before it was replaced. */
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

test("the merged table preserves every glyph the legacy mapping chose", () => {
  // Compared by identity, not by displayName: lucide exports some icons under
  // an alias (FileJson resolves to FileBraces), so names differ where the
  // rendered component is the same object.
  const drift: string[] = [];
  for (const [ext, expected] of Object.entries(LEGACY)) {
    if (getFileGlyph(`x.${ext}`).icon !== expected) drift.push(ext);
  }
  assert.deepEqual(drift, [], `glyph changed for: ${drift.join(", ")}`);
});

test("a dotfile has no extension and falls back rather than guessing", () => {
  assert.equal(getFileGlyph(".env").icon, FileIcon);
});

test("a directory is chrome, so it gets the folder glyph and no badge", () => {
  assert.equal(getFileGlyph("outputs", { isDirectory: true }).icon, Folder);
  assert.equal(getFileKind("outputs", { isDirectory: true }), "Folder");
});

/**
 * An unknown extension gets no badge at all. A grey tile reading "FILE" claims
 * to identify a kind it could not identify, which is worse than the stroke icon
 * the caller falls back to.
 */
test("only kinds worth announcing get a badge", () => {
  assert.equal(fileGlyph("report.pdf")?.label, "PDF");
  assert.equal(fileGlyph("archive.bin"), null);
  assert.equal(fileGlyph(".env"), null);
});

test("kind is a human word, not a MIME type", () => {
  assert.equal(getFileKind("spec.docx"), "Word document");
  assert.equal(getFileKind("board.tsx"), "Dashboard");
  assert.equal(getFileKind("thing.weird"), "WEIRD");
});
