import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const storeSaveQueues = new Map<string, Promise<unknown>>();

export function enqueueStoreSave<T>(path: string, task: () => Promise<T>): Promise<T> {
  const previous = storeSaveQueues.get(path) ?? Promise.resolve();
  const run = previous.catch(() => undefined).then(task);
  const settled = run.catch(() => undefined);
  storeSaveQueues.set(path, settled);
  void settled.then(() => {
    if (storeSaveQueues.get(path) === settled) storeSaveQueues.delete(path);
  });
  return run;
}

/** Protect the entire read/merge/write across local Pi processes, not only rename. */
export async function withStoreLock<T>(path: string, task: () => Promise<T>, timeoutMs = 5000): Promise<T> {
  await mkdir(dirname(path), { recursive: true });
  const lock = `${path}.lock`;
  const deadline = performance.now() + timeoutMs;
  for (;;) {
    try {
      await mkdir(lock, { mode: 0o700 });
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (performance.now() >= deadline) {
        // Never steal an old lock: a paused writer may still be alive.
        throw new Error(`Tokometer settings are locked: ${lock}. Retry; if it persists, close all Pi processes before removing this lock directory.`);
      }
      await delay(25);
    }
  }
  try {
    await writeFile(`${lock}/owner.json`, JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }), "utf8");
    return await task();
  } finally {
    await rm(lock, { recursive: true, force: true });
  }
}
