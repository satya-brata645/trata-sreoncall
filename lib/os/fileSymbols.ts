"use client";

/**
 * One symbol per file type, for every surface that lists files.
 *
 * This replaces three competing mappings that had drifted apart:
 *
 * - `getFileIcon` / `getFileIconColor` (`components/shared/FileItem.tsx`) — a
 *   glyph plus a legacy `text-[var(--…)]` colour string.
 * - `extTone` (`components/os/apps/app/AppRightPanel.tsx`) — OS role tokens, but
 *   as surface/text *pairs* for a chip rather than a glyph.
 *
 * Deliberately shaped like `getAppSymbol` (`lib/os/appIcons.tsx`): it returns
 * `{ icon, tone }` rather than a bare component, so consumers destructure a
 * reference instead of deriving one from a call — which lint correctly reads as
 * building a component during render. Returning the same `AppIconTone` means
 * `APP_TONE_CLASSES` is reused verbatim and file kinds are theme-aware for free.
 *
 * Tone is meaning, not decoration: a report reads as critical, data as medium,
 * a dashboard as low. That is the same status ramp the app tiles use, so a
 * coloured square means the same thing wherever it appears.
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

import { APP_TONE_CLASSES, type AppIconTone } from "./appIcons";

export interface FileSymbol {
  icon: LucideIcon;
  tone: AppIconTone;
}

/** Folders are chrome, not content — neutral on purpose, like the nav icons. */
const FOLDER_SYMBOL: FileSymbol = { icon: Folder, tone: "brand" };

/** Anything unrecognised still gets a symbol rather than an empty cell. */
const DEFAULT_SYMBOL: FileSymbol = { icon: FileIcon, tone: "brand" };

const BY_EXTENSION: Record<string, FileSymbol> = {
  // Reports — what someone actually opens and cites.
  pdf: { icon: FileText, tone: "critical" },
  doc: { icon: FileText, tone: "critical" },
  docx: { icon: FileText, tone: "critical" },

  // Structured data.
  json: { icon: FileJson, tone: "medium" },
  yaml: { icon: FileJson, tone: "medium" },
  yml: { icon: FileJson, tone: "medium" },

  // Tabular.
  csv: { icon: FileSpreadsheet, tone: "info" },
  xls: { icon: FileSpreadsheet, tone: "info" },
  xlsx: { icon: FileSpreadsheet, tone: "info" },

  // Dashboards — the generated component a build produces.
  tsx: { icon: Boxes, tone: "low" },
  jsx: { icon: Boxes, tone: "low" },
  ts: { icon: Boxes, tone: "low" },
  js: { icon: Boxes, tone: "low" },

  // Markup and prose.
  html: { icon: FileCode, tone: "high" },
  htm: { icon: FileCode, tone: "high" },
  md: { icon: FileText, tone: "brand" },
  txt: { icon: FileText, tone: "brand" },
  log: { icon: FileText, tone: "brand" },

  // Images.
  png: { icon: FileImage, tone: "info" },
  jpg: { icon: FileImage, tone: "info" },
  jpeg: { icon: FileImage, tone: "info" },
  gif: { icon: FileImage, tone: "info" },
  svg: { icon: FileImage, tone: "info" },
  webp: { icon: FileImage, tone: "info" },

  // Archives.
  zip: { icon: FileArchive, tone: "high" },
  tar: { icon: FileArchive, tone: "high" },
  gz: { icon: FileArchive, tone: "high" },
  rar: { icon: FileArchive, tone: "high" },
};

/** The extension, lowercased, with no dot. Empty string when there is none. */
export function getFileExtension(filename: string): string {
  const dot = filename.lastIndexOf(".");
  // `dot < 1` also covers dotfiles (".env"), which have no extension — the
  // leading dot is part of the name.
  if (dot < 1) return "";
  return filename.slice(dot + 1).toLowerCase();
}

/** The symbol for a file or folder. */
export function getFileSymbol(
  filename: string,
  options?: { isDirectory?: boolean },
): FileSymbol {
  if (options?.isDirectory) return FOLDER_SYMBOL;
  return BY_EXTENSION[getFileExtension(filename)] ?? DEFAULT_SYMBOL;
}

/**
 * The tile/chip classes for a file, ready to drop on an element.
 *
 * A thin pass-through to `APP_TONE_CLASSES` so callers don't have to know that
 * file tones and app tones are the same ramp — they just ask for classes.
 */
export function getFileToneClasses(
  filename: string,
  options?: { isDirectory?: boolean },
): string {
  return APP_TONE_CLASSES[getFileSymbol(filename, options).tone];
}

/**
 * Finder's "Kind" column: a short human word for the type.
 *
 * Not the MIME type — "Microsoft Word 2007+" is what `file` says and not what a
 * person reads. Unknown extensions render as the uppercased extension, which is
 * still more use than "Document".
 */
export function getFileKind(
  filename: string,
  options?: { isDirectory?: boolean },
): string {
  if (options?.isDirectory) return "Folder";

  const ext = getFileExtension(filename);
  const KINDS: Record<string, string> = {
    pdf: "PDF",
    doc: "Word document",
    docx: "Word document",
    json: "JSON",
    yaml: "YAML",
    yml: "YAML",
    csv: "CSV",
    xls: "Spreadsheet",
    xlsx: "Spreadsheet",
    tsx: "Dashboard",
    jsx: "Dashboard",
    ts: "TypeScript",
    js: "JavaScript",
    html: "HTML",
    htm: "HTML",
    md: "Markdown",
    txt: "Text",
    log: "Log",
    png: "PNG image",
    jpg: "JPEG image",
    jpeg: "JPEG image",
    gif: "GIF image",
    svg: "SVG image",
    webp: "WebP image",
    zip: "Archive",
    tar: "Archive",
    gz: "Archive",
    rar: "Archive",
  };

  return KINDS[ext] ?? (ext ? ext.toUpperCase() : "File");
}
