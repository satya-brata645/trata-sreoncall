import type { FileNode } from "./types";
import type { ProjectFile } from "@/lib/api/types";

/**
 * A flat file list, folded back into the tree its paths describe.
 *
 * Directories sort before files and both sort by name, so a wake-up's outputs
 * read the same way every time — the file system is derived rather than
 * authored, so a stable order is the only order a user can learn.
 */
export function buildFileTree(files: ProjectFile[], sessionPath: string): FileNode[] {
  interface MutableNode extends Omit<FileNode, "children"> {
    children?: Map<string, MutableNode>;
  }
  const root = new Map<string, MutableNode>();

  for (const file of files) {
    const parts = file.path.split("/").filter(Boolean);
    let current = root;

    parts.forEach((part, i) => {
      const isLast = i === parts.length - 1;
      const path = parts.slice(0, i + 1).join("/");

      if (!current.has(part)) {
        current.set(part, {
          name: part,
          path,
          isDirectory: !isLast,
          children: isLast ? undefined : new Map(),
          sessionPath,
        });
      }

      if (!isLast) {
        const node = current.get(part)!;
        node.children ??= new Map();
        current = node.children;
      }
    });
  }

  function toArray(map: Map<string, MutableNode>): FileNode[] {
    return Array.from(map.values())
      .map((node) => ({
        ...node,
        children: node.children ? toArray(node.children) : undefined,
      }))
      .sort((a, b) => {
        if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
  }

  return toArray(root);
}
