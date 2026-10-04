import test from "node:test";
import assert from "node:assert/strict";
import { visibleWidth } from "@earendil-works/pi-tui";
import { AssistantSpeedTracker } from "../extensions/tokometer/speedometer.ts";
import { DEFAULT_LEVELS, type ToksLevel } from "../extensions/tokometer/preferences.ts";
import { ansi256Index, speedometerText, toksLevelIndex } from "../extensions/tokometer/ui.ts";

test("level boundaries cover slow through thousand-token speeds", () => {
  for (const [rate, level] of [[0, 0], [4.9, 0], [9.9, 0], [10, 1], [19.9, 1], [25, 2], [59.9, 2], [60, 3], [119.9, 3], [120, 4], [1000, 4]]) {
    assert.equal(toksLevelIndex(rate!, DEFAULT_LEVELS), level);
  }
  // A speed below the first min still resolves to level 0.
  const highOnly = [{ min: 50, color: "#00ff00" }] as ToksLevel[];
  assert.equal(toksLevelIndex(10, highOnly), 0);
  assert.equal(toksLevelIndex(50, highOnly), 0);
});

test("soft red-to-teal defaults use a concrete distinct palette and deterministic phases", () => {
  const theme = {
    fg: (color: string, text: string) => `${color}:${text}`,
    style: (text: string, options: { fg: { r: number; g: number; b: number } }) => `${options.fg.r},${options.fg.g},${options.fg.b}:${text}`,
  };
  // [tps, concrete rgb, blink period]: red, peach, yellow, green, teal.
  const cases: [number, string, number][] = [
    [2, "243,139,168", 400],
    [15, "250,179,135", 400],
    [40, "249,226,175", 400],
    [90, "166,227,161", 300],
    [200, "148,226,213", 150],
  ];
  for (const [tps, rgb, period] of cases) {
    const meter = (at: number) => ({ tps, live: true, lastActivityAt: at });
    assert.equal(speedometerText(meter(0), theme, false, true, false, 0), `${rgb}:■`, `tps ${tps} bright at 0`);
    const brightMs = Math.min(200, period / 2);
    assert.equal(speedometerText(meter(brightMs - 1), theme, false, true, false, brightMs - 1), `${rgb}:■`, `tps ${tps} bright before boundary`);
    assert.equal(speedometerText(meter(brightMs), theme, false, true, false, brightMs), "dim:■", `tps ${tps} dim at boundary`);
    // Simulate 25ms refreshes across several periods: even max alternates, never aliases to steady.
    const frames = Array.from({ length: period * 3 / 25 }, (_, i) => {
      const now = i * 25;
      return speedometerText(meter(now), theme, false, true, false, now);
    });
    assert.ok(frames.includes(`${rgb}:■`));
    assert.ok(frames.includes("dim:■"));
    // The blink period does not change the level color.
    assert.equal(speedometerText(meter(period), theme, false, true, false, period), `${rgb}:■`, `tps ${tps} period ${period}`);
  }
  // Idle and stalled single squares are neutral.
  assert.equal(speedometerText({ tps: 0 }, theme, false, true), "dim:■");
  assert.equal(speedometerText({ tps: 500, live: true, lastActivityAt: 1000 }, theme, false, true, false, 2000), "dim:■");
});

test("concrete palette uses host style, then capability fallback, else plain", () => {
  const truecolor = { getColorMode: () => "truecolor" };
  const index256 = { getColorMode: () => "256color" };
  // Green level (60-<120 t/s) as a concrete sRGB foreground.
  assert.equal(speedometerText({ tps: 90 }, truecolor, false, true), "\x1b[38;2;166;227;161m■\x1b[39m");
  const indexed = speedometerText({ tps: 90 }, index256, false, true);
  assert.match(indexed, /^\x1b\[38;5;\d+m■\x1b\[39m$/);
  // Semantic-only and no-theme hosts render plain, never a user theme's semantic role.
  assert.equal(speedometerText({ tps: 90 }, { fg: () => "green-role" }, false, true), "■");
  assert.equal(speedometerText({ tps: 90 }, {}, false, true), "■");
  assert.equal(speedometerText({ tps: 90 }, undefined, false, true), "■");
  // Levels stay distinct even when a user theme maps semantic roles oddly.
  assert.notEqual(speedometerText({ tps: 15 }, truecolor, false, true), speedometerText({ tps: 200 }, truecolor, false, true));
  assert.notEqual(speedometerText({ tps: 15 }, truecolor, false, true), indexed);
  // Squares share the same capability path (inactive squares stay plain without a theme).
  assert.equal(
    speedometerText({ tps: 90 }, truecolor, false, true, false, 0, true, { visual: "squares" }),
    "\x1b[38;2;166;227;161m■\x1b[39m".repeat(4) + "□",
  );
  assert.equal(
    speedometerText({ tps: 90 }, index256, false, true, false, 0, true, { visual: "squares" }),
    "\x1b[38;5;151m■\x1b[39m".repeat(4) + "□",
  );
  assert.equal(speedometerText({ tps: 90 }, {}, false, true, false, 0, true, { visual: "squares" }), "■■■■□");
  // Stateless rendering: a theme change cannot leave cached ANSI colors stale.
  const themeA = { style: (text: string, o: { fg: { r: number } }) => `A${o.fg.r}:${text}` };
  const themeB = { style: (text: string, o: { fg: { r: number } }) => `B${o.fg.r}:${text}` };
  assert.notEqual(
    speedometerText({ tps: 90 }, themeA, false, true, false, 0, true, { visual: "squares" }),
    speedometerText({ tps: 90 }, themeB, false, true, false, 0, true, { visual: "squares" }),
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
  // Chosen level approximations on the real palette.
  assert.equal(ansi256Index(166, 227, 161), 151); // soft green
  assert.equal(ansi256Index(243, 139, 168), 211); // warning red
  for (let r = 0; r <= 255; r += 17) {
    for (let g = 0; g <= 255; g += 17) {
      for (let b = 0; b <= 255; b += 17) {
        const index = ansi256Index(r, g, b);
        assert.ok(index >= 16 && index <= 255, `index ${index} out of range for ${r},${g},${b}`);
      }
    }
  }
});

test("squares show one position per level: five 20% blocks by default", () => {
  const theme = {
    fg: (color: string, text: string) => `${color}:${text}`,
    style: (text: string, options: { fg: { r: number; g: number; b: number } }) => `${options.fg.r},${options.fg.g},${options.fg.b}:${text}`,
  };
  const squares = (rgb: string, active: number, bright: boolean) => {
    let out = "";
    for (let i = 0; i < 5; i++) out += i < active ? `${bright ? rgb : "dim"}:■` : "dim:□";
    return out;
  };
  // [tps, concrete rgb, active squares]. Each level lights one more block in its own hue.
  const cases: [number, string, number][] = [
    [2, "243,139,168", 1],
    [15, "250,179,135", 2],
    [40, "249,226,175", 3],
    [90, "166,227,161", 4],
    [500, "148,226,213", 5],
  ];
  for (const [tps, rgb, active] of cases) {
    const meter = (at: number) => ({ tps, live: true, lastActivityAt: at });
    assert.equal(speedometerText(meter(0), theme, false, true, false, 0, true, { visual: "squares" }), squares(rgb, active, true), `tps ${tps} bright`);
    // Dim phase keeps active as dim ■ and inactive as dim □; width and count never change.
    assert.equal(speedometerText(meter(200), theme, false, true, false, 200, true, { visual: "squares" }), squares(rgb, active, false), `tps ${tps} dim`);
  }
  // Real escapes never change the visible five-column width.
  const truecolor = { getColorMode: () => "truecolor" };
  assert.equal(visibleWidth(speedometerText({ tps: 90 }, truecolor, false, true, false, 0, true, { visual: "squares" })), 5);
  assert.equal(visibleWidth(speedometerText({ tps: 0 }, truecolor, false, true, false, 0, true, { visual: "squares" })), 5);
});

test("squares idle and stall neutral and keep peak/current layouts", () => {
  const theme = {
    fg: (color: string, text: string) => `${color}:${text}`,
    style: (text: string, options: { fg: { r: number; g: number; b: number } }) => `${options.fg.r},${options.fg.g},${options.fg.b}:${text}`,
  };
  const allInactive = "dim:□".repeat(5);
  assert.equal(speedometerText({ tps: 0 }, theme, false, true, false, 0, true, { visual: "squares" }), allInactive);
  // Stall: recent activity expired, no stale colored squares.
  assert.equal(speedometerText({ tps: 500, live: true, lastActivityAt: 1000 }, theme, false, true, false, 2000, true, { visual: "squares" }), allInactive);
  const hot = "166,227,161:■".repeat(4) + "dim:□";
  assert.equal(
    speedometerText({ tps: 90, peak: 142 }, theme, false, true, false, 0, true, { visual: "squares" }),
    `${hot} dim:142↑ t/s`,
  );
  assert.equal(
    speedometerText({ tps: 90, peak: 142 }, theme, false, false, false, 0, true, { visual: "squares" }),
    `${hot} dim:90/142↑ t/s`,
  );
  assert.equal(speedometerText({ tps: 90, peak: 142 }, theme, true, false, false, 0, true, { visual: "squares" }), "dim:90/142↑ t/s");
});

test("saved levels drive colors, square count and boundaries", () => {
  const theme = {
    fg: (color: string, text: string) => `${color}:${text}`,
    style: (text: string, options: { fg: { r: number; g: number; b: number } }) => `${options.fg.r},${options.fg.g},${options.fg.b}:${text}`,
  };
  const levels = [{ min: 0, color: "#ff0000" }, { min: 100, color: "#00ff00" }];
  const squares = (rgb: string, active: number) => {
    let out = "";
    for (let i = 0; i < 2; i++) out += i < active ? `${rgb}:■` : "dim:□";
    return out;
  };
  assert.equal(speedometerText({ tps: 50, live: true, lastActivityAt: 0 }, theme, false, true, false, 0, true, { visual: "squares", levels }), squares("255,0,0", 1));
  assert.equal(speedometerText({ tps: 120, live: true, lastActivityAt: 0 }, theme, false, true, false, 0, true, { visual: "squares", levels }), squares("0,255,0", 2));
  // Slow models can split a low range, and the count follows the levels.
  const deep = [{ min: 0, color: "#123456" }, { min: 1, color: "#234567" }, { min: 2, color: "#345678" }, { min: 3, color: "#456789" }];
  assert.equal(toksLevelIndex(1.5, deep), 1);
  assert.equal(
    speedometerText({ tps: 1.5, live: true, lastActivityAt: 0 }, theme, false, true, false, 0, true, { visual: "chase", levels: deep }),
    `35,69,103:■19,38,57:■${"dim:□".repeat(2)}`,
  );
});

test("chase moves through lit squares faster at each level and wraps cleanly", () => {
  const theme = {
    fg: (color: string, text: string) => `${color}:${text}`,
    style: (text: string, o: { fg: { r: number; g: number; b: number } }) => `${o.fg.r},${o.fg.g},${o.fg.b}:${text}`,
  };
  const steps = [600, 500, 400, 300, 200];
  for (const [index, level] of DEFAULT_LEVELS.entries()) {
    const count = index + 1;
    const step = steps[index]!;
    const render = (now: number) => speedometerText({ tps: level.min || 1, live: true, lastActivityAt: now }, theme, false, true, false, now, true, { visual: "chase" });
    if (count === 1) {
      // With no second position to chase, retain the original slow-level pulse.
      assert.notEqual(render(0), render(200));
      assert.equal(render(1400), render(0));
      continue;
    }
    const first = render(0);
    assert.equal(render(step - 1), first);
    assert.notEqual(render(step), first);
    assert.equal(render(step * count), first);
    assert.equal(render(step * count * 3), first);
    assert.equal(first.split("dim:□").length - 1, DEFAULT_LEVELS.length - count);
  }
});

test("chase respects custom counts and clamps high-level motion to the fastest step", () => {
  const levels = Array.from({ length: 7 }, (_, min) => ({ min, color: "#123456" }));
  const theme = { getColorMode: () => "truecolor" };
  const render = (now: number) => speedometerText({ tps: 1000, live: true, lastActivityAt: now }, theme, false, true, false, now, true, { visual: "chase", levels });
  assert.equal(visibleWidth(render(0)), 7);
  assert.equal(render(199), render(0));
  assert.notEqual(render(200), render(0));
  assert.equal(render(1400), render(0));
  assert.ok(render(0).includes("\x1b[38;2;18;52;86m■\x1b[39m"));
});

test("chase dims on stalls, holds a static completion highlight, and keeps its width", () => {
  const theme = {
    fg: (color: string, text: string) => `${color}:${text}`,
    style: (text: string, o: { fg: { r: number; g: number; b: number } }) => `${o.fg.r},${o.fg.g},${o.fg.b}:${text}`,
  };
  const options = { visual: "chase" } as const;
  const inactive = "dim:□".repeat(5);
  assert.equal(speedometerText({ tps: 0 }, theme, false, true, false, 0, true, options), inactive);
  assert.equal(speedometerText({ tps: 90, live: true, lastActivityAt: 0 }, theme, false, true, false, 600, true, options), inactive);
  const completed = "166,227,161:■" + "91,125,89:■".repeat(3) + "dim:□";
  for (const now of [0, 200, 500, 5000]) {
    assert.equal(speedometerText({ tps: 90 }, theme, false, true, false, now, true, options), completed);
  }
  const truecolor = { getColorMode: () => "truecolor" };
  assert.equal(visibleWidth(speedometerText({ tps: 90 }, truecolor, false, true, false, 0, true, options)), 5);
  assert.equal(speedometerText({ tps: 90 }, {}, false, true, false, 0, true, options), "■■■■□");
  assert.equal(speedometerText({ tps: 90, peak: 100 }, theme, false, false, false, 0, true, options), `${completed} dim:90/100↑ t/s`);
  assert.equal(speedometerText({ tps: 90 }, theme, false, true, true, 0, true, options), "166,227,161:■".repeat(4) + "dim:□");
});

test("peak readout sits right of the square and full mode is unambiguous", () => {
  assert.equal(speedometerText({ tps: 100, peak: 142 }, undefined, false, true), "■ 142↑ t/s");
  assert.equal(speedometerText({ tps: 100, peak: 142 }, undefined, false, false), "■ 100/142↑ t/s");
  assert.equal(speedometerText({ tps: 100 }, undefined, false, true), "■");
  assert.equal(speedometerText({ tps: 100, peak: 142 }, undefined, false, true, false, Date.now(), false), "■");
  assert.equal(speedometerText({ tps: 100, peak: 142 }, undefined, true), "100/142↑ t/s");
});

test("single square pulses at fixed width, dims on stalls, and supports steady motion", () => {
  const theme = {
    fg: (color: string, text: string) => `${color}:${text}`,
    style: (text: string, options: { fg: { r: number; g: number; b: number } }) => `${options.fg.r},${options.fg.g},${options.fg.b}:${text}`,
  };
  const meter = { tps: 90, live: true, lastActivityAt: 1600 };
  assert.equal(speedometerText(meter, theme, false, true, false, 1600), "166,227,161:■");
  assert.equal(speedometerText(meter, theme, false, true, false, 1750), "dim:■");
  assert.equal(speedometerText(meter, theme, false, true, true, 1800), "166,227,161:■");
  assert.equal(speedometerText(meter, theme, false, true, true, 2200), "dim:■");
  assert.equal(speedometerText({ tps: 0 }, theme, false, true), "dim:■");
  assert.equal(speedometerText(meter, undefined, true), "90 t/s");
  // Visual-only is the default layout; explicit false opts into numbers.
  assert.equal(speedometerText({ tps: 1000 }, undefined), "■");
  assert.equal(speedometerText({ tps: 1000 }, undefined, false, false), "■ 1000 t/s");
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