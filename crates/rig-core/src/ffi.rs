//! C ABI for hosts (AudioWorklet, Node). No wasm-bindgen: hosts allocate buffers in
//! linear memory with `rig_alloc` and pass pointers.

use crate::solver::Circuit;
use std::sync::Mutex;

static LAST_ERROR: Mutex<String> = Mutex::new(String::new());

#[no_mangle]
pub extern "C" fn rig_alloc(len: usize) -> *mut u8 {
    let mut v = Vec::<u8>::with_capacity(len.max(1));
    let p = v.as_mut_ptr();
    std::mem::forget(v);
    p
}

/// # Safety
/// `ptr` must come from `rig_alloc(len)` and not be used afterwards.
#[no_mangle]
pub unsafe extern "C" fn rig_free(ptr: *mut u8, len: usize) {
    drop(Vec::from_raw_parts(ptr, 0, len.max(1)));
}

/// Parse a netlist and build a circuit. Returns null on error; see `rig_error_*`.
///
/// # Safety
/// `ptr..ptr+len` must be readable linear memory holding UTF-8.
#[no_mangle]
pub unsafe extern "C" fn rig_load(
    ptr: *const u8,
    len: usize,
    sample_rate: f32,
    oversample: u32,
) -> *mut Circuit {
    let text = String::from_utf8_lossy(std::slice::from_raw_parts(ptr, len)).into_owned();
    match Circuit::new(&text, sample_rate as f64, oversample as usize) {
        Ok(c) => Box::into_raw(Box::new(c)),
        Err(e) => {
            *LAST_ERROR.lock().unwrap() = e;
            std::ptr::null_mut()
        }
    }
}

#[no_mangle]
pub extern "C" fn rig_error_len() -> usize {
    LAST_ERROR.lock().unwrap().len()
}

/// # Safety
/// `out` must have room for `rig_error_len()` bytes.
#[no_mangle]
pub unsafe extern "C" fn rig_error_copy(out: *mut u8) {
    let e = LAST_ERROR.lock().unwrap();
    std::ptr::copy_nonoverlapping(e.as_ptr(), out, e.len());
}

/// # Safety
/// `c` from `rig_load`; `input` and `output` valid for `n` f32s.
#[no_mangle]
pub unsafe extern "C" fn rig_process(
    c: *mut Circuit,
    input: *const f32,
    output: *mut f32,
    n: usize,
) {
    let c = &mut *c;
    c.process(
        std::slice::from_raw_parts(input, n),
        std::slice::from_raw_parts_mut(output, n),
    );
}

/// # Safety
/// `c` from `rig_load`, not used afterwards.
#[no_mangle]
pub unsafe extern "C" fn rig_destroy(c: *mut Circuit) {
    drop(Box::from_raw(c));
}
