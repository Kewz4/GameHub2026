//! Deterministic Win32 input-polling fixture for the overlay gate regression.
//!
//! The parent test injects `gamehub-inputhook.dll`, then toggles the shared
//! target-scoped flag while this process holds F24 down. A real imported
//! GetAsyncKeyState call must report pressed -> neutral -> pressed.

#[cfg(target_os = "windows")]
use std::ffi::c_void;
#[cfg(target_os = "windows")]
use std::io::{self, BufRead, Write};

#[cfg(target_os = "windows")]
use windows_sys::Win32::System::LibraryLoader::{GetModuleHandleW, GetProcAddress};
#[cfg(target_os = "windows")]
use windows_sys::Win32::System::Threading::GetCurrentProcessId;
#[cfg(target_os = "windows")]
use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
    keybd_event, GetAsyncKeyState, KEYEVENTF_KEYUP, VK_F24,
};

#[cfg(target_os = "windows")]
fn pressed() -> bool {
    unsafe { GetAsyncKeyState(VK_F24 as i32) < 0 }
}

#[cfg(target_os = "windows")]
#[link(name = "Xinput9_1_0")]
extern "system" {
    fn XInputGetState(user_index: u32, state: *mut c_void) -> u32;
}

#[cfg(target_os = "windows")]
fn hook_status() -> (bool, bool, u32) {
    let module_name: Vec<u16> = "gamehub-inputhook.dll"
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect();
    let module = unsafe { GetModuleHandleW(module_name.as_ptr()) };
    if module.is_null() {
        return (false, false, 0);
    }
    let ready = unsafe { GetProcAddress(module, c"gamehub_input_hook_ready".as_ptr().cast()) };
    let Some(ready) = ready else {
        return (true, false, 0);
    };
    let ready: unsafe extern "system" fn() -> i32 = unsafe { std::mem::transmute(ready) };
    let status = unsafe { GetProcAddress(module, c"gamehub_input_hook_status".as_ptr().cast()) }
        .map(|status| {
            let status: unsafe extern "system" fn() -> u32 = unsafe { std::mem::transmute(status) };
            unsafe { status() }
        })
        .unwrap_or(0);
    (true, unsafe { ready() != 0 }, status)
}

#[cfg(target_os = "windows")]
fn main() {
    // Keep a real XInput import in the fixture so the handshake validates the
    // controller path as well as the Win32 keyboard path.
    let mut xinput_state = [0u8; 16];
    unsafe {
        XInputGetState(0, xinput_state.as_mut_ptr().cast());
    }
    unsafe { keybd_event(VK_F24 as u8, 0, 0, 0) };
    std::thread::sleep(std::time::Duration::from_millis(150));

    let mut stdout = io::stdout().lock();
    let _ = writeln!(
        stdout,
        "READY\t{}\t{}",
        unsafe { GetCurrentProcessId() },
        u8::from(pressed())
    );
    let _ = stdout.flush();

    for line in io::stdin().lock().lines() {
        match line.as_deref() {
            Ok("poll") => {
                let _ = writeln!(stdout, "POLL\t{}", u8::from(pressed()));
                let _ = stdout.flush();
            }
            Ok("status") => {
                let (loaded, ready, status) = hook_status();
                let _ = writeln!(
                    stdout,
                    "STATUS\t{}\t{}\t{}",
                    u8::from(loaded),
                    u8::from(ready),
                    status
                );
                let _ = stdout.flush();
            }
            Ok("exit") | Err(_) => break,
            _ => {}
        }
    }

    unsafe { keybd_event(VK_F24 as u8, 0, KEYEVENTF_KEYUP, 0) };
}

#[cfg(not(target_os = "windows"))]
fn main() {}
