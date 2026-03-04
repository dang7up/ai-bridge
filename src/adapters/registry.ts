import { readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import type { ToolAdapter, ToolName } from "../types.js";
import { fileExists } from "../utils/fs.js";

type AdapterCtor = new () => ToolAdapter;

let cache: Map<ToolName, AdapterCtor> | null = null;
let loading: Promise<Map<ToolName, AdapterCtor>> | null = null;

function isAdapterInstance(value: unknown): value is ToolAdapter {
  if (!value || typeof value !== "object") return false;
  const v = value as Partial<ToolAdapter>;
  return (
    typeof v.name === "string" &&
    typeof v.listSessions === "function" &&
    typeof v.findSession === "function" &&
    typeof v.read === "function" &&
    typeof v.write === "function" &&
    typeof v.getResumeCommand === "function"
  );
}

function getReaderCandidates(dir: string): string[] {
  return [join(dir, "reader.js"), join(dir, "reader.ts")];
}

async function importReaderModule(dir: string): Promise<Record<string, unknown> | null> {
  for (const candidate of getReaderCandidates(dir)) {
    if (!(await fileExists(candidate))) continue;
    return (await import(pathToFileURL(candidate).href)) as Record<string, unknown>;
  }
  return null;
}

async function loadAdaptersFromDir(
  adaptersDir: string,
  map: Map<ToolName, AdapterCtor>
): Promise<void> {
  const entries = await readdir(adaptersDir, { withFileTypes: true });
  const dirs = entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => entry.name)
    .sort();

  for (const dirName of dirs) {
    const readerDir = join(adaptersDir, dirName);
    const readerModule = await importReaderModule(readerDir);
    if (!readerModule) continue;

    for (const exported of Object.values(readerModule)) {
      if (typeof exported !== "function") continue;

      let instance: ToolAdapter | null = null;
      try {
        instance = new (exported as AdapterCtor)();
      } catch {
        continue;
      }
      if (!isAdapterInstance(instance)) continue;

      if (map.has(instance.name)) {
        throw new Error(`Duplicate adapter name: ${instance.name}`);
      }
      map.set(instance.name, exported as AdapterCtor);
    }
  }
}

async function loadConstructors(): Promise<Map<ToolName, AdapterCtor>> {
  const adaptersDir = dirname(fileURLToPath(import.meta.url));
  const map = new Map<ToolName, AdapterCtor>();

  // Load from root adapters directory
  await loadAdaptersFromDir(adaptersDir, map);

  // Load from private subdirectory (if exists)
  const privateDir = join(adaptersDir, "private");
  try {
    await loadAdaptersFromDir(privateDir, map);
  } catch {
    // private directory may not exist, ignore
  }

  return map;
}

async function ensureLoaded(): Promise<Map<ToolName, AdapterCtor>> {
  if (cache) return cache;
  if (!loading) {
    loading = loadConstructors().then((result) => {
      cache = result;
      return result;
    });
  }
  return loading;
}

export async function listSupportedTools(): Promise<ToolName[]> {
  const adapters = await ensureLoaded();
  return Array.from(adapters.keys());
}

export async function getAdapter(tool: ToolName): Promise<ToolAdapter> {
  const adapters = await ensureLoaded();
  const Ctor = adapters.get(tool);
  if (!Ctor) {
    const known = Array.from(adapters.keys()).join(", ");
    throw new Error(`Unknown tool: ${tool}. Supported tools: ${known}`);
  }
  return new Ctor();
}

