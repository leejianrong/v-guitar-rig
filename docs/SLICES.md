# Virtual Guitar Rig: Slices

Vertical increments. Each ends in something you can demonstrate. Slice 1 confronts the riskiest unknown (realtime circuit solving in a worklet, plus browser latency).

## V1: One circuit pedal, live

**Delivers:** R0, R5, R2 (partial)

**Build plan**

1. Scaffold pnpm monorepo, Rust crate, Vite app, Apache-2.0 LICENSE, CI that builds and runs tests.
2. Rust core: netlist parser (R, C, diode), MNA solver with Newton step, oversampling helper; compile to WASM.
3. AudioWorklet host that loads the WASM and runs a diode-clipper netlist at 128-frame blocks.
4. Input: `getUserMedia` with echo cancellation, noise suppression and AGC off, plus DI file loop fallback; output with a master limiter.
5. Minimal page: waveform and spectrogram of input and output, CPU headroom meter, latency loopback test button.
6. ngspice reference harness for the clipper transient.

**Demo:** Open the page, pick the DI loop or your interface, enable the clipper, hear distortion, see harmonics appear in the output spectrogram, and read round-trip latency and CPU headroom.

**Rests on assumptions:** Q3 (<= 40 ms is acceptable), Q17 (48 kHz, 128-frame blocks); if wrong, retune block size or prioritise a native host.

### Test plan

#### End-to-end

- In headless Chromium with a looped 110 Hz sine DI, enabling the clipper raises 3rd-harmonic energy at least 20 dB above the bypassed case.
- A 10-minute run reports zero worklet underruns, with measured CPU headroom of at least 4x for the clipper alone (render time per block <= 25% of block duration).
- Loopback measurement on the author's interface is recorded in the repo and is <= 40 ms (or the miss is documented as a native-host trigger).

#### Integration

- WASM solver output for a 1 kHz sine through the diode clipper matches the ngspice transient within 2% RMS error.
- The worklet loads, processes and unloads the WASM module without allocating in the audio callback.

#### Unit

- Solver converges (no NaN) for full-scale square, DC and silence inputs.
- Oversampler passband is flat to 0.1 dB up to 18 kHz and rejects images by at least 60 dB.

## V2: Daemon and offline render parity

**Delivers:** R6, R7

**Build plan**

1. Node daemon with HTTP/WS API, token auth, 127.0.0.1 bind; docker compose file serving UI and API.
2. Host the same WASM in Node; `rig render --board --input --out` plus `--json`.
3. Parity harness comparing worklet output (captured in Chromium) to Node render.
4. Rig directory with schema-versioned board file and watcher.

**Demo:** `docker compose up`, open the UI on Windows, and run `rig render` on the same board and clip; show both spectrograms match.

**Rests on assumptions:** Q25 (localhost-only exposure), Q23 (1e-5 parity).

### Test plan

#### End-to-end

- `docker compose up` then UI loads from Windows at localhost and connects with the session token.
- A request without a token is rejected and nothing is bound off 127.0.0.1.

#### Integration

- Offline render equals worklet capture within 1e-5 for the clipper on a 5 s clip.
- Stale-rev board write returns exit code 3 and the current state.

#### Unit

- Board schema validation rejects missing `schema` and unknown module ids.

## V3: Pedalboard and library UI

**Delivers:** R1, R2 (partial)

**Build plan**

1. Module registry and param schema for behavioral modules; loader in worklet and Node.
2. Ship a starter set: overdrive, fuzz, delay, chorus, reverb, tuner-style bypass, noise gate.
3. Library grid and board editor: add, reorder, bypass, knobs, with smoothing and 20 ms crossfade on swap.
4. Per-slot taps feeding the signal view.

**Demo:** Build a board of four pedals, reorder them while playing, and hear no clicks while the waveform and spectrogram follow each stage.

**Rests on assumptions:** Q15 (slot UUIDs), Q16 (param schema expressive enough).

### Test plan

#### End-to-end

- Reordering two pedals while a looped DI plays produces no sample discontinuity above -40 dBFS at the swap.
- Moving a knob updates the output within 50 ms and the UI knob reflects an agent-set value.

#### Integration

- Two concurrent board edits: the second with a stale rev is rejected, not lost.

#### Unit

- Taper functions map 0..1 to the declared range monotonically.
- Parameter smoothing reaches target within the declared time.

## V4: Per-effect real-time visuals

**Delivers:** R2

**Build plan**

1. Analysis tap ring buffer to the main thread; FFT and spectrogram renderer on OffscreenCanvas.
2. Transfer-curve probe, impulse and frequency response measurement on a module copy.
3. Before/after spectrum, envelope follower, declared-descriptor widgets (delay taps, LFO).
4. Frame-budget instrumentation.

**Demo:** Select a fuzz pedal and see its measured transfer curve and before/after spectrum update live as you turn the gain knob; select the delay and see its tap times drawn.

**Rests on assumptions:** Q10 (host-drawn only).

### Test plan

#### End-to-end

- With six modules active the UI holds >= 55 fps average over 60 s while audio has zero underruns.
- The transfer curve of a hard clipper shows the declared clip level within 1 dB.

#### Integration

- Probe measurement does not change live output (bit-identical with and without the probe running).

#### Unit

- FFT of a known sine puts peak energy in the correct bin; frequency-response probe of a known filter matches its analytic response within 0.5 dB.

## V5: Vibe-code a pedal through MCP and CLI

**Delivers:** R3, R6

**Build plan**

1. MCP server and CLI commands: `module new`, `module check`, `board set`, `render` with descriptors and optional spectrogram PNG.
2. Safety gate: compile, schema, stability tests, CPU budget; Node worker with permission model.
3. Auto-bypass on runtime fault with error returned to UI and agent.
4. Documented agent workflow prompt (spec for the LLM client).

**Demo:** In an LLM client attached to the MCP, ask for "a warm tape-style echo"; watch the module appear, pass the gate, and play, with descriptors returned to the agent.

**Rests on assumptions:** Q21 (descriptors are enough feedback), Q24 (sandbox adequate).

### Test plan

#### End-to-end

- A scripted MCP client creates a compiling pedal from a fixed spec within 3 attempts and activates it on a board.
- A module that outputs NaN is auto-bypassed within one block and the board keeps playing.

#### Integration

- A module that tries `fs` or network access inside the Node worker is denied and reported with exit code 4.
- `render` returns identical descriptors on repeated runs of the same board and input.

#### Unit

- Stability gate rejects infinite gain, NaN and unbounded growth; accepts a well-behaved filter.

## V6: Presets, hand-DSP amp and prompt-to-tone search

**Delivers:** R4

**Build plan**

1. Behavioral amp (preamp waveshaper, tone stack, power-stage sag) and IR cab via partitioned convolution; bundle only licence-cleared IRs.
2. Preset schema with tags (artist, era, genre, descriptors); ~12 starter presets.
3. `preset search` tool and the preset-first workflow in the MCP guidance.
4. Knob-tuning loop using `render`.

**Demo:** Prompt "I want to sound like David Gilmour"; the agent picks a chain, loads it, and then "more spacey and dreamy" raises delay feedback and reverb mix.

**Rests on assumptions:** Q14 (original names), Q29 (oversampling and IR cabs).

### Test plan

#### End-to-end

- A fixed prompt set returns a preset whose tags match for at least 8 of 10 prompts.
- "More spacey" raises measured reverb/delay tail time by a stated minimum without exceeding output limits.

#### Integration

- Search results are deterministic for the same library and query.

#### Unit

- Convolution of an impulse reproduces the IR within 1e-6; amp output stays bounded for full-scale input.

## V7: NAM amp preset

**Delivers:** R4, R0 (realism)

**Build plan**

1. Integrate the NAM WASM runtime as a Capture module kind.
2. Package one licence-cleared capture; add it to a shipped preset.
3. Runtime CPU budget check and fallback to the behavioral amp if over budget.

**Demo:** Switch a preset between the behavioral amp and the NAM capture and hear and see the difference in spectrogram.

**Rests on assumptions:** Q8 (NAM only for shipped presets), Q30 (licence acceptable under Apache-2.0).

### Test plan

#### End-to-end

- The NAM preset plays with zero underruns on the author's machine for 10 minutes.

#### Integration

- A capture exceeding the CPU budget triggers fallback to the behavioral amp, with a visible notice.

#### Unit

- The capture module exposes the common param schema and reports its sample rate.

## Later milestones (not sliced yet)

- M2: circuit builder, more parts (BJT, JFET, op-amp, triode), schematic view, BOM export.
- M3: public registry and hosted playground.
- M4: tone match from a track; digital twin; manufacturing.
