//! Host-agnostic DSP core (ADR-0001). No browser or OS calls in this crate:
//! the same code runs in an AudioWorklet, in Node, and later in a native host.

pub mod ffi;
pub mod netlist;
pub mod oversample;
pub mod solver;

pub use solver::Circuit;

/// Block size in frames used by every host (docs/PLAN.md, Q17).
pub const BLOCK_FRAMES: usize = 128;

/// Reference sample rate in Hz (docs/PLAN.md, Q17).
pub const SAMPLE_RATE: f32 = 48_000.0;
