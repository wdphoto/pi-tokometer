import type { ToksLevel } from "./preferences.ts";

export interface RevReading { tps: number; gear: number }

/** Session-local gear hysteresis. Rendering remains stateless. */
export class RevTracker {
  private reading: RevReading = { tps: 0, gear: 0 };
  private signature = "";

  reset() { this.reading = { tps: 0, gear: 0 }; this.signature = ""; }

  update(tps: number, levels: readonly ToksLevel[], live: boolean): RevReading {
    const signature = JSON.stringify(levels);
    if (signature !== this.signature) { this.reset(); this.signature = signature; }
    let target = 0;
    for (let i = 0; i < levels.length; i++) if (tps >= levels[i]!.min) target = i;
    let gear = this.reading.gear;
    // Pauses retain the gear, but zero the fill. Completion uses the exact final band.
    if (!live || tps > 0) {
      if (!live || target >= gear) gear = target;
      else {
        const boundary = levels[gear]!.min;
        const previous = levels.slice(0, gear).reverse().find(level => level.min < boundary)?.min ?? 0;
        if (tps < boundary - (boundary - previous) * 0.05) gear = target;
      }
    }
    this.reading = { tps, gear };
    return this.reading;
  }
}

/** Top gear spans at least its minimum, the previous gap, or 10 t/s. */
export function revFill(reading: RevReading, levels: readonly ToksLevel[]): number {
  if (reading.tps <= 0 || !levels.length) return 0;
  const lower = levels[reading.gear]!.min;
  const previous = levels.slice(0, reading.gear).reverse().find(level => level.min < lower)?.min ?? 0;
  const span = levels[reading.gear + 1]
    ? levels[reading.gear + 1]!.min - lower
    : Math.max(10, lower, lower - previous);
  const progress = Math.max(0, Math.min(1, (reading.tps - lower) / (span > 0 ? span : 1)));
  return Math.min(5, 1 + Math.floor(progress * 5));
}
