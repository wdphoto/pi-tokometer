# pi-tokometer

Shows estimated model output tokens per second in Pi’s footer.

```text
■ 42/68↑ t/s
```

The first number is live speed; the number with `↑` is the response peak.
Both refresh twice per second, independently of the animation.

When a response ends, live speed immediately returns to zero. The last peak
stays visible through idle and the next response’s initial wait, until that
response produces a new numeric reading. A new session or reload starts at
`0/0↑ t/s`.

## Load

From a local checkout:

```bash
pi -e ./extensions/tokometer/index.ts
```

To load the checkout automatically, run this from its root:

```bash
pi install .
```

This registers the local directory without copying it. Restart Pi or run
`/reload` after registration or code changes. No npm installation is needed.

## Commands

```text
/tokometer                     toggle on/off
/tokometer on|off              show/hide the saved display
/tokometer visual single       one blinking square
/tokometer visual multi        squares fill with speed
/tokometer visual chase        moving highlight through lit squares
/tokometer visual cycle        single → multi → chase → single
/tokometer visual off          numbers only
```

Live and peak numbers are always shown while enabled. On/off preserves the
visual choice. Changing visuals while disabled does not enable the extension.
Cycling a hidden visual starts at single; single is also the default.

## Visual examples

These are plain-text previews; the actual squares use the colors below.
`■` is lit, `□` is empty. Single’s dim phase keeps the same square, just darker.

**Single** — one blinking square beside live/peak:

```text
■ 42/68↑ t/s
```

```text
/tokometer visual single
```

**Multi** — the bar fills as speed rises:

```text
■□□□□ 5/8↑ t/s
■■■□□ 42/68↑ t/s
■■■■■ 150/180↑ t/s
```

```text
/tokometer visual multi
```

**Chase** — a bright highlight moves through the lit positions. The carets below
mark the highlight for this example; they are not part of the footer:

```text
■■■□□ 42/68↑ t/s
^
■■■□□ 42/68↑ t/s
 ^
■■■□□ 42/68↑ t/s
  ^
```

```text
/tokometer visual chase
```

**Numbers only** — no visual, same live/peak reading:

```text
42/68↑ t/s
```

```text
/tokometer visual off
```

Try `/tokometer visual cycle` to compare all three visuals. Use `/tokometer off`
to hide the entire readout and `/tokometer on` to restore it.

## Visuals and colors

All visuals use the same speed levels and colors. Defaults use soft Catppuccin
Mocha colors, independent of your Pi theme: red means slow, then peach, yellow,
green, and teal as speed improves.

| t/s | Color | Lit squares in multi/chase |
| --- | --- | --- |
| <10 | Red | 1 |
| 10–<25 | Peach | 2 |
| 25–<60 | Yellow | 3 |
| 60–<120 | Green | 4 |
| 120+ | Teal | 5 |

The default bar has five equal-width blocks. Each is 20% of the visual width,
not 20% of a fixed maximum speed.

- **Single:** one square changes color. Blink periods are 0.4s for the first
  three levels, 0.3s for the fourth, and 0.15s for the highest.
- **Multi:** each reached level lights another square. All lit squares share
  the current level’s color and blink together, with periods of
  1.4 / 1.2 / 1.0 / 0.8 / 0.6 seconds.
- **Chase:** a brighter highlight moves through the lit squares. Step intervals
  are 0.6 / 0.5 / 0.4 / 0.3 / 0.2 seconds. With one lit square, it pulses instead.

Visuals dim after 600ms without output. After completion, they hold the final
average’s color/level for three seconds, then dim. The numeric peak stays.
Animation refreshes every 25ms while streaming or during the completion hold;
there is no idle timer.

## Settings

Settings live in `~/.pi/agent/pi-tokometer.json`, respecting
`PI_CODING_AGENT_DIR`. Pi’s main `settings.json` only needs the loading entry.
Commands save display preferences; edit `levels` to adjust thresholds or colors.

This is a valid settings file with the defaults:

```json
{
  "version": 1,
  "enabled": true,
  "compact": false,
  "visual": "dot",
  "levels": [
    { "min": 0, "color": "#f38ba8" },
    { "min": 10, "color": "#fab387" },
    { "min": 25, "color": "#f9e2af" },
    { "min": 60, "color": "#a6e3a1" },
    { "min": 120, "color": "#94e2d5" }
  ]
}
```

Saved visual names are `dot` (single), `squares` (multi), and `chase`.
`compact: true` hides the visual, not the numbers.

Each level pairs a minimum speed with a `#rrggbb` color. Levels sort by `min`;
multi/chase have one position per level. A slow model might use thresholds
`0, 5, 15, 30, 60`; a very fast one `0, 100, 300, 700, 1000`.

Omit `levels` to use the defaults. Existing custom levels are preserved.
Invalid entries are discarded; if none remain, defaults are used. A command
save writes the normalized settings. Invalid JSON or unsupported versions
are reported and not overwritten.

Settings refresh at session/message boundaries and before command changes.
Other open Pi windows pick up changes at their next boundary. Use `/reload`
to reload immediately.

## Measurement and privacy

Live speed is an estimate: streamed assistant characters divided by four,
measured over a rolling one-second window. Buffered chunks are spread over
the preceding gap to avoid treating a delayed flush as an instant speed spike.
Peak is the highest live estimate, not the completed average.

The completed visual uses the provider’s output-token count divided by response
elapsed time when available, otherwise the character estimate. This measures
output arriving in Pi, not tool execution speed or total task throughput.
Tokenization and buffering vary by model/provider.

No response text is retained. No telemetry, network calls, history scanning,
or runtime dependencies. Rendering and animation are TUI-only.

## Unload

For a registered local checkout, run from its root:

```bash
pi remove .
```

Restart Pi or run `/reload`. If loaded with `-e`, omit that flag next time.
Optionally delete `~/.pi/agent/pi-tokometer.json` to reset preferences.
