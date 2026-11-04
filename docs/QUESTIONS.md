# Questions

Statuses: `DECIDED` (user answered) · `ASSUMED` (default taken, correct it if wrong) · `FORK` (waiting on the user) · `DEFERRED` (not needed this milestone).

## Open forks

None. Round 1 closed (1 of 3 rounds used).

## Register

| ID | Question | Status | Answer or default | Landed |
|----|----------|--------|-------------------|--------|
| Q1 | Hardware and OS | DECIDED | Windows, browser on Windows, dev shell in WSL2. Interface model unknown | ADR-0001 |
| Q2 | Where does realtime audio run | DECIDED | Browser AudioWorklet hosting a WASM DSP core; core is host-agnostic so Node (offline) and a native ASIO host can reuse it | ADR-0001 |
| Q3 | Latency target | ASSUMED | Round trip <= 40 ms measured by loopback in V1 (stretch 30). Interface unknown, so the number is reported, not promised | ADR-0001 |
| Q4 | Module authoring format | DECIDED | Three module kinds: behavioral TypeScript, circuit netlist (solver in Rust->WASM), NAM capture. Common param schema | ADR-0003 |
| Q5 | Solver language | DECIDED | Rust crate compiled to WASM from V1. TS-only first cut rejected: V1 exists to test the real mechanism | ADR-0001, ADR-0007 |
| Q6 | Personal tool or hosted | DECIDED | Personal local-first for MVP. Later: online = shared registry + playground, local daemon = engine/library, Docker-like | ADR-0002 |
| Q7 | Licence and visibility | DECIDED | Public GitHub repo, Apache-2.0. Bundled content (IRs, NAM captures, part models) carries its own licence, checked per item; GPL dependencies excluded | PLAN §Open risks |
| Q8 | Amp sim approach | DECIDED | Shipped presets may use NAM captures; vibe-coded amps use generated behavioral DSP; scratch builds use netlists | ADR-0003 |
| Q9 | Prompt-to-tone strategy | DECIDED | Preset-first: search existing amp+pedal chains, then tweak knobs; write new modules only when nothing fits | ADR-0006 |
| Q10 | Who draws per-effect visuals | DECIDED | Host draws from measurements and module-declared descriptors. No module-supplied drawing code in M1 | ADR-0005 |
| Q11 | Circuit-from-scratch and BOM/manufacturing | DECIDED | Architecture supports it now (netlist is source of truth). M1 proves one circuit-solved pedal. Builder UI, BOM export, manufacturing are later milestones; pedals before tube amps | ADR-0007 |
| Q12 | M1 scope boundary | DECIDED | Pedals + one hand-DSP amp + one NAM amp preset + one circuit pedal; no track upload, no digital twin, no BOM, no accounts | PLAN §Scope |
| Q13 | Primary actors | ASSUMED | One guitarist; LLM agent is a second first-class actor through MCP/CLI. UI wins on conflict | PLAN §Users |
| Q14 | Brand names in shipped library | ASSUMED | Original names with "X-style" descriptions; no brand names or logos shipped | PLAN §Scope |
| Q15 | Entities and IDs | ASSUMED | Module (slug@semver), Board slot (UUID), Board (id + rev), Preset = saved board. Boards reference module by id+version | PLAN §Implementation |
| Q16 | Param schema | ASSUMED | Each module declares id, range, unit, default, taper. UI, MCP schemas and automation derive from it | ADR-0003 |
| Q17 | Signal format | ASSUMED | Mono in, stereo out, 48 kHz, float32, 128-frame blocks | PLAN §Implementation |
| Q18 | Storage | ASSUMED | Plain files in a rig directory (modules, boards, IRs, captures); no database; user's own git | ADR-0002 |
| Q19 | Concurrency | ASSUMED | Daemon single writer; boards carry rev; stale writes rejected with current state; param changes smoothed, module swaps crossfaded ~20 ms | ADR-0002 |
| Q20 | Interfaces | ASSUMED | UI, CLI, MCP all call one daemon API. CLI: `--json`, exit codes 0 ok, 2 validation, 3 stale rev, 4 module compile/safety failure | PLAN §Implementation |
| Q21 | Can the agent hear | ASSUMED | Yes, via offline render returning numeric descriptors and optional spectrogram image | ADR-0006 |
| Q22 | Failure behaviour | ASSUMED | Faulty module (compile error, throw, NaN, CPU over budget) auto-bypassed, board keeps playing, error surfaced; master limiter always on. No input device falls back to DI file | ADR-0004 |
| Q23 | Offline/online parity | ASSUMED | Offline render matches browser output within 1e-5 for the same input | ADR-0001 |
| Q24 | Sandbox for generated code | ASSUMED | AudioWorklet scope (no DOM/network) in browser; separate Node process with permission model, a bare vm realm and a time limit offline | ADR-0004 |
| Q25 | Daemon exposure | ASSUMED | Binds 127.0.0.1 with per-session token; compose publishes only localhost. Hosted exposure is a later decision | ADR-0002 |
| Q26 | Secrets | ASSUMED | Project holds no LLM credentials; the user's LLM client calls our MCP. Nothing sensitive to log | n/a |
| Q27 | Versioning | ASSUMED | `schema: 1` field on module and board files from day one; migrations deferred | PLAN §Implementation |
| Q28 | UI stack | ASSUMED | TypeScript, Vite, React; Canvas2D/WebGL visuals; visuals never on the audio thread | PLAN §Implementation |
| Q29 | Oversampling and cab | ASSUMED | 2x-4x polyphase oversampling helper for nonlinear stages; cab via partitioned FFT convolution of IR files | PLAN §Implementation |
| Q30 | Dependency licences | ASSUMED | MIT/Apache/BSD only in the shipped path. ngspice (BSD) used as a test reference only. NAM runtime (MIT). Faust rejected (GPL toolchain) | PLAN §Open risks |
| Q31 | Tone matching from a track | DEFERRED | Stem separation (Demucs, MIT) -> descriptors -> optimiser over board params using offline render. Needs Q23 | PLAN §Out |
| Q32 | Digital twin | DEFERRED | Pitch/onset from audio plus a playability prior over fretboard positions. Expect plausible hands, not true hands | PLAN §Out |
| Q33 | Manufacturing safety and regulation | DEFERRED | Pedals (9 V) first; tube amps carry high-voltage and certification duties | PLAN §Out |

## Coverage

| Category | Covered by |
|----------|-----------|
| Primary user and actors | Q13 |
| Scope boundary | Q11, Q12, Q14 |
| Data model and identity | Q15, Q16, Q17 |
| State and storage | Q18 |
| Concurrency and conflict | Q19 |
| Interfaces and contracts | Q20, Q21 |
| Failure behaviour | Q22 |
| External dependencies | Q5, Q8, Q29, Q30 |
| Runtime and deployment | Q1, Q2, Q6, Q25 |
| Measurable success | Q3, Q23, PLAN §Requirements, SLICES e2e tests |
| Security and secrets | Q24, Q25, Q26 |
| Versioning and migration | Q27 |
| Visualisation (domain) | Q10 |
| Circuit modelling (domain) | Q4, Q11 |
