import { resolveToksVisual, type ToksVisual } from "./preferences.ts";

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
  return value !== undefined && Number.isFinite(value) && value >= 0 ? `${value.toFixed(value >= 10 ? 0 : 1)} tok/s` : "—";
}

function peakTps(value: number | undefined): string {
  return value !== undefined && Number.isFinite(value) && value > 0 ? `${value.toFixed(value >= 10 ? 0 : 1)} peak tok/s` : "";
}

/** Six tiers: 0-<10, 10-<20, 20-<60, 60-<120, 120-<300, 300+. */
export function speedometerStage(value: number): number {
  return [10, 20, 60, 120, 300].filter((threshold) => value >= threshold).length;
}

// Concrete, theme-independent hues. Below 5 tok/s is a deeper red; 5-<10 stays red on the same
// 1400ms tier; then pink, green, teal, blue, and violet. Foreground-only, reset with SGR 39.
type Rgb = readonly [number, number, number];
const DEEP_RED: Rgb = [192, 57, 43];
const TIER_RGB: readonly Rgb[] = [
  [231, 76, 60],   // red
  [255, 126, 182], // light red / pink
  [46, 204, 113],  // green
  [26, 188, 156],  // teal
  [52, 152, 219],  // blue
  [155, 89, 182],  // violet
];
const BLINK_PERIODS = [1400, 1200, 1000, 800, 600, 400] as const;
const CHASE_STEPS = [700, 600, 500, 400, 300, 200] as const;
const CHASE_BASE_FACTOR = 0.55;
const BRIGHT_MS = 200;
const SQUARE_COUNT = 6;
const ACTIVE_SQUARE = "■";
const INACTIVE_SQUARE = "□";
const XTERM_CUBE = [0, 95, 135, 175, 215, 255] as const;
const XTERM_GRAY = Array.from({ length: 24 }, (_, step) => 8 + step * 10);
const ANSI256_CACHE = new Map<number, number>();

function tierRgb(tps: number, stageIndex: number): Rgb {
  if (stageIndex === 0) return tps < 5 ? DEEP_RED : TIER_RGB[0]!;
  return TIER_RGB[stageIndex] ?? TIER_RGB[TIER_RGB.length - 1]!;
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
  stageIndex: number;
}

/** Shared activity/phase rules for both visuals: idle and stalls are inactive, never a stale glow. */
function visualState(speedometer: FooterSpeedometer, steady: boolean | undefined, now: number): VisualState {
  const stageIndex = speedometerStage(speedometer.tps);
  const active = speedometer.tps > 0 && (!speedometer.live || speedometer.lastActivityAt === undefined || now - speedometer.lastActivityAt < 600);
  const period = BLINK_PERIODS[stageIndex] ?? BLINK_PERIODS[BLINK_PERIODS.length - 1]!;
  const bright = active && (steady || !speedometer.live || now % period < BRIGHT_MS);
  return { active, bright, stageIndex };
}

function dotText(speedometer: FooterSpeedometer, theme: ThemeLike | undefined, state: VisualState): string {
  return state.bright ? colorFg(theme, tierRgb(speedometer.tps, state.stageIndex), "●") : fg(theme, "dim", "●");
}

/** Six stable positions; all active squares share the current tier color and blink together. */
function squaresText(speedometer: FooterSpeedometer, theme: ThemeLike | undefined, state: VisualState): string {
  const activeCount = state.active ? state.stageIndex + 1 : 0;
  let out = "";
  for (let i = 0; i < SQUARE_COUNT; i++) {
    if (i < activeCount) {
      out += state.bright ? colorFg(theme, tierRgb(speedometer.tps, state.stageIndex), ACTIVE_SQUARE) : fg(theme, "dim", ACTIVE_SQUARE);
    } else {
      out += fg(theme, "dim", INACTIVE_SQUARE);
    }
  }
  return out;
}

function dimRgb(rgb: Rgb, factor: number): Rgb {
  return [Math.round(rgb[0] * factor), Math.round(rgb[1] * factor), Math.round(rgb[2] * factor)];
}

function inactiveSquares(theme: ThemeLike | undefined): string {
  let out = "";
  for (let i = 0; i < SQUARE_COUNT; i++) out += fg(theme, "dim", INACTIVE_SQUARE);
  return out;
}

/**
 * Chase: a brighter highlight moves left-to-right within the lit positions while the other lit squares keep
 * a subtler tier hue. Motion speeds up by tier; a single lit square pulses on the squares blink period, and
 * the completed meter holds a static highlight. Steady mode colors every lit square without a highlight.
 */
function chaseText(speedometer: FooterSpeedometer, theme: ThemeLike | undefined, state: VisualState, steady: boolean | undefined, now: number): string {
  const activeCount = state.active ? state.stageIndex + 1 : 0;
  if (activeCount === 0) return inactiveSquares(theme);
  const brightRgb = tierRgb(speedometer.tps, state.stageIndex);
  if (steady) {
    let out = "";
    for (let i = 0; i < SQUARE_COUNT; i++) out += i < activeCount ? colorFg(theme, brightRgb, ACTIVE_SQUARE) : fg(theme, "dim", INACTIVE_SQUARE);
    return out;
  }
  const baseRgb = dimRgb(brightRgb, CHASE_BASE_FACTOR);
  const step = CHASE_STEPS[state.stageIndex] ?? CHASE_STEPS[CHASE_STEPS.length - 1]!;
  let highlight: number;
  if (activeCount === 1) highlight = state.bright ? 0 : -1;
  else if (!speedometer.live) highlight = 0; // completion hold: no moving highlight
  else highlight = Math.floor(now / step) % activeCount;
  let out = "";
  for (let i = 0; i < SQUARE_COUNT; i++) {
    if (i >= activeCount) out += fg(theme, "dim", INACTIVE_SQUARE);
    else out += i === highlight ? colorFg(theme, brightRgb, ACTIVE_SQUARE) : colorFg(theme, baseRgb, ACTIVE_SQUARE);
  }
  return out;
}

function visualText(speedometer: FooterSpeedometer, theme: ThemeLike | undefined, state: VisualState, visual: ToksVisual, steady: boolean | undefined, now: number): string {
  if (visual === "squares") return squaresText(speedometer, theme, state);
  if (visual === "chase") return chaseText(speedometer, theme, state, steady, now);
  return dotText(speedometer, theme, state);
}

function fg(theme: ThemeLike | undefined, color: "dim", value: string): string {
  return theme?.fg?.(color, value) ?? value;
}

export interface SpeedometerOptions {
  /** Visual meter style; missing values fall back to the dot. */
  visual?: ToksVisual;
}

export function speedometerText(speedometer: FooterSpeedometer | undefined, theme?: ThemeLike, compact?: boolean, ledOnly?: boolean | undefined, steady?: boolean, now = Date.now(), peakEnabled = true, options: SpeedometerOptions = {}): string {
  if (!speedometer || !Number.isFinite(speedometer.tps) || speedometer.tps < 0) return "";
  if (compact === true) return fg(theme, "dim", tps(speedometer.tps));
  // Layout is tri-state: LED dot only by default; `ledOnly === false` opts into full (dot + number).
  const visual = resolveToksVisual(options.visual);
  const meterText = visualText(speedometer, theme, visualState(speedometer, steady, now), visual, steady, now);
  const peak = peakEnabled ? peakTps(speedometer.peak) : "";
  const peakText = peak ? fg(theme, "dim", peak) : "";
  if (ledOnly !== false) return peakText ? `${meterText} ${peakText}` : meterText;
  const current = fg(theme, "dim", tps(speedometer.tps));
  return peakText ? `${meterText} ${current} · ${peakText}` : `${meterText} ${current}`;
}
