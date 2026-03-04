import { randomUUID } from "node:crypto";

export function uuid(): string {
  return randomUUID();
}

export function isoNow(): string {
  return new Date().toISOString();
}

/** Encode an absolute path the way Claude does for project directories.
 *  e.g. "/Users/foo/bar" → "-Users-foo-bar" */
export function encodeClaudePath(absPath: string): string {
  return absPath.replace(/\//g, "-");
}

/** Decode a Claude-style encoded path back to an absolute path. */
export function decodeClaudePath(encoded: string): string {
  // "-Users-foo-bar" → "/Users/foo/bar"
  return encoded.replace(/^-/, "/").replace(/-/g, "/");
}

/** Check if `candidate` is a prefix of `full` (for short-id matching). */
export function isIdPrefix(candidate: string, full: string): boolean {
  return full.toLowerCase().startsWith(candidate.toLowerCase());
}
