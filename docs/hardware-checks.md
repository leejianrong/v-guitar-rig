# Hardware checks

CI has no sound card, so these are run by hand on a real interface and recorded here per release.

## V1: latency and stability

1. `make wasm`, then `pnpm --filter @rig/web dev` and open http://127.0.0.1:5173 in Chrome on Windows.
2. Connect the interface output to an input with a cable (turn monitoring and volume down first).
3. Choose "Guitar input", press Start audio, then "Measure loopback latency". Repeat 5 times.
4. Switch to the test tone, enable the clipper, and let it play 10 minutes; note any dropouts. The footer's "Frame rate" line shows the browser's own underrun count (Chrome only).
5. V4: add six pedals, select each in turn for a minute, and note the fps and dropout count in the footer (target: >= 55 fps, 0 dropouts).

Target: round trip <= 40 ms, no dropouts in 10 minutes (docs/QUESTIONS.md Q3).

| Date | Interface | Browser | Round trip (ms) | 10-min dropouts | Notes |
|------|-----------|---------|-----------------|-----------------|-------|
| _not yet measured_ | | | | | |
