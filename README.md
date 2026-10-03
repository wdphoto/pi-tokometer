# pi-tokometer

A small, local assistant token-speed meter for Pi. Extracted from [pi-tally](https://github.com/wdphoto/pi-tally); works independently, with or without the prompt counter.

The footer shows a speed-colored dot and an optional response peak:

```text
● 142 peak tok/s
```

## Install

From source (available now):

```bash
pi install https://github.com/wdphoto/pi-tokometer
```

For local development:

```bash
pi -e ./extensions/tokometer/index.ts
```

Restart/reload Pi after installing. npm publication is not yet available.

## Commands

```text
/tokometer                 toggle on/off
/tokometer on              show the saved layout
/tokometer off             hide without resetting settings
/tokometer compact         current number only
/tokometer full            visual + current rate + optional peak
/tokometer led             visual + optional peak (default)
/tokometer dot             select a blinking dot
/tokometer squares         select synchronized squares
/tokometer chase           select a moving square highlight
/tokometer cycle           dot → squares → chase → dot
/tokometer steady          stop visual motion
/tokometer blink           restore activity motion
/tokometer peak [on|off]    toggle/set the peak readout
/tokometer status          show settings and their location
```

Selecting/cycling a visual enables the LED layout; on/off preserve settings.

| tok/s | Color | Lit squares | Pulse period |
| --- | --- | --- | --- |
| <10 | Red (deeper below 5) | 1 | 1.4s |
| 10–<20 | Pink | 2 | 1.2s |
| 20–<60 | Green | 3 | 1.0s |
| 60–<120 | Teal | 4 | 0.8s |
| 120–<300 | Blue | 5 | 0.6s |
| 300+ | Violet | 6 | 0.4s |

Idle and stalls are neutral. Peak survives pauses and holds for three seconds after completion, then clears. A new assistant message/session resets it.

## Local data and measurement

Live speed is approximate: streamed characters ÷ 4 over a one-second window, with buffered-burst protection. Completed responses use Pi's output-token usage and response timing when available. Peak is the highest live one-second estimate, not the completed average.

Settings live in `~/.pi/agent/pi-tokometer.json` (respects `PI_CODING_AGENT_DIR`). Other loaded windows adopt changes on their next assistant-message/session sync. No text storage, telemetry, network calls, history scanning, or runtime dependencies. Animation is TUI-only, memory-only, and stops at idle/disable/shutdown.

### Moving from pi-tally

Use `/tokometer …` instead of `/tally toks …`. Settings start at the dot/LED/peak defaults; old Tally settings and historical speed samples are not imported. Updated Tally drops its retired meter fields when saving, preserving prompt counts, Crumbs, footer preference, and trend baseline. Reload every Tally window so older versions do not keep rendering/writing the old meter.

## Uninstall

```bash
pi remove https://github.com/wdphoto/pi-tokometer
```

Optionally delete `~/.pi/agent/pi-tokometer.json` for a clean slate.
