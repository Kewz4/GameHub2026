#![cfg_attr(target_os = "windows", windows_subsystem = "windows")]

#[cfg(target_os = "windows")]
use std::ffi::OsString;
#[cfg(target_os = "windows")]
use std::fs::{self, OpenOptions};
#[cfg(target_os = "windows")]
use std::io::Write;
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
#[cfg(target_os = "windows")]
use std::path::{Path, PathBuf};
#[cfg(target_os = "windows")]
use std::process::{Command, Stdio};
#[cfg(target_os = "windows")]
use std::thread;
#[cfg(target_os = "windows")]
use std::time::Duration;

#[cfg(target_os = "windows")]
use windows_sys::Win32::Foundation::CloseHandle;
#[cfg(target_os = "windows")]
use windows_sys::Win32::System::Threading::{
    OpenProcess, WaitForSingleObject, CREATE_NO_WINDOW, PROCESS_QUERY_LIMITED_INFORMATION,
};

#[cfg(target_os = "windows")]
const SYNCHRONIZE_ACCESS: u32 = 0x0010_0000;

#[cfg(target_os = "windows")]
fn diagnostic_path(output_path: &Path) -> PathBuf {
    PathBuf::from(format!("{}.log", output_path.to_string_lossy()))
}

#[cfg(target_os = "windows")]
fn open_shared_output(path: &Path) -> std::io::Result<std::fs::File> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    OpenOptions::new()
        .create(true)
        .truncate(true)
        .write(true)
        .open(path)
}

#[cfg(target_os = "windows")]
fn parent_is_running(parent_pid: u32) -> bool {
    unsafe {
        let handle = OpenProcess(
            SYNCHRONIZE_ACCESS | PROCESS_QUERY_LIMITED_INFORMATION,
            0,
            parent_pid,
        );
        if handle.is_null() {
            return false;
        }
        let running = WaitForSingleObject(handle, 0) != 0;
        CloseHandle(handle);
        running
    }
}

#[cfg(target_os = "windows")]
fn run() -> Result<(), String> {
    let args: Vec<OsString> = std::env::args_os().skip(1).collect();
    if args.len() != 6 {
        return Err("expected PresentMon, output, stop, parent PID, target PID, and session".into());
    }

    let presentmon = PathBuf::from(&args[0]);
    let output_path = PathBuf::from(&args[1]);
    let stop_path = PathBuf::from(&args[2]);
    let parent_pid = args[3]
        .to_string_lossy()
        .parse::<u32>()
        .map_err(|_| "invalid parent PID")?;
    let target_pid = args[4]
        .to_string_lossy()
        .parse::<u32>()
        .map_err(|_| "invalid target PID")?;
    let session_name = args[5].to_string_lossy().into_owned();

    if !presentmon.is_file() || parent_pid == 0 || target_pid == 0 {
        return Err("invalid PresentMon bridge target".into());
    }

    let _ = fs::remove_file(&stop_path);
    let output = open_shared_output(&output_path)
        .map_err(|error| format!("could not open shared CSV output: {error}"))?;
    let diagnostic_path = diagnostic_path(&output_path);
    let diagnostic = open_shared_output(&diagnostic_path)
        .map_err(|error| format!("could not open diagnostic output: {error}"))?;
    let child_stderr = diagnostic
        .try_clone()
        .map_err(|error| format!("could not clone diagnostic output: {error}"))?;

    // PresentMon opens --output_file without FILE_SHARE_READ, which prevents
    // the normal-integrity GameHub process from tailing an elevated capture.
    // Its stdout mode flushes every CSV row, while Rust-created files use the
    // Windows standard library's share-read/share-write/share-delete defaults.
    let mut child = Command::new(&presentmon)
        .args([
            OsString::from("--process_id"),
            OsString::from(target_pid.to_string()),
            OsString::from("--output_stdout"),
            OsString::from("--no_console_stats"),
            OsString::from("--exclude_dropped"),
            OsString::from("--v1_metrics"),
            OsString::from("--terminate_on_proc_exit"),
            OsString::from("--session_name"),
            OsString::from(session_name),
            OsString::from("--stop_existing_session"),
        ])
        .stdout(Stdio::from(output))
        .stderr(Stdio::from(child_stderr))
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
        .map_err(|error| format!("could not start PresentMon: {error}"))?;

    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                let mut diagnostic = diagnostic;
                let _ = writeln!(diagnostic, "PresentMon exited with status {status}");
                break;
            }
            Ok(None) => {}
            Err(error) => {
                let _ = child.kill();
                return Err(format!("could not monitor PresentMon: {error}"));
            }
        }

        // A normal stop writes the signal file. Monitoring GameHub's parent
        // PID also prevents an elevated collector surviving an app crash.
        if stop_path.exists() || !parent_is_running(parent_pid) {
            let _ = child.kill();
            let _ = child.wait();
            break;
        }
        thread::sleep(Duration::from_millis(100));
    }

    let _ = fs::remove_file(stop_path);
    Ok(())
}

#[cfg(target_os = "windows")]
fn main() {
    if let Err(error) = run() {
        if let Some(output) = std::env::args_os().nth(2) {
            if let Ok(mut diagnostic) =
                open_shared_output(&diagnostic_path(Path::new(&output)))
            {
                let _ = writeln!(diagnostic, "{error}");
            }
        }
        std::process::exit(1);
    }
}

#[cfg(not(target_os = "windows"))]
fn main() {}
