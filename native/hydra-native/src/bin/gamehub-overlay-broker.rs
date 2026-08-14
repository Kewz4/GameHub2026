//! Retired elevated GameHub overlay helper.
//!
//! Older installs may still have a scheduled task pointing at this binary, so
//! the executable remains as an inert tombstone that exits immediately. It
//! intentionally creates no pipe and accepts no process injection, suspension,
//! file-output, or PresentMon operation. Compatible overlays use the
//! same-integrity native path in the GameHub process.

#![cfg_attr(target_os = "windows", windows_subsystem = "windows")]

#[cfg(test)]
fn supports_elevated_operation(_operation: &str) -> bool {
    false
}

fn main() {
    // Keep the retired scheduled-task target harmless and non-resident.
}

#[cfg(test)]
mod tests {
    use super::supports_elevated_operation;

    #[test]
    fn retired_broker_exposes_no_elevated_operation() {
        for operation in [
            "inject",
            "input.suspend",
            "input.resume",
            "presentmon.start",
            "presentmon.stop",
        ] {
            assert!(!supports_elevated_operation(operation), "{operation}");
        }
    }
}
