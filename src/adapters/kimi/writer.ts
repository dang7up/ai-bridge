import { join } from "node:path";
import { createHash } from "node:crypto";
import type { IREntry } from "../../types.js";
import { writeJsonl } from "../../utils/fs.js";
import { uuid } from "../../utils/id.js";
import { KIMI_BASE } from "./utils.js";

// ── Kimi output record shapes ─────────────────────────────────

interface KimiCheckpointOut {
  role: "_checkpoint";
  id: number;
}

interface KimiUserOut {
  role: "user";
  content: string;
}

interface KimiContentBlockOut {
  type: string;
  text?: string;
  think?: string;
  encrypted?: null;
}

interface KimiToolCallOut {
  type: "function";
  id: string;
  function: { name: string; arguments: string };
}

interface KimiAssistantOut {
  role: "assistant";
  content: KimiContentBlockOut[];
  tool_calls?: KimiToolCallOut[];
}

interface KimiToolResultOut {
  role: "tool";
  tool_call_id: string;
  content: string;
}

type KimiRecordOut =
  | KimiCheckpointOut
  | KimiUserOut
  | KimiAssistantOut
  | KimiToolResultOut;

/**
 * Write a set of IR entries as a new Kimi session under KIMI_BASE.
 * Returns the generated session ID (directory name).
 */
export async function writeKimiSession(
  entries: IREntry[],
  _targetCwd: string,
): Promise<string> {
  const sessionId = uuid();
  // Kimi uses <md5-hash>/<uuid>/context.jsonl
  const hash = createHash("md5").update(_targetCwd).digest("hex");
  const sessionDir = join(KIMI_BASE, hash, sessionId);
  const contextPath = join(sessionDir, "context.jsonl");

  const records: KimiRecordOut[] = [];
  let checkpointId = 0;

  // Track the last assistant record so we can attach tool_calls to it
  let lastAssistant: KimiAssistantOut | null = null;

  const flushAssistant = (): void => {
    if (lastAssistant) {
      records.push(lastAssistant);
      lastAssistant = null;
    }
  };

  const addCheckpoint = (): void => {
    records.push({ role: "_checkpoint", id: checkpointId++ });
  };

  for (const entry of entries) {
    switch (entry.type) {
      case "session_meta":
        // No direct Kimi equivalent; skip
        break;

      case "user_message": {
        flushAssistant();
        addCheckpoint();
        const userRecord: KimiUserOut = {
          role: "user",
          content: entry.content,
        };
        records.push(userRecord);
        break;
      }

      case "assistant_message": {
        flushAssistant();
        addCheckpoint();

        const contentBlocks: KimiContentBlockOut[] = [];

        // Add thinking block if present
        if (entry.thinking) {
          contentBlocks.push({
            type: "think",
            think: entry.thinking,
            encrypted: null,
          });
        }

        // Add text content block
        if (entry.content) {
          contentBlocks.push({
            type: "text",
            text: entry.content,
          });
        }

        lastAssistant = {
          role: "assistant",
          content: contentBlocks,
        };
        break;
      }

      case "tool_call": {
        // Attach to the current (pending) assistant record, or create one
        if (!lastAssistant) {
          lastAssistant = {
            role: "assistant",
            content: [],
          };
        }
        if (!lastAssistant.tool_calls) {
          lastAssistant.tool_calls = [];
        }
        lastAssistant.tool_calls.push({
          type: "function",
          id: entry.tool_call_id,
          function: {
            name: entry.tool_name,
            arguments: entry.arguments,
          },
        });
        break;
      }

      case "tool_result": {
        // Flush any pending assistant before writing the tool result
        flushAssistant();
        const toolRecord: KimiToolResultOut = {
          role: "tool",
          tool_call_id: entry.tool_call_id,
          content: entry.output,
        };
        records.push(toolRecord);
        break;
      }
    }
  }

  // Flush any trailing assistant record
  flushAssistant();

  // Final checkpoint
  addCheckpoint();

  await writeJsonl(contextPath, records);

  return sessionId;
}
