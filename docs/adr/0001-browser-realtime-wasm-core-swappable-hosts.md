# ADR-0001: Realtime audio runs in the browser on a WASM DSP core with swappable hosts

- Status: Accepted
- Date: 2026-11-03
- Deciders: Jian

## Context

The user plays through a USB interface on Windows; the browser runs on Windows, the dev shell and any Docker run in WSL2. Containers and WSL2 have no path to the Windows audio device, so a containerised realtime engine is impossible. The engine must also run offline (agent "ears", tests, later tone-matching) and should work for an install-free hosted playground. Circuit simulation is CPU heavy, so the core cannot be a slow path.

## Decision

All DSP (filters, convolver, circuit solver, helpers) lives in one core compiled to WASM. M1 hosts it in a browser AudioWorklet for live play. The Node daemon hosts the same WASM for offline render. The core makes no browser or OS calls so a native ASIO host can be added later without rewriting DSP. Behavioral TypeScript modules run in the same hosts as plain JS beside the core.

Latency target: round trip <= 40 ms (stretch 30), measured with a loopback test in V1 and reported, not promised.

## Alternatives considered

| Option | Why not |
|--------|---------|
| Browser-only with separate server DSP | Two codebases drift; offline render stops being trustworthy |
| Native Windows engine (Rust, ASIO) | Cannot run in Docker/WSL; every playground visitor must install; two runtimes |
| TS-only solver first, Rust later | V1 exists to test the real hot loop; a throwaway solver tests the wrong thing |

## Consequences

Buys: one DSP truth, install-free playground, a low-risk path to native. Costs: Rust and WASM in the toolchain; browser latency floor of roughly 20-50 ms on Windows shared-mode audio; WASM-in-worklet constraints (no allocation in the audio callback, SIMD availability). Requires an automated parity test between hosts (offline vs browser within 1e-5).
