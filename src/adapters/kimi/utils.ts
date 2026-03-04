import { homedir } from "node:os";
import { join } from "node:path";
import { readdir } from "node:fs/promises";

export const KIMI_BASE = join(homedir(), ".kimi", "sessions");

export interface KimiSessionPath {
  /** Hash directory name */
  hash: string;
  /** UUID subdirectory name */
  uuid: string;
  /** Full path to context.jsonl */
  contextPath: string;
}

/**
 * List all session directories under KIMI_BASE.
 * Kimi uses a two-level structure: <hash>/<uuid>/context.jsonl
 */
export async function listSessionPaths(): Promise<KimiSessionPath[]> {
  const results: KimiSessionPath[] = [];
  try {
    const hashes = await readdir(KIMI_BASE, { withFileTypes: true });
    for (const h of hashes) {
      if (!h.isDirectory()) continue;
      const hashDir = join(KIMI_BASE, h.name);
      try {
        const uuids = await readdir(hashDir, { withFileTypes: true });
        for (const u of uuids) {
          if (!u.isDirectory()) continue;
          results.push({
            hash: h.name,
            uuid: u.name,
            contextPath: join(hashDir, u.name, "context.jsonl"),
          });
        }
      } catch {
        // skip unreadable subdirs
      }
    }
  } catch {
    // ~/.kimi/sessions doesn't exist
  }
  return results;
}
