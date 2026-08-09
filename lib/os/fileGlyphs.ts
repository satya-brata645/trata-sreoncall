/**
 * The badge a file kind is drawn with.
 *
 * The one place in the system a *filled* colour tile is allowed. Everywhere
 * else colour means severity or liveness; here it means file kind, and a row of
 * identical grey document icons is genuinely harder to scan than a row of
 * coloured badges. Kept small and few so it cannot grow into decoration.
 */
export interface FileGlyph {
  label: string;
  tint: string;
}

const BY_EXTENSION: Record<string, FileGlyph> = {
  pdf: { label: "PDF", tint: "#C0392B" },
  csv: { label: "CSV", tint: "#2E7D4F" },
  xlsx: { label: "XLS", tint: "#2E7D4F" },
  xls: { label: "XLS", tint: "#2E7D4F" },
  doc: { label: "DOC", tint: "#2B5CB8" },
  docx: { label: "DOC", tint: "#2B5CB8" },
  json: { label: "JSON", tint: "#6E6B78" },
  md: { label: "MD", tint: "#6E6B78" },
  txt: { label: "TXT", tint: "#6E6B78" },
};

export function fileGlyph(filename: string): FileGlyph | null {
  const ext = filename.split(".").pop()?.toLowerCase();
  return (ext && BY_EXTENSION[ext]) || null;
}
