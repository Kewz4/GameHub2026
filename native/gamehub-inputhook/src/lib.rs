//! In-game input gate for the GameHub overlay.
//!
//! # Why this exists
//!
//! Giving the overlay window Win32 foreground is not enough to stop a game
//! reading input, and this was measured rather than assumed: with the overlay
//! confirmed foreground (`overlayHasForeground: true`), games kept responding
//! to the pad, the keyboard and the mouse. The reason is that the APIs games
//! actually poll do not consult focus:
//!
//! * `XInputGetState` — XInput 1.3, which most games still ship, has no focus
//!   gating whatsoever, and 1.4's automatic gating only applies to Store apps.
//! * `GetAsyncKeyState` / `GetKeyState` — global key state, focus-independent
//!   by definition.
//! * `GetRawInputData` — a window registered with `RIDEV_INPUTSINK` is
//!   explicitly asking to receive input while it is *not* foreground.
//!
//! Nothing outside the game process can gate those. A low-level
//! `WH_KEYBOARD_LL` hook could swallow keyboard and mouse events, but it sits
//! ahead of input routing, so it would starve the overlay itself — and it does
//! not see XInput at all. Steam, Discord and GeForce Experience all solve this
//! the same way: inside the target process. So does this.
//!
//! # How
//!
//! Import Address Table patching, not inline detours. Rewriting an IAT entry
//! is a single pointer store into the loader's own table; an inline detour
//! means disassembling and relocating the first instructions of a live OS
//! function, which needs a length disassembler, can race other threads
//! mid-call, and looks exactly like what anti-cheat heuristics hunt for. IAT
//! patching is reversible, thread-safe by nature of being a single aligned
//! store, and cheap enough to re-apply on a timer.
//!
//! Its one weakness is late binding: a module loaded after the patch, or a
//! `GetProcAddress` lookup, would resolve the real function. Both are covered —
//! the worker thread re-scans every module periodically, and `GetProcAddress`
//! is itself hooked so runtime lookups hand back the gate.

#![cfg(windows)]

use std::ffi::c_void;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicUsize, Ordering};

use windows_sys::Win32::Foundation::{
    CloseHandle, GetLastError, FALSE, HANDLE, HMODULE, INVALID_HANDLE_VALUE, TRUE, WAIT_TIMEOUT,
};
use windows_sys::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, Module32FirstW, Module32NextW, MODULEENTRY32W, TH32CS_SNAPMODULE,
};
use windows_sys::Win32::System::LibraryLoader::{
    DisableThreadLibraryCalls, GetModuleHandleW, GetProcAddress,
};
use windows_sys::Win32::System::Memory::{
    MapViewOfFile, OpenFileMappingW, VirtualProtect, VirtualQuery, FILE_MAP_READ, FILE_MAP_WRITE,
    MEMORY_BASIC_INFORMATION, PAGE_READWRITE,
};
use windows_sys::Win32::System::Threading::{
    CreateThread, GetCurrentProcessId, OpenProcess, Sleep, WaitForSingleObject,
    PROCESS_QUERY_LIMITED_INFORMATION,
};

/// Name of the shared flag GameHub writes. Session-local: the launcher and the
/// game it started always share a session, and `Global\` would demand
/// SeCreateGlobalPrivilege for no benefit.
const FLAG_MAPPING_NAME: &[u16] = &[
    0x4C, 0x6F, 0x63, 0x61, 0x6C, 0x5C, // "Local\"
    0x47, 0x61, 0x6D, 0x65, 0x48, 0x75, 0x62, // "GameHub"
    0x4F, 0x76, 0x65, 0x72, 0x6C, 0x61, 0x79, // "Overlay"
    0x49, 0x6E, 0x70, 0x75, 0x74, 0x42, 0x6C, 0x6F, 0x63, 0x6B, // "InputBlock"
    0x00,
];

/// Set once the shared flag view is mapped; until then nothing is gated.
static FLAG_VIEW: AtomicUsize = AtomicUsize::new(0);
static HOOKS_READY: AtomicBool = AtomicBool::new(false);
static HOOK_STATUS: AtomicU32 = AtomicU32::new(0);
static OWNER_ALIVE: AtomicBool = AtomicBool::new(false);
static OWNER_PID: AtomicU32 = AtomicU32::new(0);

const INPUT_GATE_WORDS: usize = 9;
const OWNER_PID_WORD: usize = 0;
const TARGET_PID_WORD: usize = 1;
const BLOCKED_WORD: usize = 2;
const TARGET_GENERATION_WORD: usize = 3;
const READY_PID_WORD: usize = 4;
const READY_GENERATION_WORD: usize = 5;
const CAPABILITY_MASK_WORD: usize = 6;
const UNSUPPORTED_MODULE_MASK_WORD: usize = 7;
const HOOK_STATUS_WORD: usize = 8;

const CAPABILITY_XINPUT: u32 = 1 << 0;
const CAPABILITY_WIN32_KEYBOARD: u32 = 1 << 1;
const CAPABILITY_RAW_INPUT: u32 = 1 << 2;
const CAPABILITY_LATE_BINDING: u32 = 1 << 3;
const REQUIRED_CAPABILITIES: u32 =
    CAPABILITY_XINPUT | CAPABILITY_WIN32_KEYBOARD | CAPABILITY_RAW_INPUT | CAPABILITY_LATE_BINDING;

const UNSUPPORTED_DIRECT_INPUT: u32 = 1 << 0;
const UNSUPPORTED_GAME_INPUT: u32 = 1 << 1;
const UNSUPPORTED_WINDOWS_GAMING_INPUT: u32 = 1 << 2;
const SYNCHRONIZE_ACCESS: u32 = 0x0010_0000;

/// Real implementations, captured before any patching.
static REAL_XINPUT_GET_STATE: AtomicUsize = AtomicUsize::new(0);
static REAL_XINPUT_GET_STATE_EX: AtomicUsize = AtomicUsize::new(0);
static REAL_GET_ASYNC_KEY_STATE: AtomicUsize = AtomicUsize::new(0);
static REAL_GET_KEY_STATE: AtomicUsize = AtomicUsize::new(0);
static REAL_GET_KEYBOARD_STATE: AtomicUsize = AtomicUsize::new(0);
static REAL_GET_RAW_INPUT_DATA: AtomicUsize = AtomicUsize::new(0);
static REAL_GET_RAW_INPUT_BUFFER: AtomicUsize = AtomicUsize::new(0);
static REAL_GET_PROC_ADDRESS: AtomicUsize = AtomicUsize::new(0);

/// XInput reports "nothing plugged in" with this code; games treat it as an
/// absent pad and stop reading, which is exactly the behaviour wanted while the
/// overlay owns the controller.
const ERROR_DEVICE_NOT_CONNECTED: u32 = 1167;

/// True while GameHub wants the game to see no input.
#[inline]
fn blocking() -> bool {
    let view = FLAG_VIEW.load(Ordering::Acquire);
    if view == 0 {
        return false;
    }
    let words = view as *const u32;
    // Aligned u32 stores are atomic on Windows. The launcher writes BLOCKED
    // last, so any concurrent target transition fails open.
    let blocked = unsafe { std::ptr::read_volatile(words.add(BLOCKED_WORD)) };
    if blocked == 0 {
        return false;
    }
    let owner = unsafe { std::ptr::read_volatile(words.add(OWNER_PID_WORD)) };
    let target = unsafe { std::ptr::read_volatile(words.add(TARGET_PID_WORD)) };
    let generation = unsafe { std::ptr::read_volatile(words.add(TARGET_GENERATION_WORD)) };
    let ready_pid = unsafe { std::ptr::read_volatile(words.add(READY_PID_WORD)) };
    let ready_generation = unsafe { std::ptr::read_volatile(words.add(READY_GENERATION_WORD)) };
    let capability_mask = unsafe { std::ptr::read_volatile(words.add(CAPABILITY_MASK_WORD)) };
    let unsupported_module_mask =
        unsafe { std::ptr::read_volatile(words.add(UNSUPPORTED_MODULE_MASK_WORD)) };
    owner != 0
        && owner == OWNER_PID.load(Ordering::Acquire)
        && OWNER_ALIVE.load(Ordering::Acquire)
        && target == unsafe { GetCurrentProcessId() }
        && ready_pid == target
        && generation != 0
        && ready_generation == generation
        && (capability_mask & REQUIRED_CAPABILITIES) == REQUIRED_CAPABILITIES
        && unsupported_module_mask == 0
}

// ---------------------------------------------------------------------------
// Replacement implementations
// ---------------------------------------------------------------------------

type XInputGetStateFn = unsafe extern "system" fn(u32, *mut c_void) -> u32;
type GetAsyncKeyStateFn = unsafe extern "system" fn(i32) -> i16;
type GetKeyStateFn = unsafe extern "system" fn(i32) -> i16;
type GetKeyboardStateFn = unsafe extern "system" fn(*mut u8) -> i32;
type GetRawInputDataFn =
    unsafe extern "system" fn(*mut c_void, u32, *mut c_void, *mut u32, u32) -> u32;
type GetRawInputBufferFn = unsafe extern "system" fn(*mut c_void, *mut u32, u32) -> u32;
type GetProcAddressFn = unsafe extern "system" fn(HMODULE, *const u8) -> *const c_void;

/// XINPUT_STATE is `{ dwPacketNumber: u32, Gamepad: XINPUT_GAMEPAD }` and
/// XINPUT_GAMEPAD is 12 bytes, so the whole struct is 16 bytes. Zeroing it
/// yields a neutral pad: no buttons, centred sticks, released triggers.
const XINPUT_STATE_SIZE: usize = 16;

unsafe extern "system" fn hook_xinput_get_state(user_index: u32, state: *mut c_void) -> u32 {
    if blocking() {
        if !state.is_null() {
            unsafe { std::ptr::write_bytes(state as *mut u8, 0, XINPUT_STATE_SIZE) };
        }
        // Reporting an empty state with ERROR_SUCCESS would leave games that
        // poll for connection changes spinning; "not connected" is the honest
        // answer while the overlay owns the pad.
        return ERROR_DEVICE_NOT_CONNECTED;
    }
    let real = REAL_XINPUT_GET_STATE.load(Ordering::Acquire);
    if real == 0 {
        return ERROR_DEVICE_NOT_CONNECTED;
    }
    unsafe { std::mem::transmute::<usize, XInputGetStateFn>(real)(user_index, state) }
}

unsafe extern "system" fn hook_xinput_get_state_ex(user_index: u32, state: *mut c_void) -> u32 {
    if blocking() {
        if !state.is_null() {
            unsafe { std::ptr::write_bytes(state as *mut u8, 0, XINPUT_STATE_SIZE) };
        }
        return ERROR_DEVICE_NOT_CONNECTED;
    }
    let real = REAL_XINPUT_GET_STATE_EX.load(Ordering::Acquire);
    if real == 0 {
        return ERROR_DEVICE_NOT_CONNECTED;
    }
    unsafe { std::mem::transmute::<usize, XInputGetStateFn>(real)(user_index, state) }
}

unsafe extern "system" fn hook_get_async_key_state(key: i32) -> i16 {
    if blocking() {
        return 0;
    }
    let real = REAL_GET_ASYNC_KEY_STATE.load(Ordering::Acquire);
    if real == 0 {
        return 0;
    }
    unsafe { std::mem::transmute::<usize, GetAsyncKeyStateFn>(real)(key) }
}

unsafe extern "system" fn hook_get_key_state(key: i32) -> i16 {
    if blocking() {
        return 0;
    }
    let real = REAL_GET_KEY_STATE.load(Ordering::Acquire);
    if real == 0 {
        return 0;
    }
    unsafe { std::mem::transmute::<usize, GetKeyStateFn>(real)(key) }
}

unsafe extern "system" fn hook_get_keyboard_state(state: *mut u8) -> i32 {
    if blocking() {
        if !state.is_null() {
            // The API contract is a 256-entry table; all-zero means every key
            // is up and no toggle is set.
            unsafe { std::ptr::write_bytes(state, 0, 256) };
        }
        return TRUE;
    }
    let real = REAL_GET_KEYBOARD_STATE.load(Ordering::Acquire);
    if real == 0 {
        return FALSE;
    }
    unsafe { std::mem::transmute::<usize, GetKeyboardStateFn>(real)(state) }
}

unsafe extern "system" fn hook_get_raw_input_data(
    raw_input: *mut c_void,
    command: u32,
    data: *mut c_void,
    size: *mut u32,
    header_size: u32,
) -> u32 {
    if blocking() {
        // Zero bytes copied reads as "no input available" to every caller.
        if !size.is_null() {
            unsafe { std::ptr::write(size, 0) };
        }
        return 0;
    }
    let real = REAL_GET_RAW_INPUT_DATA.load(Ordering::Acquire);
    if real == 0 {
        return u32::MAX;
    }
    unsafe {
        std::mem::transmute::<usize, GetRawInputDataFn>(real)(
            raw_input,
            command,
            data,
            size,
            header_size,
        )
    }
}

unsafe extern "system" fn hook_get_raw_input_buffer(
    data: *mut c_void,
    size: *mut u32,
    header_size: u32,
) -> u32 {
    if blocking() {
        return 0;
    }
    let real = REAL_GET_RAW_INPUT_BUFFER.load(Ordering::Acquire);
    if real == 0 {
        return u32::MAX;
    }
    unsafe { std::mem::transmute::<usize, GetRawInputBufferFn>(real)(data, size, header_size) }
}

/// Covers late binding: a game that resolves `XInputGetState` at runtime would
/// otherwise sail straight past every patched IAT entry.
unsafe extern "system" fn hook_get_proc_address(module: HMODULE, name: *const u8) -> *const c_void {
    let real = REAL_GET_PROC_ADDRESS.load(Ordering::Acquire);
    if real == 0 {
        return std::ptr::null();
    }
    let resolved = unsafe { std::mem::transmute::<usize, GetProcAddressFn>(real)(module, name) };
    if resolved.is_null() {
        return resolved;
    }
    match resolved as usize {
        address if address == REAL_XINPUT_GET_STATE.load(Ordering::Acquire) => {
            hook_xinput_get_state as XInputGetStateFn as *const c_void
        }
        address if address == REAL_XINPUT_GET_STATE_EX.load(Ordering::Acquire) => {
            hook_xinput_get_state_ex as XInputGetStateFn as *const c_void
        }
        address if address == REAL_GET_ASYNC_KEY_STATE.load(Ordering::Acquire) => {
            hook_get_async_key_state as GetAsyncKeyStateFn as *const c_void
        }
        address if address == REAL_GET_KEY_STATE.load(Ordering::Acquire) => {
            hook_get_key_state as GetKeyStateFn as *const c_void
        }
        address if address == REAL_GET_KEYBOARD_STATE.load(Ordering::Acquire) => {
            hook_get_keyboard_state as GetKeyboardStateFn as *const c_void
        }
        address if address == REAL_GET_RAW_INPUT_DATA.load(Ordering::Acquire) => {
            hook_get_raw_input_data as GetRawInputDataFn as *const c_void
        }
        address if address == REAL_GET_RAW_INPUT_BUFFER.load(Ordering::Acquire) => {
            hook_get_raw_input_buffer as GetRawInputBufferFn as *const c_void
        }
        _ => resolved,
    }
}

// ---------------------------------------------------------------------------
// PE walking
// ---------------------------------------------------------------------------

/// Offsets into the PE headers. Declared here rather than pulled from
/// windows-sys because only four fields are needed and the layout has been
/// fixed since PE32 was specified.
const DOS_MAGIC: u16 = 0x5A4D; // "MZ"
const PE_SIGNATURE: u32 = 0x0000_4550; // "PE\0\0"
const E_LFANEW_OFFSET: usize = 0x3C;
const OPTIONAL_HEADER_OFFSET: usize = 4 + 20; // signature + IMAGE_FILE_HEADER
const OPTIONAL_MAGIC_PE32: u16 = 0x010B;
const OPTIONAL_MAGIC_PE32PLUS: u16 = 0x020B;
const DATA_DIRECTORY_OFFSET_PE32: usize = 96;
const DATA_DIRECTORY_OFFSET_PE32PLUS: usize = 112;
const IMPORT_DIRECTORY_INDEX: usize = 1;

#[repr(C)]
#[derive(Clone, Copy)]
struct ImageImportDescriptor {
    original_first_thunk: u32,
    time_date_stamp: u32,
    forwarder_chain: u32,
    name: u32,
    first_thunk: u32,
}

/// Guard every header read: a module can be unmapped between enumeration and
/// inspection, and a torn read inside a game is a crash the user blames on us.
unsafe fn readable(pointer: *const c_void, len: usize) -> bool {
    if pointer.is_null() {
        return false;
    }
    let mut info: MEMORY_BASIC_INFORMATION = unsafe { std::mem::zeroed() };
    let queried = unsafe {
        VirtualQuery(
            pointer,
            &mut info,
            std::mem::size_of::<MEMORY_BASIC_INFORMATION>(),
        )
    };
    if queried == 0 {
        return false;
    }
    const COMMITTED: u32 = 0x1000;
    const NO_ACCESS: u32 = 0x01;
    const GUARD: u32 = 0x100;
    if info.State != COMMITTED || info.Protect & (NO_ACCESS | GUARD) != 0 {
        return false;
    }
    let region_end = info.BaseAddress as usize + info.RegionSize;
    (pointer as usize).saturating_add(len) <= region_end
}

/// Locate a module's import table, returning a pointer to the first descriptor.
unsafe fn import_descriptors(base: usize) -> Option<*const ImageImportDescriptor> {
    if !unsafe { readable(base as *const c_void, E_LFANEW_OFFSET + 4) } {
        return None;
    }
    if unsafe { std::ptr::read_unaligned(base as *const u16) } != DOS_MAGIC {
        return None;
    }
    let lfanew = unsafe { std::ptr::read_unaligned((base + E_LFANEW_OFFSET) as *const i32) };
    if lfanew <= 0 || lfanew > 0x1000 {
        return None;
    }
    let nt = base + lfanew as usize;
    if !unsafe { readable(nt as *const c_void, OPTIONAL_HEADER_OFFSET + 2) } {
        return None;
    }
    if unsafe { std::ptr::read_unaligned(nt as *const u32) } != PE_SIGNATURE {
        return None;
    }

    let optional = nt + OPTIONAL_HEADER_OFFSET;
    let directory_offset = match unsafe { std::ptr::read_unaligned(optional as *const u16) } {
        OPTIONAL_MAGIC_PE32PLUS => DATA_DIRECTORY_OFFSET_PE32PLUS,
        OPTIONAL_MAGIC_PE32 => DATA_DIRECTORY_OFFSET_PE32,
        _ => return None,
    };

    // Each IMAGE_DATA_DIRECTORY is { VirtualAddress: u32, Size: u32 }.
    let entry = optional + directory_offset + IMPORT_DIRECTORY_INDEX * 8;
    if !unsafe { readable(entry as *const c_void, 8) } {
        return None;
    }
    let rva = unsafe { std::ptr::read_unaligned(entry as *const u32) };
    if rva == 0 {
        return None;
    }
    let descriptors = base + rva as usize;
    if !unsafe {
        readable(
            descriptors as *const c_void,
            std::mem::size_of::<ImageImportDescriptor>(),
        )
    } {
        return None;
    }
    Some(descriptors as *const ImageImportDescriptor)
}

/// Replace every IAT slot in `base` whose current value matches a hooked
/// function. Matching on address rather than name deliberately: XInput's
/// `XInputGetStateEx` is exported by ordinal 100 with no name at all, and this
/// catches it for free.
#[derive(Default)]
struct PatchCoverage {
    covered: usize,
    failed: usize,
}

unsafe fn patch_module(base: usize, replacements: &[(usize, usize)]) -> PatchCoverage {
    let Some(mut descriptor) = (unsafe { import_descriptors(base) }) else {
        return PatchCoverage::default();
    };

    let mut coverage = PatchCoverage::default();
    loop {
        if !unsafe {
            readable(
                descriptor as *const c_void,
                std::mem::size_of::<ImageImportDescriptor>(),
            )
        } {
            break;
        }
        let entry = unsafe { std::ptr::read_unaligned(descriptor) };
        if entry.first_thunk == 0 && entry.name == 0 {
            break;
        }

        let mut thunk = base + entry.first_thunk as usize;
        loop {
            if !unsafe { readable(thunk as *const c_void, std::mem::size_of::<usize>()) } {
                break;
            }
            let current = unsafe { std::ptr::read_unaligned(thunk as *const usize) };
            if current == 0 {
                break;
            }
            if let Some((_, replacement)) = replacements
                .iter()
                .find(|(original, _)| *original == current)
            {
                let mut previous = 0u32;
                let protect_ok = unsafe {
                    VirtualProtect(
                        thunk as *mut c_void,
                        std::mem::size_of::<usize>(),
                        PAGE_READWRITE,
                        &mut previous,
                    )
                } != 0;
                if protect_ok {
                    unsafe { std::ptr::write_unaligned(thunk as *mut usize, *replacement) };
                    let mut restored = 0u32;
                    unsafe {
                        VirtualProtect(
                            thunk as *mut c_void,
                            std::mem::size_of::<usize>(),
                            previous,
                            &mut restored,
                        )
                    };
                    coverage.covered += 1;
                } else {
                    coverage.failed += 1;
                }
            } else if replacements
                .iter()
                .any(|(_, replacement)| *replacement == current)
            {
                // Periodic sweeps must continue to report the slots patched by
                // an earlier sweep as positively covered.
                coverage.covered += 1;
            }
            thunk += std::mem::size_of::<usize>();
        }

        descriptor = unsafe { descriptor.add(1) };
    }
    coverage
}

struct LoadedModules {
    bases: Vec<usize>,
    unsupported_module_mask: u32,
    snapshot_complete: bool,
}

/// Snapshot every module currently mapped into this process and record input
/// stacks this DLL does not hook. Module presence is intentionally a
/// conservative signal: a title may load one without polling it, but opening
/// fail-safe is preferable to letting one controller action hit two UIs.
///
/// Raw HID remains an explicit limitation but is not inferred from `hid.dll`:
/// Windows and device middleware load it transitively in many games, so doing
/// so would reject a large number of titles without proving direct HID use.
fn loaded_modules() -> LoadedModules {
    let mut bases = Vec::new();
    let mut unsupported_module_mask = 0u32;
    let snapshot: HANDLE =
        unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPMODULE, GetCurrentProcessId()) };
    if snapshot == INVALID_HANDLE_VALUE {
        return LoadedModules {
            bases,
            unsupported_module_mask,
            snapshot_complete: false,
        };
    }
    let mut entry: MODULEENTRY32W = unsafe { std::mem::zeroed() };
    entry.dwSize = std::mem::size_of::<MODULEENTRY32W>() as u32;
    let snapshot_complete = unsafe { Module32FirstW(snapshot, &mut entry) } != 0;
    if snapshot_complete {
        loop {
            bases.push(entry.modBaseAddr as usize);
            let name_length = entry
                .szModule
                .iter()
                .position(|character| *character == 0)
                .unwrap_or(entry.szModule.len());
            let module_name =
                String::from_utf16_lossy(&entry.szModule[..name_length]).to_ascii_lowercase();
            match module_name.as_str() {
                "dinput.dll" | "dinput8.dll" => {
                    unsupported_module_mask |= UNSUPPORTED_DIRECT_INPUT;
                }
                "gameinput.dll" | "gameinputredist.dll" => {
                    unsupported_module_mask |= UNSUPPORTED_GAME_INPUT;
                }
                "windows.gaming.input.dll" => {
                    unsupported_module_mask |= UNSUPPORTED_WINDOWS_GAMING_INPUT;
                }
                _ => {}
            }
            if unsafe { Module32NextW(snapshot, &mut entry) } == 0 {
                break;
            }
        }
    }
    unsafe { CloseHandle(snapshot) };
    LoadedModules {
        bases,
        unsupported_module_mask,
        snapshot_complete,
    }
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

fn wide(text: &str) -> Vec<u16> {
    text.encode_utf16().chain(std::iter::once(0)).collect()
}

/// Resolve a real export, loading its module only if the game already has it.
/// Deliberately does not `LoadLibrary` XInput into a game that never used it —
/// there would be nothing to gate, and forcing an unexpected DLL into a process
/// is the kind of side effect that breaks games.
fn resolve(module: &str, symbol: &[u8]) -> usize {
    let handle = unsafe { GetModuleHandleW(wide(module).as_ptr()) };
    if handle.is_null() {
        return 0;
    }
    let address = unsafe { GetProcAddress(handle, symbol.as_ptr()) };
    address.map_or(0, |pointer| pointer as usize)
}

fn resolve_ordinal(module: &str, ordinal: u16) -> usize {
    let handle = unsafe { GetModuleHandleW(wide(module).as_ptr()) };
    if handle.is_null() {
        return 0;
    }
    // An ordinal is passed to GetProcAddress as a pointer-sized integer.
    let address = unsafe { GetProcAddress(handle, ordinal as usize as *const u8) };
    address.map_or(0, |pointer| pointer as usize)
}

fn map_flag() -> bool {
    let mapping = unsafe {
        OpenFileMappingW(
            FILE_MAP_READ | FILE_MAP_WRITE,
            FALSE,
            FLAG_MAPPING_NAME.as_ptr(),
        )
    };
    if mapping.is_null() {
        HOOK_STATUS.store(1_000 + unsafe { GetLastError() }, Ordering::Release);
        return false;
    }
    let view = unsafe {
        MapViewOfFile(
            mapping,
            FILE_MAP_READ | FILE_MAP_WRITE,
            0,
            0,
            std::mem::size_of::<u32>() * INPUT_GATE_WORDS,
        )
    };
    // The view stays valid after the handle closes, and holding the handle open
    // for the process lifetime buys nothing.
    unsafe { CloseHandle(mapping) };
    if view.Value.is_null() {
        HOOK_STATUS.store(2_000 + unsafe { GetLastError() }, Ordering::Release);
        return false;
    }
    FLAG_VIEW.store(view.Value as usize, Ordering::Release);
    true
}

fn capture_originals() {
    // XInput ships under several names; whichever the game loaded is the one
    // worth gating. 1.3 is the one that never gates on focus by itself.
    for module in ["xinput1_4.dll", "xinput1_3.dll", "xinput9_1_0.dll"] {
        if REAL_XINPUT_GET_STATE.load(Ordering::Acquire) == 0 {
            let address = resolve(module, b"XInputGetState\0");
            if address != 0 {
                REAL_XINPUT_GET_STATE.store(address, Ordering::Release);
            }
        }
        if REAL_XINPUT_GET_STATE_EX.load(Ordering::Acquire) == 0 {
            // Undocumented but universally present: ordinal 100, the variant
            // that also reports the Guide button.
            let address = resolve_ordinal(module, 100);
            if address != 0 {
                REAL_XINPUT_GET_STATE_EX.store(address, Ordering::Release);
            }
        }
    }

    for (slot, symbol) in [
        (&REAL_GET_ASYNC_KEY_STATE, &b"GetAsyncKeyState\0"[..]),
        (&REAL_GET_KEY_STATE, &b"GetKeyState\0"[..]),
        (&REAL_GET_KEYBOARD_STATE, &b"GetKeyboardState\0"[..]),
        (&REAL_GET_RAW_INPUT_DATA, &b"GetRawInputData\0"[..]),
        (&REAL_GET_RAW_INPUT_BUFFER, &b"GetRawInputBuffer\0"[..]),
    ] {
        if slot.load(Ordering::Acquire) == 0 {
            let address = resolve("user32.dll", symbol);
            if address != 0 {
                slot.store(address, Ordering::Release);
            }
        }
    }

    if REAL_GET_PROC_ADDRESS.load(Ordering::Acquire) == 0 {
        let address = resolve("kernel32.dll", b"GetProcAddress\0");
        if address != 0 {
            REAL_GET_PROC_ADDRESS.store(address, Ordering::Release);
        }
    }
}

fn replacement_table() -> Vec<(usize, usize)> {
    let mut table: Vec<(usize, usize)> = Vec::with_capacity(8);
    let mut push = |slot: &AtomicUsize, hook: usize| {
        let original = slot.load(Ordering::Acquire);
        if original != 0 {
            table.push((original, hook));
        }
    };
    push(
        &REAL_XINPUT_GET_STATE,
        hook_xinput_get_state as XInputGetStateFn as usize,
    );
    push(
        &REAL_XINPUT_GET_STATE_EX,
        hook_xinput_get_state_ex as XInputGetStateFn as usize,
    );
    push(
        &REAL_GET_ASYNC_KEY_STATE,
        hook_get_async_key_state as GetAsyncKeyStateFn as usize,
    );
    push(
        &REAL_GET_KEY_STATE,
        hook_get_key_state as GetKeyStateFn as usize,
    );
    push(
        &REAL_GET_KEYBOARD_STATE,
        hook_get_keyboard_state as GetKeyboardStateFn as usize,
    );
    push(
        &REAL_GET_RAW_INPUT_DATA,
        hook_get_raw_input_data as GetRawInputDataFn as usize,
    );
    push(
        &REAL_GET_RAW_INPUT_BUFFER,
        hook_get_raw_input_buffer as GetRawInputBufferFn as usize,
    );
    push(
        &REAL_GET_PROC_ADDRESS,
        hook_get_proc_address as GetProcAddressFn as usize,
    );
    table
}

fn capability_mask() -> u32 {
    // The XInput replacement family is compiled into this DLL and late-loaded
    // XInput modules are covered by repeated import sweeps. The other bits
    // require their real Win32 entry points to have been captured first.
    let mut mask = CAPABILITY_XINPUT;
    if REAL_GET_ASYNC_KEY_STATE.load(Ordering::Acquire) != 0
        && REAL_GET_KEY_STATE.load(Ordering::Acquire) != 0
        && REAL_GET_KEYBOARD_STATE.load(Ordering::Acquire) != 0
    {
        mask |= CAPABILITY_WIN32_KEYBOARD;
    }
    if REAL_GET_RAW_INPUT_DATA.load(Ordering::Acquire) != 0
        && REAL_GET_RAW_INPUT_BUFFER.load(Ordering::Acquire) != 0
    {
        mask |= CAPABILITY_RAW_INPUT;
    }
    if REAL_GET_PROC_ADDRESS.load(Ordering::Acquire) != 0 {
        mask |= CAPABILITY_LATE_BINDING;
    }
    mask
}

/// Publish a positive acknowledgement for the exact target generation. The
/// launcher reads READY_PID as the commit word. Re-checking target/generation
/// before that final store prevents a late loader (for example Khazan's
/// steamclient_loader_x64.exe) from acknowledging its BBQ render child.
fn publish_hook_state(capabilities: u32, unsupported_modules: u32, status: u32) {
    let view = FLAG_VIEW.load(Ordering::Acquire);
    if view == 0 || !OWNER_ALIVE.load(Ordering::Acquire) {
        return;
    }
    let words = view as *mut u32;
    let current_pid = unsafe { GetCurrentProcessId() };
    let target = unsafe { std::ptr::read_volatile(words.add(TARGET_PID_WORD)) };
    let generation = unsafe { std::ptr::read_volatile(words.add(TARGET_GENERATION_WORD)) };
    if target != current_pid || generation == 0 {
        return;
    }

    unsafe {
        std::ptr::write_volatile(words.add(CAPABILITY_MASK_WORD), capabilities);
        std::ptr::write_volatile(words.add(UNSUPPORTED_MODULE_MASK_WORD), unsupported_modules);
        std::ptr::write_volatile(words.add(HOOK_STATUS_WORD), status);
        std::ptr::write_volatile(words.add(READY_GENERATION_WORD), generation);
    }

    let current_target = unsafe { std::ptr::read_volatile(words.add(TARGET_PID_WORD)) };
    let current_generation = unsafe { std::ptr::read_volatile(words.add(TARGET_GENERATION_WORD)) };
    if current_target == current_pid && current_generation == generation {
        unsafe { std::ptr::write_volatile(words.add(READY_PID_WORD), current_pid) };
    }
}

fn invalidate_hook_state(status: u32) {
    let view = FLAG_VIEW.load(Ordering::Acquire);
    if view == 0 {
        return;
    }
    let words = view as *mut u32;
    let current_pid = unsafe { GetCurrentProcessId() };
    let target = unsafe { std::ptr::read_volatile(words.add(TARGET_PID_WORD)) };
    if target != current_pid {
        return;
    }
    // The game stops suppressing input immediately; the launcher observes the
    // cleared readiness on its next 125 ms target poll and hides the overlay.
    unsafe {
        std::ptr::write_volatile(words.add(BLOCKED_WORD), 0);
        std::ptr::write_volatile(words.add(READY_PID_WORD), 0);
        std::ptr::write_volatile(words.add(HOOK_STATUS_WORD), status);
    }
}

fn gate_requested() -> bool {
    let view = FLAG_VIEW.load(Ordering::Acquire);
    if view == 0 {
        return false;
    }
    unsafe { std::ptr::read_volatile((view as *const u32).add(BLOCKED_WORD)) != 0 }
}

/// Re-apply the patch forever. Games load renderer plugins, anti-cheat shims
/// and mod DLLs long after startup, and each arrives with a fresh unpatched
/// IAT; a periodic sweep is far simpler and more robust than tracking
/// LdrLoadDll.
unsafe extern "system" fn worker(_parameter: *mut c_void) -> u32 {
    HOOK_STATUS.store(3, Ordering::Release);
    for _ in 0..50 {
        if map_flag() {
            HOOK_STATUS.store(4, Ordering::Release);
            break;
        }
        // The launcher may still be creating the mapping.
        unsafe { Sleep(100) };
    }

    let mut monitored_owner = 0u32;
    let mut owner_handle: HANDLE = std::ptr::null_mut();
    let mut module_scan_tick = 0u32;

    loop {
        let view = FLAG_VIEW.load(Ordering::Acquire);
        let owner = if view == 0 {
            0
        } else {
            unsafe { std::ptr::read_volatile((view as *const u32).add(OWNER_PID_WORD)) }
        };
        if owner != monitored_owner {
            OWNER_ALIVE.store(false, Ordering::Release);
            OWNER_PID.store(0, Ordering::Release);
            if !owner_handle.is_null() {
                unsafe { CloseHandle(owner_handle) };
                owner_handle = std::ptr::null_mut();
            }
            monitored_owner = owner;
            if owner != 0 {
                owner_handle = unsafe {
                    OpenProcess(
                        SYNCHRONIZE_ACCESS | PROCESS_QUERY_LIMITED_INFORMATION,
                        FALSE,
                        owner,
                    )
                };
                if !owner_handle.is_null() {
                    OWNER_PID.store(owner, Ordering::Release);
                }
            }
        }
        let owner_alive = !owner_handle.is_null()
            && unsafe { WaitForSingleObject(owner_handle, 0) } == WAIT_TIMEOUT;
        OWNER_ALIVE.store(owner_alive, Ordering::Release);

        if module_scan_tick == 0 {
            capture_originals();
            let table = replacement_table();
            HOOK_STATUS.store(100 + table.len() as u32, Ordering::Release);
            if !table.is_empty() {
                let modules = loaded_modules();
                if !modules.snapshot_complete {
                    const SNAPSHOT_FAILED_STATUS: u32 = 2_500;
                    HOOK_STATUS.store(SNAPSHOT_FAILED_STATUS, Ordering::Release);
                    HOOKS_READY.store(false, Ordering::Release);
                    invalidate_hook_state(SNAPSHOT_FAILED_STATUS);
                    module_scan_tick = 0;
                    unsafe { Sleep(100) };
                    continue;
                }
                let module_count = modules.bases.len() as u32;
                HOOK_STATUS.store(200 + module_count, Ordering::Release);
                let mut coverage = PatchCoverage::default();
                for base in modules.bases {
                    let module_coverage = unsafe { patch_module(base, &table) };
                    coverage.covered = coverage.covered.saturating_add(module_coverage.covered);
                    coverage.failed = coverage.failed.saturating_add(module_coverage.failed);
                }
                let capabilities = capability_mask();
                let status = 300 + coverage.covered.min((u32::MAX - 300) as usize) as u32;
                HOOK_STATUS.store(status, Ordering::Release);
                let coverage_complete = coverage.covered > 0 && coverage.failed == 0;
                let capabilities_complete =
                    (capabilities & REQUIRED_CAPABILITIES) == REQUIRED_CAPABILITIES;
                if coverage_complete && capabilities_complete {
                    publish_hook_state(capabilities, modules.unsupported_module_mask, status);
                    HOOKS_READY.store(true, Ordering::Release);
                } else {
                    HOOKS_READY.store(false, Ordering::Release);
                    invalidate_hook_state(status);
                }
            } else {
                const NO_HOOKS_STATUS: u32 = 2_600;
                HOOK_STATUS.store(NO_HOOKS_STATUS, Ordering::Release);
                HOOKS_READY.store(false, Ordering::Release);
                invalidate_hook_state(NO_HOOKS_STATUS);
            }
        }
        // While the overlay is active, shorten the unsupported-module
        // detection window to 200 ms. Hidden prewarming retains the lower-cost
        // two-second cadence.
        let scan_period = if gate_requested() { 2 } else { 20 };
        module_scan_tick = (module_scan_tick + 1) % scan_period;
        // Check launcher liveness ten times per second; full module rescans
        // retain the previous two-second cadence.
        unsafe { Sleep(100) };
    }
}

const DLL_PROCESS_ATTACH: u32 = 1;

#[no_mangle]
pub extern "system" fn DllMain(module: HMODULE, reason: u32, _reserved: *mut c_void) -> i32 {
    if reason == DLL_PROCESS_ATTACH {
        HOOK_STATUS.store(1, Ordering::Release);
        // Nothing but thread creation happens under the loader lock; all real
        // work (which touches other modules) is deferred to the worker.
        unsafe { DisableThreadLibraryCalls(module) };
        let handle = unsafe {
            CreateThread(
                std::ptr::null(),
                0,
                Some(worker),
                std::ptr::null(),
                0,
                std::ptr::null_mut(),
            )
        };
        if !handle.is_null() {
            HOOK_STATUS.store(2, Ordering::Release);
            unsafe { CloseHandle(handle) };
        }
    }
    TRUE
}

/// Exported so the launcher can confirm the DLL is live rather than guessing
/// from an injection call that only reports whether the thread started.
#[no_mangle]
pub extern "system" fn gamehub_input_hook_ready() -> i32 {
    if HOOKS_READY.load(Ordering::Acquire) {
        TRUE
    } else {
        FALSE
    }
}

#[no_mangle]
pub extern "system" fn gamehub_input_hook_status() -> u32 {
    HOOK_STATUS.load(Ordering::Acquire)
}
