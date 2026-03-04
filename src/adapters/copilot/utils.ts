import { join } from "node:path";
import { homedir } from "node:os";

export const COPILOT_BASE = join(homedir(), ".copilot", "session-state");

// ── Copilot native event types ──────────────────────────────

export interface CopilotEvent {
  type: string;
  data: Record<string, unknown>;
  id: string;
  timestamp: string;
  parentId: string | null;
}

export interface CopilotWorkspace {
  id: string;
  cwd?: string;
  git_root?: string;
  repository?: string;
  branch?: string;
  name?: string;
  summary?: string;
  summary_count?: number;
  created_at?: string;
  updated_at?: string;
}
