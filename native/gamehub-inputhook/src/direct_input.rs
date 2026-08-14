//! DirectInput capability boundary.
//!
//! DirectInput cannot be declared covered until every live COM interface,
//! including cached and QueryInterface-derived device interfaces, can be
//! patched without racing the game and every active data format can be made
//! neutral without inventing axis values. The current implementation does not
//! meet that bar, so it deliberately reports a loaded DirectInput stack as
//! unsupported. An absent stack is vacuously safe and does not claim the
//! DirectInput capability bit.

pub const CAPABILITY_DIRECT_INPUT: u32 = 1 << 4;

pub struct DirectInputSweep {
    pub capability_ready: bool,
    pub fast_sweep: bool,
    pub unsupported: bool,
    pub covered: usize,
    pub failed: usize,
}

pub fn capture_originals() {}

pub fn replacements() -> Vec<(usize, usize)> {
    Vec::new()
}

pub fn late_bound_replacement(_resolved: usize) -> Option<usize> {
    None
}

pub fn sweep(legacy_loaded: bool, direct8_loaded: bool) -> DirectInputSweep {
    let loaded = legacy_loaded || direct8_loaded;
    DirectInputSweep {
        capability_ready: false,
        fast_sweep: false,
        unsupported: loaded,
        covered: 0,
        failed: usize::from(loaded),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn absent_direct_input_is_vacuously_safe_without_capability_claim() {
        let result = sweep(false, false);
        assert!(!result.capability_ready);
        assert!(!result.unsupported);
        assert_eq!(result.failed, 0);
    }

    #[test]
    fn any_loaded_direct_input_stack_fails_closed() {
        for (legacy, direct8) in [(true, false), (false, true), (true, true)] {
            let result = sweep(legacy, direct8);
            assert!(!result.capability_ready);
            assert!(result.unsupported);
            assert_eq!(result.failed, 1);
        }
    }
}
