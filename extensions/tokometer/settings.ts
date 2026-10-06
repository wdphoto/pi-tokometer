import { getSettingsListTheme, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Container, SettingsList, Text, type TuiMouseEvent } from "@earendil-works/pi-tui";
import type { Preferences } from "./preferences.ts";

const VISUALS = ["single", "multi", "chase", "tach", "none"];

function visualValue(preferences: Preferences): string {
  return preferences.compact ? "none"
    : preferences.visual === "dot" ? "single"
    : preferences.visual === "squares" ? "multi" : preferences.visual;
}

export async function openSettings(
  ctx: ExtensionContext,
  initial: Preferences,
  save: (change: Partial<Preferences>) => Promise<Preferences>,
): Promise<void> {
  await ctx.ui.custom<void>((tui, theme, _keybindings, done) => {
    let current = initial;
    let pending = Promise.resolve();
    let revision = 0;
    let closing = false;
    let disposed = false;
    const list = new SettingsList([
      { id: "enabled", label: "Enabled", currentValue: current.enabled ? "on" : "off", values: ["on", "off"] },
      { id: "visual", label: "Visual", currentValue: visualValue(current), values: VISUALS },
    ], 2, getSettingsListTheme(), (id, value) => {
      const change: Partial<Preferences> = id === "enabled" ? { enabled: value === "on" }
        : value === "none" ? { compact: true }
        : { compact: false, visual: value === "single" ? "dot" : value === "multi" ? "squares" : value as Preferences["visual"] };
      const changeRevision = ++revision;
      // SettingsList callbacks are synchronous; serialize saves and drain on close.
      pending = pending.then(async () => {
        try { current = await save(change); }
        catch (error) { ctx.ui.notify(error instanceof Error ? error.message : String(error), "warning"); }
        if (!disposed && changeRevision === revision) {
          list.updateValue("enabled", current.enabled ? "on" : "off");
          list.updateValue("visual", visualValue(current));
          tui.requestRender();
        }
      });
    }, () => {
      closing = true;
      void pending.then(() => done(undefined));
    });
    const container = new Container();
    container.addChild(new Text(theme.fg("accent", "Tokometer settings"), 0, 0));
    container.addChild(list);
    return {
      render: (width) => container.render(width),
      invalidate: () => container.invalidate(),
      handleInput: (data) => { if (!closing) list.handleInput(data); tui.requestRender(); },
      handleMouse: (event: TuiMouseEvent) => closing ? undefined : container.handleMouse(event),
      dispose: () => { disposed = true; },
    };
  });
}
