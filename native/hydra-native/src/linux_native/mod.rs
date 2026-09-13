//! Linux desktop adapters. X11 and SDL are optional; no compositor security
//! boundary is bypassed and no game process is injected into or input-grabbed.

#[cfg(target_os = "linux")]
pub mod controllers;
#[cfg(target_os = "linux")]
pub mod desktop;
#[cfg(target_os = "linux")]
pub mod processes;

/// /proc/PID/stat's command field can itself contain whitespace and ')'.
pub fn parse_process_stat(value: &str) -> Option<(u32, String)> {
    let close = value.rfind(')')?;
    let fields: Vec<_> = value.get(close + 1..)?.split_whitespace().collect();
    let parent = fields.get(1)?.parse().ok()?;
    let start: u64 = fields.get(19)?.parse().ok()?;
    Some((parent, start.to_string()))
}

/// SDL's standard controller layout to the existing overlay XInput bit mask.
pub fn controller_mask(buttons: &[bool; 15], left_x: i16, left_y: i16) -> u32 {
    const BUTTON_MASKS: [u32; 15] = [
        0x1000, 0x2000, 0x4000, 0x8000, 0x0020, 0x0400, 0x0010, 0x0040, 0x0080, 0x0100, 0x0200,
        0x0001, 0x0002, 0x0004, 0x0008,
    ];
    let mut mask = buttons
        .iter()
        .zip(BUTTON_MASKS)
        .fold(0, |mask, (pressed, bit)| {
            mask | if *pressed { bit } else { 0 }
        });
    if left_x < -12_000 {
        mask |= 0x0004;
    }
    if left_x > 12_000 {
        mask |= 0x0008;
    }
    // SDL's vertical axis is negative up (XInput has the opposite polarity).
    if left_y < -12_000 {
        mask |= 0x0001;
    }
    if left_y > 12_000 {
        mask |= 0x0002;
    }
    mask
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn proc_stat_handles_parentheses_and_spaces() {
        let line = format!(
            "42 (game (wine) name) S 7 {} 123456 0",
            vec!["0"; 17].join(" ")
        );
        assert_eq!(parse_process_stat(&line), Some((7, "123456".into())));
        assert_eq!(parse_process_stat("42 (broken) R 2"), None);
    }

    #[test]
    fn maps_guide_face_bumpers_chord_and_axes_without_stick_drift() {
        let mut buttons = [false; 15];
        buttons[0] = true;
        buttons[5] = true;
        buttons[9] = true;
        assert_eq!(controller_mask(&buttons, 0, 0), 0x1500);
        assert_eq!(controller_mask(&[false; 15], -12_001, -12_001), 0x0005);
        assert_eq!(controller_mask(&[false; 15], 12_001, 12_001), 0x000a);
        assert_eq!(controller_mask(&[false; 15], 12_000, -12_000), 0);
        buttons = [false; 15];
        buttons[4] = true;
        buttons[6] = true;
        assert_eq!(controller_mask(&buttons, 0, 0), 0x0030);
    }
}
