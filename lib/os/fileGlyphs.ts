/**
 * One place that knows what a file is.
 *
 * Three things every file surface needs — the badge on a dense row, the stroke
 * icon in a tree, and Finder's "Kind" word — derived from one extension table.
 * They were briefly three tables, which is how a `.docx` ends up blue in one
 * window and grey in the next.
 *
 * The badge is a **filled colour tile**, one of only two places in the system
 * where that is allowed (the other is the connected-source row in Spotlight).
 * It earns the exception because a column of identical grey document icons is
 * genuinely harder to scan than a column of coloured badges, and "which kind of
 * file" is meaning rather than decoration. The colours are deliberately muted
 * against the near-black ground so a list of files does not out-shout a finding.
 */

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
  type LucideIcon,
} from "lucide-react";

export interface FileGlyph {
  /** Two-to-four characters for the badge. */
  label: string;
  /** The badge fill. */
  tint: string;
  /** The stroke icon, for trees and inline rows where a badge is too loud. */
  icon: LucideIcon;
  /** Finder's "Kind" column: a short human word, not a MIME type. */
  kind: string;
}

const DOC = "#C0392B";
const SHEET = "#2E7D4F";
const TEXT = "#2B5CB8";
const NEUTRAL = "#4E4956";
const CODE = "#6B4FA8";

const BY_EXTENSION: Record<string, FileGlyph> = {
  // Reports — what someone actually opens and cites.
  pdf: { label: "PDF", tint: DOC, icon: FileText, kind: "PDF" },
  doc: { label: "DOC", tint: TEXT, icon: FileText, kind: "Word document" },
  docx: { label: "DOC", tint: TEXT, icon: FileText, kind: "Word document" },

  // Tabular.
  csv: { label: "CSV", tint: SHEET, icon: FileSpreadsheet, kind: "CSV" },
  xls: { label: "XLS", tint: SHEET, icon: FileSpreadsheet, kind: "Spreadsheet" },
  xlsx: { label: "XLS", tint: SHEET, icon: FileSpreadsheet, kind: "Spreadsheet" },

  // Structured data.
  json: { label: "JSON", tint: NEUTRAL, icon: FileJson, kind: "JSON" },
  yaml: { label: "YML", tint: NEUTRAL, icon: FileJson, kind: "YAML" },
  yml: { label: "YML", tint: NEUTRAL, icon: FileJson, kind: "YAML" },

  // Dashboards — the generated component a build produces. Not a document, and
  // deliberately not shareable: it embeds a refresh id and fetches from an
  // authenticated endpoint, so a recipient would get an error and a leaked id.
  tsx: { label: "TSX", tint: CODE, icon: Boxes, kind: "Dashboard" },
  jsx: { label: "JSX", tint: CODE, icon: Boxes, kind: "Dashboard" },
  ts: { label: "TS", tint: CODE, icon: Boxes, kind: "TypeScript" },
  js: { label: "JS", tint: CODE, icon: Boxes, kind: "JavaScript" },

  // Markup and prose.
  html: { label: "HTML", tint: CODE, icon: FileCode, kind: "HTML" },
  htm: { label: "HTML", tint: CODE, icon: FileCode, kind: "HTML" },
  md: { label: "MD", tint: NEUTRAL, icon: FileText, kind: "Markdown" },
  txt: { label: "TXT", tint: NEUTRAL, icon: FileText, kind: "Text" },
  log: { label: "LOG", tint: NEUTRAL, icon: FileText, kind: "Log" },

  // Images.
  png: { label: "PNG", tint: SHEET, icon: FileImage, kind: "PNG image" },
  jpg: { label: "JPG", tint: SHEET, icon: FileImage, kind: "JPEG image" },
  jpeg: { label: "JPG", tint: SHEET, icon: FileImage, kind: "JPEG image" },
  gif: { label: "GIF", tint: SHEET, icon: FileImage, kind: "GIF image" },
  svg: { label: "SVG", tint: SHEET, icon: FileImage, kind: "SVG image" },
  webp: { label: "WEBP", tint: SHEET, icon: FileImage, kind: "WebP image" },

  // Archives.
  zip: { label: "ZIP", tint: NEUTRAL, icon: FileArchive, kind: "Archive" },
  tar: { label: "TAR", tint: NEUTRAL, icon: FileArchive, kind: "Archive" },
  gz: { label: "GZ", tint: NEUTRAL, icon: FileArchive, kind: "Archive" },
  rar: { label: "RAR", tint: NEUTRAL, icon: FileArchive, kind: "Archive" },
};

/** Folders are chrome, not content — no badge, ever. */
const FOLDER: FileGlyph = { label: "", tint: NEUTRAL, icon: Folder, kind: "Folder" };

/** Anything unrecognised still gets a glyph rather than an empty cell. */
const FALLBACK: FileGlyph = { label: "", tint: NEUTRAL, icon: FileIcon, kind: "File" };

/** The extension, lowercased, with no dot. Empty string when there is none. */
export function getFileExtension(filename: string): string {
  const dot = filename.lastIndexOf(".");
  // `dot < 1` also covers dotfiles (".env"), which have no extension — the
  // leading dot is part of the name.
  if (dot < 1) return "";
  return filename.slice(dot + 1).toLowerCase();
}

/**
 * Everything known about a file's kind.
 *
 * Directories resolve to the folder glyph rather than being rejected, so a
 * caller listing a mixed folder never has to branch before asking.
 */
export function getFileGlyph(
  filename: string,
  options?: { isDirectory?: boolean },
): FileGlyph {
  if (options?.isDirectory) return FOLDER;
  return BY_EXTENSION[getFileExtension(filename)] ?? FALLBACK;
}

/**
 * The badge, or `null` where there is nothing worth badging.
 *
 * Null rather than a grey "FILE" tile: an unknown extension has no kind to
 * announce, and a badge that says nothing is worse than the stroke icon.
 */
export function fileGlyph(filename: string): FileGlyph | null {
  const glyph = getFileGlyph(filename);
  return glyph.label ? glyph : null;
}

/** Finder's "Kind" column. Unknown extensions render as the uppercased ext. */
export function getFileKind(
  filename: string,
  options?: { isDirectory?: boolean },
): string {
  if (options?.isDirectory) return FOLDER.kind;
  const ext = getFileExtension(filename);
  const known = BY_EXTENSION[ext];
  if (known) return known.kind;
  return ext ? ext.toUpperCase() : FALLBACK.kind;
}
