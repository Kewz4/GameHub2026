#![cfg(windows)]
#![allow(dead_code)]

fn gate_latched() -> bool {
    false
}

fn invalidate_hook_state(_status: u32) {}

fn resolve(_module: &str, _symbol: &[u8]) -> usize {
    0
}

#[path = "../src/windows_gaming_input.rs"]
mod windows_gaming_input;
