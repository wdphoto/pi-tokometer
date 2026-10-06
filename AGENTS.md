# pi-tokometer

Standalone Pi extension showing estimated model output speed in the footer.
Local and TUI-only: no network calls, telemetry, saved response text, or runtime
dependencies.

## Current behavior

- Readout: `42/68↑ t/s` means live/peak. Both numbers are always visible while enabled.
- Digits are unpadded; reserve four columns per number and move unused space after `t/s`
  so the whole block stays fixed-width. Round low speeds to whole numbers;
  show thousands compactly (`1.2k`, `9.9k`); `k` is the only unit, and wider values
  clamp to `999k`. Documentation need not cover speeds above 9,999.
- Trailing padding uses non-breaking spaces plus a zero-width suffix;
  Pi's footer sanitizer collapses regular spaces and trims whitespace at both edges.
- Numbers refresh every 500ms; visuals animate every 25ms.
- Commands: `/tokometer`, `on`, `off`, and `settings`. No aliases or visual subcommands.
- Native settings menu: Enabled on/off; Visual single/multi/chase/tach/none.
  Save and apply each change immediately; drain pending saves before closing.
- Single blinks; multi fills; chase moves a highlight; tach builds within color-coded
  gears. Default: single.
- Tach: fixed five blocks; saved levels define gear thresholds/colors. Refresh every
  500ms; direct downshifts with 5% hysteresis, no blinking. Top span is the max of
  the gear minimum, previous distinct gap, and 10 t/s. Pauses retain the gear.
  Lit blocks brighten left to right through a five-step shade ladder (45%→100%)
  of the gear color; unlit blocks stay dim.
- Five default levels: soft red, peach, yellow, green, blue. Red means slow.
  Thresholds are 0/10/100/200/500 t/s.
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
- `settings.ts` — native Pi SettingsList menu and serialized change callbacks.
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
