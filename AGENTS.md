# pi-tokometer

Independent Git/npm project, extracted from pi-tally. Work from this directory; never stage it in the parent workspace.

## Scope

- Local, TUI-only live assistant tok/s meter. No telemetry, network calls, history scanner, prompt counting, or runtime dependencies.
- `/tokometer` owns enablement, layouts, visuals, motion and peak preferences.
- `extensions/tokometer/index.ts`: event wiring, commands, timer lifecycle.
- `speedometer.ts`: bounded character/timing estimates and completed usage-based average. Retain no text.
- `ui.ts`: stateless tier/color/visual rendering.
- `preferences.ts`: agent-directory settings and locked atomic preference transactions.
- `save-queue.ts`: local serialization and bounded cross-process lock; never steal locks.

No timers in the extension factory. Animate only during a TUI response/completion hold; no disk IO on ticks. Clear timers/status on shutdown/reload/session start. Sync settings at session/message boundaries and read fresh settings inside every transaction. Corrupt/unsupported settings must not be overwritten.

Settings: `~/.pi/agent/pi-tokometer.json`, respecting `PI_CODING_AGENT_DIR`. Do not read/write Tally's store. Migration starts fresh; document this rather than silently importing or mutating another extension's data.

## Validation

```bash
npm ci
npm run check
npm test
npm run pack:dry
```

Smoke test: `pi -e ./extensions/tokometer/index.ts`. Check every command, streaming/stalls/peak hold, session changes, narrow terminals, light/dark themes, and loaded-window settings sync. Live provider tests require authorization. Tests should use synthetic events and temporary settings only.

Read installed Pi `docs/extensions.md`, `docs/packages.md`, and `docs/tui.md` completely and relevant examples before API changes.

Keep README user-facing; update CHANGE.md for material changes. No commits to unrelated repositories, local Pi-settings changes, npm publication, tags, or releases without authorization.
