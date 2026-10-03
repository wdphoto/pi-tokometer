# Changelog

## 0.0.1

- Extracted the live assistant token-speed meter from pi-tally into a standalone Pi package with `/tokometer` commands and independent settings/status.
- Preserved dot, synchronized squares, and chase visuals; six speed/color tiers; compact/full/LED layouts; steady/blink motion; and optional response peak.
- Preserved bounded one-second character estimates with buffered-gap protection, completed usage/timing averages, and a three-second completion hold.
- Added locked atomic preference transactions, loaded-window sync, malformed-settings protection, and lifecycle/mode tests.
- No Tally dependency, historical speed index, network activity, or retained response text. Settings start fresh rather than importing Tally data.
