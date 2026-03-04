import { join } from "node:path";
import { homedir } from "node:os";
import { readdir } from "node:fs/promises";
import { Dirent } from "node:fs";

/** Root directory for Codex session storage. */
export const CODEX_BASE = join(homedir(), ".codex", "sessions");

/**
 * Recursively find all rollout-*.jsonl files under the given directory.
 * Returns absolute paths sorted newest-first by filename (which embeds a
 * timestamp).
 */
export async function findRolloutFiles(baseDir: string = CODEX_BASE): Promise<string[]> {
  const results: string[] = [];
  await walk(baseDir, results);
  // Rollout filenames contain a timestamp, so reverse-sorting by name gives
  // newest first.
  results.sort((a, b) => b.localeCompare(a));
  return results;
}

async function walk(dir: string, acc: string[]): Promise<void> {
  let dirents: Dirent[];
  try {
    dirents = await readdir(dir, { withFileTypes: true }) as Dirent[];
  } catch {
    // Directory may not exist yet — that is fine.
    return;
  }
  for (const entry of dirents) {
    const name = String(entry.name);
    const full = join(dir, name);
    if (entry.isDirectory()) {
      await walk(full, acc);
    } else if (entry.isFile() && name.startsWith("rollout-") && name.endsWith(".jsonl")) {
      acc.push(full);
    }
  }
}

/**
 * Extract a session ID from a rollout filename.
 * Filename format:
 * - rollout-YYYY-MM-DDThh-mm-ss-<uuid>.jsonl (current Codex)
 * - rollout-<legacy-timestamp>-<uuid>.jsonl   (legacy writers)
 */
export function sessionIdFromFilename(filename: string): string {
  const base = filename.replace(/\.jsonl$/, "").replace(/^rollout-/, "");

  // Prefer the right-most UUID-looking suffix.
  const uuidMatch = base.match(
    /([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$/,
  );
  if (uuidMatch) return uuidMatch[1];

  // Fallback for malformed names.
  const dashIdx = base.lastIndexOf("-");
  if (dashIdx === -1) return base;
  return base.slice(dashIdx + 1);
}
