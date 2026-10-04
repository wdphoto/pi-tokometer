import test from "node:test";
import assert from "node:assert/strict";
import { visibleWidth } from "@earendil-works/pi-tui";
import { DEFAULT_LEVELS } from "../extensions/tokometer/preferences.ts";
import { RevTracker, revFill } from "../extensions/tokometer/rev.ts";
import { speedometerText } from "../extensions/tokometer/ui.ts";

const theme = { getColorMode: () => "truecolor" };
test("rev fills within each band and resets at an upshift, with a bounded top gear", () => {
  const tracker = new RevTracker();
  for (const [speed, gear, fill] of [[1, 0, 1], [9, 0, 5], [10, 1, 1], [18, 1, 3], [24, 1, 5], [25, 2, 1], [59, 2, 5], [60, 3, 1], [119, 3, 5], [120, 4, 1], [240, 4, 5], [1000, 4, 5]]) {
    const reading = tracker.update(speed!, DEFAULT_LEVELS, true);
    assert.equal(reading.gear, gear);
    assert.equal(revFill(reading, DEFAULT_LEVELS), fill);
    const text = speedometerText({ tps: speed!, peak: 1000 }, theme, false, false, false, 0, true, { visual: "tach", rev: reading });
    assert.equal(visibleWidth(text), 20);
    assert.equal(text.split("■").length - 1, fill);
  }
});

test("rev resists boundary jitter, skips gears, retains gear on silence and resets", () => {
  const tracker = new RevTracker();
  assert.equal(tracker.update(62, DEFAULT_LEVELS, true).gear, 3);
  for (const speed of [59, 61, 58.25]) assert.equal(tracker.update(speed, DEFAULT_LEVELS, true).gear, 3);
  assert.equal(tracker.update(58, DEFAULT_LEVELS, true).gear, 2);
  assert.equal(tracker.update(200, DEFAULT_LEVELS, true).gear, 4);
  assert.equal(tracker.update(18, DEFAULT_LEVELS, true).gear, 1);
  const paused = tracker.update(0, DEFAULT_LEVELS, true);
  assert.equal(paused.gear, 1);
  assert.equal(revFill(paused, DEFAULT_LEVELS), 0);
  assert.equal(tracker.update(62, DEFAULT_LEVELS, true).gear, 3);
  assert.equal(tracker.update(59, DEFAULT_LEVELS, false).gear, 2);
  tracker.reset();
  assert.equal(tracker.update(59, DEFAULT_LEVELS, true).gear, 2);
});

test("rev uses custom colors and thresholds but always five blocks", () => {
  const levels = [{ min: 0, color: "#ff0000" }, { min: 100, color: "#00ff00" }];
  const tracker = new RevTracker();
  const render = (speed: number, now = 0, live = false) => speedometerText({ tps: speed, live, lastActivityAt: 0 }, theme, false, true, false, now, true, { visual: "tach", levels, rev: tracker.update(speed, levels, live) });
  assert.equal(render(50), "\x1b[38;2;255;0;0m■\x1b[39m".repeat(3) + "□□");
  assert.equal(render(100), "\x1b[38;2;0;255;0m■\x1b[39m□□□□");
  assert.equal(render(200), "\x1b[38;2;0;255;0m■\x1b[39m".repeat(5));
  assert.equal(render(200, 600, true), "□□□□□");
  assert.equal(render(0), "□□□□□");
  // Settings replacement cannot leave an out-of-range gear behind.
  const single = [{ min: 0, color: "#123456" }];
  assert.equal(tracker.update(5, single, true).gear, 0);
  assert.equal(revFill(tracker.update(10, single, true), single), 5);
  const duplicates = [{ min: 0, color: "#ff0000" }, { min: 0, color: "#00ff00" }, { min: 0.5, color: "#0000ff" }];
  assert.equal(revFill(tracker.update(0.4, duplicates, true), duplicates), 5);
});
