/**
 * The wire shapes the OS reads. Ported verbatim from the MCS backend contract
 * so the ported window-manager / file-system code needs no edits, and so the
 * fixtures in `lib/mock/` are already the right shape when the service lands.
 */

export interface ProjectFilters {
  domain: string[];
  areaOfFocus: string[];
  cloudProvider: string[];
}

/** An app. "Project" is the backend's word for it. */
export interface Project {
  id: string;
  name: string;
  description: string;
  path: string;
  url: string;
  has_claude_md: boolean;
  has_project_json: boolean;
  filters?: ProjectFilters;
  /** Namespaced metadata tags (e.g. "domain:network", "cloud:aws"). */
  tags?: string[];
  enabled?: boolean | null;
  is_public?: boolean;
}

export interface ProjectFile {
  path: string;
  filename: string;
  size: number;
  mime_type: string;
  modified_at: string;
}

export interface SessionSummary {
  executive_summary?: {
    title?: string;
    heading?: string;
    overview: string;
    key_findings: string[];
    next_steps: string[];
  };
  human_readable_summary?: {
    headline: string;
    narrative: string;
    key_metrics: string[];
    risk_assessment: string;
    criticality_level: string;
    action_items: string[];
  };
}

/** A wake-up: the agent doing a piece of work on an app. */
export interface ProjectSession {
  session_id: string;
  project_id: string;
  title: string;
  agent_name?: string;
  status?: string;
  created_at?: string;
  path?: string;
  updated_at?: string;
  chat_messages_count?: number;
  agent_messages_count?: number;
  last_update?: string;
  user_email?: string;
  result_summary?: SessionSummary;
  is_public?: boolean;
  org_slug?: string;
}

export interface SessionWithSummary extends ProjectSession {
  summary?: SessionSummary;
  has_summary: boolean;
}
