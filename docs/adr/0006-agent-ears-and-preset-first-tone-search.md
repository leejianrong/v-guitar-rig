# ADR-0006: The agent hears through offline render descriptors and searches presets before writing code

- Status: Accepted
- Date: 2026-11-03
- Deciders: Jian

## Context

Prompts like "sound like David Gilmour" or "make it spacier and dreamier" must be turned into a board. An LLM cannot listen, and generating a new module for every request is slow and risky. A library of known amp and pedal chains makes most requests a parameter-tuning problem.

## Decision

- The MCP and CLI expose `render(board, input)` which runs offline in the daemon on a test signal or a DI clip and returns numeric descriptors (RMS, crest factor, spectral centroid and rolloff, band energies, THD, decay time, delay tap times) plus an optional spectrogram PNG. Descriptors are the agent's feedback loop.
- Tone requests follow a fixed order: (1) search presets and library modules by tags and descriptions for a matching amp + pedal chain; (2) set and tweak knobs, verifying with `render`; (3) write a new module only if nothing fits.
- Presets carry tags (artist, era, genre, descriptors like "spacey", "dreamy", "fuzzy") so search is cheap and deterministic. M1 relies on the LLM's own knowledge of artist gear; matching against a reference recording is the later tone-match milestone.

## Alternatives considered

| Option | Why not |
|--------|---------|
| Always generate new modules | Slow, unsafe, wastes the shipped library |
| Agent tunes by guessing blind | No feedback means no convergence |
| Reference-audio matching in M1 | Needs stem separation and an optimiser; deferred |

## Consequences

Buys: fast, grounded results and a direct route to tone matching later (same render, same descriptors). Costs: descriptor quality limits how well the agent can judge "dreamy"; requires the Q23 parity guarantee so offline numbers describe what the user actually hears.
