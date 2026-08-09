import { fetchBackend, type AuthParams } from "./client";
import type { ProjectFile } from "./types";

export interface ConversationFilesItem {
  conversation_id: string;
  title?: string | null;
  files: ProjectFile[];
  /** Last activity. The server orders by this; carried for display. */
  last_update?: string | null;
}

export interface ConversationFilesResponse {
  conversations: ConversationFilesItem[];
  total_files: number;
}

/**
 * Every conversation of the current user, with whatever files it holds — one
 * request covers the whole `chat/` root. Empty conversations are included: a
 * chat gets a folder because it exists.
 */
export async function getConversationFiles(
  auth: AuthParams,
): Promise<ConversationFilesResponse> {
  return fetchBackend<ConversationFilesResponse>("/conversations/files", auth);
}
