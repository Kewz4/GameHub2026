mod cloud_save;
mod constants;

pub use cloud_save::hashing::{build_snapshot_aggregate_hash, hash_local_save_file};
pub use cloud_save::local_snapshot::build_local_game_snapshot;
pub use cloud_save::manifest::get_save_rules_for_game;
pub use cloud_save::path_resolution::resolve_save_rules;
pub use cloud_save::pipeline::build_local_game_snapshot_pipeline;
pub use cloud_save::restore::{
    cleanup_restore_temp_snapshot, delete_local_save_targets, download_restore_blob_to_temp,
    replace_restore_targets, resolve_restore_targets, should_skip_restore_file,
    verify_downloaded_restore_file,
};
pub use cloud_save::save_scanner::scan_resolved_save_rules;
pub use cloud_save::upload::upload_local_save_blob;

use std::fs::File;
use std::io::BufReader;
use std::path::{Path, PathBuf};
use std::{cmp::Ordering, collections::HashMap};

#[cfg(target_os = "windows")]
use std::collections::{HashSet, VecDeque};

use image::codecs::gif::GifDecoder;
use image::codecs::png::PngDecoder;
use image::codecs::webp::WebPDecoder;
use image::{AnimationDecoder, ImageFormat, ImageReader};
use napi::bindgen_prelude::{Buffer, Error};
use napi_derive::napi;

#[cfg(target_os = "windows")]
mod win_inject;
use sysinfo::{ProcessesToUpdate, System};
use uuid::Uuid;

// ── In-game overlay ──────────────────────────────────────────────────────────
// Windows-only shortcut detection (Shift+F3 via raw input), XInput gamepad
// polling for Guide/navigation, plus the
// process-access / foreground-pid / elevation helpers the injected overlay uses
// to pick and attach to the running game. All Windows-gated; no-ops elsewhere.
#[cfg(target_os = "windows")]
use std::mem::{size_of, zeroed};
#[cfg(target_os = "windows")]
use std::ptr::{null, null_mut};
#[cfg(target_os = "windows")]
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering as AtomicOrdering};
#[cfg(target_os = "windows")]
use std::sync::mpsc;
#[cfg(target_os = "windows")]
use std::sync::{Mutex, OnceLock};
#[cfg(target_os = "windows")]
use std::thread;
#[cfg(target_os = "windows")]
use std::time::{Duration, Instant};

#[cfg(target_os = "windows")]
use windows_sys::Win32::Foundation::{
    CloseHandle, FreeLibrary, GetLastError, HWND, INVALID_HANDLE_VALUE, LPARAM, LRESULT, POINT,
    RECT, WPARAM,
};
#[cfg(target_os = "windows")]
use windows_sys::Win32::Graphics::Gdi::ClientToScreen;
#[cfg(target_os = "windows")]
use windows_sys::Win32::Security::{
    GetTokenInformation, TokenElevation, TOKEN_ELEVATION, TOKEN_QUERY,
};
#[cfg(target_os = "windows")]
use windows_sys::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS,
};
#[cfg(target_os = "windows")]
use windows_sys::Win32::System::LibraryLoader::{GetModuleHandleW, GetProcAddress, LoadLibraryExW};
#[cfg(target_os = "windows")]
use windows_sys::Win32::System::Memory::{
    CreateFileMappingW, MapViewOfFile, OpenFileMappingW, FILE_MAP_READ, FILE_MAP_WRITE,
    PAGE_READWRITE,
};
#[cfg(target_os = "windows")]
use windows_sys::Win32::System::Threading::{AttachThreadInput, GetCurrentThreadId};
#[cfg(target_os = "windows")]
use windows_sys::Win32::System::Threading::{
    GetCurrentProcess, GetCurrentProcessId, GetExitCodeProcess, OpenProcess, OpenProcessToken,
    TerminateProcess, WaitForSingleObject, PROCESS_CREATE_THREAD,
    PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_TERMINATE, PROCESS_VM_OPERATION, PROCESS_VM_READ,
    PROCESS_VM_WRITE,
};
#[cfg(target_os = "windows")]
use windows_sys::Win32::UI::Input::KeyboardAndMouse::GetAsyncKeyState;
#[cfg(target_os = "windows")]
use windows_sys::Win32::UI::Input::KeyboardAndMouse::SetActiveWindow;
#[cfg(target_os = "windows")]
use windows_sys::Win32::UI::Input::{
    GetRawInputData, RegisterRawInputDevices, HRAWINPUT, RAWINPUT, RAWINPUTDEVICE, RAWINPUTHEADER,
    RIDEV_INPUTSINK, RID_INPUT, RIM_TYPEKEYBOARD,
};
#[cfg(target_os = "windows")]
use windows_sys::Win32::UI::Shell::{
    ShellExecuteExW, SEE_MASK_NOASYNC, SEE_MASK_NOCLOSEPROCESS, SHELLEXECUTEINFOW,
};
#[cfg(target_os = "windows")]
use windows_sys::Win32::UI::WindowsAndMessaging::{
    BringWindowToTop, CreateWindowExW, DefWindowProcW, DispatchMessageW, EnumWindows,
    GetClientRect, GetForegroundWindow, GetMessageW, GetWindow, GetWindowLongW,
    GetWindowThreadProcessId, IsIconic, IsWindowVisible, RegisterClassW, SetForegroundWindow,
    SetWindowPos, ShowWindow, TranslateMessage, GWL_EXSTYLE, GW_OWNER, HWND_MESSAGE, HWND_TOPMOST,
    MSG, SWP_NOACTIVATE, SW_HIDE, SW_RESTORE, SW_SHOWNORMAL, WM_INPUT, WNDCLASSW, WS_EX_TOOLWINDOW,
};

// Per-app volume mixer (Core Audio) — higher-level `windows` COM bindings.
#[cfg(target_os = "windows")]
use windows::core::Interface;
#[cfg(target_os = "windows")]
use windows::Win32::Media::Audio::{
    eConsole, eRender, IAudioSessionControl2, IAudioSessionManager2, IMMDeviceEnumerator,
    ISimpleAudioVolume, MMDeviceEnumerator,
};
#[cfg(target_os = "windows")]
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_ALL, COINIT_MULTITHREADED,
};

#[cfg(target_os = "windows")]
static RAW_INPUT_STARTED: AtomicBool = AtomicBool::new(false);
#[cfg(target_os = "windows")]
static SHIFT_DOWN: AtomicBool = AtomicBool::new(false);
#[cfg(target_os = "windows")]
static F3_DOWN: AtomicBool = AtomicBool::new(false);
#[cfg(target_os = "windows")]
static COMBO_LATCHED: AtomicBool = AtomicBool::new(false);
#[cfg(target_os = "windows")]
static POLLED_COMBO_LATCHED: AtomicBool = AtomicBool::new(false);
#[cfg(target_os = "windows")]
static OVERLAY_KEYBOARD_EVENTS: AtomicU32 = AtomicU32::new(0);
#[cfg(target_os = "windows")]
static LAST_SHORTCUT_EVENT: OnceLock<Mutex<Option<Instant>>> = OnceLock::new();

#[cfg(target_os = "windows")]
#[repr(C)]
#[derive(Default)]
struct XInputGamepad {
    buttons: u16,
    left_trigger: u8,
    right_trigger: u8,
    thumb_lx: i16,
    thumb_ly: i16,
    thumb_rx: i16,
    thumb_ry: i16,
}

#[cfg(target_os = "windows")]
#[repr(C)]
#[derive(Default)]
struct XInputState {
    packet_number: u32,
    gamepad: XInputGamepad,
}

#[cfg(target_os = "windows")]
type XInputGetStateFn = unsafe extern "system" fn(u32, *mut XInputState) -> u32;

#[cfg(target_os = "windows")]
static XINPUT_GET_STATE_EX: OnceLock<Option<XInputGetStateFn>> = OnceLock::new();
#[cfg(target_os = "windows")]
static ELEVATED_PRESENTMON_PROCESS: OnceLock<Mutex<Option<ElevatedPresentMonProcess>>> =
    OnceLock::new();
#[cfg(target_os = "windows")]
const SYNCHRONIZE_ACCESS: u32 = 0x0010_0000;

#[cfg(target_os = "windows")]
struct ElevatedPresentMonProcess {
    handle: usize,
    stop_file: String,
}

#[napi(object)]
pub struct NativeWindowBounds {
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
    // HWND is pointer-sized. Expose it as a decimal string so JavaScript never
    // loses precision and Electron's `window:HWND:0` capture source can be
    // matched to the exact game window.
    pub window_id: String,
}

#[cfg(target_os = "windows")]
struct WindowSearch {
    pid: u32,
    window: HWND,
    bounds: RECT,
    area: i64,
    allow_minimized: bool,
}

#[cfg(target_os = "windows")]
unsafe extern "system" fn find_process_window(window: HWND, parameter: LPARAM) -> i32 {
    let search = unsafe { &mut *(parameter as *mut WindowSearch) };
    let mut pid = 0;
    unsafe { GetWindowThreadProcessId(window, &mut pid) };
    if pid != search.pid
        || unsafe { IsWindowVisible(window) } == 0
        || (!search.allow_minimized && unsafe { IsIconic(window) } != 0)
    {
        return 1;
    }
    if unsafe { GetWindowLongW(window, GWL_EXSTYLE) } as u32 & WS_EX_TOOLWINDOW != 0 {
        return 1;
    }
    if !unsafe { GetWindow(window, GW_OWNER) }.is_null() {
        return 1;
    }

    let mut client: RECT = unsafe { zeroed() };
    if unsafe { GetClientRect(window, &mut client) } == 0 {
        return 1;
    }
    let mut origin = POINT { x: 0, y: 0 };
    if unsafe { ClientToScreen(window, &mut origin) } == 0 {
        return 1;
    }
    let width = client.right - client.left;
    let height = client.bottom - client.top;
    let area = i64::from(width) * i64::from(height);
    if width > 0 && height > 0 && area > search.area {
        search.window = window;
        search.bounds = RECT {
            left: origin.x,
            top: origin.y,
            right: origin.x + width,
            bottom: origin.y + height,
        };
        search.area = area;
    }
    1
}

#[cfg(target_os = "windows")]
fn find_best_process_window(pid: u32, allow_minimized: bool) -> Option<(HWND, RECT)> {
    let mut search = WindowSearch {
        pid,
        window: null_mut(),
        bounds: unsafe { zeroed() },
        area: 0,
        allow_minimized,
    };
    unsafe {
        EnumWindows(
            Some(find_process_window),
            &mut search as *mut WindowSearch as LPARAM,
        );
    }
    (!search.window.is_null()).then_some((search.window, search.bounds))
}

#[cfg(target_os = "windows")]
fn process_window(pid: u32) -> Option<(HWND, RECT)> {
    find_best_process_window(pid, false)
}

#[cfg(target_os = "windows")]
#[link(name = "Xinput9_1_0")]
extern "system" {
    fn XInputGetState(user_index: u32, state: *mut XInputState) -> u32;
}

#[cfg(target_os = "windows")]
fn extended_xinput_get_state() -> Option<XInputGetStateFn> {
    *XINPUT_GET_STATE_EX.get_or_init(|| {
        // The documented XInputGetState entry point intentionally omits the
        // Guide button. Desktop XInput DLLs expose the otherwise identical
        // extended entry point at ordinal 100. Resolve it at runtime so the
        // standard XInput 9.1.0 path remains a safe fallback.
        const LOAD_LIBRARY_SEARCH_SYSTEM32: u32 = 0x0000_0800;
        const XINPUT_GET_STATE_EX_ORDINAL: usize = 100;

        for dll_name in ["xinput1_4.dll", "xinput1_3.dll"] {
            let wide_name: Vec<u16> = dll_name.encode_utf16().chain(std::iter::once(0)).collect();
            let module = unsafe {
                LoadLibraryExW(wide_name.as_ptr(), null_mut(), LOAD_LIBRARY_SEARCH_SYSTEM32)
            };
            if module.is_null() {
                continue;
            }

            let procedure =
                unsafe { GetProcAddress(module, XINPUT_GET_STATE_EX_ORDINAL as *const u8) };
            if let Some(procedure) = procedure {
                // Keep the module loaded for the process lifetime: the cached
                // function pointer is only valid while its DLL remains loaded.
                let get_state = unsafe {
                    std::mem::transmute::<unsafe extern "system" fn() -> isize, XInputGetStateFn>(
                        procedure,
                    )
                };
                return Some(get_state);
            }

            unsafe {
                FreeLibrary(module);
            }
        }

        None
    })
}

#[cfg(target_os = "windows")]
fn get_xinput_state(user_index: u32, state: &mut XInputState) -> u32 {
    if let Some(get_state) = extended_xinput_get_state() {
        let result = unsafe { get_state(user_index, state) };
        if result == 0 {
            return result;
        }
    }

    unsafe { XInputGetState(user_index, state) }
}

#[napi]
pub fn start_overlay_keyboard_watcher() -> bool {
    #[cfg(target_os = "windows")]
    {
        if RAW_INPUT_STARTED.swap(true, AtomicOrdering::AcqRel) {
            return true;
        }

        let (sender, receiver) = mpsc::sync_channel(1);
        thread::spawn(move || run_raw_input_thread(sender));
        let started = receiver
            .recv_timeout(std::time::Duration::from_secs(2))
            .unwrap_or(false);
        if !started {
            RAW_INPUT_STARTED.store(false, AtomicOrdering::Release);
        }
        started
    }

    #[cfg(not(target_os = "windows"))]
    false
}

#[napi]
pub fn get_overlay_keyboard_event_count() -> u32 {
    #[cfg(target_os = "windows")]
    {
        poll_overlay_combo();
        OVERLAY_KEYBOARD_EVENTS.load(AtomicOrdering::Acquire)
    }

    #[cfg(not(target_os = "windows"))]
    0
}

#[cfg(target_os = "windows")]
fn record_overlay_shortcut() {
    let now = Instant::now();
    let last_event = LAST_SHORTCUT_EVENT.get_or_init(|| Mutex::new(None));
    if let Ok(mut last_event) = last_event.lock() {
        if last_event
            .as_ref()
            .is_some_and(|last| now.duration_since(*last) < Duration::from_millis(250))
        {
            return;
        }
        *last_event = Some(now);
    }
    OVERLAY_KEYBOARD_EVENTS.fetch_add(1, AtomicOrdering::AcqRel);
}

#[cfg(target_os = "windows")]
fn poll_overlay_combo() {
    let shift_down = unsafe { GetAsyncKeyState(0x10) } as u16 & 0x8000 != 0;
    let f3_down = unsafe { GetAsyncKeyState(0x72) } as u16 & 0x8000 != 0;
    let active = shift_down && f3_down;

    if active && !POLLED_COMBO_LATCHED.swap(true, AtomicOrdering::AcqRel) {
        record_overlay_shortcut();
    } else if !active {
        POLLED_COMBO_LATCHED.store(false, AtomicOrdering::Release);
    }
}

#[cfg(target_os = "windows")]
fn update_overlay_combo(virtual_key: u16, pressed: bool) {
    match virtual_key {
        0x10 | 0xA0 | 0xA1 => SHIFT_DOWN.store(pressed, AtomicOrdering::Release),
        0x72 => F3_DOWN.store(pressed, AtomicOrdering::Release),
        _ => return,
    }

    let active = SHIFT_DOWN.load(AtomicOrdering::Acquire) && F3_DOWN.load(AtomicOrdering::Acquire);
    if active && !COMBO_LATCHED.swap(true, AtomicOrdering::AcqRel) {
        record_overlay_shortcut();
    } else if !active {
        COMBO_LATCHED.store(false, AtomicOrdering::Release);
    }
}

#[cfg(target_os = "windows")]
unsafe extern "system" fn raw_input_window_proc(
    window: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    if message == WM_INPUT {
        let mut input: RAWINPUT = unsafe { zeroed() };
        let mut size = size_of::<RAWINPUT>() as u32;
        let result = unsafe {
            GetRawInputData(
                lparam as HRAWINPUT,
                RID_INPUT,
                &mut input as *mut RAWINPUT as *mut _,
                &mut size,
                size_of::<RAWINPUTHEADER>() as u32,
            )
        };
        if result != u32::MAX && result > 0 && input.header.dwType == RIM_TYPEKEYBOARD {
            let keyboard = unsafe { input.data.keyboard };
            update_overlay_combo(keyboard.VKey, keyboard.Flags & 1 == 0);
        }
    }

    unsafe { DefWindowProcW(window, message, wparam, lparam) }
}

#[cfg(target_os = "windows")]
fn run_raw_input_thread(sender: mpsc::SyncSender<bool>) {
    unsafe {
        let instance = GetModuleHandleW(null());
        let class_name: Vec<u16> = "HydraOverlayRawInput\0".encode_utf16().collect();
        let window_class = WNDCLASSW {
            lpfnWndProc: Some(raw_input_window_proc),
            hInstance: instance,
            lpszClassName: class_name.as_ptr(),
            ..zeroed()
        };

        if RegisterClassW(&window_class) == 0 {
            let _ = sender.send(false);
            return;
        }

        let window = CreateWindowExW(
            0,
            class_name.as_ptr(),
            class_name.as_ptr(),
            0,
            0,
            0,
            0,
            0,
            HWND_MESSAGE,
            null_mut(),
            instance,
            null(),
        );
        if window.is_null() {
            let _ = sender.send(false);
            return;
        }

        let keyboard = RAWINPUTDEVICE {
            usUsagePage: 0x01,
            usUsage: 0x06,
            dwFlags: RIDEV_INPUTSINK,
            hwndTarget: window,
        };
        if RegisterRawInputDevices(&keyboard, 1, size_of::<RAWINPUTDEVICE>() as u32) == 0 {
            let _ = sender.send(false);
            return;
        }

        let _ = sender.send(true);
        let mut message: MSG = zeroed();
        while GetMessageW(&mut message, null_mut(), 0, 0) > 0 {
            TranslateMessage(&message);
            DispatchMessageW(&message);
        }
    }
}

#[napi(object)]
pub struct ProcessAccessStatus {
    pub can_inject: bool,
    pub error_code: u32,
}

#[napi]
#[cfg_attr(not(target_os = "windows"), allow(unused_variables))]
pub fn get_process_access_status(pid: u32) -> ProcessAccessStatus {
    #[cfg(target_os = "windows")]
    unsafe {
        let rights = PROCESS_CREATE_THREAD
            | PROCESS_QUERY_LIMITED_INFORMATION
            | PROCESS_VM_OPERATION
            | PROCESS_VM_WRITE
            | PROCESS_VM_READ;
        let handle = OpenProcess(rights, 0, pid);
        if handle.is_null() {
            return ProcessAccessStatus {
                can_inject: false,
                error_code: GetLastError(),
            };
        }
        CloseHandle(handle);
        ProcessAccessStatus {
            can_inject: true,
            error_code: 0,
        }
    }

    #[cfg(not(target_os = "windows"))]
    ProcessAccessStatus {
        can_inject: false,
        error_code: 0,
    }
}

#[napi]
pub fn get_foreground_process_id() -> u32 {
    #[cfg(target_os = "windows")]
    unsafe {
        let window = GetForegroundWindow();
        if window.is_null() {
            return 0;
        }
        let mut pid = 0;
        GetWindowThreadProcessId(window, &mut pid);
        pid
    }

    #[cfg(not(target_os = "windows"))]
    0
}

#[napi]
pub fn is_current_process_elevated() -> bool {
    #[cfg(target_os = "windows")]
    unsafe {
        let mut token = null_mut();
        if OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) == 0 {
            return false;
        }

        let mut elevation: TOKEN_ELEVATION = zeroed();
        let mut returned_size = 0;
        let result = GetTokenInformation(
            token,
            TokenElevation,
            &mut elevation as *mut TOKEN_ELEVATION as *mut _,
            size_of::<TOKEN_ELEVATION>() as u32,
            &mut returned_size,
        );
        CloseHandle(token);
        result != 0 && elevation.TokenIsElevated != 0
    }

    #[cfg(not(target_os = "windows"))]
    false
}

#[napi]
#[cfg_attr(not(target_os = "windows"), allow(unused_variables))]
pub fn launch_elevated(executable: String, parameters: String, working_directory: String) -> bool {
    #[cfg(target_os = "windows")]
    unsafe {
        let verb: Vec<u16> = "runas\0".encode_utf16().collect();
        let executable: Vec<u16> = executable
            .encode_utf16()
            .chain(std::iter::once(0))
            .collect();
        let parameters: Vec<u16> = parameters
            .encode_utf16()
            .chain(std::iter::once(0))
            .collect();
        let working_directory: Vec<u16> = working_directory
            .encode_utf16()
            .chain(std::iter::once(0))
            .collect();
        let mut execute_info: SHELLEXECUTEINFOW = zeroed();
        execute_info.cbSize = size_of::<SHELLEXECUTEINFOW>() as u32;
        execute_info.fMask = SEE_MASK_NOCLOSEPROCESS;
        execute_info.lpVerb = verb.as_ptr();
        execute_info.lpFile = executable.as_ptr();
        execute_info.lpParameters = parameters.as_ptr();
        execute_info.lpDirectory = working_directory.as_ptr();
        execute_info.nShow = SW_SHOWNORMAL;
        if ShellExecuteExW(&mut execute_info) == 0 {
            return false;
        }
        if !execute_info.hProcess.is_null() {
            CloseHandle(execute_info.hProcess);
        }
        true
    }

    #[cfg(not(target_os = "windows"))]
    false
}

#[cfg(target_os = "windows")]
fn stop_elevated_presentmon_process() -> bool {
    let process_slot = ELEVATED_PRESENTMON_PROCESS.get_or_init(|| Mutex::new(None));
    let mut process_slot = process_slot
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let Some(process) = process_slot.as_ref() else {
        return true;
    };

    let process_handle = process.handle as *mut std::ffi::c_void;
    let mut exit_code = 0;
    const STILL_ACTIVE: u32 = 259;
    let already_exited = unsafe { GetExitCodeProcess(process_handle, &mut exit_code) } != 0
        && exit_code != STILL_ACTIVE;

    // Ask the elevated bridge to stop PresentMon first. The bridge owns the
    // child handle and can terminate it even when GameHub remains at normal
    // integrity. If it does not exit promptly, retain the existing hard-stop
    // fallback for the bridge itself.
    if !already_exited {
        let _ = std::fs::write(&process.stop_file, b"stop");
    }
    // The bridge may need a moment to kill PresentMon and stop its ETW trace.
    // Waiting longer than the bridge's cleanup path avoids terminating the
    // bridge first and orphaning its elevated PresentMon child.
    let exited_after_signal =
        already_exited || unsafe { WaitForSingleObject(process_handle, 6_000) } == 0;
    if exited_after_signal || unsafe { TerminateProcess(process_handle, 0) } != 0 {
        unsafe {
            CloseHandle(process_handle);
        }
        let stop_file = process.stop_file.clone();
        let _ = std::fs::remove_file(stop_file);
        *process_slot = None;
        return true;
    }

    // Keep the only process handle when termination is denied or transiently
    // fails. A later stop can retry instead of orphaning the elevated session.
    false
}

#[cfg(target_os = "windows")]
fn quote_presentmon_argument(value: &str) -> String {
    // Windows paths cannot contain a quote, but escape it defensively so the
    // function remains safe if it is reused for a session name.
    format!("\"{}\"", value.replace('"', "\\\""))
}

#[napi]
#[cfg_attr(not(target_os = "windows"), allow(unused_variables))]
pub async fn launch_elevated_presentmon(
    executable: String,
    output_file: String,
    target_pid: u32,
    session_name: String,
) -> bool {
    #[cfg(target_os = "windows")]
    unsafe {
        if target_pid == 0 {
            return false;
        }

        // Retain the elevated process handle so GameHub can stop the collector
        // during target changes, preference changes, updates, and shutdown.
        if !stop_elevated_presentmon_process() {
            return false;
        }

        // The console application's --output_file handle is exclusive, so a
        // normal-integrity GameHub process cannot tail it while PresentMon is
        // elevated. Launch our tiny elevated bridge instead: it captures
        // PresentMon's row-flushed --output_stdout into a share-readable file.
        let Some(resources_directory) = Path::new(&executable).parent().and_then(Path::parent)
        else {
            return false;
        };
        let bridge_executable = resources_directory
            .join("hydra-native")
            .join("presentmon-bridge.exe");
        if !bridge_executable.is_file() {
            return false;
        }
        let stop_file = format!("{output_file}.stop");
        let _ = std::fs::remove_file(&stop_file);
        let parameters = format!(
            "{} {} {} {} {} {}",
            quote_presentmon_argument(&executable),
            quote_presentmon_argument(&output_file),
            quote_presentmon_argument(&stop_file),
            std::process::id(),
            target_pid,
            quote_presentmon_argument(&session_name),
        );
        let working_directory = bridge_executable
            .parent()
            .and_then(Path::to_str)
            .unwrap_or("")
            .to_owned();
        let verb: Vec<u16> = "runas\0".encode_utf16().collect();
        let bridge_executable: Vec<u16> = bridge_executable
            .as_os_str()
            .to_string_lossy()
            .encode_utf16()
            .chain(std::iter::once(0))
            .collect();
        let parameters: Vec<u16> = parameters
            .encode_utf16()
            .chain(std::iter::once(0))
            .collect();
        let working_directory: Vec<u16> = working_directory
            .encode_utf16()
            .chain(std::iter::once(0))
            .collect();
        let mut execute_info: SHELLEXECUTEINFOW = zeroed();
        execute_info.cbSize = size_of::<SHELLEXECUTEINFOW>() as u32;
        execute_info.fMask = SEE_MASK_NOCLOSEPROCESS | SEE_MASK_NOASYNC;
        execute_info.lpVerb = verb.as_ptr();
        execute_info.lpFile = bridge_executable.as_ptr();
        execute_info.lpParameters = parameters.as_ptr();
        execute_info.lpDirectory = working_directory.as_ptr();
        execute_info.nShow = SW_HIDE;
        if ShellExecuteExW(&mut execute_info) == 0 || execute_info.hProcess.is_null() {
            return false;
        }

        let process_slot = ELEVATED_PRESENTMON_PROCESS.get_or_init(|| Mutex::new(None));
        let mut process_slot = process_slot
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        *process_slot = Some(ElevatedPresentMonProcess {
            handle: execute_info.hProcess as usize,
            stop_file,
        });
        true
    }

    #[cfg(not(target_os = "windows"))]
    false
}

#[napi]
pub async fn stop_elevated_presentmon() -> bool {
    #[cfg(target_os = "windows")]
    {
        return stop_elevated_presentmon_process();
    }

    #[cfg(not(target_os = "windows"))]
    false
}

#[napi(object)]
pub struct NativeProcessControlResult {
    pub succeeded_pids: Vec<u32>,
    pub failed_pids: Vec<u32>,
    pub unsupported: bool,
    pub error: Option<String>,
}

#[cfg(target_os = "windows")]
#[link(name = "ntdll")]
extern "system" {
    fn NtSuspendProcess(process_handle: *mut std::ffi::c_void) -> i32;
    fn NtResumeProcess(process_handle: *mut std::ffi::c_void) -> i32;
}

#[cfg(target_os = "windows")]
fn collect_process_tree(root_pid: u32) -> Vec<u32> {
    unsafe {
        let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if snapshot == INVALID_HANDLE_VALUE {
            return vec![root_pid];
        }

        let mut children_by_parent: HashMap<u32, Vec<u32>> = HashMap::new();
        let mut entry: PROCESSENTRY32W = zeroed();
        entry.dwSize = size_of::<PROCESSENTRY32W>() as u32;
        if Process32FirstW(snapshot, &mut entry) != 0 {
            loop {
                children_by_parent
                    .entry(entry.th32ParentProcessID)
                    .or_default()
                    .push(entry.th32ProcessID);
                if Process32NextW(snapshot, &mut entry) == 0 {
                    break;
                }
            }
        }
        CloseHandle(snapshot);

        let mut result = Vec::new();
        let mut seen = HashSet::new();
        let mut pending = VecDeque::from([root_pid]);
        while let Some(pid) = pending.pop_front() {
            if pid == 0 || !seen.insert(pid) {
                continue;
            }
            result.push(pid);
            if let Some(children) = children_by_parent.get(&pid) {
                pending.extend(children.iter().copied());
            }
        }
        result
    }
}

#[cfg(target_os = "windows")]
fn control_one_process(pid: u32, action: &str) -> bool {
    const PROCESS_SUSPEND_RESUME: u32 = 0x0800;
    unsafe {
        let rights = match action {
            "suspend" | "resume" => PROCESS_SUSPEND_RESUME | SYNCHRONIZE_ACCESS,
            "terminate" => PROCESS_TERMINATE | SYNCHRONIZE_ACCESS,
            _ => return false,
        };
        let handle = OpenProcess(rights, 0, pid);
        if handle.is_null() {
            return false;
        }
        let succeeded = match action {
            "suspend" => NtSuspendProcess(handle) >= 0,
            "resume" => NtResumeProcess(handle) >= 0,
            "terminate" => TerminateProcess(handle, 0) != 0,
            _ => false,
        };
        CloseHandle(handle);
        succeeded
    }
}

/// Applies an action only to a validated root PID and its descendants. The
/// renderer never supplies this PID: the main-process service resolves it from
/// the active game's tracked render target before calling into native code.
#[napi]
#[cfg_attr(not(target_os = "windows"), allow(unused_variables))]
pub fn control_process_tree(root_pid: u32, action: String) -> NativeProcessControlResult {
    #[cfg(target_os = "windows")]
    {
        if root_pid <= 4 || root_pid == unsafe { GetCurrentProcessId() } {
            return NativeProcessControlResult {
                succeeded_pids: Vec::new(),
                failed_pids: vec![root_pid],
                unsupported: false,
                error: Some("unsafe process target rejected".to_string()),
            };
        }
        if !matches!(action.as_str(), "suspend" | "resume" | "terminate") {
            return NativeProcessControlResult {
                succeeded_pids: Vec::new(),
                failed_pids: vec![root_pid],
                unsupported: false,
                error: Some("unsupported process action".to_string()),
            };
        }

        let mut process_tree = collect_process_tree(root_pid);
        let current_pid = unsafe { GetCurrentProcessId() };
        if process_tree.contains(&current_pid) {
            return NativeProcessControlResult {
                succeeded_pids: Vec::new(),
                failed_pids: process_tree,
                unsupported: false,
                error: Some("process tree contains GameHub and was rejected".to_string()),
            };
        }
        // Stop descendants before their parent so the target cannot spawn more
        // children while a suspend/close operation is being applied.
        if matches!(action.as_str(), "suspend" | "terminate") {
            process_tree.reverse();
        }

        let mut succeeded_pids = Vec::new();
        let mut failed_pids = Vec::new();
        for pid in process_tree {
            if control_one_process(pid, &action) {
                succeeded_pids.push(pid);
            } else {
                failed_pids.push(pid);
            }
        }
        NativeProcessControlResult {
            error: if failed_pids.is_empty() {
                None
            } else {
                Some("one or more game processes denied the requested action".to_string())
            },
            succeeded_pids,
            failed_pids,
            unsupported: false,
        }
    }

    #[cfg(not(target_os = "windows"))]
    NativeProcessControlResult {
        succeeded_pids: Vec::new(),
        failed_pids: vec![root_pid],
        unsupported: true,
        error: Some("process pause and resume are only available on Windows".to_string()),
    }
}

#[napi]
pub fn get_overlay_gamepad_buttons() -> u32 {
    #[cfg(target_os = "windows")]
    {
        const ERROR_SUCCESS: u32 = 0;
        const DPAD_UP: u16 = 0x0001;
        const DPAD_DOWN: u16 = 0x0002;
        const DPAD_LEFT: u16 = 0x0004;
        const DPAD_RIGHT: u16 = 0x0008;
        const STICK_THRESHOLD: i16 = 12_000;

        // Treat every connected controller as an input source. Returning the
        // first non-idle pad loses Guide presses from another pad whenever the
        // first one is holding a direction.
        let mut combined_buttons = 0_u32;
        for user_index in 0..4 {
            let mut state = XInputState::default();
            let result = get_xinput_state(user_index, &mut state);
            if result != ERROR_SUCCESS {
                continue;
            }

            let mut buttons = state.gamepad.buttons;
            if state.gamepad.thumb_ly > STICK_THRESHOLD {
                buttons |= DPAD_UP;
            } else if state.gamepad.thumb_ly < -STICK_THRESHOLD {
                buttons |= DPAD_DOWN;
            }
            if state.gamepad.thumb_lx < -STICK_THRESHOLD {
                buttons |= DPAD_LEFT;
            } else if state.gamepad.thumb_lx > STICK_THRESHOLD {
                buttons |= DPAD_RIGHT;
            }

            combined_buttons |= u32::from(buttons);
        }

        return combined_buttons;
    }

    #[cfg(not(target_os = "windows"))]
    {
        0
    }
}

#[napi]
pub fn get_process_window_bounds(_pid: u32) -> Option<NativeWindowBounds> {
    #[cfg(target_os = "windows")]
    if let Some((window, bounds)) = process_window(_pid) {
        return Some(NativeWindowBounds {
            x: bounds.left,
            y: bounds.top,
            width: bounds.right - bounds.left,
            height: bounds.bottom - bounds.top,
            window_id: (window as usize).to_string(),
        });
    }
    None
}

#[napi]
pub fn place_overlay_window(_window_handle: Buffer, _pid: u32) -> bool {
    #[cfg(target_os = "windows")]
    if let Some((_, bounds)) = process_window(_pid) {
        if _window_handle.is_empty() {
            return false;
        }
        let mut raw_handle = [0_u8; size_of::<usize>()];
        let byte_count = raw_handle.len().min(_window_handle.len());
        raw_handle[..byte_count].copy_from_slice(&_window_handle[..byte_count]);
        let overlay = usize::from_ne_bytes(raw_handle) as HWND;
        if overlay.is_null() {
            return false;
        }
        return unsafe {
            SetWindowPos(
                overlay,
                HWND_TOPMOST,
                bounds.left,
                bounds.top,
                bounds.right - bounds.left,
                bounds.bottom - bounds.top,
                SWP_NOACTIVATE,
            ) != 0
        };
    }
    false
}

#[napi]
pub fn focus_process_window(_pid: u32) -> bool {
    #[cfg(target_os = "windows")]
    if let Some((window, _)) = find_best_process_window(_pid, true) {
        unsafe {
            if IsIconic(window) != 0 {
                ShowWindow(window, SW_RESTORE);
            }
            return SetForegroundWindow(window) != 0;
        }
    }
    false
}

/// Force the overlay window to become the foreground window.
///
/// This is what actually stops the game reacting to the controller while the
/// overlay is open. XInput 1.4 gates input on window focus by itself — per
/// Microsoft, XInputEnable is "Deprecated [on Windows 10 or later], as game
/// controller input is automatically enabled/disabled by the system based on
/// the application window focus" — so an unfocused game reads neutral state
/// without anything being hooked or suspended.
///
/// Electron's `BrowserWindow.focus()` is not enough over a fullscreen game:
/// Windows' foreground lock makes SetForegroundWindow fail for a process that
/// does not already own the foreground. Attaching our input queue to the
/// foreground window's thread lifts that restriction for the duration of the
/// call, which is the long-standing documented workaround.
#[napi]
#[cfg_attr(not(target_os = "windows"), allow(unused_variables))]
pub fn force_foreground_window(window_handle: f64) -> bool {
    #[cfg(target_os = "windows")]
    unsafe {
        let window = window_handle as isize as HWND;
        if window.is_null() {
            return false;
        }
        if IsIconic(window) != 0 {
            ShowWindow(window, SW_RESTORE);
        }

        let foreground = GetForegroundWindow();
        if foreground == window {
            return true;
        }

        let current_thread = GetCurrentThreadId();
        let foreground_thread = if foreground.is_null() {
            0
        } else {
            GetWindowThreadProcessId(foreground, std::ptr::null_mut())
        };

        let attached = foreground_thread != 0
            && foreground_thread != current_thread
            && AttachThreadInput(current_thread, foreground_thread, 1) != 0;

        BringWindowToTop(window);
        let focused = SetForegroundWindow(window) != 0;
        SetActiveWindow(window);

        if attached {
            AttachThreadInput(current_thread, foreground_thread, 0);
        }
        return focused || GetForegroundWindow() == window;
    }

    #[cfg(not(target_os = "windows"))]
    false
}

// ── Per-app volume mixer (Core Audio, Windows only) ──────────────────────────
#[napi(object)]
pub struct AudioSession {
    pub pid: u32,
    pub name: String,
    /// Master volume of this app's audio session, 0.0–1.0.
    pub volume: f64,
    pub muted: bool,
}

#[napi]
pub fn get_audio_sessions() -> Vec<AudioSession> {
    // Run COM on a dedicated MTA thread so we never touch Electron's own COM
    // apartment on the JS thread.
    #[cfg(target_os = "windows")]
    {
        std::thread::spawn(enumerate_audio_sessions)
            .join()
            .unwrap_or_default()
    }

    #[cfg(not(target_os = "windows"))]
    Vec::new()
}

#[napi]
#[cfg_attr(not(target_os = "windows"), allow(unused_variables))]
pub fn set_audio_session_volume(pid: u32, volume: f64) -> bool {
    #[cfg(target_os = "windows")]
    {
        std::thread::spawn(move || {
            apply_to_session(pid, &|simple| unsafe {
                simple
                    .SetMasterVolume(volume.clamp(0.0, 1.0) as f32, std::ptr::null())
                    .is_ok()
            })
        })
        .join()
        .unwrap_or(false)
    }

    #[cfg(not(target_os = "windows"))]
    false
}

#[napi]
#[cfg_attr(not(target_os = "windows"), allow(unused_variables))]
pub fn set_audio_session_mute(pid: u32, muted: bool) -> bool {
    #[cfg(target_os = "windows")]
    {
        std::thread::spawn(move || {
            apply_to_session(pid, &|simple| unsafe {
                simple.SetMute(muted, std::ptr::null()).is_ok()
            })
        })
        .join()
        .unwrap_or(false)
    }

    #[cfg(not(target_os = "windows"))]
    false
}

#[cfg(target_os = "windows")]
struct ComGuard;
#[cfg(target_os = "windows")]
impl ComGuard {
    unsafe fn new() -> Self {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        ComGuard
    }
}
#[cfg(target_os = "windows")]
impl Drop for ComGuard {
    fn drop(&mut self) {
        unsafe { CoUninitialize() };
    }
}

#[cfg(target_os = "windows")]
unsafe fn session_manager() -> windows::core::Result<IAudioSessionManager2> {
    let enumerator: IMMDeviceEnumerator = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)?;
    let device = enumerator.GetDefaultAudioEndpoint(eRender, eConsole)?;
    device.Activate(CLSCTX_ALL, None)
}

#[cfg(target_os = "windows")]
fn enumerate_audio_sessions() -> Vec<AudioSession> {
    unsafe {
        let _guard = ComGuard::new();
        collect_sessions().unwrap_or_default()
    }
}

#[cfg(target_os = "windows")]
unsafe fn collect_sessions() -> windows::core::Result<Vec<AudioSession>> {
    let manager = session_manager()?;
    let sessions = manager.GetSessionEnumerator()?;
    let count = sessions.GetCount()?;

    let mut raw: Vec<(u32, f32, bool)> = Vec::new();
    for index in 0..count {
        let control = sessions.GetSession(index)?;
        let control2: IAudioSessionControl2 = control.cast()?;
        let pid = control2.GetProcessId().unwrap_or(0);
        let simple: ISimpleAudioVolume = control.cast()?;
        let volume = simple.GetMasterVolume().unwrap_or(0.0);
        let muted = simple
            .GetMute()
            .map(|value| value.as_bool())
            .unwrap_or(false);
        raw.push((pid, volume, muted));
    }

    let mut system = System::new();
    system.refresh_processes(ProcessesToUpdate::All, true);

    Ok(raw
        .into_iter()
        .map(|(pid, volume, muted)| AudioSession {
            pid,
            name: if pid == 0 {
                "System sounds".to_string()
            } else {
                system
                    .process(sysinfo::Pid::from_u32(pid))
                    .map(|process| process.name().to_string_lossy().to_string())
                    .unwrap_or_else(|| format!("PID {pid}"))
            },
            volume: volume as f64,
            muted,
        })
        .collect())
}

#[cfg(target_os = "windows")]
fn apply_to_session(pid: u32, apply: &dyn Fn(&ISimpleAudioVolume) -> bool) -> bool {
    unsafe {
        let _guard = ComGuard::new();
        let Ok(manager) = session_manager() else {
            return false;
        };
        let Ok(sessions) = manager.GetSessionEnumerator() else {
            return false;
        };
        let count = sessions.GetCount().unwrap_or(0);
        for index in 0..count {
            let Ok(control) = sessions.GetSession(index) else {
                continue;
            };
            let Ok(control2) = control.cast::<IAudioSessionControl2>() else {
                continue;
            };
            if control2.GetProcessId().unwrap_or(0) != pid {
                continue;
            }
            if let Ok(simple) = control.cast::<ISimpleAudioVolume>() {
                return apply(&simple);
            }
        }
        false
    }
}

#[napi(object)]
pub struct ProcessedImageData {
    pub image_path: String,
    pub mime_type: String,
}

#[napi(object)]
pub struct NativeProcessPayload {
    pub exe: Option<String>,
    pub pid: u32,
    pub name: String,
    pub environ: Option<HashMap<String, String>>,
    pub cwd: Option<String>,
}

#[napi]
pub fn process_profile_image(
    image_path: String,
    target_extension: Option<String>,
) -> napi::Result<ProcessedImageData> {
    let input_path = PathBuf::from(image_path);

    if !input_path.exists() {
        return Err(Error::from_reason("Image file not found"));
    }

    let format = detect_image_format(&input_path)?;
    let animated = is_animated_image(&input_path, format)?;

    if !animated {
        return Ok(ProcessedImageData {
            image_path: input_path.to_string_lossy().to_string(),
            mime_type: mime_type_from_format_or_path(format, &input_path),
        });
    }

    let extension = target_extension
        .map(|value| value.to_ascii_lowercase())
        .unwrap_or_else(|| "webp".to_string());

    let output_format = output_format_from_extension(&extension)?;
    let output_path = build_temp_output_path(&extension);

    let image = ImageReader::open(&input_path)
        .map_err(|err| Error::from_reason(err.to_string()))?
        .with_guessed_format()
        .map_err(|err| Error::from_reason(err.to_string()))?
        .decode()
        .map_err(|err| Error::from_reason(err.to_string()))?;

    image
        .save_with_format(&output_path, output_format)
        .map_err(|err| Error::from_reason(err.to_string()))?;

    Ok(ProcessedImageData {
        image_path: output_path.to_string_lossy().to_string(),
        mime_type: mime_type_from_format_or_path(Some(output_format), &output_path),
    })
}

#[napi]
pub fn list_processes() -> Vec<NativeProcessPayload> {
    let mut system = System::new_all();
    system.refresh_processes(ProcessesToUpdate::All, true);

    let mut processes: Vec<NativeProcessPayload> = system
        .processes()
        .values()
        .map(|process| {
            let include_linux_extras = !cfg!(target_os = "windows");

            NativeProcessPayload {
                exe: process
                    .exe()
                    .map(|value| value.to_string_lossy().to_string()),
                pid: process.pid().as_u32(),
                name: process.name().to_string_lossy().to_string(),
                cwd: if include_linux_extras {
                    process
                        .cwd()
                        .map(|value| value.to_string_lossy().to_string())
                } else {
                    None
                },
                environ: if include_linux_extras {
                    let env_map: HashMap<String, String> = process
                        .environ()
                        .iter()
                        .filter_map(|entry| {
                            let entry_value = entry.to_string_lossy();
                            entry_value.split_once('=').and_then(|(key, value)| {
                                if key.is_empty() {
                                    None
                                } else {
                                    Some((key.to_string(), value.to_string()))
                                }
                            })
                        })
                        .collect();

                    if env_map.is_empty() {
                        None
                    } else {
                        Some(env_map)
                    }
                } else {
                    None
                },
            }
        })
        .collect();

    processes.sort_by(|left, right| {
        let by_pid = left.pid.cmp(&right.pid);
        if by_pid == Ordering::Equal {
            left.name.cmp(&right.name)
        } else {
            by_pid
        }
    });

    processes
}

fn detect_image_format(path: &Path) -> napi::Result<Option<ImageFormat>> {
    let reader = ImageReader::open(path).map_err(|err| Error::from_reason(err.to_string()))?;

    let guessed = reader
        .with_guessed_format()
        .map_err(|err| Error::from_reason(err.to_string()))?;

    Ok(guessed.format())
}

fn is_animated_image(path: &Path, format: Option<ImageFormat>) -> napi::Result<bool> {
    match format {
        Some(ImageFormat::Gif) => is_gif_animated(path),
        Some(ImageFormat::WebP) => is_webp_animated(path),
        Some(ImageFormat::Png) => is_apng(path),
        _ => Ok(false),
    }
}

fn is_gif_animated(path: &Path) -> napi::Result<bool> {
    let file = File::open(path).map_err(|err| Error::from_reason(err.to_string()))?;
    let decoder =
        GifDecoder::new(BufReader::new(file)).map_err(|err| Error::from_reason(err.to_string()))?;

    let mut frames = decoder.into_frames();
    let _ = frames.next().transpose();
    Ok(matches!(frames.next().transpose(), Ok(Some(_))))
}

fn is_webp_animated(path: &Path) -> napi::Result<bool> {
    let file = File::open(path).map_err(|err| Error::from_reason(err.to_string()))?;
    let decoder = WebPDecoder::new(BufReader::new(file))
        .map_err(|err| Error::from_reason(err.to_string()))?;

    Ok(decoder.has_animation())
}

fn is_apng(path: &Path) -> napi::Result<bool> {
    let file = File::open(path).map_err(|err| Error::from_reason(err.to_string()))?;
    let decoder =
        PngDecoder::new(BufReader::new(file)).map_err(|err| Error::from_reason(err.to_string()))?;

    decoder
        .is_apng()
        .map_err(|err| Error::from_reason(err.to_string()))
}

fn output_format_from_extension(extension: &str) -> napi::Result<ImageFormat> {
    match extension {
        "png" => Ok(ImageFormat::Png),
        "jpg" | "jpeg" => Ok(ImageFormat::Jpeg),
        "webp" => Ok(ImageFormat::WebP),
        _ => Err(Error::from_reason("Unsupported target extension")),
    }
}

fn build_temp_output_path(extension: &str) -> PathBuf {
    let mut output_path = std::env::temp_dir();
    output_path.push(format!("{}.{}", Uuid::new_v4(), extension));
    output_path
}

fn mime_type_from_format_or_path(format: Option<ImageFormat>, path: &Path) -> String {
    if let Some(value) = mime_type_from_image_format(format) {
        return value.to_string();
    }

    mime_guess::from_path(path)
        .first_or_octet_stream()
        .essence_str()
        .to_string()
}

fn mime_type_from_image_format(format: Option<ImageFormat>) -> Option<&'static str> {
    match format {
        Some(ImageFormat::Png) => Some("image/png"),
        Some(ImageFormat::Jpeg) => Some("image/jpeg"),
        Some(ImageFormat::Gif) => Some("image/gif"),
        Some(ImageFormat::WebP) => Some("image/webp"),
        Some(ImageFormat::Bmp) => Some("image/bmp"),
        Some(ImageFormat::Ico) => Some("image/x-icon"),
        Some(ImageFormat::Tiff) => Some("image/tiff"),
        Some(ImageFormat::Avif) => Some("image/avif"),
        _ => None,
    }
}

// ---------------------------------------------------------------------------
// Overlay input gate
// ---------------------------------------------------------------------------
//
// Focus is not enough to stop a game reading input — measured, not assumed: the
// overlay reliably wins Win32 foreground and games keep responding, because
// XInput 1.3, GetAsyncKeyState and RIDEV_INPUTSINK raw input all ignore focus.
// The gate therefore lives inside the game: gamehub-inputhook is injected and
// answers those APIs with neutral state while this flag is set. The launcher
// only owns the flag and the injection.

/// Shared with the injected DLL, which opens the same named mapping.
#[cfg(target_os = "windows")]
const INPUT_GATE_MAPPING_NAME: &str = "Local\\GameHubOverlayInputBlock";

/// Cross-process layout, expressed as aligned u32 words so every update is an
/// atomic Win32 store. The injected worker positively acknowledges the exact
/// target generation after its first complete patch sweep; LoadLibrary success
/// alone is intentionally not treated as readiness. Writers clear BLOCKED and
/// READY_PID before changing a target, so torn or stale updates fail safe.
#[cfg(target_os = "windows")]
const INPUT_GATE_WORDS: usize = 9;
#[cfg(target_os = "windows")]
const INPUT_GATE_OWNER_PID_WORD: usize = 0;
#[cfg(target_os = "windows")]
const INPUT_GATE_TARGET_PID_WORD: usize = 1;
#[cfg(target_os = "windows")]
const INPUT_GATE_BLOCKED_WORD: usize = 2;
#[cfg(target_os = "windows")]
const INPUT_GATE_GENERATION_WORD: usize = 3;
#[cfg(target_os = "windows")]
const INPUT_GATE_READY_PID_WORD: usize = 4;
#[cfg(target_os = "windows")]
const INPUT_GATE_READY_GENERATION_WORD: usize = 5;
#[cfg(target_os = "windows")]
const INPUT_GATE_CAPABILITY_MASK_WORD: usize = 6;
#[cfg(target_os = "windows")]
const INPUT_GATE_UNSUPPORTED_MODULE_MASK_WORD: usize = 7;
#[cfg(target_os = "windows")]
const INPUT_GATE_HOOK_STATUS_WORD: usize = 8;
#[cfg(target_os = "windows")]
const INPUT_GATE_REQUIRED_CAPABILITIES: u32 = 0x0f;

#[cfg(target_os = "windows")]
static INPUT_GATE_VIEW: OnceLock<usize> = OnceLock::new();
#[cfg(target_os = "windows")]
static INPUT_GATE_MAPPING_HANDLE: OnceLock<usize> = OnceLock::new();

#[cfg(target_os = "windows")]
fn wide_string(text: &str) -> Vec<u16> {
    text.encode_utf16().chain(std::iter::once(0)).collect()
}

/// Create the shared flag. Idempotent: repeated calls reuse the first view.
#[napi]
pub fn create_overlay_input_gate() -> bool {
    #[cfg(target_os = "windows")]
    {
        if INPUT_GATE_VIEW.get().is_some() {
            return true;
        }
        unsafe {
            let mapping_name = wide_string(INPUT_GATE_MAPPING_NAME);
            let mapping = CreateFileMappingW(
                INVALID_HANDLE_VALUE,
                null(),
                PAGE_READWRITE,
                0,
                (size_of::<u32>() * INPUT_GATE_WORDS) as u32,
                mapping_name.as_ptr(),
            );
            if mapping.is_null() {
                return false;
            }
            let view = MapViewOfFile(
                mapping,
                FILE_MAP_WRITE,
                0,
                0,
                size_of::<u32>() * INPUT_GATE_WORDS,
            );
            if view.Value.is_null() {
                CloseHandle(mapping);
                return false;
            }
            let words = view.Value as *mut u32;
            for index in 0..INPUT_GATE_WORDS {
                std::ptr::write_volatile(words.add(index), 0);
            }
            std::ptr::write_volatile(words.add(INPUT_GATE_OWNER_PID_WORD), GetCurrentProcessId());
            // A mapped view keeps the section's bytes alive but not its name
            // available to OpenFileMapping. Retain the creator handle for the
            // launcher lifetime so injected processes can discover it.
            let _ = INPUT_GATE_MAPPING_HANDLE.set(mapping as usize);
            let _ = INPUT_GATE_VIEW.set(view.Value as usize);
            true
        }
    }

    #[cfg(not(target_os = "windows"))]
    false
}

/// Diagnostic used by the native regression fixture to prove the named
/// mapping is visible across a process boundary.
#[napi]
pub fn is_overlay_input_gate_visible() -> bool {
    #[cfg(target_os = "windows")]
    unsafe {
        let name = wide_string(INPUT_GATE_MAPPING_NAME);
        let mapping = OpenFileMappingW(FILE_MAP_READ, 0, name.as_ptr());
        if mapping.is_null() {
            return false;
        }
        CloseHandle(mapping);
        return true;
    }

    #[cfg(not(target_os = "windows"))]
    false
}

/// Set or clear the gate for exactly one render process. The injected DLL also
/// verifies that this launcher process is still alive; a launcher crash can
/// therefore never strand a running game with its input blocked.
#[napi]
#[cfg_attr(not(target_os = "windows"), allow(unused_variables))]
pub fn set_overlay_input_gate(target_pid: u32, blocked: bool) -> bool {
    #[cfg(target_os = "windows")]
    {
        let Some(view) = INPUT_GATE_VIEW.get() else {
            return false;
        };
        unsafe {
            let words = *view as *mut u32;
            // Always release first. Blur/hide keeps the same target and its
            // readiness generation; a process handoff invalidates everything.
            std::ptr::write_volatile(words.add(INPUT_GATE_BLOCKED_WORD), 0);
            std::ptr::write_volatile(words.add(INPUT_GATE_OWNER_PID_WORD), GetCurrentProcessId());

            let current_target = std::ptr::read_volatile(words.add(INPUT_GATE_TARGET_PID_WORD));
            if current_target != target_pid {
                // READY_PID is the commit word written by the injected worker.
                // Clear it before changing PID/generation so a stale process
                // can never authorize blocking the new render child.
                std::ptr::write_volatile(words.add(INPUT_GATE_READY_PID_WORD), 0);
                std::ptr::write_volatile(words.add(INPUT_GATE_READY_GENERATION_WORD), 0);
                std::ptr::write_volatile(words.add(INPUT_GATE_CAPABILITY_MASK_WORD), 0);
                std::ptr::write_volatile(words.add(INPUT_GATE_UNSUPPORTED_MODULE_MASK_WORD), 0);
                std::ptr::write_volatile(words.add(INPUT_GATE_HOOK_STATUS_WORD), 0);
                std::ptr::write_volatile(words.add(INPUT_GATE_TARGET_PID_WORD), target_pid);
                let previous = std::ptr::read_volatile(words.add(INPUT_GATE_GENERATION_WORD));
                let mut next = previous.wrapping_add(1);
                if next == 0 {
                    next = 1;
                }
                std::ptr::write_volatile(words.add(INPUT_GATE_GENERATION_WORD), next);
            }

            if blocked && target_pid != 0 {
                let generation = std::ptr::read_volatile(words.add(INPUT_GATE_GENERATION_WORD));
                let ready_pid = std::ptr::read_volatile(words.add(INPUT_GATE_READY_PID_WORD));
                let ready_generation =
                    std::ptr::read_volatile(words.add(INPUT_GATE_READY_GENERATION_WORD));
                let capability_mask =
                    std::ptr::read_volatile(words.add(INPUT_GATE_CAPABILITY_MASK_WORD));
                let unsupported_module_mask =
                    std::ptr::read_volatile(words.add(INPUT_GATE_UNSUPPORTED_MODULE_MASK_WORD));
                let safe = generation != 0
                    && ready_pid == target_pid
                    && ready_generation == generation
                    && (capability_mask & INPUT_GATE_REQUIRED_CAPABILITIES)
                        == INPUT_GATE_REQUIRED_CAPABILITIES
                    && unsupported_module_mask == 0;
                if !safe {
                    return false;
                }
                std::ptr::write_volatile(words.add(INPUT_GATE_BLOCKED_WORD), 1);
            }
        }
        true
    }

    #[cfg(not(target_os = "windows"))]
    false
}

/// Snapshot of the worker-published input isolation handshake.
#[napi(object)]
pub struct OverlayInputGateStatus {
    pub ready: bool,
    pub owner_pid: u32,
    pub target_pid: u32,
    pub blocked: bool,
    pub generation: u32,
    pub ready_pid: u32,
    pub ready_generation: u32,
    pub capability_mask: u32,
    pub unsupported_module_mask: u32,
    pub hook_status: u32,
}

#[napi]
#[cfg_attr(not(target_os = "windows"), allow(unused_variables))]
pub fn get_overlay_input_gate_status(requested_pid: u32) -> OverlayInputGateStatus {
    #[cfg(target_os = "windows")]
    {
        let Some(view) = INPUT_GATE_VIEW.get() else {
            return OverlayInputGateStatus {
                ready: false,
                owner_pid: 0,
                target_pid: 0,
                blocked: false,
                generation: 0,
                ready_pid: 0,
                ready_generation: 0,
                capability_mask: 0,
                unsupported_module_mask: 0,
                hook_status: 0,
            };
        };
        unsafe {
            let words = *view as *const u32;
            // Read generation on both sides of the payload. If the launcher is
            // transitioning targets, the snapshot is never reported ready.
            let generation_before = std::ptr::read_volatile(words.add(INPUT_GATE_GENERATION_WORD));
            let owner_pid = std::ptr::read_volatile(words.add(INPUT_GATE_OWNER_PID_WORD));
            let target_pid = std::ptr::read_volatile(words.add(INPUT_GATE_TARGET_PID_WORD));
            let blocked = std::ptr::read_volatile(words.add(INPUT_GATE_BLOCKED_WORD)) != 0;
            let ready_pid = std::ptr::read_volatile(words.add(INPUT_GATE_READY_PID_WORD));
            let ready_generation =
                std::ptr::read_volatile(words.add(INPUT_GATE_READY_GENERATION_WORD));
            let capability_mask =
                std::ptr::read_volatile(words.add(INPUT_GATE_CAPABILITY_MASK_WORD));
            let unsupported_module_mask =
                std::ptr::read_volatile(words.add(INPUT_GATE_UNSUPPORTED_MODULE_MASK_WORD));
            let hook_status = std::ptr::read_volatile(words.add(INPUT_GATE_HOOK_STATUS_WORD));
            let generation = std::ptr::read_volatile(words.add(INPUT_GATE_GENERATION_WORD));
            let ready = requested_pid != 0
                && owner_pid == GetCurrentProcessId()
                && target_pid == requested_pid
                && ready_pid == requested_pid
                && generation_before == generation
                && generation != 0
                && ready_generation == generation;
            OverlayInputGateStatus {
                ready,
                owner_pid,
                target_pid,
                blocked,
                generation,
                ready_pid,
                ready_generation,
                capability_mask,
                unsupported_module_mask,
                hook_status,
            }
        }
    }

    #[cfg(not(target_os = "windows"))]
    OverlayInputGateStatus {
        ready: false,
        owner_pid: 0,
        target_pid: 0,
        blocked: false,
        generation: 0,
        ready_pid: 0,
        ready_generation: 0,
        capability_mask: 0,
        unsupported_module_mask: 0,
        hook_status: 0,
    }
}

/// Compatibility entry point for older renderer code. It can clear the gate,
/// but deliberately refuses to create an unscoped block.
#[napi]
#[cfg_attr(not(target_os = "windows"), allow(unused_variables))]
pub fn set_overlay_input_block(blocked: bool) -> bool {
    if blocked {
        return false;
    }
    set_overlay_input_gate(0, false)
}

/// Load gamehub-inputhook into `pid` via the standard
/// VirtualAllocEx + WriteProcessMemory + CreateRemoteThread(LoadLibraryW)
/// sequence. Injecting the same DLL twice is harmless — the loader returns the
/// already-mapped module and no second worker thread starts — so callers may
/// retry without tracking state.
#[napi(object)]
pub struct InputHookInjection {
    pub injected: bool,
    /// Which step failed, so a refusal can be told apart from a crash: an
    /// "open" failure is a protected or higher-integrity process, "thread" is
    /// usually antivirus blocking CreateRemoteThread, and "load" means the
    /// game's loader rejected the DLL (most often a bitness mismatch).
    pub stage: String,
    /// GetLastError at the point of failure, 0 on success.
    pub error_code: u32,
}

#[napi]
#[cfg_attr(not(target_os = "windows"), allow(unused_variables))]
pub fn inject_input_hook(pid: u32, dll_path: String) -> InputHookInjection {
    #[cfg(target_os = "windows")]
    {
        // Unelevated fast path. A game running at higher integrity than the
        // launcher fails here with stage "open" / ERROR_ACCESS_DENIED, which is
        // the caller's cue to go through the elevated broker instead.
        let outcome = win_inject::inject_dll(pid, &dll_path);
        InputHookInjection {
            injected: outcome.injected,
            stage: outcome.stage.to_string(),
            error_code: outcome.error_code,
        }
    }

    #[cfg(not(target_os = "windows"))]
    InputHookInjection {
        injected: false,
        stage: "unsupported".to_string(),
        error_code: 0,
    }
}
