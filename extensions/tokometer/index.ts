import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { defaultPreferences, loadPreferences, resolvePreferencesPath, updatePreferences, type Preferences, type ToksVisual } from "./preferences.ts";
import { AssistantSpeedTracker } from "./speedometer.ts";
import { speedometerText, type FooterSpeedometer } from "./ui.ts";

export const STATUS_KEY = "pi-tokometer";
const USAGE = "Usage: /tokometer [on|off|compact|full|led|dot|squares|chase|cycle|steady|blink|peak [on|off]|status]";

export default function piTokometer(pi: ExtensionAPI) {
  const path = resolvePreferencesPath();
  const tracker = new AssistantSpeedTracker();
  let preferences = defaultPreferences();
  let timer: ReturnType<typeof setInterval> | undefined;
  let streaming = false;
  let completedUntil = 0;
  let completed: FooterSpeedometer | undefined;

  function stopTimer() {
    if (timer) clearInterval(timer);
    timer = undefined;
  }
  function reset() {
    stopTimer(); tracker.reset(); streaming = false; completedUntil = 0; completed = undefined;
  }
  function render(ctx: ExtensionContext) {
    if (ctx.mode !== "tui") { stopTimer(); return; }
    const now = Date.now();
    if (completedUntil && now >= completedUntil) { completedUntil = 0; completed = undefined; }
    const meter = streaming ? tracker.snapshot(now) : completed;
    ctx.ui.setStatus(STATUS_KEY, preferences.enabled
      ? speedometerText(meter ?? { tps: 0 }, ctx.ui.theme, preferences.compact, preferences.ledOnly, preferences.steady, now, preferences.peakEnabled, { visual: preferences.visual })
      : undefined);
    if (!preferences.enabled || (!streaming && !completedUntil)) { stopTimer(); return; }
    if (!timer) {
      timer = setInterval(() => render(ctx), 200);
      timer.unref();
    }
  }
  async function sync(ctx: ExtensionContext) {
    try { preferences = await loadPreferences(path); }
    catch (error) {
      if (ctx.hasUI) ctx.ui.notify(error instanceof Error ? error.message : String(error), "warning");
    }
  }

  pi.registerCommand("tokometer", {
    description: "Toggle or configure the local assistant tok/s meter",
    handler: async (args, ctx) => {
      const command = args.trim().replace(/\s+/g, " ");
      if (command === "status") {
        await sync(ctx); render(ctx);
        if (ctx.hasUI) ctx.ui.notify(`pi-tokometer: ${preferences.enabled ? "on" : "off"} · ${preferences.compact ? "compact" : preferences.ledOnly ? "led" : "full"} · ${preferences.visual} · ${preferences.steady ? "steady" : "blink"} · peak ${preferences.peakEnabled ? "on" : "off"}\nSettings: ${path}`, "info");
        return;
      }
      const valid = ["", "on", "off", "compact", "full", "led", "dot", "squares", "chase", "cycle", "steady", "blink", "peak", "peak on", "peak off"];
      if (!valid.includes(command)) { if (ctx.hasUI) ctx.ui.notify(USAGE, "warning"); return; }
      try {
        preferences = await updatePreferences(path, (current): Partial<Preferences> => {
          if (!command || command === "on" || command === "off") return { enabled: command ? command === "on" : !current.enabled };
          if (command === "steady" || command === "blink") return { steady: command === "steady" };
          if (command.startsWith("peak")) return { peakEnabled: command === "peak" ? !current.peakEnabled : command === "peak on" };
          if (command === "compact" || command === "full" || command === "led") return { enabled: true, compact: command === "compact", ledOnly: command === "led" };
          const order: ToksVisual[] = ["dot", "squares", "chase"];
          const visual = command === "cycle" ? order[(order.indexOf(current.visual) + 1) % order.length]! : command as ToksVisual;
          return { enabled: true, compact: false, ledOnly: true, visual };
        });
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
