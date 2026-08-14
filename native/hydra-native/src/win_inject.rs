//! DLL injection, shared by the in-process napi addon and the elevated broker.
//!
//! Both need the identical sequence, and they must not drift: the unelevated
//! addon is the fast path, and the broker is the fallback used when the target
//! runs at a higher integrity level than the launcher (`OpenProcess` returning
//! ERROR_ACCESS_DENIED). Living in one file means a fix to either applies to
//! both. Compiled into each independently — the crate is a `cdylib`, so a
//! binary cannot link the library.

#![cfg(target_os = "windows")]
#![allow(dead_code)]

use std::path::Path;

use windows_sys::Win32::Foundation::{
    CloseHandle, GetLastError, FILETIME, HANDLE, STILL_ACTIVE, WAIT_OBJECT_0,
};
use windows_sys::Win32::System::Diagnostics::Debug::WriteProcessMemory;
use windows_sys::Win32::System::LibraryLoader::{GetModuleHandleW, GetProcAddress};
use windows_sys::Win32::System::Memory::{
    VirtualAllocEx, VirtualFreeEx, MEM_COMMIT, MEM_RELEASE, MEM_RESERVE, PAGE_READWRITE,
};
use windows_sys::Win32::System::Threading::{
    CreateRemoteThread, GetExitCodeThread, GetProcessTimes, OpenProcess, WaitForSingleObject,
    INFINITE, PROCESS_CREATE_THREAD, PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_VM_OPERATION,
    PROCESS_VM_READ, PROCESS_VM_WRITE,
};

/// Outcome of an injection attempt, reported per stage so a refusal can be told
/// apart from a crash. "open" is a protected or higher-integrity process,
/// "thread" is usually antivirus blocking CreateRemoteThread, and "load" means
/// the target's loader rejected the DLL (most often a bitness mismatch).
pub struct InjectOutcome {
    pub injected: bool,
    pub stage: &'static str,
    pub error_code: u32,
}

impl InjectOutcome {
    fn fail(stage: &'static str) -> Self {
        Self {
            injected: false,
            stage,
            error_code: unsafe { GetLastError() },
        }
    }

    fn fail_with_code(stage: &'static str, error_code: u32) -> Self {
        Self {
            injected: false,
            stage,
            error_code,
        }
    }
}

fn completed_remote_load(wait_result: u32, queried_exit_code: bool, exit_code: u32) -> bool {
    wait_result == WAIT_OBJECT_0
        && queried_exit_code
        && exit_code != 0
        && exit_code != STILL_ACTIVE as u32
}

fn creation_ticks_from_filetime(value: FILETIME) -> u64 {
    ((value.dwHighDateTime as u64) << 32) | value.dwLowDateTime as u64
}

unsafe fn creation_ticks_for_handle(process: HANDLE) -> Option<u64> {
    let mut creation: FILETIME = unsafe { std::mem::zeroed() };
    let mut exit: FILETIME = unsafe { std::mem::zeroed() };
    let mut kernel: FILETIME = unsafe { std::mem::zeroed() };
    let mut user: FILETIME = unsafe { std::mem::zeroed() };
    (unsafe { GetProcessTimes(process, &mut creation, &mut exit, &mut kernel, &mut user) } != 0)
        .then(|| creation_ticks_from_filetime(creation))
}

pub fn process_creation_time_ticks(pid: u32) -> Option<u64> {
    if pid <= 4 {
        return None;
    }
    unsafe {
        let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if process.is_null() {
            return None;
        }
        let ticks = creation_ticks_for_handle(process);
        CloseHandle(process);
        ticks
    }
}

/// A timed-out remote loader still owns `remote`. Freeing that allocation
/// before LoadLibraryW returns is a target-process use-after-free. Transfer all
/// three handles to a bounded local cleanup thread and release the allocation
/// only after the remote thread is signalled. If the cleanup thread itself
/// cannot be created, close our handles and intentionally leak only the small
/// remote path allocation; the target OS will reclaim it when the game exits.
unsafe fn defer_remote_cleanup(
    process: *mut std::ffi::c_void,
    thread: *mut std::ffi::c_void,
    remote: *mut std::ffi::c_void,
) {
    let process_value = process as usize;
    let thread_value = thread as usize;
    let remote_value = remote as usize;
    let cleanup = std::thread::Builder::new()
        .name("gamehub-inject-cleanup".into())
        .spawn(move || unsafe {
            let process = process_value as *mut std::ffi::c_void;
            let thread = thread_value as *mut std::ffi::c_void;
            let remote = remote_value as *mut std::ffi::c_void;
            WaitForSingleObject(thread, INFINITE);
            VirtualFreeEx(process, remote, 0, MEM_RELEASE);
            CloseHandle(thread);
            CloseHandle(process);
        });
    if cleanup.is_err() {
        CloseHandle(thread);
        CloseHandle(process);
    }
}

pub fn wide_string(text: &str) -> Vec<u16> {
    text.encode_utf16().chain(std::iter::once(0)).collect()
}

/// Load `dll_path` into `pid` via the standard
/// VirtualAllocEx + WriteProcessMemory + CreateRemoteThread(LoadLibraryW)
/// sequence. Injecting the same DLL twice is harmless — the loader returns the
/// already-mapped module and no second worker starts — so callers may retry.
pub fn inject_dll(pid: u32, dll_path: &str, expected_creation_ticks: u64) -> InjectOutcome {
    unsafe {
        if pid == 0 || !Path::new(dll_path).is_file() {
            return InjectOutcome {
                injected: false,
                stage: "missing-dll",
                error_code: 0,
            };
        }

        let process = OpenProcess(
            PROCESS_CREATE_THREAD
                | PROCESS_QUERY_LIMITED_INFORMATION
                | PROCESS_VM_OPERATION
                | PROCESS_VM_READ
                | PROCESS_VM_WRITE,
            0,
            pid,
        );
        if process.is_null() {
            return InjectOutcome::fail("open");
        }
        if expected_creation_ticks == 0
            || creation_ticks_for_handle(process) != Some(expected_creation_ticks)
        {
            CloseHandle(process);
            return InjectOutcome::fail_with_code("identity", 0);
        }

        let path = wide_string(dll_path);
        let bytes = path.len() * std::mem::size_of::<u16>();
        let remote = VirtualAllocEx(
            process,
            std::ptr::null(),
            bytes,
            MEM_COMMIT | MEM_RESERVE,
            PAGE_READWRITE,
        );
        if remote.is_null() {
            let outcome = InjectOutcome::fail("allocate");
            CloseHandle(process);
            return outcome;
        }

        let mut written = 0usize;
        let wrote = WriteProcessMemory(
            process,
            remote,
            path.as_ptr() as *const std::ffi::c_void,
            bytes,
            &mut written,
        ) != 0
            && written == bytes;

        // LoadLibraryW sits at the same address in every process on a given
        // boot, so kernel32's local address is valid in the target.
        let loader = if wrote {
            let kernel32 = GetModuleHandleW(wide_string("kernel32.dll").as_ptr());
            if kernel32.is_null() {
                None
            } else {
                GetProcAddress(kernel32, c"LoadLibraryW".as_ptr() as *const u8)
            }
        } else {
            None
        };

        let mut outcome = if wrote {
            InjectOutcome::fail("loader-address")
        } else {
            InjectOutcome::fail("write")
        };

        if let Some(loader) = loader {
            let thread = CreateRemoteThread(
                process,
                std::ptr::null(),
                0,
                Some(std::mem::transmute::<
                    unsafe extern "system" fn() -> isize,
                    unsafe extern "system" fn(*mut std::ffi::c_void) -> u32,
                >(loader)),
                remote,
                0,
                std::ptr::null_mut(),
            );
            if thread.is_null() {
                outcome = InjectOutcome::fail("thread");
            } else {
                // Bounded: a game holding its loader lock must not stall the
                // caller. A slow load still succeeds; only the success report
                // is lost on timeout.
                let wait_result = WaitForSingleObject(thread, 1_200);
                let mut exit_code = 0u32;
                // LoadLibraryW returns the module handle, truncated to 32 bits
                // in a thread exit code — non-zero still means it loaded.
                let queried_exit_code =
                    wait_result == WAIT_OBJECT_0 && GetExitCodeThread(thread, &mut exit_code) != 0;
                outcome = if completed_remote_load(wait_result, queried_exit_code, exit_code) {
                    InjectOutcome {
                        injected: true,
                        stage: "ok",
                        error_code: 0,
                    }
                } else {
                    let stage = if wait_result == WAIT_OBJECT_0 {
                        "load"
                    } else {
                        "thread-timeout"
                    };
                    InjectOutcome::fail_with_code(stage, wait_result)
                };
                if wait_result == WAIT_OBJECT_0 {
                    CloseHandle(thread);
                } else {
                    defer_remote_cleanup(process, thread, remote);
                    return outcome;
                }
            }
        }

        VirtualFreeEx(process, remote, 0, MEM_RELEASE);
        CloseHandle(process);
        outcome
    }
}

#[cfg(test)]
mod tests {
    use super::{
        completed_remote_load, process_creation_time_ticks, CreateRemoteThread, GetExitCodeThread,
        WaitForSingleObject,
    };
    use windows_sys::Win32::Foundation::{CloseHandle, STILL_ACTIVE, WAIT_OBJECT_0, WAIT_TIMEOUT};
    use windows_sys::Win32::System::Threading::{GetCurrentProcess, Sleep, INFINITE};

    #[test]
    fn a_remote_load_is_successful_only_after_the_thread_signals() {
        assert!(completed_remote_load(WAIT_OBJECT_0, true, 0x1234));
        assert!(!completed_remote_load(WAIT_TIMEOUT, true, 0x1234));
        assert!(!completed_remote_load(
            WAIT_OBJECT_0,
            true,
            STILL_ACTIVE as u32
        ));
        assert!(!completed_remote_load(WAIT_OBJECT_0, false, 0x1234));
        assert!(!completed_remote_load(WAIT_OBJECT_0, true, 0));
    }

    unsafe extern "system" fn delayed_remote_fixture(_: *mut std::ffi::c_void) -> u32 {
        unsafe { Sleep(50) };
        1
    }

    #[test]
    fn a_delayed_remote_thread_is_never_mistaken_for_success() {
        unsafe {
            let thread = CreateRemoteThread(
                GetCurrentProcess(),
                std::ptr::null(),
                0,
                Some(delayed_remote_fixture),
                std::ptr::null(),
                0,
                std::ptr::null_mut(),
            );
            assert!(!thread.is_null());
            let wait_result = WaitForSingleObject(thread, 1);
            let mut exit_code = 0;
            let queried = GetExitCodeThread(thread, &mut exit_code) != 0;
            assert_eq!(wait_result, WAIT_TIMEOUT);
            assert_eq!(exit_code, STILL_ACTIVE as u32);
            assert!(!completed_remote_load(wait_result, queried, exit_code));
            assert_eq!(WaitForSingleObject(thread, INFINITE), WAIT_OBJECT_0);
            CloseHandle(thread);
        }
    }

    #[test]
    fn process_creation_identity_is_exact_and_stable() {
        let pid = std::process::id();
        let first = process_creation_time_ticks(pid).expect("current process creation time");
        let second = process_creation_time_ticks(pid).expect("repeat process creation time");
        assert_ne!(first, 0);
        assert_eq!(first, second);
    }
}
