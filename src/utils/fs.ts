import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

export async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
}

export async function readJsonl<T = unknown>(path: string): Promise<T[]> {
  const text = await readFile(path, "utf-8");
  return text
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as T);
}

export async function writeJsonl(path: string, entries: unknown[]): Promise<void> {
  await ensureDir(dirname(path));
  const content = entries.map((e) => JSON.stringify(e)).join("\n") + "\n";
  await writeFile(path, content, "utf-8");
}

export async function readJson<T = unknown>(path: string): Promise<T> {
  const text = await readFile(path, "utf-8");
  return JSON.parse(text) as T;
}

export async function writeJson(path: string, data: unknown): Promise<void> {
  await ensureDir(dirname(path));
  await writeFile(path, JSON.stringify(data, null, 2) + "\n", "utf-8");
}

export async function fileExists(path: string): Promise<boolean> {
  try {
    await readFile(path);
    return true;
  } catch {
    return false;
  }
}
