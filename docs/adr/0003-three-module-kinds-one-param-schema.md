# ADR-0003: Three module kinds share one parameter schema

- Status: Accepted
- Date: 2026-11-03
- Deciders: Jian

## Context

Users want fast vibe-coded pedals and amps, realistic amps from captures, and eventually real transistor/tube/IC circuits. These have different authoring, accuracy and CPU trade-offs, yet must live on one pedalboard and one UI.

## Decision

A module is one of:

1. **Behavioral**: a TypeScript file exporting a `process(in, out, params)` function and a param schema (id, range, unit, default, taper). LLM-friendly; runs in worklet and Node.
2. **Circuit**: a netlist of real parts (see ADR-0007) solved by the Rust/WASM core. Exposes knobs by mapping params to component values (pots) and switches.
3. **Capture**: a Neural Amp Modeler model file run by the NAM WASM runtime, packaged only with shipped presets in M1. Cannot be vibe-coded.

All kinds expose the same param schema, bypass and metadata (name, description, category, schema version), so boards, UI knobs, MCP tool schemas and automation never branch on kind. Generated (vibe-coded) modules are behavioral in M1.

## Alternatives considered

| Option | Why not |
|--------|---------|
| Faust as the authoring language | Weaker LLM fluency; GPL compiler toolchain; adds a fourth language |
| Behavioral only | Fails the build-from-real-parts goal and the realism of shipped amps |
| Circuit only | Too slow to author and too heavy for quick vibe-coded tone changes |

## Consequences

Buys: one board model, honest trade-offs per kind. Costs: three loaders to maintain and test; the param schema must be expressive enough for pot tapers and switches from day one; NAM runtime adds weight to the bundle.
