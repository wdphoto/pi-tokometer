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
  return { ctx, command, handlers, notifications, get status() { return status; }, emit: (name: string, event = {}) => handlers.get(name)!(event, ctx) };
}

test("commands persist layouts, visuals, motion and peak independently", async (t) => {
  const path = await sandbox(t);
  const f = fixture();
  await f.emit("session_start");
  assert.equal(f.status, "●");
  await f.command("  peak   off  ", f.ctx);
  await f.command("steady", f.ctx);
  await f.command("compact", f.ctx);
  assert.equal(f.status, "0.0 tok/s");
  await f.command("off", f.ctx);
  assert.equal(f.status, undefined);
  await f.command("on", f.ctx);
  assert.equal(f.status, "0.0 tok/s");
  for (const visual of ["squares", "chase", "dot"]) {
    await f.command("cycle", f.ctx);
    const prefs = await loadPreferences(path);
    assert.equal(prefs.visual, visual);
    assert.equal(prefs.ledOnly, true);
    assert.equal(prefs.compact, false);
    assert.equal(prefs.steady, true);
    assert.equal(prefs.peakEnabled, false);
  }
  await f.command("full", f.ctx);
  assert.equal(f.status, "● 0.0 tok/s");
  await f.command("squares", f.ctx);
  assert.equal(f.status, "□□□□□□");
  await f.command("compact", f.ctx);
  await f.command("led", f.ctx);
  assert.equal((await loadPreferences(path)).visual, "squares");
  await f.command("blink", f.ctx);
  await f.command("peak", f.ctx);
  assert.equal((await loadPreferences(path)).peakEnabled, true);
  await f.command("nonsense", f.ctx);
  assert.match(f.notifications.at(-1)!, /^Usage:/);
  await f.emit("session_shutdown");
});

test("loaded instances sync changes and concurrent writes preserve unrelated preferences", async (t) => {
  const path = await sandbox(t);
  const a = fixture(), b = fixture();
  await a.emit("session_start"); await b.emit("session_start");
  await a.command("compact", a.ctx);
  await b.emit("session_tree");
  assert.equal(b.status, "0.0 tok/s");
  await b.command("peak off", b.ctx);
  assert.equal((await loadPreferences(path)).compact, true);
  await Promise.all([
    updatePreferences(path, () => ({ visual: "chase" })),
    updatePreferences(path, () => ({ steady: true })),
  ]);
  const prefs = await loadPreferences(path);
  assert.equal(prefs.visual, "chase"); assert.equal(prefs.steady, true); assert.equal(prefs.peakEnabled, false);
});

test("bad settings are not overwritten and invalid individual values normalize safely", async (t) => {
  const path = await sandbox(t);
  assert.deepEqual(await loadPreferences(path), defaultPreferences());
  for (const content of ["{bad", '{"version":999}', 'null', '[]']) {
    await writeFile(path, content);
    await assert.rejects(updatePreferences(path, () => ({ enabled: false })));
    assert.equal(await readFile(path, "utf8"), content);
  }
  await writeFile(path, JSON.stringify({ version: 1, visual: "bogus", steady: "true", ledOnly: false, peakEnabled: false }));
  const prefs = await loadPreferences(path);
  assert.equal(prefs.visual, "dot"); assert.equal(prefs.steady, false); assert.equal(prefs.ledOnly, false); assert.equal(prefs.peakEnabled, false);
});

test("animation is memory-only, holds peak for three seconds and cleans up on shutdown", async (t) => {
  const path = await sandbox(t);
  let now = 1000;
  let tick: (() => void) | undefined;
  let cleared = 0;
  t.mock.method(Date, "now", () => now);
  t.mock.method(globalThis, "setInterval", (callback: () => void) => { tick = callback; return { unref() {} } as any; });
  t.mock.method(globalThis, "clearInterval", () => { cleared++; tick = undefined; });
  const f = fixture();
  await f.emit("session_start");
  await f.command("full", f.ctx);
  const before = await readFile(path, "utf8");
  await f.emit("message_start", { message: { role: "assistant", timestamp: 1000 } });
  now = 1500;
  await f.emit("message_update", { message: { role: "assistant" }, assistantMessageEvent: { delta: "x".repeat(400) } });
  assert.equal(f.status, "● 100 tok/s · 100 peak tok/s");
  now = 2700; tick!();
  assert.equal(f.status, "● 0.0 tok/s · 100 peak tok/s");
  await f.emit("message_end", { message: { role: "assistant", timestamp: 1000, usage: { output: 17 } } });
  assert.equal(f.status, "● 10 tok/s · 100 peak tok/s");
  now = 5699; tick!(); assert.match(f.status!, /100 peak/);
  now = 5700; tick!(); assert.equal(f.status, "● 0.0 tok/s");
  assert.equal(tick, undefined); assert.ok(cleared > 0);
  assert.equal(await readFile(path, "utf8"), before);
  await f.emit("message_start", { message: { role: "assistant", timestamp: 5700 } });
  assert.doesNotMatch(f.status!, /peak/);
  await f.emit("session_start");
  assert.equal(tick, undefined);
  assert.equal(f.status, "● 0.0 tok/s");
  await f.emit("message_start", { message: { role: "assistant", timestamp: 5700 } });
  await f.command("off", f.ctx);
  assert.equal(tick, undefined); assert.equal(f.status, undefined);
  await f.emit("session_shutdown");
  assert.equal(tick, undefined); assert.equal(f.status, undefined);
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
