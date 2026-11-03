# ADR-0005: The host draws per-effect visuals from measurements

- Status: Accepted
- Date: 2026-11-03
- Deciders: Jian

## Context

The user wants rich real-time graphs for each effect. If modules supplied their own drawing code, untrusted code would run on the main thread with DOM access, and every module would need a UI author.

## Decision

The host produces visuals for any module, with no module code involved: live waveform and spectrogram at taps between modules, before/after spectrum per module, a measured transfer curve (swept-level probe), measured impulse and frequency response, and an input/output envelope. A module may additionally declare data descriptors (for example delay tap times, LFO rate and shape, compression threshold) that the host renders with built-in widgets. Analysis runs on a tap in the worklet feeding a SharedArrayBuffer/ring buffer; drawing runs on the main thread or an OffscreenCanvas worker, never on the audio thread. Target 60 fps.

## Alternatives considered

| Option | Why not |
|--------|---------|
| Modules ship their own canvas code | Second sandbox needed (iframe or worker); security cost before the core is proven |
| Static pedal artwork only | Does not meet "interesting real-time visuals" |

## Consequences

Buys: every vibe-coded or circuit pedal gets visuals for free, safely. Costs: less bespoke flair per effect at first; measurement probes must run offline or on a copy so they do not disturb live audio. Custom module visuals are a later decision.
