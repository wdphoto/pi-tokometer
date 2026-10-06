import test from "node:test";
import assert from "node:assert/strict";
import { initTheme, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { defaultPreferences, type Preferences } from "../extensions/tokometer/preferences.ts";
import { openSettings } from "../extensions/tokometer/settings.ts";

function fixture() {
  initTheme("dark", false);
  let component!: Component;
  let renders = 0;
  const warnings: string[] = [];
  const ctx = {
    ui: {
      notify: (text: string) => warnings.push(text),
      custom: (factory: any) => new Promise<void>((resolve) => {
        component = factory({ requestRender: () => renders++ }, { fg: (_color: string, text: string) => text }, {}, resolve);
      }),
    },
  } as unknown as ExtensionContext;
  return { ctx, warnings, get component() { return component; }, get renders() { return renders; } };
}

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

test("native menu serializes rapid changes, applies before closing, and drains saves on Esc", async () => {
  const f = fixture();
  let preferences = defaultPreferences();
  const changes: Partial<Preferences>[] = [];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let closed = false;
  const finished = openSettings(f.ctx, preferences, async (change) => {
    changes.push(change);
    if (changes.length === 1) await gate;
    preferences = { ...preferences, ...change };
    return preferences;
  }).then(() => { closed = true; });
  f.component.handleInput!("\r"); // Enabled off.
  f.component.handleInput!("\u001b[B");
  f.component.handleInput!("\r"); // Multi.
  await flush();
  assert.equal(changes.length, 1);
  release();
  await flush();
  assert.equal(preferences.enabled, false);
  assert.equal(preferences.visual, "squares");
  assert.equal(closed, false); // Applied while the menu is still open.
  assert.ok(f.renders > 0);
  f.component.handleInput!("\r"); // Chase, save still pending.
  f.component.handleInput!("\u001b");
  f.component.handleInput!("\r"); // Ignored after close requested.
  assert.equal(closed, false);
  await finished;
  assert.equal(changes.length, 3);
  assert.equal(preferences.visual, "chase");
  assert.equal(closed, true);
});

test("failed saves warn, restore the confirmed menu value, and do not block subsequent saves", async () => {
  const f = fixture();
  let preferences = defaultPreferences();
  let attempts = 0;
  const finished = openSettings(f.ctx, preferences, async (change) => {
    if (++attempts === 1) throw new Error("Settings file is invalid; not overwritten.");
    preferences = { ...preferences, ...change };
    return preferences;
  });
  f.component.handleInput!("\r");
  await flush();
  assert.equal(preferences.enabled, true);
  assert.match(f.warnings[0]!, /not overwritten/);
  const lines = f.component.render(80).join("\n").replace(/\x1b\[[0-9;]*m/g, "");
  assert.match(lines, /Enabled.*on/);
  f.component.handleInput!("\r");
  f.component.handleInput!("\u001b");
  await finished;
  assert.equal(preferences.enabled, false);
  assert.equal(attempts, 2);
});
