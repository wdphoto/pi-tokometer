import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import piTokometer, { STATUS_KEY } from "../extensions/tokometer/index.ts";
import { defaultPreferences, loadPreferences, updatePreferences } from "../extensions/tokometer/preferences.ts";

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
  const notifications: string[] = [];
  const ctx = {
    mode, hasUI: mode === "tui" || mode === "rpc",
    ui: {
      theme: { fg: (_color: string, text: string) => text },
      setStatus: (key: string, text: string | undefined) => { assert.equal(key, STATUS_KEY); status = text; },
      notify: (text: string) => notifications.push(text),
    },
  };
  piTokometer({
    on: (name: string, handler: any) => handlers.set(name, handler),
    registerCommand: (name: string, def: any) => { assert.equal(name, "tokometer"); command = def.handler; },
  } as any);
  return { ctx, command, notifications, get status() { return status; }, emit: (name: string, event = {}) => handlers.get(name)!(event, ctx) };
}

test("visual commands always preserve live and peak readings", async (t) => {
  const path = await sandbox(t);
  const f = fixture();
  await f.emit("session_start");
  assert.equal(f.status, "■ 0/0↑ t/s");
  for (const [choice, saved] of [["multi", "squares"], ["chase", "chase"], ["single", "dot"]]) {
    await f.command("visual cycle", f.ctx);
    assert.equal((await loadPreferences(path)).visual, saved);
    await f.command(`visual ${choice}`, f.ctx);
    assert.match(f.status!, /0\/0↑ t\/s$/);
  }
  await f.command("  visual   off  ", f.ctx);
  assert.equal(f.status, "0/0↑ t/s");
  await f.command("visual cycle", f.ctx);
  assert.equal(f.status, "■ 0/0↑ t/s");
  await f.command("off", f.ctx);
  assert.equal(f.status, undefined);
  await f.command("visual multi", f.ctx);
  assert.equal(f.status, undefined);
  await f.command("on", f.ctx);
  assert.equal(f.status, "□□□□□ 0/0↑ t/s");
  await f.command("", f.ctx);
  assert.equal(f.status, undefined);
  await f.command("", f.ctx);
  assert.equal(f.status, "□□□□□ 0/0↑ t/s");
  for (const old of ["dot", "squares", "cycle", "compact", "full", "led", "steady", "blink", "status", "peak", "numbers on", "numbers live", "numbers peak", "numbers both", "numbers cycle", "numbers off", "visual on", "visual dot", "visual meter", "visual flash", "nonsense"]) {
    const before = await readFile(path, "utf8");
    await f.command(old, f.ctx);
    assert.match(f.notifications.at(-1)!, /^Usage:/);
    assert.equal(await readFile(path, "utf8"), before);
  }
  await f.emit("session_shutdown");
});

test("loaded instances sync changes and concurrent writes preserve unrelated preferences", async (t) => {
  const path = await sandbox(t);
  const a = fixture(), b = fixture();
  await a.emit("session_start"); await b.emit("session_start");
  await a.command("visual off", a.ctx);
  await b.emit("session_tree");
  assert.equal(b.status, "0/0↑ t/s");
  await Promise.all([
    updatePreferences(path, () => ({ visual: "chase" })),
    updatePreferences(path, () => ({ enabled: false })),
  ]);
  const prefs = await loadPreferences(path);
  assert.equal(prefs.visual, "chase"); assert.equal(prefs.enabled, false); assert.equal(prefs.compact, true);
});

test("bad settings are preserved; older visual choices load and retired number flags are ignored", async (t) => {
  const path = await sandbox(t);
  assert.deepEqual(await loadPreferences(path), defaultPreferences());
  for (const content of ["{bad", '{"version":999}', 'null', '[]']) {
    await writeFile(path, content);
    await assert.rejects(updatePreferences(path, () => ({ enabled: false })));
    assert.equal(await readFile(path, "utf8"), content);
  }
  for (const visual of ["dot", "squares", "flash", "chase", "meter", "bogus"]) {
    await writeFile(path, JSON.stringify({ version: 1, visual, steady: true, ledOnly: true, peakEnabled: false }));
    const prefs = await loadPreferences(path);
    assert.equal(prefs.visual, visual === "bogus" ? "dot" : visual === "meter" || visual === "flash" ? "chase" : visual);
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
  await f.command("visual single", f.ctx);
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
  await f.command("visual off", f.ctx);
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
  await update(550, 400);
  assert.equal(numbers(), "dim:100/100↑ t/s");
  now = 600; tick();
  assert.equal(numbers(), "dim:100/100↑ t/s");
  assert.ok(colors.has("166,227,161"));
  assert.ok(colors.has("148,226,213"));
  now = 999; tick();
  assert.equal(numbers(), "dim:100/100↑ t/s");
  now = 1000; tick();
  assert.equal(numbers(), "dim:200/200↑ t/s");
  now = 1025;
  await f.emit("message_end", { message: { role: "assistant", timestamp: 0, usage: { output: 20 } } });
  assert.equal(numbers(), "dim:0/200↑ t/s");
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
