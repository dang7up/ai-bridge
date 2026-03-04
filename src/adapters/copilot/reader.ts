import { readdir, readFile, stat } from "node:fs/promises";
import { join, basename } from "node:path";
import YAML from "yaml";

import type {
  ToolAdapter,
  SessionInfo,
  IREntry,
  IRSessionMeta,
  IRUserMessage,
  IRAssistantMessage,
  IRToolCall,
  IRToolResult,
} from "../../types.js";
import { readJsonl, fileExists } from "../../utils/fs.js";
import { isIdPrefix } from "../../utils/id.js";
import { COPILOT_BASE } from "./utils.js";
import type { CopilotEvent, CopilotWorkspace } from "./utils.js";

export class CopilotAdapter implements ToolAdapter {
  readonly name = "copilot" as const;

  // ── listSessions ────────────────────────────────────────────

  async listSessions(): Promise<SessionInfo[]> {
    const sessions: SessionInfo[] = [];

    let entries: string[];
    try {
      entries = await readdir(COPILOT_BASE);
    } catch {
      return sessions;
    }

    for (const entry of entries) {
      const fullPath = join(COPILOT_BASE, entry);

      // Directory-based session (contains workspace.yaml)
      const workspacePath = join(fullPath, "workspace.yaml");
      if (await fileExists(workspacePath)) {
        try {
          const raw = await readFile(workspacePath, "utf-8");
          const ws = YAML.parse(raw) as CopilotWorkspace;
          sessions.push({
            tool: "copilot",
            sessionId: ws.id ?? entry,
            title: ws.summary,
            cwd: ws.cwd,
            createdAt: ws.created_at,
            path: fullPath,
          });
        } catch {
          // Corrupted workspace.yaml — skip
        }
        continue;
      }

      // Standalone .jsonl session file
      if (entry.endsWith(".jsonl")) {
        const sessionId = basename(entry, ".jsonl");
        try {
          const info = await this.extractMetaFromJsonl(fullPath, sessionId);
          sessions.push(info);
        } catch {
          // Unreadable .jsonl — skip
          sessions.push({
            tool: "copilot",
            sessionId,
            path: fullPath,
          });
        }
      }
    }

    return sessions;
  }

  // ── findSession ─────────────────────────────────────────────

  async findSession(sessionId: string): Promise<SessionInfo | null> {
    const all = await this.listSessions();
    return all.find((s) => isIdPrefix(sessionId, s.sessionId)) ?? null;
  }

  // ── read ────────────────────────────────────────────────────

  async read(session: SessionInfo): Promise<IREntry[]> {
    const eventsPath = await this.resolveEventsPath(session.path);
    if (!eventsPath) return [];

    const raw = await readJsonl<CopilotEvent>(eventsPath);
    return this.mapEvents(raw, session);
  }

  // ── write ───────────────────────────────────────────────────

  async write(entries: IREntry[], targetCwd: string): Promise<string> {
    // Delegate to the dedicated writer module
    const { writeCopilotSession } = await import("./writer.js");
    return writeCopilotSession(entries, targetCwd);
  }

  // ── getResumeCommand ────────────────────────────────────────

  getResumeCommand(sessionId: string, _targetCwd?: string): { command: string; args: string[] } {
    return { command: "copilot", args: ["--resume", sessionId] };
  }

  // ── private helpers ─────────────────────────────────────────

  /** Determine the path to the events file, whether directory or standalone. */
  private async resolveEventsPath(sessionPath: string): Promise<string | null> {
    try {
      const s = await stat(sessionPath);
      if (s.isDirectory()) {
        const p = join(sessionPath, "events.jsonl");
        return (await fileExists(p)) ? p : null;
      }
      // Standalone .jsonl file
      if (sessionPath.endsWith(".jsonl")) return sessionPath;
    } catch {
      // path does not exist
    }
    return null;
  }

  /** Extract basic metadata from the first session.start event in a standalone .jsonl. */
  private async extractMetaFromJsonl(
    path: string,
    fallbackId: string,
  ): Promise<SessionInfo> {
    const events = await readJsonl<CopilotEvent>(path);
    const startEvent = events.find((e) => e.type === "session.start");
    const data = startEvent?.data ?? {};
    const ctx = (data.context ?? {}) as Record<string, string>;

    return {
      tool: "copilot",
      sessionId: (data.sessionId as string) ?? fallbackId,
      cwd: ctx.cwd,
      createdAt: startEvent?.timestamp ?? (data.startTime as string),
      path,
    };
  }

  /** Map Copilot events → IR entries. */
  private mapEvents(events: CopilotEvent[], session: SessionInfo): IREntry[] {
    const entries: IREntry[] = [];

    for (const evt of events) {
      switch (evt.type) {
        case "session.start": {
          const d = evt.data;
          const ctx = (d.context ?? {}) as Record<string, string>;
          const meta: IRSessionMeta = {
            ir_version: "1",
            type: "session_meta",
            source_tool: "copilot",
            source_session_id: (d.sessionId as string) ?? session.sessionId,
            cwd: ctx.cwd ?? session.cwd ?? process.cwd(),
            git_branch: ctx.branch,
            title: session.title,
            model: session.model,
            created_at: evt.timestamp ?? (d.startTime as string) ?? "",
          };
          entries.push(meta);
          break;
        }

        case "user.message": {
          const msg: IRUserMessage = {
            type: "user_message",
            timestamp: evt.timestamp,
            content: (evt.data.content as string) ?? "",
          };
          entries.push(msg);
          break;
        }

        case "assistant.message": {
          const content = (evt.data.content as string) ?? "";
          const toolRequests = evt.data.toolRequests as unknown;
          const hasToolRequests = Array.isArray(toolRequests) && toolRequests.length > 0;
          // Skip synthetic/empty tool-request wrapper messages.
          if (!content.trim() && hasToolRequests) {
            break;
          }

          const msg: IRAssistantMessage = {
            type: "assistant_message",
            timestamp: evt.timestamp,
            content,
          };
          entries.push(msg);
          break;
        }

        case "tool.execution_start": {
          const tc: IRToolCall = {
            type: "tool_call",
            timestamp: evt.timestamp,
            tool_call_id: (evt.data.toolCallId as string) ?? evt.id,
            tool_name: (evt.data.toolName as string) ?? "unknown",
            arguments:
              typeof evt.data.arguments === "string"
                ? evt.data.arguments
                : JSON.stringify(evt.data.arguments ?? {}),
          };
          entries.push(tc);
          break;
        }

        case "tool.execution_complete": {
          const tr: IRToolResult = {
            type: "tool_result",
            timestamp: evt.timestamp,
            tool_call_id: (evt.data.toolCallId as string) ?? evt.id,
            output:
              typeof evt.data.result === "string"
                ? evt.data.result
                : JSON.stringify(evt.data.result ?? ""),
          };
          entries.push(tr);
          break;
        }

        // session.resume, session.info, assistant.turn_start, assistant.turn_end → skip
        default:
          break;
      }
    }

    // If no session.start was found, synthesise a meta entry
    if (!entries.some((e) => e.type === "session_meta")) {
      entries.unshift({
        ir_version: "1",
        type: "session_meta",
        source_tool: "copilot",
        source_session_id: session.sessionId,
        cwd: session.cwd ?? process.cwd(),
        title: session.title,
        model: session.model,
        created_at: session.createdAt ?? "",
      });
    }

    return entries;
  }
}
