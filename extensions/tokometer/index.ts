import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { defaultPreferences, loadPreferences, resolvePreferencesPath, updatePreferences, type Preferences } from "./preferences.ts";
import { AssistantSpeedTracker } from "./speedometer.ts";
import { speedometerText, type FooterSpeedometer } from "./ui.ts";
import { RevTracker } from "./rev.ts";

export const STATUS_KEY = "pi-tokometer";
const USAGE = "Usage: /tokometer [on|off|visual single|multi|chase|tach|cycle|off]";

export default function piTokometer(pi: ExtensionAPI) {
  const path = resolvePreferencesPath();
  const tracker = new AssistantSpeedTracker();
  const revTracker = new RevTracker();
  let rev = revTracker.update(0, defaultPreferences().levels, false);
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
    revTracker.reset(); rev = { tps: 0, gear: 0 };
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
      rev = revTracker.update(meter?.tps ?? 0, preferences.levels, streaming);
    }
    ctx.ui.setStatus(STATUS_KEY, preferences.enabled
      ? speedometerText({ ...(meter ?? { tps: 0 }), peak: readoutPeak }, ctx.ui.theme, preferences.compact, false, false, now, true, { visual: preferences.visual, currentTps: readoutTps, levels: preferences.levels, rev })
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
    description: "Show or configure estimated model output tokens per second",
    handler: async (args, ctx) => {
      const command = args.trim().replace(/\s+/g, " ");
      const valid = ["", "on", "off", "visual single", "visual multi", "visual chase", "visual tach", "visual rev", "visual cycle", "visual off"];
      if (!valid.includes(command)) { if (ctx.hasUI) ctx.ui.notify(USAGE, "warning"); return; }
      try {
        preferences = await updatePreferences(path, (current): Partial<Preferences> => {
          if (!command || command === "on" || command === "off") return { enabled: command ? command === "on" : !current.enabled };
          const [, choice] = command.split(" ");
          if (choice === "off") return { compact: true };
          // Keep the existing saved identifiers so older settings still load.
          const order = ["dot", "squares", "chase", "tach"] as const;
          const visual = choice === "cycle"
            ? (current.compact ? "dot" : order[(order.indexOf(current.visual) + 1) % order.length]!)
            : choice === "single" ? "dot"
            : choice === "multi" ? "squares"
            : choice === "chase" ? "chase"
            : choice === "tach" || choice === "rev" ? "tach" : "dot";
          return { compact: false, visual };
        });
        lastReadoutAt = undefined;
        render(ctx);
        if (ctx.hasUI) ctx.ui.notify(`pi-tokometer: ${command || (preferences.enabled ? "on" : "off")}`, "info");
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
    revTracker.reset();
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
