//! Host-agnostic DSP core (ADR-0001). No browser or OS calls in this crate:
//! the same code runs in an AudioWorklet, in Node, and later in a native host.

/// Block size in frames used by every host (docs/PLAN.md, Q17).
pub const BLOCK_FRAMES: usize = 128;

/// Reference sample rate in Hz (docs/PLAN.md, Q17).
pub const SAMPLE_RATE: f32 = 48_000.0;

/// Placeholder processing entry point: copies `input` to `output`.
/// Replaced by the netlist solver in V1.
pub fn process(input: &[f32], output: &mut [f32]) {
    let n = input.len().min(output.len());
    output[..n].copy_from_slice(&input[..n]);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn passthrough_copies_block() {
        let input = [0.25_f32; BLOCK_FRAMES];
        let mut output = [0.0_f32; BLOCK_FRAMES];
        process(&input, &mut output);
        assert_eq!(input, output);
    }
}
