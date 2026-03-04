// ── Tool names ──────────────────────────────────────────────
export type ToolName = string;

// ── IR (Intermediate Representation) ────────────────────────

export interface IRSessionMeta {
  ir_version: "1";
  type: "session_meta";
  source_tool: ToolName;
  source_session_id: string;
  cwd: string;
  git_branch?: string;
  title?: string;
  model?: string;
  created_at: string;
}

export interface IRUserMessage {
  type: "user_message";
  timestamp: string;
  content: string;
}

export interface IRAssistantMessage {
  type: "assistant_message";
  timestamp: string;
  content: string;
  thinking?: string;
  model?: string;
}

export interface IRToolCall {
  type: "tool_call";
  timestamp: string;
  tool_call_id: string;
  tool_name: string;
  arguments: string;
}

export interface IRToolResult {
  type: "tool_result";
  timestamp: string;
  tool_call_id: string;
  output: string;
}

export type IREntry =
  | IRSessionMeta
  | IRUserMessage
  | IRAssistantMessage
  | IRToolCall
  | IRToolResult;

// ── Session info ────────────────────────────────────────────

export interface SessionInfo {
  tool: ToolName;
  sessionId: string;
  title?: string;
  cwd?: string;
  model?: string;
  createdAt?: string;
  /** Filesystem path to the primary session file */
  path: string;
}

// ── Adapter interface ───────────────────────────────────────

export interface ToolAdapter {
  readonly name: ToolName;
  listSessions(): Promise<SessionInfo[]>;
  findSession(sessionId: string): Promise<SessionInfo | null>;
  read(session: SessionInfo): Promise<IREntry[]>;
  write(entries: IREntry[], targetCwd: string): Promise<string>;
  getResumeCommand(
    sessionId: string,
    targetCwd?: string,
  ): { command: string; args: string[] };
}
