import { DEFAULT_LEVELS, resolveToksVisual, type ToksLevel, type ToksVisual } from "./preferences.ts";

type SemanticTheme = { fg?: (color: "dim", value: string) => string };

/** A concrete sRGB color in the shape host Pi accepts for `theme.style(text, { fg })`. */
export interface ThemeColorLike {
  kind: "rgb";
  r: number;
  g: number;
  b: number;
}

/**
 * Host theme surface. Newer Pi exposes `style()` for concrete `Color` values; older Pi only
 * exposes `getColorMode()`. With neither, colors render as plain text.
 */
export type ThemeLike = SemanticTheme & {
  getColorMode?: () => string;
  style?: (text: string, options: { fg: ThemeColorLike }) => string;
};

export interface FooterSpeedometer {
  tps: number;
  live?: boolean;
  lastActivityAt?: number;
  /** Highest valid rolling one-second estimate seen during this response. */
  peak?: number;
}

function tps(value: number | undefined): string {
  return value !== undefined && Number.isFinite(value) && value >= 0 ? `${value === 0 ? "0" : value.toFixed(value >= 10 ? 0 : 1)}` : "—";
}

function peakTps(value: number | undefined): string {
  return value !== undefined && Number.isFinite(value) && value >= 0 ? `${value === 0 ? "0" : value.toFixed(value >= 10 ? 0 : 1)}↑` : "";
}

/** Highest level whose `min` the speed has reached; a speed below every `min` stays at level 0. */
export function toksLevelIndex(tps: number, levels: readonly ToksLevel[]): number {
  let index = 0;
  for (let i = 0; i < levels.length; i++) if (tps >= levels[i]!.min) index = i;
  return index;
}

// Concrete, theme-independent hues. Each level carries its own color; foreground-only, reset with SGR 39.
type Rgb = readonly [number, number, number];
function hexToRgb(hex: string | undefined): Rgb | undefined {
  const match = typeof hex === "string" ? /^#([0-9a-f]{6})$/i.exec(hex.trim()) : undefined;
  if (!match) return undefined;
  const value = match[1]!;
  return [parseInt(value.slice(0, 2), 16), parseInt(value.slice(2, 4), 16), parseInt(value.slice(4, 6), 16)];
}
const BLINK_PERIODS = [1400, 1200, 1000, 800, 600] as const;
const SINGLE_BLINK_PERIODS = [400, 400, 400, 300, 150] as const;
const CHASE_STEPS = [600, 500, 400, 300, 200] as const;
const CHASE_BASE_FACTOR = 0.55;
const BRIGHT_MS = 200;
const ACTIVE_SQUARE = "■";
const INACTIVE_SQUARE = "□";
const XTERM_CUBE = [0, 95, 135, 175, 215, 255] as const;
const XTERM_GRAY = Array.from({ length: 24 }, (_, step) => 8 + step * 10);
const ANSI256_CACHE = new Map<number, number>();

function levelRgb(levels: readonly ToksLevel[], index: number): Rgb {
  return hexToRgb(levels[index]?.color) ?? hexToRgb(DEFAULT_LEVELS[Math.min(index, DEFAULT_LEVELS.length - 1)]!.color)!;
}

/** Nearest real xterm-256 index for a concrete sRGB color (16-255). */
export function ansi256Index(r: number, g: number, b: number): number {
  const key = (r << 16) | (g << 8) | b;
  const cached = ANSI256_CACHE.get(key);
  if (cached !== undefined) return cached;
  // Real xterm 256-color palette: a 6x6x6 cube on [0,95,135,175,215,255] plus a 24-step gray ramp.
  let bestIndex = 16;
  let bestDistance = Infinity;
  for (let ri = 0; ri < 6; ri++) {
    for (let gi = 0; gi < 6; gi++) {
      for (let bi = 0; bi < 6; bi++) {
        const distance = (XTERM_CUBE[ri]! - r) ** 2 + (XTERM_CUBE[gi]! - g) ** 2 + (XTERM_CUBE[bi]! - b) ** 2;
        if (distance < bestDistance) {
          bestDistance = distance;
          bestIndex = 16 + 36 * ri + 6 * gi + bi;
        }
      }
    }
  }
  for (let step = 0; step < XTERM_GRAY.length; step++) {
    const gray = XTERM_GRAY[step]!;
    const distance = (gray - r) ** 2 + (gray - g) ** 2 + (gray - b) ** 2;
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = 232 + step;
    }
  }
  ANSI256_CACHE.set(key, bestIndex);
  return bestIndex;
}

/** Capability-aware concrete foreground: host `style()`, then `getColorMode()`, else plain text. */
function colorFg(theme: ThemeLike | undefined, rgb: Rgb, value: string): string {
  if (!theme) return value;
  const [r, g, b] = rgb;
  if (typeof theme.style === "function") {
    try {
      return theme.style(value, { fg: { kind: "rgb", r, g, b } });
    } catch {
      // Fall through to the capability fallback below.
    }
  }
  const mode = theme.getColorMode?.();
  if (mode === "truecolor") return `\x1b[38;2;${r};${g};${b}m${value}\x1b[39m`;
  if (mode === "256color") return `\x1b[38;5;${ansi256Index(r, g, b)}m${value}\x1b[39m`;
  return value;
}

interface VisualState {
  active: boolean;
  bright: boolean;
  levelIndex: number;
}

/** Shared activity/phase rules for all visuals: idle and stalls are inactive, never a stale glow. */
function visualState(speedometer: FooterSpeedometer, steady: boolean | undefined, now: number, levels: readonly ToksLevel[], visual: ToksVisual): VisualState {
  const levelIndex = toksLevelIndex(speedometer.tps, levels);
  const active = speedometer.tps > 0 && (!speedometer.live || speedometer.lastActivityAt === undefined || now - speedometer.lastActivityAt < 600);
  const periods = visual === "dot" ? SINGLE_BLINK_PERIODS : BLINK_PERIODS;
  const period = periods[Math.min(levelIndex, periods.length - 1)]!;
  const brightMs = visual === "dot" ? Math.min(BRIGHT_MS, period / 2) : BRIGHT_MS;
  const bright = active && (steady || !speedometer.live || now % period < brightMs);
  return { active, bright, levelIndex };
}

function dotText(speedometer: FooterSpeedometer, theme: ThemeLike | undefined, state: VisualState, levels: readonly ToksLevel[]): string {
  return state.bright ? colorFg(theme, levelRgb(levels, state.levelIndex), "■") : fg(theme, "dim", "■");
}

/** One stable position per level; all lit squares share the current level color and blink together. */
function squaresText(speedometer: FooterSpeedometer, theme: ThemeLike | undefined, state: VisualState, levels: readonly ToksLevel[]): string {
  const activeCount = state.active ? state.levelIndex + 1 : 0;
  let out = "";
  for (let i = 0; i < levels.length; i++) {
    if (i < activeCount) {
      out += state.bright ? colorFg(theme, levelRgb(levels, state.levelIndex), ACTIVE_SQUARE) : fg(theme, "dim", ACTIVE_SQUARE);
    } else {
      out += fg(theme, "dim", INACTIVE_SQUARE);
    }
  }
  return out;
}

function dimRgb(rgb: Rgb, factor: number): Rgb {
  return [Math.round(rgb[0] * factor), Math.round(rgb[1] * factor), Math.round(rgb[2] * factor)];
}

/** A brighter highlight moves through the lit squares, faster at higher speed levels. */
function chaseText(speedometer: FooterSpeedometer, theme: ThemeLike | undefined, state: VisualState, steady: boolean | undefined, now: number, levels: readonly ToksLevel[]): string {
  const activeCount = state.active ? state.levelIndex + 1 : 0;
  const brightRgb = levelRgb(levels, state.levelIndex);
  const baseRgb = dimRgb(brightRgb, CHASE_BASE_FACTOR);
  const step = CHASE_STEPS[Math.min(state.levelIndex, CHASE_STEPS.length - 1)]!;
  let highlight: number;
  if (activeCount === 1) highlight = state.bright ? 0 : -1;
  else if (!speedometer.live) highlight = 0;
  else highlight = Math.floor(now / step) % activeCount;
  let out = "";
  for (let i = 0; i < levels.length; i++) {
    if (i >= activeCount) out += fg(theme, "dim", INACTIVE_SQUARE);
    else out += colorFg(theme, steady || i === highlight ? brightRgb : baseRgb, ACTIVE_SQUARE);
  }
  return out;
}

function visualText(speedometer: FooterSpeedometer, theme: ThemeLike | undefined, state: VisualState, visual: ToksVisual, steady: boolean | undefined, now: number, levels: readonly ToksLevel[]): string {
  if (visual === "squares") return squaresText(speedometer, theme, state, levels);
  if (visual === "chase") return chaseText(speedometer, theme, state, steady, now, levels);
  return dotText(speedometer, theme, state, levels);
}

function fg(theme: ThemeLike | undefined, color: "dim", value: string): string {
  return theme?.fg?.(color, value) ?? value;
}

export interface SpeedometerOptions {
  /** Saved visual identifier; missing values use a single square. */
  visual?: ToksVisual;
  /** Live numeric rate can be zero while the visual holds its completed reading. */
  currentTps?: number | undefined;
  /** Speed bands with colors; missing values use the built-in defaults. */
  levels?: readonly ToksLevel[] | undefined;
}

export function speedometerText(speedometer: FooterSpeedometer | undefined, theme?: ThemeLike, compact?: boolean, ledOnly?: boolean | undefined, steady?: boolean, now = Date.now(), peakEnabled = true, options: SpeedometerOptions = {}): string {
  if (!speedometer || !Number.isFinite(speedometer.tps) || speedometer.tps < 0) return "";
  const levels = options.levels ?? DEFAULT_LEVELS;
  const visual = resolveToksVisual(options.visual);
  const meterText = compact ? "" : visualText(speedometer, theme, visualState(speedometer, steady, now, levels, visual), visual, steady, now, levels);
  const peak = peakEnabled ? peakTps(speedometer.peak) : "";
  const numbersEnabled = ledOnly === false || (compact === true && ledOnly === undefined);
  const current = numbersEnabled ? tps(options.currentTps ?? speedometer.tps) : "";
  const values = [current, peak].filter(Boolean).join("/");
  const readings = values ? fg(theme, "dim", `${values} t/s`) : "";
  return [meterText, readings].filter(Boolean).join(" ");
}
