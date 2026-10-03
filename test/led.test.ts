import test from "node:test";
import assert from "node:assert/strict";
import { visibleWidth } from "@earendil-works/pi-tui";
import { AssistantSpeedTracker } from "../extensions/tokometer/speedometer.ts";
import { ansi256Index, speedometerStage, speedometerText } from "../extensions/tokometer/ui.ts";

test("LED tier boundaries cover slow through thousand-token speeds", () => {
  for (const [rate, tier] of [[0, 0], [4.9, 0], [5, 0], [9.9, 0], [10, 1], [19.9, 1], [20, 2], [59.9, 2], [60, 3], [119.9, 3], [120, 4], [299.9, 4], [300, 5], [1000, 5]]) {
    assert.equal(speedometerStage(rate!), tier);
  }
});

test("six dot tiers use a concrete distinct palette and deterministic phases", () => {
  const theme = {
    fg: (color: string, text: string) => `${color}:${text}`,
    style: (text: string, options: { fg: { r: number; g: number; b: number } }) => `${options.fg.r},${options.fg.g},${options.fg.b}:${text}`,
  };
  // [tps, concrete rgb, blink period]. Tier 0 uses a deeper red below 5 tok/s.
  const cases: [number, string, number][] = [
    [2, "192,57,43", 1400],     // deeper red
    [7, "231,76,60", 1400],     // red (same tier)
    [15, "255,126,182", 1200],  // light red / pink
    [40, "46,204,113", 1000],   // green
    [90, "26,188,156", 800],    // teal
    [200, "52,152,219", 600],   // blue
    [500, "155,89,182", 400],   // violet
  ];
  for (const [tps, rgb, period] of cases) {
    const meter = (at: number) => ({ tps, live: true, lastActivityAt: at });
    assert.equal(speedometerText(meter(0), theme, false, true, false, 0), `${rgb}:●`, `tps ${tps} bright at 0`);
    assert.equal(speedometerText(meter(199), theme, false, true, false, 199), `${rgb}:●`, `tps ${tps} bright at 199`);
    assert.equal(speedometerText(meter(200), theme, false, true, false, 200), "dim:●", `tps ${tps} dim at 200`);
    // Steady motion ignores the phase but keeps the tier color.
    assert.equal(speedometerText(meter(200), theme, false, true, true, 200), `${rgb}:●`, `tps ${tps} steady`);
    // The phase repeats after the tier's blink period.
    assert.equal(speedometerText(meter(period), theme, false, true, false, period), `${rgb}:●`, `tps ${tps} period ${period}`);
  }
  // Idle and stalled dots are neutral, never a slow red.
  assert.equal(speedometerText({ tps: 0 }, theme, false, true), "dim:●");
  assert.equal(speedometerText({ tps: 500, live: true, lastActivityAt: 1000 }, theme, false, true, false, 2000), "dim:●");
});

test("concrete palette uses host style, then capability fallback, else plain", () => {
  const truecolor = { getColorMode: () => "truecolor" };
  const index256 = { getColorMode: () => "256color" };
  // Green tier (20-<60 tok/s) as a concrete sRGB foreground.
  assert.equal(speedometerText({ tps: 40 }, truecolor, false, true), "\x1b[38;2;46;204;113m●\x1b[39m");
  const indexed = speedometerText({ tps: 40 }, index256, false, true);
  assert.match(indexed, /^\x1b\[38;5;\d+m●\x1b\[39m$/);
  // Semantic-only and no-theme hosts render plain, never a user theme's semantic role.
  assert.equal(speedometerText({ tps: 40 }, { fg: () => "green-role" }, false, true), "●");
  assert.equal(speedometerText({ tps: 40 }, {}, false, true), "●");
  assert.equal(speedometerText({ tps: 40 }, undefined, false, true), "●");
  // Tiers stay distinct even when a user theme maps semantic roles oddly.
  assert.notEqual(speedometerText({ tps: 7 }, truecolor, false, true), speedometerText({ tps: 500 }, truecolor, false, true));
  assert.notEqual(speedometerText({ tps: 7 }, truecolor, false, true), indexed);
  // Squares share the same capability path (inactive squares stay plain without a theme).
  assert.equal(
    speedometerText({ tps: 40 }, truecolor, false, true, false, 0, true, { visual: "squares" }),
    "\x1b[38;2;46;204;113m■\x1b[39m".repeat(3) + "□□□",
  );
  assert.equal(
    speedometerText({ tps: 40 }, index256, false, true, false, 0, true, { visual: "squares" }),
    "\x1b[38;5;41m■\x1b[39m".repeat(3) + "□□□",
  );
  assert.equal(speedometerText({ tps: 40 }, {}, false, true, false, 0, true, { visual: "squares" }), "■■■□□□");
  // Stateless rendering: a theme change cannot leave cached ANSI colors stale.
  const themeA = { style: (text: string, o: { fg: { r: number } }) => `A${o.fg.r}:${text}` };
  const themeB = { style: (text: string, o: { fg: { r: number } }) => `B${o.fg.r}:${text}` };
  assert.notEqual(
    speedometerText({ tps: 40 }, themeA, false, true, false, 0, true, { visual: "squares" }),
    speedometerText({ tps: 40 }, themeB, false, true, false, 0, true, { visual: "squares" }),
  );
});

test("xterm 256 fallback uses the real cube and gray ramp", () => {
  assert.equal(ansi256Index(0, 0, 0), 16);
  assert.equal(ansi256Index(255, 255, 255), 231);
  assert.equal(ansi256Index(255, 0, 0), 196);
  assert.equal(ansi256Index(0, 255, 0), 46);
  assert.equal(ansi256Index(0, 0, 255), 21);
  assert.equal(ansi256Index(128, 128, 128), 244); // gray ramp 8 + 12*10
  assert.equal(ansi256Index(8, 8, 8), 232);
  assert.equal(ansi256Index(238, 238, 238), 255);
  // Chosen tier approximations on the real palette.
  assert.equal(ansi256Index(46, 204, 113), 41);  // green cube (b=113 -> level 95)
  assert.equal(ansi256Index(155, 89, 182), 97);  // violet cube
  for (let r = 0; r <= 255; r += 17) {
    for (let g = 0; g <= 255; g += 17) {
      for (let b = 0; b <= 255; b += 17) {
        const index = ansi256Index(r, g, b);
        assert.ok(index >= 16 && index <= 255, `index ${index} out of range for ${r},${g},${b}`);
      }
    }
  }
});

test("squares show one position per tier with all active squares on the current color", () => {
  const theme = {
    fg: (color: string, text: string) => `${color}:${text}`,
    style: (text: string, options: { fg: { r: number; g: number; b: number } }) => `${options.fg.r},${options.fg.g},${options.fg.b}:${text}`,
  };
  const squares = (rgb: string, active: number, bright: boolean) => {
    let out = "";
    for (let i = 0; i < 6; i++) out += i < active ? `${bright ? rgb : "dim"}:■` : "dim:□";
    return out;
  };
  // [tps, concrete rgb, blink period, active squares]. Stage0 is one square; below 5 keeps deeper red.
  const cases: [number, string, number, number][] = [
    [2, "192,57,43", 1400, 1],
    [7, "231,76,60", 1400, 1],
    [15, "255,126,182", 1200, 2],
    [40, "46,204,113", 1000, 3],
    [90, "26,188,156", 800, 4],
    [200, "52,152,219", 600, 5],
    [500, "155,89,182", 400, 6],
  ];
  for (const [tps, rgb, period, active] of cases) {
    const meter = (at: number) => ({ tps, live: true, lastActivityAt: at });
    const bright = squares(rgb, active, true);
    const dim = squares(rgb, active, false);
    assert.equal(speedometerText(meter(0), theme, false, true, false, 0, true, { visual: "squares" }), bright, `tps ${tps} bright`);
    assert.equal(speedometerText(meter(199), theme, false, true, false, 199, true, { visual: "squares" }), bright, `tps ${tps} bright at 199`);
    // Dim phase keeps active as dim ■ and inactive as dim □; width and count never change.
    assert.equal(speedometerText(meter(200), theme, false, true, false, 200, true, { visual: "squares" }), dim, `tps ${tps} dim`);
    assert.equal(speedometerText(meter(200), theme, false, true, true, 200, true, { visual: "squares" }), bright, `tps ${tps} steady`);
    assert.equal(speedometerText(meter(period), theme, false, true, false, period, true, { visual: "squares" }), bright, `tps ${tps} period ${period}`);
  }
  // Real escapes never change the visible six-column width.
  const truecolor = { getColorMode: () => "truecolor" };
  assert.equal(visibleWidth(speedometerText({ tps: 40 }, truecolor, false, true, false, 0, true, { visual: "squares" })), 6);
  assert.equal(visibleWidth(speedometerText({ tps: 0 }, truecolor, false, true, false, 0, true, { visual: "squares" })), 6);
});

test("squares idle and stall neutral and keep peak/current layouts", () => {
  const theme = {
    fg: (color: string, text: string) => `${color}:${text}`,
    style: (text: string, options: { fg: { r: number; g: number; b: number } }) => `${options.fg.r},${options.fg.g},${options.fg.b}:${text}`,
  };
  const allInactive = "dim:□".repeat(6);
  assert.equal(speedometerText({ tps: 0 }, theme, false, true, false, 0, true, { visual: "squares" }), allInactive);
  // Stall: recent activity expired, no stale colored squares.
  assert.equal(speedometerText({ tps: 500, live: true, lastActivityAt: 1000 }, theme, false, true, false, 2000, true, { visual: "squares" }), allInactive);
  const green = "46,204,113:■".repeat(3) + "dim:□".repeat(3);
  assert.equal(
    speedometerText({ tps: 40, peak: 142 }, theme, false, true, false, 0, true, { visual: "squares" }),
    `${green} dim:142 peak tok/s`,
  );
  assert.equal(
    speedometerText({ tps: 40, peak: 142 }, theme, false, false, false, 0, true, { visual: "squares" }),
    `${green} dim:40 tok/s · dim:142 peak tok/s`,
  );
  assert.equal(speedometerText({ tps: 40, peak: 142 }, theme, true, false, false, 0, true, { visual: "squares" }), "dim:40 tok/s");
});

test("chase moves a brighter highlight through lit squares by tier step", () => {
  const theme = {
    fg: (color: string, text: string) => `${color}:${text}`,
    style: (text: string, options: { fg: { r: number; g: number; b: number } }) => `${options.fg.r},${options.fg.g},${options.fg.b}:${text}`,
  };
  const bright = "46,204,113";
  const base = "25,112,62"; // tier hue dimmed, never neutral
  const frame = (highlight: number) => {
    let out = "";
    for (let i = 0; i < 6; i++) out += i < 3 ? `${i === highlight ? bright : base}:■` : "dim:□";
    return out;
  };
  const meter = (now: number) => ({ tps: 40, live: true, lastActivityAt: now });
  // Stage2 step is 500ms; the highlight advances and wraps within the three lit positions.
  assert.equal(speedometerText(meter(0), theme, false, true, false, 0, true, { visual: "chase" }), frame(0));
  assert.equal(speedometerText(meter(499), theme, false, true, false, 499, true, { visual: "chase" }), frame(0));
  assert.equal(speedometerText(meter(500), theme, false, true, false, 500, true, { visual: "chase" }), frame(1));
  assert.equal(speedometerText(meter(1000), theme, false, true, false, 1000, true, { visual: "chase" }), frame(2));
  assert.equal(speedometerText(meter(1500), theme, false, true, false, 1500, true, { visual: "chase" }), frame(0));
  assert.equal(speedometerText(meter(5000), theme, false, true, false, 5000, true, { visual: "chase" }), frame(1));
  // Highlight and base differ in color, and every lit square stays a tier hue.
  const one = speedometerText(meter(0), theme, false, true, false, 0, true, { visual: "chase" });
  assert.ok(one.includes(`${bright}:■`) && one.includes(`${base}:■`));
  // Tier change recolors all lit squares immediately.
  const at90 = speedometerText({ tps: 90, live: true, lastActivityAt: 0 }, theme, false, true, false, 0, true, { visual: "chase" });
  assert.notEqual(at90, one);
  assert.ok(!at90.includes(bright) && !at90.includes(base));
});

test("chase speeds up by tier and clamps to the lit count", () => {
  const theme = {
    fg: (color: string, text: string) => `${color}:${text}`,
    style: (text: string, options: { fg: { r: number; g: number; b: number } }) => `${options.fg.r},${options.fg.g},${options.fg.b}:${text}`,
  };
  // [tps, step]. Stage0 and 5 are endpoints; one-square stage0 keeps its blink period instead.
  const steps: [number, number][] = [[15, 600], [40, 500], [90, 400], [200, 300], [500, 200]];
  for (const [tps, step] of steps) {
    const meter = (now: number) => ({ tps, live: true, lastActivityAt: now });
    const first = speedometerText(meter(0), theme, false, true, false, 0, true, { visual: "chase" });
    assert.equal(speedometerText(meter(step - 1), theme, false, true, false, step - 1, true, { visual: "chase" }), first, `tps ${tps} holds before step`);
    assert.notEqual(speedometerText(meter(step), theme, false, true, false, step, true, { visual: "chase" }), first, `tps ${tps} advances at step`);
  }
  // A single lit square pulses on the squares blink period instead of sitting static.
  const one = (now: number) => ({ tps: 2, live: true, lastActivityAt: now });
  assert.equal(speedometerText(one(0), theme, false, true, false, 0, true, { visual: "chase" }), `192,57,43:■${'dim:□'.repeat(5)}`);
  assert.equal(speedometerText(one(200), theme, false, true, false, 200, true, { visual: "chase" }), `106,31,24:■${'dim:□'.repeat(5)}`);
  assert.equal(speedometerText(one(1400), theme, false, true, false, 1400, true, { visual: "chase" }), `192,57,43:■${'dim:□'.repeat(5)}`);
});

test("chase steady, idle/stall, completion hold, width, and plain fallback", () => {
  const theme = {
    fg: (color: string, text: string) => `${color}:${text}`,
    style: (text: string, options: { fg: { r: number; g: number; b: number } }) => `${options.fg.r},${options.fg.g},${options.fg.b}:${text}`,
  };
  const allInactive = "dim:□".repeat(6);
  assert.equal(speedometerText({ tps: 0 }, theme, false, true, false, 0, true, { visual: "chase" }), allInactive);
  assert.equal(speedometerText({ tps: 500, live: true, lastActivityAt: 1000 }, theme, false, true, false, 2000, true, { visual: "chase" }), allInactive);
  // Steady colors all lit squares with no highlight.
  const steady = "46,204,113:■".repeat(3) + "dim:□".repeat(3);
  assert.equal(speedometerText({ tps: 40, live: true, lastActivityAt: 0 }, theme, false, true, true, 0, true, { visual: "chase" }), steady);
  assert.equal(speedometerText({ tps: 40, live: true, lastActivityAt: 0 }, theme, false, true, true, 500, true, { visual: "chase" }), steady);
  // Completed meter holds a static highlight as time passes.
  const completedA = speedometerText({ tps: 40 }, theme, false, true, false, 0, true, { visual: "chase" });
  const completedB = speedometerText({ tps: 40 }, theme, false, true, false, 5000, true, { visual: "chase" });
  assert.equal(completedA, completedB);
  assert.ok(completedA.includes("25,112,62:■"));
  // Width is six columns under real escapes; plain hosts get glyphs only.
  const truecolor = { getColorMode: () => "truecolor" };
  assert.equal(visibleWidth(speedometerText({ tps: 40, live: true, lastActivityAt: 0 }, truecolor, false, true, false, 0, true, { visual: "chase" })), 6);
  assert.equal(speedometerText({ tps: 40, live: true, lastActivityAt: 0 }, {}, false, true, false, 0, true, { visual: "chase" }), "■■■□□□");
  // 256-color hosts distinguish highlight from base.
  const indexed = speedometerText({ tps: 40, live: true, lastActivityAt: 0 }, { getColorMode: () => "256color" }, false, true, false, 0, true, { visual: "chase" });
  const indices = [...indexed.matchAll(/38;5;(\d+)/g)].map((match) => match[1]);
  assert.ok(new Set(indices).size >= 2, `expected distinct 256 indices, got ${indexed}`);
});

test("peak readout sits right of the dot and full mode is unambiguous", () => {
  assert.equal(speedometerText({ tps: 100, peak: 142 }, undefined, false, true), "● 142 peak tok/s");
  assert.equal(speedometerText({ tps: 100, peak: 142 }, undefined, false, false), "● 100 tok/s · 142 peak tok/s");
  assert.equal(speedometerText({ tps: 100 }, undefined, false, true), "●");
  assert.equal(speedometerText({ tps: 100, peak: 142 }, undefined, false, true, false, Date.now(), false), "●");
  assert.equal(speedometerText({ tps: 100, peak: 142 }, undefined, true), "100 tok/s");
});

test("LED pulses at fixed width, dims on stalls, and supports steady motion", () => {
  const theme = {
    fg: (color: string, text: string) => `${color}:${text}`,
    style: (text: string, options: { fg: { r: number; g: number; b: number } }) => `${options.fg.r},${options.fg.g},${options.fg.b}:${text}`,
  };
  const meter = { tps: 100, live: true, lastActivityAt: 1600 };
  assert.equal(speedometerText(meter, theme, false, true, false, 1600), "26,188,156:●");
  assert.equal(speedometerText(meter, theme, false, true, false, 1800), "dim:●");
  assert.equal(speedometerText(meter, theme, false, true, true, 1800), "26,188,156:●");
  assert.equal(speedometerText(meter, theme, false, true, true, 2200), "dim:●");
  assert.equal(speedometerText({ tps: 0 }, theme, false, true), "dim:●");
  assert.equal(speedometerText(meter, undefined, true), "100 tok/s");
  // Dot-only is the default layout; explicit false opts back into full.
  assert.equal(speedometerText({ tps: 1000 }, undefined), "●");
  assert.equal(speedometerText({ tps: 1000 }, undefined, false, false), "● 1000 tok/s");
});

test("recent speed expires on silence and buffered flush includes the gap", () => {
  const tracker = new AssistantSpeedTracker();
  tracker.start({}, 1000);
  assert.equal(tracker.update({ delta: "x".repeat(80) }, 2000)?.tps, 20);
  assert.equal(tracker.snapshot(3100)?.tps, 0);
  // Five seconds since previous output, not 500 tokens / 100ms.
  assert.equal(tracker.update({ delta: "x".repeat(2000) }, 7000)?.tps, 100);
  tracker.reset();
  assert.equal(tracker.snapshot(7100), undefined);
});

test("R1: a later small chunk does not erase the buffered flush's gap", () => {
  const tracker = new AssistantSpeedTracker();
  tracker.start({}, 1000);
  tracker.update({ delta: "x".repeat(80) }, 2000); // 20 estimated tokens
  assert.equal(Math.round(tracker.update({ delta: "x".repeat(2000) }, 7000)!.tps), 100);
  // The flushed burst still spans its five-second gap after one tiny new chunk.
  tracker.update({ delta: "x".repeat(4) }, 7050);
  assert.equal(Math.round(tracker.snapshot(7050)!.tps), 101);
  // Sustained output within the window recovers to the normal rate.
  for (let now = 7100; now <= 9000; now += 50) tracker.update({ delta: "xxxx" }, now);
  assert.equal(Math.round(tracker.snapshot(9000)!.tps), 20);
  assert.equal(tracker.snapshot(10_100)?.tps, 0);
});

test("response peak is monotonic during a message and resets on the next one", () => {
  const tracker = new AssistantSpeedTracker();
  tracker.start({}, 0);
  tracker.update({ delta: "x".repeat(400) }, 100); // 100 tokens over the window
  const first = tracker.snapshot(100)!.peak!;
  assert.equal(Math.round(first), 100);
  tracker.update({ delta: "x".repeat(1200) }, 200); // rolling window now carries both samples
  const second = tracker.snapshot(200)!.peak!;
  assert.ok(second > first, `peak should grow, got ${first} then ${second}`);
  // Rolling samples expire, but the peak stays visible through the pause.
  const paused = tracker.snapshot(1200)!;
  assert.equal(paused.tps, 0);
  assert.equal(paused.peak, second);
  // A new assistant message clears the peak; no label before output.
  tracker.start({}, 5000);
  assert.equal(tracker.snapshot(5000)!.peak, undefined);
});

test("completed average settles the meter but never overwrites the peak", () => {
  const tracker = new AssistantSpeedTracker();
  tracker.start({ timestamp: 1000 }, 1000);
  tracker.update({ delta: "x".repeat(4000) }, 1500); // 1000 tokens well inside the window
  const peak = tracker.snapshot(1500)!.peak!;
  assert.ok(peak >= 1000, `expected a high measured peak, got ${peak}`);
  const result = tracker.end({ timestamp: 1000, usage: { output: 10 } }, 3000); // whole-response average 5 tok/s
  assert.ok(result.speedometer);
  assert.equal(Math.round(result.speedometer!.tps), 5);
  assert.equal(Math.round(result.speedometer!.peak!), Math.round(peak));
});

test("recent speed is bounded and recovers after a burst", () => {
  const tracker = new AssistantSpeedTracker();
  tracker.start({}, 0);
  for (let now = 50; now <= 5000; now += 50) tracker.update({ delta: "xxxx" }, now);
  assert.equal(tracker.snapshot(5000)?.tps, 20);
  assert.equal(tracker.snapshot(6100)?.tps, 0);
});

