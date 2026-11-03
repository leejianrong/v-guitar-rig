# ADR-0007: A circuit netlist of real parts is the single source of truth, solved by a Rust/WASM nodal solver

- Status: Accepted
- Date: 2026-11-03
- Deciders: Jian

## Context

The long-term goal is to build pedals and amps from real transistors, tubes and ICs, then offer a bill of materials or manufacturing. The sound, the schematic and the BOM must agree. Nonlinear circuits must run in real time at audio rate with oversampling.

## Decision

- A circuit module is a declarative netlist: parts with part numbers and values (R, C, pots, diodes, BJTs, JFETs, op-amps, triodes), nodes, and a knob-to-component mapping.
- The Rust core compiles a netlist into a solver using modified nodal analysis with a Newton-Raphson step per sample (companion models for reactive parts, trapezoidal integration), at 2x-4x oversampling. Wave digital filter structures may replace it for specific known topologies if profiling demands.
- Schematic view and BOM are generated from the same netlist.
- Device models come from a part database with documented sources (datasheet fits, Koren-style tube models). Third-party SPICE model files are not redistributed unless their licence allows.
- Correctness is checked against an independent fine-step backward-Euler reference in the test suite (V1), and later against ngspice transient runs (reference only, BSD) within a stated tolerance.
- M1 proves one circuit-solved pedal (diode clipper first, then a one-transistor stage). Builder UI, LLM-authored netlists, BOM export and manufacturing are later milestones; pedals precede tube amps.

## Alternatives considered

| Option | Why not |
|--------|---------|
| Behavioral models only | Cannot produce a real BOM or true part-level behaviour |
| Wrap ngspice/Xyce | Not realtime, native-only, awkward in a worklet |
| WDF-only | Great for fixed topologies, poor for arbitrary user-built nonlinear circuits |

## Consequences

Buys: sound, schematic and BOM from one artifact. Costs: a nonlinear solve per sample is the dominant CPU risk and full multi-tube amps may not fit in one worklet (fallback: solve the preamp, model the power stage behaviorally); the part database needs licence curation and tolerance modelling before manufacturing claims; high-voltage amps add safety and certification duties.
