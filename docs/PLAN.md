# Virtual Guitar Rig: Plan

Status: agreed · Milestone: M1 (proof of concept)

## Problem

Guitarists who want to experiment with tone have to buy pedals and amps, or learn plugin DSP and circuit design to make their own. Existing amp sims are closed boxes: you pick from a catalogue, you cannot see inside the signal, and you cannot say "make it more spacey" and have the rig respond.

The long-term goal is a rig where anyone can describe a tone, hear it, see exactly what each effect does to the signal, and eventually design a real pedal from real parts and get a bill of materials or a manufactured unit.

## Solution

A web app (plus local daemon) where you plug a guitar into your audio interface and play through a virtual pedalboard and amp. You see your pedals, amps and boards in a polished UI, watch waveforms and spectrograms along the signal chain, and see live graphs for every effect. You talk to your own LLM (via MCP or CLI) with prompts like "I want to sound like David Gilmour". It finds the closest existing amp and pedal chain, tunes the knobs, and only writes a new pedal or amp when nothing fits. Later you can build effects from transistors, tubes and ICs, drop in a track to replicate its guitar tone, and see a virtual guitarist's hands mirror your playing.

## Users and actors

- **Primary: one guitarist** on one machine (the author, on Windows with the browser on Windows and Docker in WSL2).
- **Second first-class actor: an LLM agent** reached through MCP or CLI, using the user's own LLM subscription.
- When they conflict, the human at the UI wins; the agent's stale write is rejected with current state (ADR-0002).
- Later: public visitors using the hosted playground and a shared registry.

## Scope

**In M1.**
- Live guitar input (or DI file fallback) through a board of modules to the output, round-trip latency measured and reported.
- Library browser for pedals, amps, cabs and boards; board editor with knobs, bypass, reorder.
- Module kinds: behavioral TypeScript, one circuit-solved pedal, NAM capture for shipped amp presets (ADR-0003).
- Live waveform, spectrogram, and host-drawn per-effect visuals (ADR-0005).
- Daemon in docker compose with an HTTP API plus server-sent events, CLI and MCP; offline render with parity to the browser.
- Vibe-coding behavioral pedals and amps safely (ADR-0004).
- Preset-first prompt-to-tone search and knob tuning (ADR-0006).
- A shipped starter library with original names, no brand names or logos.

**Out.**
- Track upload, stem separation, tone matching (deferred, but offline render and descriptors are built now because they are its foundation).
- Digital twin / hand tracking (deferred; expect plausible hands rather than exact fretting).
- Circuit builder UI, LLM-authored netlists, BOM export, manufacturing (later milestones; pedals before tube amps, which add high-voltage and certification duties).
- Accounts, hosted multi-user service, registry, mobile, VST/AU export, MIDI controllers.
- Native ASIO host (kept possible by ADR-0001, built only if measured latency is a problem).

## Requirements

| ID | Requirement | Status |
|----|-------------|--------|
| R0 | Play a real guitar through a virtual rig and see the signal pass through each effect | Core goal |
| R1 | See and edit pedals, amps and pedalboards in a web UI | Must-have |
| R2 | Show waveforms, spectrograms and live per-effect visuals at 60 fps without audio dropouts | Must-have |
| R3 | Create new pedals and amps through MCP/CLI prompts, safely | Must-have |
| R4 | From a tone prompt, find an existing chain and tune it before writing new code | Must-have |
| R5 | Model a pedal from real parts (diodes, transistors) in real time from a netlist | Must-have (one example in M1) |
| R6 | Offline render matches live audio, giving the agent numeric feedback | Must-have |
| R7 | Run locally with docker compose; rig files are portable, versioned, and registry-ready | Must-have |
| R8 | Later: tone match from a track, digital twin, BOM and manufacturing | Out of M1 |

## Shape

| Part | Mechanism | ADR |
|------|-----------|-----|
| S1 | Rust DSP core compiled to WASM (solver, convolver, oversampler) hosted in an AudioWorklet and in Node | ADR-0001 |
| S2 | Daemon: single write path HTTP → validate → rev check → persist file → broadcast over server-sent events; MCP and CLI call it | ADR-0002 |
| S3 | Module registry with three kinds sharing one param schema | ADR-0003 |
| S4 | Safety gate and sandbox: worklet scope, Node worker with permissions, stability tests, auto-bypass, master limiter | ADR-0004 |
| S5 | Analysis taps (ring buffer) and host-drawn visuals on the main thread / OffscreenCanvas | ADR-0005 |
| S6 | Offline renderer plus descriptor extraction; preset search by tags | ADR-0006 |
| S7 | Netlist compiler → MNA/Newton solver in the Rust core | ADR-0007 |
| S8 | Rig directory of plain files in a user git repo, schema-versioned | ADR-0002 |

## Affordances

**UI.**

| Affordance | Place | Wires to |
|------------|-------|----------|
| Library grid (pedals, amps, cabs, boards) | Library | S3 |
| Board editor: drag order, knobs, bypass | Board | S2 |
| Signal view: waveform and spectrogram per tap | Board | S5 |
| Per-effect panel: before/after spectrum, transfer curve, response, envelope | Pedal detail | S5 |
| Input picker, latency readout, CPU headroom meter | Header | S1 |
| Fault banner for auto-bypassed module | Board | S4 |

**Non-UI.**

| Affordance | Kind | Wires to |
|------------|------|----------|
| `rig serve`, `rig render`, `rig module new/check`, `rig board get/set`, `rig preset search` | CLI (`--json`, exit codes 0/2/3/4) | S2 |
| MCP tools mirroring the CLI plus `render` with descriptors | MCP server (stdio) | S2, S6 |
| Rig directory watcher | Daemon handler | S8 |
| Module gate (compile, schema, stability, CPU) | Daemon job | S4 |

## Implementation decisions

- **Entities and IDs:** Module (`slug@semver`), Board slot (UUID, stable across reorder), Board (id + `rev`), Preset = saved board with tags. Boards reference modules by id and version. Files carry `schema: 1`.
- **Signal:** mono in, stereo out, 48 kHz, float32, 128-frame blocks. Nonlinear stages use a 2x-4x polyphase oversampling helper. Cabs are partitioned FFT convolution of IR files.
- **Param schema:** id, range, unit, default, taper, optional switch values; drives UI, MCP tool schemas and automation (ADR-0003).
- **Stack:** TypeScript monorepo (pnpm) with Vite and React for UI, Node for daemon and CLI, Rust crate for the core. Visuals on Canvas2D/WebGL.
- **Failure:** faulty module auto-bypassed, board continues, error returned to UI and agent. No input device falls back to a DI file loop.
- **Security:** daemon on 127.0.0.1 with a session token; no credentials held; nothing sensitive logged (ADR-0002, ADR-0004).
- **Brand names:** shipped modules use original names with "X-style" descriptions.

## Testing approach

Test at three seams, highest first: end-to-end in a real Chromium against a looped DI file (no hardware needed); daemon integration over HTTP/CLI/MCP including offline-vs-browser parity; unit tests for DSP against known signals and ngspice reference runs. Good tests assert audible-domain behaviour (spectra, levels, latency, no NaN), not internals. Real-hardware latency and feel is a manual check recorded per release because CI has no sound card. Per-slice plans live in SLICES.md.

## Assumed defaults

| ID | Assumed | Cost if wrong |
|----|---------|---------------|
| Q3 | Round trip <= 40 ms is acceptable on the user's interface | Days: prioritise the native ASIO host (ADR-0001 keeps it open) |
| Q13 | Single human user plus one agent | Low until the hosted milestone |
| Q17 | Mono in, stereo out at 48 kHz, 128-frame blocks | Low: constants in one place, but the parity tests encode them |
| Q28 | React, Vite, Canvas2D/WebGL | Low: UI-only |
| Q29 | 2x-4x oversampling and IR cabs | Medium: aliasing artefacts would force a better helper |

## Open risks

- **Realtime nonlinear solve cost** (ADR-0007). Revealed by V1; fallback is behavioral approximation of heavy stages.
- **Browser latency floor on Windows shared-mode audio** (ADR-0001). Revealed by V1 loopback test.
- **Parity between worklet and Node** (Q23). Revealed by V2.
- **Licensing of bundled content**: NAM captures, IRs, and device models each need a licence that allows redistribution under an Apache-2.0 project; GPL dependencies are excluded. Checked before V6/V7 bundle anything.
- **Descriptor adequacy**: numeric descriptors may not capture "dreamy". Revealed by V5; fallback is richer spectrogram images for multimodal agents.
- **Tone matching and digital twin feasibility**: not designed here; string/fret ambiguity makes true hand recovery impossible without playing priors.
