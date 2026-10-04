# Handoff

## Paused here

Release v0.0.4 adds the painted-dial tach brightness ladder and shared thresholds
0/10/100/200/500 t/s. Validation: TypeScript, 32 offline tests, and diff checks.
No npm publish. Existing custom settings remain preserved.

Previous release v0.0.3
ships the tach visual, the five-level recalibration (0/10/50/100/300 t/s),
the sanitizer-proof readout (non-breaking-space padding), the k-only formatter,
and the final `rev` → `tach` cleanup. It was committed and pushed to origin/main
(`2d3d9b3`), tagged `v0.0.3`, and published as a GitHub Release. No npm publish
occurred, and none is planned for now; the repo ships GitHub-only.

After the release, an over-eager attempt to strip npm packaging metadata from
`package.json` (`f650308`) was reverted (`410e369`). That revert restored the previous
release tree; npm metadata is retained deliberately — do not remove it
without an explicit request. Preserve any subsequent working-tree changes when
resuming.

## Current behavior

- Standalone, local, TUI-only Pi extension.
- Footer: `■   42/  68↑ t/s` — live/peak, always shown while enabled.
- Each number is four right-aligned columns: whole numbers below 1,000, compact
  thousands (`1.2k`, `9.9k`). `k` is the only unit; values at 999,500 t/s and above
  clamp to `999k`. User-facing documentation omits speeds above 9,999.
- Padding uses non-breaking spaces, with a zero-width prefix for numbers-only statuses:
  Pi's footer sanitizer collapses regular-space runs and trims edges, so plain padding
  would shift the row.
- Numbers refresh every 500ms. This slows the readout; it does not add averaging
  beyond the existing rolling one-second speed estimate.
- Visual animation refreshes every 25ms, with no idle timer or tick-time disk IO.
- Commands: `/tokometer`, `on`, `off`, and `visual single|multi|chase|tach|cycle|off`.
- Visual cycle: single → multi → chase → tach. No audio-style meter or flash option.
- Tach uses five blocks, saved thresholds/colors as gears, 500ms sampling, direct
  downshifts with 5% hysteresis, and no blinking. Top gear spans the max of its
  minimum, previous distinct gap, and 10 t/s (500–1000 with defaults). Pauses dim
  without downshifting; completion holds the exact final average's band/fill.
  Lit blocks brighten left to right through a five-step shade ladder (45%→100%) of
  the gear color; unlit blocks stay dim.
- Single blink periods: 400/400/400/300/150ms by level.
- Multi pulse periods: 1400/1200/1000/800/600ms.
- Chase steps: 600/500/400/300/200ms. One lit square pulses instead of chasing.
- Visuals dim after 600ms without output. Completion holds the final average's
  visual reading for three seconds; live immediately becomes zero.
- Last peak stays visible through idle and the next response's initial wait.
  Replace it at that response's first numeric refresh with measured output.
  Session start/reload resets the readout to `   0/   0↑ t/s`.

## Settings and defaults

Settings: `~/.pi/agent/pi-tokometer.json`, respecting `PI_CODING_AGENT_DIR`.

Five default levels, using fixed Catppuccin Mocha colors:

| Minimum t/s | Color | Hex |
| --- | --- | --- |
| 0 | Red — slow | `#f38ba8` |
| 10 | Peach | `#fab387` |
| 100 | Yellow | `#f9e2af` |
| 200 | Green | `#a6e3a1` |
| 500 | Blue — fastest | `#89b4fa` |

Custom `levels` are retained. Defaults do not replace saved custom colors.
Valid entries sort by minimum speed; invalid entries are discarded, with defaults
used if none remain. A command save writes normalized settings. Invalid JSON and
unsupported versions are not overwritten.

Saved visual identifiers: `dot` = single, `squares` = multi, `chase` = chase.
Retired `meter`/`flash` identifiers load as chase. `compact` hides the visual.
Retired number-visibility flags are ignored and removed on the next save.

The operator's live file currently uses `visual: squares` with the five default
levels. Earlier custom palettes are backed up beside it as
`~/.pi/agent/pi-tokometer.json.bak.*` (levels, sixband, pre-default).

## Files changed this session

- `extensions/tokometer/index.ts` — commands, persistent peak, separate numeric
  and visual refresh rates.
- `extensions/tokometer/preferences.ts` — configurable levels, palette, legacy
  preference handling.
- `extensions/tokometer/ui.ts` — compact formatting, palette rendering, timing, tach bar.
- `extensions/tokometer/tach.ts` — gear hysteresis and within-gear fill.
- `test/tach.test.ts` — tach bands, colors, hysteresis, custom settings, and widths.
- `test/extension.test.ts`, `test/led.test.ts` — current commands, timing, visuals,
  settings compatibility, and persistent readout coverage.
- `README.md` — current commands, visual previews, settings example, local loading,
  measurement details, and privacy.
- `AGENTS.md` — lean standalone-project guidance.
- `CHANGE.md` — consolidated current changes.
- `LICENSE` — added project-contributor attribution alongside the retained original
  notice; MIT terms unchanged.

`speedometer.ts` and `save-queue.ts` were not changed.

## Validation

Last full run passed:

```bash
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/tsx --test test/*.test.ts
git diff --check
```

32 tests passed, including fixed-width formatting, compact-unit rounding boundaries,
footer-sanitizer padding, tach fill/ladder/colors, gear hysteresis, settings changes,
sampling, pauses, and holds. README's settings JSON was parsed and checked for version 1 and
its levels array. No automated live-provider tests were run. Manual visual feel,
narrow-terminal rendering, and light-theme contrast still need hands-on review.

## Local setup and external actions

With permission, the local extension entry point was registered in the user-level
Pi `settings.json` earlier in the session. No package installation was performed.
Other loading entries were left unchanged. Run `/reload` to use the latest code.
Display preferences are user-managed; the agent only rewrote the extension's own
`pi-tokometer.json` when asked to recalibrate.

Implementation and tests used no network requests or credential access.
Authorized remote actions this session: pushed `main` (including release commit
`2d3d9b3` and revert `410e369`), pushed annotated tag `v0.0.3`, and created the
GitHub Release `https://github.com/wdphoto/pi-tokometer/releases/tag/v0.0.3`
via `gh release create --verify-tag`. No npm publish. Authentication came from
the configured Git remote and `gh` keyring; no credentials were read or printed.

## Resume notes

- Start with `AGENTS.md` and this file, then inspect the working-tree diff.
- Keep single/multi/chase/tach; the user rejected the audio-style visual and changed
  their mind about grouped flashes.
- Red means slow, not fast. Keep the softer red → peach → yellow → green → blue
  defaults, and preserve custom levels.
- Numbers are always live/peak, not selectable modes. Keep four-column fields:
  `  42/  68↑ t/s`.
- README and agent instructions no longer describe this as part of another project.
  The original copyright attribution remains in LICENSE as required by MIT.
- Releases are GitHub-only for now: the user says **"ship it"** to authorize a
  patch version bump, changelog freeze, validation, commit, annotated `vX.Y.Z`
  tag, push, and GitHub Release (`gh release create --verify-tag`). Never publish
  to npm, and do not remove npm packaging metadata (`files`, `keywords`,
  `pack:dry`) — an attempt to strip it was reverted.
