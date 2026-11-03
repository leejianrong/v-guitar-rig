# v-guitar-rig

Virtual guitar rig: pedals and amp sims in the browser, live signal visualisation, LLM vibe-coding via MCP/CLI. Apache-2.0.

## Build status

Trust the code over the docs where they disagree, and update the docs in the same PR.

| Area | State |
|------|-------|
| Rust DSP core (`crates/rig-core`) | Stub passthrough; solver arrives in V1 |
| Shared param schema (`packages/shared`) | Done, tested |
| Web app, daemon, CLI, MCP | Not started (V1 web, V2 daemon, V5 MCP/CLI) |
| CI / pre-push | Rust + TS lint, types, unit tests. e2e and integration jobs arrive with V1/V2 |

## Commands

- `make` lists targets. `make install`, then `make hooks` once per clone.
- `make check` is the fast gate (lint + types + unit tests). Run it before proposing a push; it is what pre-push runs.
- `make wasm` builds the DSP core to WASM.
- Never put a slow or infra-needing check in `make check`.

## Workflow

- One branch per slice off fresh `main`; changes land by PR only, after CI is green.
- Every bug gets a failing test first. Tests assert behaviour (spectra, levels, no NaN), not internals.
- Keep `rig-core` free of browser/OS calls (ADR-0001). Generated module code is untrusted (ADR-0004).
- No secrets in git. `.env*` is ignored.

## Layout

- `crates/rig-core`: Rust DSP core, compiles to WASM.
- `packages/*`, `apps/*`: TypeScript workspaces (pnpm).
- `docs/`: `PLAN.md`, `SLICES.md`, `QUESTIONS.md`, `adr/`. Start at `docs/PLAN.md`.

## Work tracking

Pandan board `VGR` (one epic per slice, `VGR-E1`..`E7`). Use the `pandan` CLI.
