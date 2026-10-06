import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { defaultPreferences, loadPreferences, resolvePreferencesPath, updatePreferences, type Preferences } from "./preferences.ts";
import { AssistantSpeedTracker } from "./speedometer.ts";
import { speedometerText, type FooterSpeedometer } from "./ui.ts";
import { TachTracker } from "./tach.ts";
import { openSettings } from "./settings.ts";

export const STATUS_KEY = "pi-tokometer";
const USAGE = "Usage: /tokometer [on|off|settings]";

export default function piTokometer(pi: ExtensionAPI) {
  const path = resolvePreferencesPath();
  const tracker = new AssistantSpeedTracker();
  const tachTracker = new TachTracker();
  let tach = tachTracker.update(0, defaultPreferences().levels, false);
  let preferences = defaultPreferences();
  let timer: ReturnType<typeof setInterval> | undefined;
  let streaming = false;
  let completedUntil = 0;
  let completed: FooterSpeedometer | undefined;
  let displayedPeak = 0;
  let readoutTps = 0;
  let readoutPeak = 0;
  let lastReadoutAt: number | undefined;

  function stopTimer() {
    if (timer) clearInterval(timer);
    timer = undefined;
  }
  function reset() {
    stopTimer(); tracker.reset(); streaming = false; completedUntil = 0; completed = undefined; displayedPeak = 0;
    readoutTps = 0; readoutPeak = 0; lastReadoutAt = undefined;
    tachTracker.reset(); tach = { tps: 0, gear: 0 };
  }
  function render(ctx: ExtensionContext) {
    if (ctx.mode !== "tui") { stopTimer(); return; }
    const now = Date.now();
    if (completedUntil && now >= completedUntil) {
      completedUntil = 0;
      completed = completed?.peak ? { tps: 0, peak: completed.peak } : undefined;
    }
    const meter = streaming ? tracker.snapshot(now) : completed;
    if (meter?.peak !== undefined) displayedPeak = meter.peak;
    // Numbers refresh independently of the animation. Completion returns live to zero immediately.
    if (!streaming || lastReadoutAt === undefined || now - lastReadoutAt >= 500) {
      readoutTps = streaming ? meter?.tps ?? 0 : 0;
      readoutPeak = displayedPeak;
      lastReadoutAt = now;
      tach = tachTracker.update(meter?.tps ?? 0, preferences.levels, streaming);
    }
    ctx.ui.setStatus(STATUS_KEY, preferences.enabled
      ? speedometerText({ ...(meter ?? { tps: 0 }), peak: readoutPeak }, ctx.ui.theme, preferences.compact, false, false, now, true, { visual: preferences.visual, currentTps: readoutTps, levels: preferences.levels, tach })
      : undefined);
    if (!preferences.enabled || (!streaming && !completedUntil)) { stopTimer(); return; }
    if (!timer) {
      timer = setInterval(() => render(ctx), 25);
      timer.unref();
    }
  }
  async function sync(ctx: ExtensionContext) {
    try {
      const next = await loadPreferences(path);
      if (JSON.stringify(next.levels) !== JSON.stringify(preferences.levels)) lastReadoutAt = undefined;
      preferences = next;
    }
    catch (error) {
      if (ctx.hasUI) ctx.ui.notify(error instanceof Error ? error.message : String(error), "warning");
    }
  }

  pi.registerCommand("tokometer", {
    description: "Toggle token speed or open settings",
    getArgumentCompletions: (prefix) => ["on", "off", "settings"]
      .filter((value) => value.startsWith(prefix)).map((value) => ({ value, label: value })),
    handler: async (args, ctx) => {
      const command = args.trim();
      if (!["", "on", "off", "settings"].includes(command)) { if (ctx.hasUI) ctx.ui.notify(USAGE, "warning"); return; }
      if (command === "settings" && ctx.mode !== "tui") {
        if (ctx.hasUI) ctx.ui.notify("Tokometer settings require TUI mode.", "warning");
        return;
      }
      try {
        const apply = async (change: Partial<Preferences>) => {
          preferences = await updatePreferences(path, () => change);
          lastReadoutAt = undefined;
          render(ctx);
          return preferences;
        };
        if (command === "settings") {
          // Don't open a menu with stale values or an unreadable settings file.
          const next = await loadPreferences(path);
          if (JSON.stringify(next.levels) !== JSON.stringify(preferences.levels)) lastReadoutAt = undefined;
          preferences = next;
          render(ctx);
          await openSettings(ctx, preferences, apply);
          return;
        }
        preferences = await updatePreferences(path, (current) => ({ enabled: command ? command === "on" : !current.enabled }));
        lastReadoutAt = undefined;
        render(ctx);
        if (ctx.hasUI) ctx.ui.notify(`pi-tokometer: ${preferences.enabled ? "on" : "off"}`, "info");
      } catch (error) {
        if (ctx.hasUI) ctx.ui.notify(error instanceof Error ? error.message : String(error), "warning");
      }
    },
  });
  pi.on("session_start", async (_event, ctx) => { reset(); await sync(ctx); render(ctx); });
  pi.on("session_tree", async (_event, ctx) => { await sync(ctx); render(ctx); });
  pi.on("message_start", async (event, ctx) => {
    if (event.message.role !== "assistant" || ctx.mode !== "tui") return;
    await sync(ctx);
    tracker.start(event.message); streaming = true; completedUntil = 0; completed = undefined;
    lastReadoutAt = undefined;
    tachTracker.reset();
    render(ctx);
  });
  pi.on("message_update", (event, ctx) => {
    if (event.message.role !== "assistant" || ctx.mode !== "tui") return;
    if (tracker.update(event.assistantMessageEvent)) render(ctx);
  });
  pi.on("message_end", async (event, ctx) => {
    if (event.message.role !== "assistant" || ctx.mode !== "tui") return;
    const now = Date.now();
    completed = tracker.end(event.message, now).speedometer;
    streaming = false; completedUntil = completed ? now + 3000 : 0;
    await sync(ctx); render(ctx);
  });
  pi.on("session_shutdown", (_event, ctx) => {
    reset();
    if (ctx.mode === "tui") ctx.ui.setStatus(STATUS_KEY, undefined);
  });
}
