export interface FileNode {
  name: string;
  path: string;
  isDirectory: boolean;
  children?: FileNode[];
  /** Which wake-up produced the file, so it can be fetched back. */
  sessionPath?: string;
}
