# Changelog

## Unreleased

- Added `visual tach` (tachometer; `rev` remains a compatibility alias): a fixed five-block RPM-style bar using saved level thresholds and colors as gears. Fill builds within each gear and resets on upshifts; downshifts skip directly with a 5% hysteresis margin.
- Tach refreshes every 500ms without blinking, dims on pauses, and holds the final average's gear/fill for three seconds. The top gear uses a derived ceiling (240 t/s with defaults).
- Added tach to visual cycling, settings persistence, documentation, and offline tests.

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
