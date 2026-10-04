# pi-tokometer

Standalone Pi extension showing estimated model output speed in the footer.
Local and TUI-only: no network calls, telemetry, saved response text, or runtime
dependencies.

## Current behavior

- Readout: `  42/  68↑ t/s` means live/peak. Both numbers are always visible while enabled.
- Each number occupies four right-aligned columns. Round low speeds to whole numbers;
  use compact units from 1,000 (`1.2k`, `10k`, `100k`, then M/B/T); overflow is `999+`.
- Numbers refresh every 500ms; visuals animate every 25ms.
- Commands: `/tokometer`, `on`, `off`, and `visual single|multi|chase|cycle|off`.
- Single blinks; multi fills; chase moves a highlight. Default: single.
- Five default levels: soft red, peach, yellow, green, teal. Red means slow.
- Settings: `~/.pi/agent/pi-tokometer.json`, respecting `PI_CODING_AGENT_DIR`.
  Custom `levels` pair minimum speeds with hex colors.
- Live returns to zero on completion. Keep the last peak until the next response
  has a numeric reading; session start/reload resets it to zero.
- Completed visuals hold for three seconds. No idle timer.

## Files

Under `extensions/tokometer/`:

- `index.ts` — events, commands, timers, and readout refresh.
- `speedometer.ts` — rolling character estimates, peak, and completed averages.
- `ui.ts` — stateless visuals, formatting, and colors.
- `preferences.ts` — settings defaults, loading, and saving.
- `save-queue.ts` — serialize writes and lock the settings file. Never steal locks.

## Rules

- Work in this repository. Preserve unrelated work.
- Don't start timers when the extension loads. No disk IO on animation ticks.
- Clear timers and session state on shutdown, reload, and session start.
- Refresh settings at session/message boundaries and before each command change.
- Never overwrite invalid JSON or unsupported settings versions.
- Before changing Pi API use, read the installed `docs/extensions.md` and
  `docs/tui.md` fully, plus relevant examples.
- Keep README user-facing, with current commands and visual examples.
  Note meaningful changes in CHANGE.md.
- No npm packaging or publishing. Don't change local Pi settings, create tags,
  or make releases without permission.

## Testing

Use fake events and temporary settings. Ask before live-provider tests.
Use existing local tools; no dependency installation is needed for routine checks:

```bash
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/tsx --test test/*.test.ts
git diff --check
```

Manual check: `pi -e ./extensions/tokometer/index.ts`.
Check commands, each visual, numeric refresh, streaming pauses, completion hold,
persistent peak, session changes, narrow terminals, light/dark themes, and
settings sync across open Pi windows.
