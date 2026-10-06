//! lodeflow-layout — a layered flow-diagram layout engine that follows the ten
//! Flying Logic layout rules (see `projects/lodeflow/AGENTS.md`).
//!
//! Native builds use `std` (tests, benchmarks). `wasm32` builds are `no_std + alloc`
//! with an arena allocator and a four-function C ABI; see `codec` for the wire format.

#![cfg_attr(target_arch = "wasm32", no_std)]
// Index loops are deliberate here (parallel arrays over vertex ids); NaN-aware comparisons too.
#![allow(
    clippy::needless_range_loop,
    clippy::too_many_arguments,
    clippy::neg_cmp_op_on_partial_ord,
    clippy::ptr_arg,
    clippy::manual_memcpy
)]

extern crate alloc;

mod bk;
pub mod codec;
mod graph;
pub mod layout;
pub mod math;
mod order;
mod place;
pub mod types;
mod untangle;

pub use layout::{layout, layout_many};
pub use types::*;

#[cfg(target_arch = "wasm32")]
mod wasm {
    use alloc::vec::Vec;
    use core::alloc::{GlobalAlloc, Layout};
    use core::arch::wasm32::{memory_grow, memory_size};

    /// Arena with size classes. Every block is a power of two (at least 16 bytes, 16-aligned);
    /// a freed block goes on its size's free list and is reused, so memory stays near what the
    /// layout actually holds; memory grows by doubling, so a big first layout makes few
    /// `memory.grow` calls. Everything is dropped at once at the start of each layout.
    struct Arena;
    static mut BASE: usize = 0;
    static mut TOP: usize = 0;
    static mut FREE: [usize; 64] = [0; 64];

    /// Size class: the smallest power of two (≥ 16 bytes) that holds `size`, as its exponent.
    fn class_of(size: usize) -> usize {
        let s = if size < 16 { 16 } else { size };
        (usize::BITS - (s - 1).leading_zeros()) as usize
    }

    unsafe fn free_list() -> *mut usize {
        core::ptr::addr_of_mut!(FREE) as *mut usize
    }

    /// Blocks larger than this are carved exactly and never reused (a power-of-two class for
    /// them could pass the 4 GB address space).
    const HUGE: usize = 1 << 30;

    /// Makes sure memory reaches `end`, doubling it (at most 256 MB a step) rather than
    /// growing by the exact amount, then falling back to the exact amount. Byte counts are
    /// 64-bit here: 65,536 pages of 64 kB is 4 GB, one past what a 32-bit `usize` holds.
    unsafe fn ensure(end: u64) -> bool {
        let pages = memory_size(0);
        let have = pages as u64 * 65536;
        if end <= have {
            return true;
        }
        let need = ((end - have + 65535) / 65536) as usize;
        let more = if need > pages.min(4096) { need } else { pages.min(4096) };
        memory_grow(0, more) != usize::MAX || memory_grow(0, need) != usize::MAX
    }

    /// Carves `size` bytes from the top of the arena. Address arithmetic is checked: near the
    /// 4 GB limit a wrap-around would hand out memory that is already in use, so an allocation
    /// that does not fit fails (and the layout stops with an error) instead.
    unsafe fn bump(size: usize, align: usize) -> *mut u8 {
        if BASE == 0 {
            BASE = (memory_size(0) * 65536 + 15) & !15;
            TOP = BASE;
        }
        let p = (TOP as u64 + align as u64 - 1) & !(align as u64 - 1);
        let end = p + size as u64;
        let top = (end + 15) & !15;
        if top > u32::MAX as u64 || !ensure(end) {
            return core::ptr::null_mut();
        }
        TOP = top as usize;
        p as usize as *mut u8
    }

    unsafe impl GlobalAlloc for Arena {
        unsafe fn alloc(&self, l: Layout) -> *mut u8 {
            if l.align() > 16 || l.size() > HUGE {
                // Rare: an exact bump allocation, never reused.
                return bump(l.size(), l.align());
            }
            let c = class_of(l.size());
            let slot = free_list().add(c);
            let head = *slot;
            if head != 0 {
                *slot = *(head as *const usize);
                return head as *mut u8;
            }
            bump(1usize << c, 16)
        }
        unsafe fn dealloc(&self, p: *mut u8, l: Layout) {
            if l.align() > 16 || l.size() > HUGE {
                return;
            }
            let slot = free_list().add(class_of(l.size()));
            *(p as *mut usize) = *slot;
            *slot = p as usize;
        }
        unsafe fn realloc(&self, p: *mut u8, l: Layout, new_size: usize) -> *mut u8 {
            if l.align() <= 16 && l.size() <= HUGE && new_size <= HUGE && class_of(new_size) == class_of(l.size()) {
                return p;
            }
            let np = self.alloc(Layout::from_size_align_unchecked(new_size, l.align()));
            if !np.is_null() {
                core::ptr::copy_nonoverlapping(p, np, core::cmp::min(l.size(), new_size));
                self.dealloc(p, l);
            }
            np
        }
    }

    #[global_allocator]
    static ALLOC: Arena = Arena;

    #[panic_handler]
    fn panic(_: &core::panic::PanicInfo) -> ! {
        core::arch::wasm32::unreachable()
    }

    static mut IN_PTR: usize = 0;
    static mut IN_LEN: usize = 0;
    static mut OUT_PTR: usize = 0;

    /// Reset the arena and reserve `len` f64s for the input. Returns the input pointer.
    #[no_mangle]
    pub extern "C" fn lf_begin(len: usize) -> *mut f64 {
        unsafe {
            if BASE != 0 {
                TOP = BASE;
                let f = free_list();
                for c in 0..64 {
                    *f.add(c) = 0;
                }
            }
        }
        let mut v: Vec<f64> = Vec::with_capacity(len);
        v.resize(len, 0.0);
        let p = v.as_mut_ptr();
        core::mem::forget(v);
        unsafe {
            IN_PTR = p as usize;
            IN_LEN = len;
        }
        p
    }

    /// Run the layout on the input buffer. Returns the output length (in f64s).
    #[no_mangle]
    pub extern "C" fn lf_run() -> usize {
        let input = unsafe { core::slice::from_raw_parts(IN_PTR as *const f64, IN_LEN) };
        let out = crate::codec::run(input);
        let len = out.len();
        let p = out.as_ptr();
        core::mem::forget(out);
        unsafe {
            OUT_PTR = p as usize;
        }
        len
    }

    #[no_mangle]
    pub extern "C" fn lf_out() -> *const f64 {
        unsafe { OUT_PTR as *const f64 }
    }

    #[no_mangle]
    pub extern "C" fn lf_version() -> u32 {
        2
    }
}
