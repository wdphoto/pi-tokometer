import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { enqueueStoreSave, withStoreLock } from "./save-queue.ts";

export type ToksVisual = "dot" | "squares" | "chase" | "tach";
export function resolveToksVisual(value: unknown): ToksVisual {
  return value === "squares" || value === "chase" || value === "tach" ? value : "dot";
}
/** One speed band: `min` tok/s and up, shown in `color` (#rrggbb). */
export interface ToksLevel {
  min: number;
  color: string;
}
export const DEFAULT_LEVELS: readonly ToksLevel[] = [
  { min: 0, color: "#f38ba8" }, // red: slow
  { min: 10, color: "#fab387" }, // peach
  { min: 100, color: "#f9e2af" }, // yellow
  { min: 200, color: "#a6e3a1" }, // green
  { min: 500, color: "#89b4fa" }, // blue: very fast
];
/** Keep well-formed entries in ascending order; anything unusable falls back to the defaults. */
export function resolveToksLevels(value: unknown): ToksLevel[] {
  const levels = Array.isArray(value)
    ? value.flatMap((entry) => {
      const min = (entry as ToksLevel | undefined)?.min;
      const color = (entry as ToksLevel | undefined)?.color;
      return typeof min === "number" && Number.isFinite(min) && min >= 0
        && typeof color === "string" && /^#[0-9a-f]{6}$/i.test(color) ? [{ min, color }] : [];
    }).sort((a, b) => a.min - b.min)
    : [];
  return levels.length > 0 ? levels : [...DEFAULT_LEVELS];
}
export interface Preferences {
  version: 1;
  enabled: boolean;
  compact: boolean;
  visual: ToksVisual;
  levels: ToksLevel[];
}
export function defaultPreferences(): Preferences {
  return { version: 1, enabled: true, compact: false, visual: "dot", levels: [...DEFAULT_LEVELS] };
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
      visual: resolveToksVisual(raw.visual),
      levels: resolveToksLevels(raw.levels),
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
