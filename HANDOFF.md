# Handoff

## Paused here

The current implementation is ready for further manual use. No feature request
is pending. Local version is now 0.0.2; changes are listed under 0.0.2 in CHANGE.md.
The latest pass added fixed-width numeric fields and bumped metadata/docs.
The user authorized committing and pushing these 0.0.2 changes to origin/main;
check Git history/status for the outcome. No tag, publication, or remote release
was requested.
The user authorized a commit and push to origin/main after this handoff was
written. Check Git history/status for the outcome. No tag, release, or publication
was requested. Preserve any subsequent working-tree changes when resuming.

## Current behavior

- Standalone, local, TUI-only Pi extension.
- Footer: `■   42/  68↑ t/s` — live/peak, always shown while enabled.
- Each number is four right-aligned columns: whole numbers below 1,000, compact
  units above (`1.2k`, `10k`, `100k`, then M/B/T). Rounding can promote to the next
  unit; out-of-range values show `999+` rather than expanding the width.
- Numbers refresh every 500ms. This slows the readout; it does not add averaging
  beyond the existing rolling one-second speed estimate.
- Visual animation refreshes every 25ms, with no idle timer or tick-time disk IO.
- Commands: `/tokometer`, `on`, `off`, and `visual single|multi|chase|cycle|off`.
- Visual cycle: single → multi → chase. No audio-style meter or flash option.
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
| 25 | Yellow | `#f9e2af` |
| 60 | Green | `#a6e3a1` |
| 120 | Teal — fast | `#94e2d5` |

Custom `levels` are retained. Defaults do not replace saved custom colors.
Valid entries sort by minimum speed; invalid entries are discarded, with defaults
used if none remain. A command save writes normalized settings. Invalid JSON and
unsupported versions are not overwritten.

Saved visual identifiers: `dot` = single, `squares` = multi, `chase` = chase.
Retired `meter`/`flash` identifiers load as chase. `compact` hides the visual.
Retired number-visibility flags are ignored and removed on the next save.

## Files changed this session

- `extensions/tokometer/index.ts` — commands, persistent peak, separate numeric
  and visual refresh rates.
- `extensions/tokometer/preferences.ts` — configurable levels, palette, legacy
  preference handling.
- `extensions/tokometer/ui.ts` — compact formatting, palette rendering, timing.
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

26 tests passed, including fixed-width formatting and compact-unit rounding boundaries. README's settings JSON was parsed and checked for version 1 and
its levels array. No automated live-provider tests were run. Manual visual feel,
narrow-terminal rendering, and light-theme contrast still need hands-on review.

## Local setup and external actions

With permission, the local extension entry point was registered in the user-level
Pi `settings.json` earlier in the session. No package installation was performed.
Other loading entries were left unchanged. Run `/reload` to use the latest code.
Display preferences themselves were not edited directly by the agent.

Implementation and tests used no network requests or credential access.
The user subsequently authorized committing and pushing this work; that push
uses the configured Git authentication and updates the remote branch.
No tags, publication, or release commands were authorized.

## Resume notes

- Start with `AGENTS.md` and this file, then inspect the working-tree diff.
- Keep single/multi/chase; the user rejected the audio-style visual and changed
  their mind about grouped flashes.
- Red means slow, not fast. Keep the softer red → peach → yellow → green → teal
  defaults, and preserve custom levels.
- Numbers are always live/peak, not selectable modes. Keep four-column fields:
  `  42/  68↑ t/s`.
- README and agent instructions no longer describe this as part of another project.
  The original copyright attribution remains in LICENSE as required by MIT.
- Old npm/package metadata and scripts still exist in `package.json` and the
  lockfile. The user does not want npm packaging/publishing; metadata cleanup
  was not part of this pass. Existing local dev tools were used without installs.
