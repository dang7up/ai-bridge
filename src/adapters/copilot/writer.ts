import { join } from "node:path";
import { writeFile } from "node:fs/promises";
import YAML from "yaml";

import type { IREntry, IRSessionMeta } from "../../types.js";
import { ensureDir, writeJsonl } from "../../utils/fs.js";
import { uuid, isoNow } from "../../utils/id.js";
import { getAdapter, listSupportedTools } from "../registry.js";
import { COPILOT_BASE } from "./utils.js";
import type { CopilotEvent, CopilotWorkspace } from "./utils.js";

const COPILOT_SCHEMA_VERSION = 1;
const COPILOT_PRODUCER = "copilot-agent";
const COPILOT_VERSION = "ai-bridge";

/**
 * Write IR entries as a new Copilot session.
 * Creates the directory structure under COPILOT_BASE and returns the new session ID.
 */
export async function writeCopilotSession(
  entries: IREntry[],
  targetCwd: string,
): Promise<string> {
  const sessionId = uuid();
  const sessionDir = join(COPILOT_BASE, sessionId);
  await ensureDir(sessionDir);

  const meta = entries.find((e) => e.type === "session_meta");
  const now = isoNow();
  const createdAt =
    meta?.type === "session_meta" ? normalizeDateTime(meta.created_at, now) : now;

  // ── workspace.yaml ────────────────────────────────────────

  const workspace: CopilotWorkspace = {
    id: sessionId,
    cwd: targetCwd,
    git_root: targetCwd,
    name: meta?.type === "session_meta" ? meta.title : undefined,
    summary: meta?.type === "session_meta" ? meta.title : undefined,
    summary_count: 0,
    branch: meta?.type === "session_meta" ? meta.git_branch : undefined,
    created_at: createdAt,
    updated_at: now,
  };

  const yamlContent = YAML.stringify(workspace, { lineWidth: 0 });
  await writeFile(join(sessionDir, "workspace.yaml"), yamlContent, "utf-8");

  // ── events.jsonl ──────────────────────────────────────────

  const events = convertToEvents(entries, sessionId, targetCwd);
  await writeJsonl(join(sessionDir, "events.jsonl"), events);
  await mirrorToAiden(entries, targetCwd, sessionId);

  return sessionId;
}

// ── Internal helpers ──────────────────────────────────────────

function convertToEvents(
  entries: IREntry[],
  sessionId: string,
  cwd: string,
): CopilotEvent[] {
  const events: CopilotEvent[] = [];
  let prevId: string | null = null;
  let fallbackTimestamp = isoNow();
  const seenToolCalls = new Set<string>();

  function pushEvent(event: CopilotEvent): void {
    events.push(event);
    prevId = event.id;
  }

  function makeAssistantToolRequestEvent(
    timestamp: string,
    toolCallId: string,
    toolName: string,
    args: unknown,
  ): CopilotEvent {
    return {
      type: "assistant.message",
      id: uuid(),
      timestamp,
      parentId: prevId,
      data: {
        messageId: uuid(),
        content: "",
        toolRequests: [
          {
            toolCallId,
            name: toolName,
            arguments: args,
            type: "function",
          },
        ],
      },
    };
  }

  function makeToolStartEvent(
    timestamp: string,
    toolCallId: string,
    toolName: string,
    args: unknown,
  ): CopilotEvent {
    return {
      type: "tool.execution_start",
      id: uuid(),
      timestamp,
      parentId: prevId,
      data: {
        toolCallId,
        toolName,
        arguments: args,
      },
    };
  }

  for (const entry of entries) {
    const ts = normalizeDateTime(
      entry.type === "session_meta" ? entry.created_at : entry.timestamp,
      fallbackTimestamp,
    );
    fallbackTimestamp = ts;

    switch (entry.type) {
      case "session_meta":
        pushEvent({
          type: "session.start",
          id: uuid(),
          timestamp: ts,
          parentId: prevId,
          data: {
            sessionId,
            version: COPILOT_SCHEMA_VERSION,
            producer: COPILOT_PRODUCER,
            copilotVersion: COPILOT_VERSION,
            startTime: ts,
            selectedModel: entry.model,
            context: {
              cwd,
              gitRoot: cwd,
              branch: entry.git_branch ?? "",
              repository: "",
            },
          },
        });
        break;

      case "user_message":
        pushEvent({
          type: "user.message",
          id: uuid(),
          timestamp: ts,
          parentId: prevId,
          data: {
            content: entry.content,
            transformedContent: entry.content,
            attachments: [],
          },
        });
        break;

      case "assistant_message":
        pushEvent({
          type: "assistant.message",
          id: uuid(),
          timestamp: ts,
          parentId: prevId,
          data: {
            messageId: uuid(),
            content: entry.content,
            toolRequests: [],
          },
        });
        break;

      case "tool_call": {
        const args = safeParseJson(entry.arguments);
        const toolCallId = entry.tool_call_id;
        const toolName = entry.tool_name;
        pushEvent(makeAssistantToolRequestEvent(ts, toolCallId, toolName, args));
        pushEvent(makeToolStartEvent(ts, toolCallId, toolName, args));
        seenToolCalls.add(toolCallId);
        break;
      }

      case "tool_result":
        if (!seenToolCalls.has(entry.tool_call_id)) {
          const fallbackArgs = {};
          const fallbackToolName = "unknown_tool";
          pushEvent(
            makeAssistantToolRequestEvent(
              ts,
              entry.tool_call_id,
              fallbackToolName,
              fallbackArgs,
            ),
          );
          pushEvent(
            makeToolStartEvent(ts, entry.tool_call_id, fallbackToolName, fallbackArgs),
          );
          seenToolCalls.add(entry.tool_call_id);
        }

        pushEvent({
          type: "tool.execution_complete",
          id: uuid(),
          timestamp: ts,
          parentId: prevId,
          data: {
            toolCallId: entry.tool_call_id,
            success: true,
            result: normalizeToolResult(entry.output),
            toolTelemetry: {},
          },
        });
        break;
    }
  }

  return events;
}

async function mirrorToAiden(
  entries: IREntry[],
  targetCwd: string,
  sessionId: string,
): Promise<void> {
  const tools = await listSupportedTools();
  if (!tools.includes("aiden")) return;

  const aidenEntries = withSessionId(entries, sessionId, targetCwd);
  const aidenAdapter = await getAdapter("aiden");
  await aidenAdapter.write(aidenEntries, targetCwd);
}

function withSessionId(entries: IREntry[], sessionId: string, cwd: string): IREntry[] {
  const metaIndex = entries.findIndex((entry) => entry.type === "session_meta");
  if (metaIndex === -1) {
    const syntheticMeta: IRSessionMeta = {
      ir_version: "1",
      type: "session_meta",
      source_tool: "copilot",
      source_session_id: sessionId,
      cwd,
      created_at: isoNow(),
    };
    return [syntheticMeta, ...entries];
  }

  return entries.map((entry, index) => {
    if (index !== metaIndex || entry.type !== "session_meta") return entry;
    return {
      ...entry,
      source_session_id: sessionId,
      cwd: entry.cwd || cwd,
    } satisfies IRSessionMeta;
  });
}

/** Try to parse a JSON string; return the original string if it fails. */
function safeParseJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

function normalizeDateTime(value: string | undefined, fallback: string): string {
  if (!value) return fallback;
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return fallback;
  return new Date(parsed).toISOString();
}

function normalizeToolResult(output: string): { content: string; detailedContent?: string } {
  const parsed = safeParseJson(output);
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    const obj = parsed as Record<string, unknown>;
    const content = typeof obj.content === "string" ? obj.content : undefined;
    const detailed = typeof obj.detailedContent === "string" ? obj.detailedContent : undefined;
    if (content || detailed) {
      return {
        content: content ?? output,
        detailedContent: detailed,
      };
    }
  }

  return { content: output };
}
