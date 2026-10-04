import test from "node:test";
import assert from "node:assert/strict";
import { visibleWidth } from "@earendil-works/pi-tui";
import { DEFAULT_LEVELS } from "../extensions/tokometer/preferences.ts";
import { TachTracker, tachFill } from "../extensions/tokometer/tach.ts";
import { speedometerText } from "../extensions/tokometer/ui.ts";

const theme = { getColorMode: () => "truecolor" };
test("tach fills within each band and resets at an upshift, with a bounded top gear", () => {
  const tracker = new TachTracker();
  for (const [speed, gear, fill] of [[1, 0, 1], [9, 0, 5], [10, 1, 1], [30, 1, 2], [70, 1, 4], [99, 1, 5], [100, 2, 1], [150, 2, 3], [199, 2, 5], [200, 3, 1], [350, 3, 3], [499, 3, 5], [500, 4, 1], [750, 4, 3], [1000, 4, 5]]) {
    const reading = tracker.update(speed!, DEFAULT_LEVELS, true);
    assert.equal(reading.gear, gear);
    assert.equal(tachFill(reading, DEFAULT_LEVELS), fill);
    const text = speedometerText({ tps: speed!, peak: 1000 }, theme, false, false, false, 0, true, { visual: "tach", tach: reading });
    assert.equal(visibleWidth(text), 20);
    assert.equal(text.split("■").length - 1, fill);
  }
});

test("tach resists boundary jitter, skips gears, retains gear on silence and resets", () => {
  const tracker = new TachTracker();
  assert.equal(tracker.update(102, DEFAULT_LEVELS, true).gear, 2);
  for (const speed of [99, 98, 95.5]) assert.equal(tracker.update(speed, DEFAULT_LEVELS, true).gear, 2);
  assert.equal(tracker.update(95.4, DEFAULT_LEVELS, true).gear, 1);
  assert.equal(tracker.update(300, DEFAULT_LEVELS, true).gear, 3);
  assert.equal(tracker.update(30, DEFAULT_LEVELS, true).gear, 1);
  const paused = tracker.update(0, DEFAULT_LEVELS, true);
  assert.equal(paused.gear, 1);
  assert.equal(tachFill(paused, DEFAULT_LEVELS), 0);
  assert.equal(tracker.update(102, DEFAULT_LEVELS, true).gear, 2);
  assert.equal(tracker.update(99, DEFAULT_LEVELS, false).gear, 1);
  tracker.reset();
  assert.equal(tracker.update(99, DEFAULT_LEVELS, true).gear, 1);
});

test("tach paints a dark-to-bright ladder within each gear", () => {
  const red = ["109;63;76", "146;83;101", "182;104;126", "219;125;151", "243;139;168"];
  const block = (rgb: string) => `\x1b[38;2;${rgb}m■\x1b[39m`;
  for (const [fill, tps] of [[1, 1], [2, 3], [3, 5], [4, 7], [5, 9]] as const) {
    const expected = red.slice(0, fill).map(block).join("") + "□".repeat(5 - fill);
    assert.ok(speedometerText({ tps }, theme, false, false, false, 0, true, { visual: "tach" }).startsWith(expected), `fill ${fill}`);
  }
  // A custom gear drives its own ladder.
  const levels = [{ min: 0, color: "#00ff00" }];
  assert.ok(speedometerText({ tps: 5 }, theme, false, false, false, 0, true, { visual: "tach", levels }).startsWith("\x1b[38;2;0;115;0m■\x1b[39m"));
});

test("tach uses custom colors and thresholds but always five blocks", () => {
  const levels = [{ min: 0, color: "#ff0000" }, { min: 100, color: "#00ff00" }];
  const tracker = new TachTracker();
  const render = (speed: number, now = 0, live = false) => speedometerText({ tps: speed, live, lastActivityAt: 0 }, theme, false, true, false, now, true, { visual: "tach", levels, tach: tracker.update(speed, levels, live) });
  assert.equal(render(50), "\x1b[38;2;115;0;0m■\x1b[39m\x1b[38;2;153;0;0m■\x1b[39m\x1b[38;2;191;0;0m■\x1b[39m□□");
  assert.equal(render(100), "\x1b[38;2;0;115;0m■\x1b[39m□□□□");
  assert.equal(render(200), ["0;115;0", "0;153;0", "0;191;0", "0;230;0", "0;255;0"].map((rgb) => `\x1b[38;2;${rgb}m■\x1b[39m`).join(""));
  assert.equal(render(200, 600, true), "□□□□□");
  assert.equal(render(0), "□□□□□");
  // Settings replacement cannot leave an out-of-range gear behind.
  const single = [{ min: 0, color: "#123456" }];
  assert.equal(tracker.update(5, single, true).gear, 0);
  assert.equal(tachFill(tracker.update(10, single, true), single), 5);
  const duplicates = [{ min: 0, color: "#ff0000" }, { min: 0, color: "#00ff00" }, { min: 0.5, color: "#0000ff" }];
  assert.equal(tachFill(tracker.update(0.4, duplicates, true), duplicates), 5);
});
