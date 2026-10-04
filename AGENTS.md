# pi-tokometer

Standalone Pi extension showing estimated model output speed in the footer.
Local and TUI-only: no network calls, telemetry, saved response text, or runtime
dependencies.

## Current behavior

- Readout: `  42/  68↑ t/s` means live/peak. Both numbers are always visible while enabled.
- Each number occupies four right-aligned columns. Round low speeds to whole numbers;
  show thousands compactly (`1.2k`, `9.9k`); `k` is the only unit, and wider values
  clamp to `999k`. Documentation need not cover speeds above 9,999.
- Numeric padding uses non-breaking spaces (plus a zero-width prefix when the visual is
  hidden); Pi's footer sanitizer collapses and trims regular spaces.
- Numbers refresh every 500ms; visuals animate every 25ms.
- Commands: `/tokometer`, `on`, `off`, and `visual single|multi|chase|tach|cycle|off`.
- Single blinks; multi fills; chase moves a highlight; tach builds within color-coded
  gears. Default: single.
- Tach: fixed five blocks; saved levels define gear thresholds/colors. Refresh every
  500ms; direct downshifts with 5% hysteresis, no blinking. Top span is the max of
  the gear minimum, previous distinct gap, and 10 t/s. Pauses retain the gear.
- Five default levels: soft red, peach, yellow, green, blue. Red means slow.
  Thresholds are 0/10/50/100/300 t/s.
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
- `tach.ts` — session-local gear hysteresis and within-gear fill calculation.
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
