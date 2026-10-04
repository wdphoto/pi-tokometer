# Changelog

## 0.0.4 — 2026-10-03

- Recalibrated shared speed levels and tach gears to 0/10/100/200/500 t/s.
- Tach lit blocks brighten left to right through a five-step shade ladder of the gear color (painted dial); unlit blocks stay dim.

## 0.0.3 — 2026-10-03

- Added `visual tach` (tachometer): a fixed five-block RPM-style bar using saved level thresholds and colors as gears. Fill builds within each gear and resets on upshifts; downshifts skip directly with a 5% hysteresis margin.
- Tach refreshes every 500ms without blinking, dims on pauses, and holds the final average's gear/fill for three seconds. The top gear uses a derived ceiling (600 t/s with defaults).
- Added tach to visual cycling, settings persistence, documentation, and offline tests.
- Recalibrated default speed levels to 0/10/50/100/300 t/s; five levels and five squares, blue as the fastest color.
- Removed the temporary `rev` command/settings alias and renamed internals to `tach`; `tach` is the only supported name.
- Kept the four-column readout intact in Pi's footer: numeric padding uses non-breaking spaces, and numbers-only statuses start with a zero-width prefix. Pi's footer sanitizer collapses runs of regular spaces and trims edges, which previously destroyed the padding and shifted the row as values changed.
- Simplified the width formatter to `k` only: values up to `1.0k` format as before, and anything at or above 999,500 t/s clamps to `999k` (the M/B/T and `999+` paths are gone).

## 0.0.2

- Fixed live/peak numbers to four right-aligned columns: `  42/  68↑ t/s`. Round lower speeds to whole numbers and compact thousands as `1.2k`, keeping the footer width stable.
- Always show live/peak readings. Numbers refresh every 500ms, independently of the 25ms animation tick.
- Keep the peak slot visible through idle and the next response's initial wait. Startup, new sessions, and reload show zero; completion immediately zeros live speed.
- Simplified commands to on/off and `visual single|multi|chase|cycle|off`. Removed layout, motion, status, and number-display commands.
- Replaced the dot with a single square. Single blink periods are 400/400/400/300/150ms by level.
- Sped up chase steps to 600/500/400/300/200ms by level. Multi retains its existing pulse periods.
- Added configurable speed thresholds and hex colors in `pi-tokometer.json`.
- Five default levels use soft red → peach → yellow → green → teal; red means slow. Existing custom levels are unchanged.
- Removed the experimental audio-style visual; saved selections fall back to chase.
- Updated standalone documentation, settings examples, and visual previews.

## 0.0.1

- Added a local live token-speed meter with `/tokometer` commands and its own settings file.
- Included dot, synchronized squares, and chase visuals; speed/color levels; display layouts; motion controls; and an optional response peak.
- Added rolling one-second character estimates, buffered-gap handling, completed usage/timing averages, and a three-second completion hold.
- Added safe settings writes, cross-window settings sync, invalid-file protection, and lifecycle/mode tests.
- No network activity, saved response text, or historical speed scanning.
