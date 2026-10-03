import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { enqueueStoreSave, withStoreLock } from "./save-queue.ts";

export type ToksVisual = "dot" | "squares" | "chase";
export function resolveToksVisual(value: unknown): ToksVisual {
  return value === "squares" || value === "chase" ? value : "dot";
}
export interface Preferences {
  version: 1;
  enabled: boolean;
  compact: boolean;
  ledOnly: boolean;
  steady: boolean;
  peakEnabled: boolean;
  visual: ToksVisual;
}
export function defaultPreferences(): Preferences {
  return { version: 1, enabled: true, compact: false, ledOnly: true, steady: false, peakEnabled: true, visual: "dot" };
}
export function resolvePreferencesPath(): string {
  const dir = process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
  return resolve(dir.startsWith("~/") ? join(homedir(), dir.slice(2)) : dir, "pi-tokometer.json");
}
export async function loadPreferences(path: string): Promise<Preferences> {
  let content: string;
  try { content = await readFile(path, "utf8"); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return defaultPreferences();
    throw new Error("Cannot read pi-tokometer settings; existing data has not been replaced.", { cause: error });
  }
  try {
    const raw = JSON.parse(content);
    if (!raw || typeof raw !== "object" || Array.isArray(raw) || raw.version !== 1) throw new Error("Unsupported settings");
    return {
      version: 1, enabled: raw.enabled !== false, compact: raw.compact === true,
      ledOnly: raw.ledOnly !== false, steady: raw.steady === true,
      peakEnabled: raw.peakEnabled !== false, visual: resolveToksVisual(raw.visual),
    };
  } catch (error) {
    throw new Error("Cannot load pi-tokometer settings; preserve/repair the file before changing preferences.", { cause: error });
  }
}

export async function updatePreferences(path: string, change: (current: Preferences) => Partial<Preferences>): Promise<Preferences> {
  return enqueueStoreSave(path, () => withStoreLock(path, async () => {
    const current = await loadPreferences(path);
    const next = { ...current, ...change(current), version: 1 as const };
    await mkdir(dirname(path), { recursive: true });
    const tmp = `${path}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await writeFile(tmp, `${JSON.stringify(next, null, 2)}\n`, "utf8");
      await rename(tmp, path);
    } finally { await unlink(tmp).catch(() => undefined); }
    return next;
  }));
}
