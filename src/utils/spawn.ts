import { spawn as cpSpawn } from "node:child_process";

export interface SpawnResult {
  code: number | null;
}

/** Spawn a command, inheriting stdio so the user can interact with it. */
export function spawnInteractive(command: string, args: string[]): Promise<SpawnResult> {
  return new Promise((resolve, reject) => {
    const child = cpSpawn(command, args, { stdio: "inherit", shell: false });
    child.on("close", (code) => resolve({ code }));
    child.on("error", reject);
  });
}
