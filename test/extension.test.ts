import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import piTokometer, { STATUS_KEY } from "../extensions/tokometer/index.ts";
import { defaultPreferences, loadPreferences, updatePreferences } from "../extensions/tokometer/preferences.ts";
import { initTheme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";

async function sandbox(t: test.TestContext) {
  const previous = process.env.PI_CODING_AGENT_DIR;
  const dir = await mkdtemp(join(tmpdir(), "tokometer-test-"));
  process.env.PI_CODING_AGENT_DIR = dir;
  t.after(async () => {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
    await rm(dir, { recursive: true, force: true });
  });
  return join(dir, "pi-tokometer.json");
}
function fixture(mode = "tui") {
  const handlers = new Map<string, (event: any, ctx: any) => any>();
  let command!: (args: string, ctx: any) => Promise<void>;
  let status: string | undefined;
  let menuKeys: string[] = [];
  let menuLines: string[] = [];
  let menuOpened = 0;
  let completions!: (prefix: string) => { value: string }[];
  initTheme("dark", false);
  const notifications: string[] = [];
  const ctx = {
    mode, hasUI: mode === "tui" || mode === "rpc",
    ui: {
      theme: { fg: (_color: string, text: string) => text },
      setStatus: (key: string, text: string | undefined) => { assert.equal(key, STATUS_KEY); status = text?.replaceAll("\u00a0", " ").replaceAll("\u200b", "").trimEnd(); },
      notify: (text: string) => notifications.push(text),
      custom: (factory: any) => new Promise<void>((resolve) => {
        menuOpened++;
        const component = factory({ requestRender() {} }, { fg: (_color: string, text: string) => text }, {}, resolve);
        menuLines = component.render(80);
        for (const width of [20, 40, 80]) assert.ok(component.render(width).every((line: string) => visibleWidth(line) <= width));
        for (const key of menuKeys) component.handleInput(key);
        component.handleInput("\u001b");
      }),
    },
  };
  piTokometer({
    on: (name: string, handler: any) => handlers.set(name, handler),
    registerCommand: (name: string, def: any) => { assert.equal(name, "tokometer"); command = def.handler; completions = def.getArgumentCompletions; },
  } as any);
  return {
    ctx, command, notifications, completions,
    get status() { return status; }, get menuLines() { return menuLines; }, get menuOpened() { return menuOpened; },
    configure: async (...keys: string[]) => { menuKeys = keys; await command("settings", ctx); },
    emit: (name: string, event = {}) => handlers.get(name)!(event, ctx),
  };
}

test("native settings save every visual and enabled state; old commands are rejected", async (t) => {
  const path = await sandbox(t);
  const f = fixture();
  await f.emit("session_start");
  assert.equal(f.status, "■ 0/0↑ t/s");
  await f.configure();
  assert.match(f.menuLines.join("\n"), /Tokometer settings/);
  assert.match(f.menuLines.join("\n"), /Enabled.*on/);
  assert.match(f.menuLines.join("\n"), /Visual.*single/);
  await assert.rejects(readFile(path), { code: "ENOENT" }); // Opening/closing does not write.
  for (const [saved, compact] of [["squares", false], ["chase", false], ["tach", false], ["tach", true], ["dot", false]] as const) {
    await f.configure("\u001b[B", "\r"); // Visual: cycle once, then close while save is pending.
    const prefs = await loadPreferences(path);
    assert.equal(prefs.visual, saved);
    assert.equal(prefs.compact, compact);
    assert.match(f.status!, /0\/0↑ t\/s$/);
  }
  await f.configure("\r");
  assert.equal(f.status, undefined);
  await f.configure("\u001b[B", "\r");
  assert.equal(f.status, undefined); // Selecting a visual does not enable the meter.
  await f.command("  on  ", f.ctx);
  assert.equal(f.status, "□□□□□ 0/0↑ t/s");
  await f.command("off", f.ctx);
  assert.equal(f.status, undefined);
  await f.command("", f.ctx);
  assert.equal(f.status, "□□□□□ 0/0↑ t/s");
  assert.deepEqual(f.completions("").map((item) => item.value), ["on", "off", "settings"]);
  assert.deepEqual(f.completions("s").map((item) => item.value), ["settings"]);
  for (const old of ["visual single", "visual multi", "visual chase", "visual tach", "visual cycle", "visual off", "dot", "squares", "cycle", "compact", "full", "led", "steady", "blink", "status", "peak", "numbers on", "numbers live", "numbers peak", "numbers both", "numbers cycle", "numbers off", "visual cylon", "visual rev", "visual on", "visual dot", "visual meter", "visual flash", "settings extra", "nonsense"]) {
    const before = await readFile(path, "utf8");
    await f.command(old, f.ctx);
    assert.equal(f.notifications.at(-1), "Usage: /tokometer [on|off|settings]");
    assert.equal(await readFile(path, "utf8"), before);
  }
  await f.emit("session_shutdown");
});

test("loaded instances sync changes and concurrent writes preserve unrelated preferences", async (t) => {
  const path = await sandbox(t);
  const a = fixture(), b = fixture();
  await a.emit("session_start"); await b.emit("session_start");
  await a.configure("\u001b[B", "\r", "\r", "\r", "\r");
  await b.emit("session_tree");
  assert.equal(b.status, "0/0↑ t/s");
  await Promise.all([
    updatePreferences(path, () => ({ visual: "chase" })),
    updatePreferences(path, () => ({ enabled: false })),
  ]);
  const prefs = await loadPreferences(path);
  assert.equal(prefs.visual, "chase"); assert.equal(prefs.enabled, false); assert.equal(prefs.compact, true);
});

test("bad settings are protected and retired visual identifiers have no aliases", async (t) => {
  const path = await sandbox(t);
  assert.deepEqual(await loadPreferences(path), defaultPreferences());
  for (const content of ["{bad", '{"version":999}', 'null', '[]']) {
    await writeFile(path, content);
    await assert.rejects(updatePreferences(path, () => ({ enabled: false })));
    assert.equal(await readFile(path, "utf8"), content);
  }
  for (const visual of ["dot", "squares", "flash", "chase", "tach", "meter", "bogus"]) {
    await writeFile(path, JSON.stringify({ version: 1, visual, steady: true, ledOnly: true, peakEnabled: false }));
    const prefs = await loadPreferences(path);
    assert.equal(prefs.visual, ["bogus", "meter", "flash"].includes(visual) ? "dot" : visual);
    assert.equal("peakEnabled" in prefs, false);
    const f = fixture();
    await f.emit("session_start");
    assert.match(f.status!, /0\/0↑ t\/s$/);
    await f.emit("session_shutdown");
  }
});

test("peak never disappears across holds, starts, empty responses and visual changes", async (t) => {
  const path = await sandbox(t);
  let now = 1000;
  let tick: (() => void) | undefined;
  let cleared = 0;
  t.mock.method(Date, "now", () => now);
  t.mock.method(globalThis, "setInterval", (callback: () => void, delay: number) => {
    assert.equal(delay, 25);
    tick = callback;
    return { unref() {} } as any;
  });
  t.mock.method(globalThis, "clearInterval", () => { cleared++; tick = undefined; });
  const f = fixture();
  await f.emit("session_start");
  await f.command("on", f.ctx);
  const before = await readFile(path, "utf8");
  await f.emit("message_start", { message: { role: "assistant", timestamp: 1000 } });
  assert.equal(f.status, "■ 0/0↑ t/s");
  now = 1500;
  await f.emit("message_update", { message: { role: "assistant" }, assistantMessageEvent: { delta: "x".repeat(400) } });
  assert.equal(f.status, "■ 100/100↑ t/s");
  now = 2700; tick!();
  assert.equal(f.status, "■ 0/100↑ t/s");
  await f.emit("message_end", { message: { role: "assistant", timestamp: 1000, usage: { output: 17 } } });
  assert.equal(f.status, "■ 0/100↑ t/s");
  now = 5700; tick!();
  assert.equal(f.status, "■ 0/100↑ t/s");
  assert.equal(tick, undefined); assert.ok(cleared > 0);
  assert.equal(await readFile(path, "utf8"), before);
  await f.emit("message_start", { message: { role: "assistant", timestamp: 5700 } });
  assert.equal(f.status, "■ 0/100↑ t/s");
  now = 5800;
  await f.emit("message_end", { message: { role: "assistant", timestamp: 5700 } });
  assert.equal(f.status, "■ 0/100↑ t/s");
  await f.configure("\u001b[B", "\r", "\r", "\r", "\r");
  assert.equal(f.status, "0/100↑ t/s");
  await f.emit("message_start", { message: { role: "assistant", timestamp: 5800 } });
  now = 6000;
  await f.emit("message_update", { message: { role: "assistant" }, assistantMessageEvent: { delta: "x".repeat(40) } });
  assert.equal(f.status, "0/100↑ t/s");
  now = 6300; tick!();
  assert.equal(f.status, "10/10↑ t/s");
  await f.command("off", f.ctx);
  assert.equal(f.status, undefined); assert.equal(tick, undefined);
  await f.command("on", f.ctx);
  assert.equal(f.status, "10/10↑ t/s");
  await f.emit("session_start");
  assert.equal(tick, undefined);
  assert.equal(f.status, "0/0↑ t/s");
  await f.emit("session_shutdown");
  assert.equal(f.status, undefined);
});

test("numbers refresh every 500ms while visuals keep animating; completion zeros immediately", async (t) => {
  await sandbox(t);
  let now = 0;
  let tick!: () => void;
  t.mock.method(Date, "now", () => now);
  t.mock.method(globalThis, "setInterval", (callback: () => void) => { tick = callback; return { unref() {} } as any; });
  t.mock.method(globalThis, "clearInterval", () => {});
  const f = fixture();
  const colors = new Set<string>();
  f.ctx.ui.theme.fg = (_color: string, text: string) => `dim:${text}`;
  Object.assign(f.ctx.ui.theme, { style: (text: string, o: { fg: { r: number; g: number; b: number } }) => {
    const color = `${o.fg.r},${o.fg.g},${o.fg.b}`;
    colors.add(color);
    return `${color}:${text}`;
  } });
  const numbers = () => f.status!.slice(f.status!.indexOf(" dim:") + 1);
  await f.emit("session_start");
  await f.emit("message_start", { message: { role: "assistant", timestamp: 0 } });
  const update = async (at: number, chars: number) => {
    now = at;
    await f.emit("message_update", { message: { role: "assistant" }, assistantMessageEvent: { delta: "x".repeat(chars) } });
    tick();
  };
  await update(100, 400);
  assert.equal(numbers(), "dim:0/0↑ t/s");
  now = 499; tick();
  assert.equal(numbers(), "dim:0/0↑ t/s");
  now = 500; tick();
  assert.equal(numbers(), "dim:100/100↑ t/s");
  await update(550, 800);
  assert.equal(numbers(), "dim:100/100↑ t/s");
  now = 600; tick();
  assert.equal(numbers(), "dim:100/100↑ t/s");
  assert.ok(colors.has("249,226,175"));
  now = 999; tick();
  assert.equal(numbers(), "dim:100/100↑ t/s");
  now = 1000; tick();
  assert.equal(numbers(), "dim:300/300↑ t/s");
  assert.ok(colors.has("166,227,161"));
  now = 1025;
  await f.emit("message_end", { message: { role: "assistant", timestamp: 0, usage: { output: 20 } } });
  assert.equal(numbers(), "dim:0/300↑ t/s");
  await f.emit("session_shutdown");
});

test("tach samples every 500ms, dims on stalls, holds completion and clears on session start", async (t) => {
  await sandbox(t);
  let now = 0;
  let tick!: () => void;
  t.mock.method(Date, "now", () => now);
  t.mock.method(globalThis, "setInterval", (callback: () => void) => { tick = callback; return { unref() {} } as any; });
  t.mock.method(globalThis, "clearInterval", () => {});
  const f = fixture();
  await f.emit("session_start");
  await f.configure("\u001b[B", "\r", "\r", "\r");
  assert.equal(f.status, "□□□□□ 0/0↑ t/s");
  await f.emit("message_start", { message: { role: "assistant", timestamp: 0 } });
  now = 100;
  await f.emit("message_update", { message: { role: "assistant" }, assistantMessageEvent: { delta: "x".repeat(72) } });
  assert.equal(f.status, "□□□□□ 0/0↑ t/s");
  now = 500; tick();
  assert.equal(f.status, "■□□□□ 18/18↑ t/s");
  now = 550;
  await f.emit("message_update", { message: { role: "assistant" }, assistantMessageEvent: { delta: "x".repeat(208) } });
  assert.equal(f.status, "■□□□□ 18/18↑ t/s");
  now = 1000; tick();
  assert.equal(f.status, "■■■■□ 70/70↑ t/s");
  now = 1150; tick();
  assert.match(f.status!, /^□□□□□/);
  now = 1200;
  await f.emit("message_end", { message: { role: "assistant", timestamp: 0, usage: { output: 24 } } });
  assert.equal(f.status, "■□□□□ 0/70↑ t/s");
  now = 4199; tick();
  assert.match(f.status!, /^■□□□□/);
  now = 4200; tick();
  assert.equal(f.status, "□□□□□ 0/70↑ t/s");
  await f.emit("session_start");
  assert.equal(f.status, "□□□□□ 0/0↑ t/s");
  await f.emit("session_shutdown");
});

test("settings refresh before opening and refuse invalid files or non-TUI modes", async (t) => {
  const path = await sandbox(t);
  const f = fixture();
  await f.emit("session_start");
  const levels = [{ min: 0, color: "#123456" }];
  await updatePreferences(path, () => ({ enabled: false, visual: "tach", levels }));
  await f.configure();
  assert.match(f.menuLines.join("\n"), /Enabled.*off/);
  assert.match(f.menuLines.join("\n"), /Visual.*tach/);
  await f.configure("\r", "\u001b[B", "\r");
  assert.equal(f.status, "0/0↑ t/s");
  assert.deepEqual((await loadPreferences(path)).levels, levels);
  for (const content of ["{bad", '{"version":999}']) {
    await writeFile(path, content);
    const opened = f.menuOpened;
    await f.configure("\r");
    assert.equal(f.menuOpened, opened);
    assert.match(f.notifications.at(-1)!, /Cannot load/);
    assert.equal(await readFile(path, "utf8"), content);
  }
  for (const mode of ["text", "json", "rpc"]) {
    const other = fixture(mode);
    await other.configure("\r");
    assert.equal(other.menuOpened, 0);
    assert.equal(await readFile(path, "utf8"), '{"version":999}');
  }
  await f.emit("session_shutdown");
});

test("print, JSON and RPC modes never start terminal animation", async (t) => {
  await sandbox(t);
  t.mock.method(globalThis, "setInterval", () => { assert.fail("no animation outside TUI"); });
  for (const mode of ["text", "json", "rpc"]) {
    const f = fixture(mode);
    await f.emit("session_start");
    await f.emit("message_start", { message: { role: "assistant" } });
    await f.emit("message_update", { message: { role: "assistant" }, assistantMessageEvent: { delta: "hello" } });
    await f.emit("message_end", { message: { role: "assistant", usage: { output: 10 } } });
    assert.equal(f.status, undefined);
    await f.emit("session_shutdown");
  }
});
