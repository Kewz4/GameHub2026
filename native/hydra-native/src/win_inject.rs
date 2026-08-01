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

use windows_sys::Win32::Foundation::{CloseHandle, GetLastError};
use windows_sys::Win32::System::Diagnostics::Debug::WriteProcessMemory;
use windows_sys::Win32::System::LibraryLoader::{GetModuleHandleW, GetProcAddress};
use windows_sys::Win32::System::Memory::{
    VirtualAllocEx, VirtualFreeEx, MEM_COMMIT, MEM_RELEASE, MEM_RESERVE, PAGE_READWRITE,
};
use windows_sys::Win32::System::Threading::{
    CreateRemoteThread, GetExitCodeThread, OpenProcess, WaitForSingleObject,
    PROCESS_CREATE_THREAD, PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_VM_OPERATION,
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
}

pub fn wide_string(text: &str) -> Vec<u16> {
    text.encode_utf16().chain(std::iter::once(0)).collect()
}

/// Load `dll_path` into `pid` via the standard
/// VirtualAllocEx + WriteProcessMemory + CreateRemoteThread(LoadLibraryW)
/// sequence. Injecting the same DLL twice is harmless — the loader returns the
/// already-mapped module and no second worker starts — so callers may retry.
pub fn inject_dll(pid: u32, dll_path: &str) -> InjectOutcome {
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
                WaitForSingleObject(thread, 1_200);
                let mut exit_code = 0u32;
                // LoadLibraryW returns the module handle, truncated to 32 bits
                // in a thread exit code — non-zero still means it loaded.
                outcome = if GetExitCodeThread(thread, &mut exit_code) != 0 && exit_code != 0 {
                    InjectOutcome {
                        injected: true,
                        stage: "ok",
                        error_code: 0,
                    }
                } else {
                    InjectOutcome::fail("load")
                };
                CloseHandle(thread);
            }
        }

        VirtualFreeEx(process, remote, 0, MEM_RELEASE);
        CloseHandle(process);
        outcome
    }
}
