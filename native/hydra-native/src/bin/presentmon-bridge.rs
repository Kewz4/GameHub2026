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
use std::time::{Duration, Instant};

#[cfg(target_os = "windows")]
use windows_sys::Win32::Foundation::CloseHandle;
#[cfg(target_os = "windows")]
use windows_sys::Win32::System::Threading::{
    OpenProcess, WaitForSingleObject, CREATE_NO_WINDOW, PROCESS_QUERY_LIMITED_INFORMATION,
};

#[cfg(target_os = "windows")]
const SYNCHRONIZE_ACCESS: u32 = 0x0010_0000;

/// Session names used by earlier GameHub builds, cleared on every start so a
/// session leaked before this fix shipped cannot block capture forever.
#[cfg(target_os = "windows")]
const LEGACY_SESSION_NAMES: &[&str] = &["GameHubOverlayPresentMon"];

/// Stop an ETW trace session by name via the OS trace controller.
///
/// `logman stop <name> -ets` deletes a running real-time session. It is part of
/// Windows, needs no PresentMon cooperation, and succeeds whether or not the
/// session exists (a missing session is simply a non-zero exit we ignore).
#[cfg(target_os = "windows")]
fn stop_trace_session(session_name: &str) {
    let Ok(mut child) = Command::new("logman")
        .args([
            OsString::from("stop"),
            OsString::from(session_name),
            OsString::from("-ets"),
        ])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
    else {
        return;
    };

    // Bounded so a wedged controller can never block the capture.
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        match child.try_wait() {
            Ok(Some(_)) | Err(_) => break,
            Ok(None) => {}
        }
        if Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            break;
        }
        thread::sleep(Duration::from_millis(50));
    }
}

/// Append a diagnostic line in UTF-16LE.
///
/// PresentMon writes its own console output to this file as UTF-16LE. Writing
/// our lines as UTF-8 left the file mixed-encoding, so whichever one the reader
/// guessed wrong came out as mojibake.
#[cfg(target_os = "windows")]
fn write_diagnostic_line(file: &mut std::fs::File, line: &str) {
    let mut bytes = Vec::with_capacity((line.len() + 2) * 2);
    for unit in format!("{line}\r\n").encode_utf16() {
        bytes.extend_from_slice(&unit.to_le_bytes());
    }
    let _ = file.write_all(&bytes);
}

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

    // An ETW trace session outlives the process that created it, and GameHub
    // stops a capture by terminating PresentMon (target change, overlay
    // disabled, shutdown), so PresentMon never closes its own session. A later
    // run then finds the stale session and refuses to start:
    //
    //   error: a trace session named "..." is already running.
    //
    // Asking PresentMon to clear it does not work — invoked with only a session
    // name it has no capture to perform, exits non-zero, and leaves the session
    // registered. Stop it with the OS's own ETW controller instead, which is
    // what `logman ... -ets` is for and does not depend on PresentMon's CLI
    // semantics. This also clears sessions leaked by earlier GameHub builds.
    stop_trace_session(&session_name);
    for legacy in LEGACY_SESSION_NAMES {
        stop_trace_session(legacy);
    }

    // Always leave a trace of what was attempted. An empty diagnostic file
    // previously meant "PresentMon printed nothing", which is indistinguishable
    // from "the bridge never got that far".
    {
        let mut diagnostic = diagnostic
            .try_clone()
            .map_err(|error| format!("could not clone diagnostic output: {error}"))?;
        write_diagnostic_line(
            &mut diagnostic,
            &format!(
                "bridge: starting PresentMon for pid {target_pid}, session \"{session_name}\""
            ),
        );
    }

    // PresentMon opens --output_file without FILE_SHARE_READ, which prevents
    // the normal-integrity GameHub process from tailing an elevated capture.
    // Its stdout mode flushes every CSV row, while Rust-created files use the
    // Windows standard library's share-read/share-write/share-delete defaults.
    // The `--no_track_*` flags are the difference between rows and silence.
    //
    // By default PresentMon correlates every present with a display event
    // before emitting its row, and also collects GPU and input-latency
    // telemetry. Those need providers this process could not get here: the
    // collector started cleanly, wrote its UTF-16LE byte-order mark, and then
    // produced not one further byte — no header, no rows — for the full
    // capture window, across two unrelated engines. Nothing is ever
    // "complete", so nothing is ever written. Turning off display, GPU and
    // input tracking leaves plain present events, which is all the consumer
    // needs: it derives frame time from msBetweenPresents when
    // msBetweenDisplayChange is absent.
    //
    // `--v1_metrics` is dropped for the same reason — matching the invocation
    // upstream Hydra uses, which is known to produce output. The column
    // resolver reads the header by name and accepts either schema, so no
    // parsing change is required.
    //
    // `--exclude_dropped` stays out: it discards every frame not considered
    // displayed, which for a composited borderless window can exclude the
    // whole capture.
    let mut child = Command::new(&presentmon)
        .args([
            OsString::from("--process_id"),
            OsString::from(target_pid.to_string()),
            OsString::from("--output_stdout"),
            OsString::from("--no_console_stats"),
            OsString::from("--no_track_display"),
            OsString::from("--no_track_gpu"),
            OsString::from("--no_track_input"),
            OsString::from("--terminate_on_proc_exit"),
            OsString::from("--session_name"),
            OsString::from(session_name.clone()),
            OsString::from("--stop_existing_session"),
        ])
        .stdout(Stdio::from(output))
        .stderr(Stdio::from(child_stderr))
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
        .map_err(|error| format!("could not start PresentMon: {error}"))?;

    // A silent PresentMon is ambiguous: it can mean the process wrote nothing,
    // or that it wrote plenty and the consumer could not read it. Sampling the
    // CSV's own byte count from inside the elevated bridge separates the two —
    // whatever this reports is what PresentMon actually produced.
    let started_at = Instant::now();
    let mut next_heartbeat = Duration::from_secs(2);
    let mut heartbeat_log = diagnostic
        .try_clone()
        .map_err(|error| format!("could not clone diagnostic output: {error}"))?;

    loop {
        let elapsed = started_at.elapsed();
        if elapsed >= next_heartbeat && next_heartbeat <= Duration::from_secs(20) {
            let csv_bytes = fs::metadata(&output_path).map(|meta| meta.len()).unwrap_or(0);
            write_diagnostic_line(
                &mut heartbeat_log,
                &format!(
                    "bridge: t={}s csv_bytes={csv_bytes}",
                    elapsed.as_secs()
                ),
            );
            next_heartbeat += Duration::from_secs(4);
        }

        match child.try_wait() {
            Ok(Some(status)) => {
                let csv_bytes = fs::metadata(&output_path).map(|meta| meta.len()).unwrap_or(0);
                let mut diagnostic = diagnostic;
                write_diagnostic_line(
                    &mut diagnostic,
                    &format!(
                        "PresentMon exited with status {status} after {}s, csv_bytes={csv_bytes}",
                        elapsed.as_secs()
                    ),
                );
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
            // Ask PresentMon to end the capture itself first: a terminated
            // PresentMon leaves its ETW session registered, which the reaper
            // above then has to clean up on the next launch. Closing stdout
            // makes it observe a broken pipe and shut the session down.
            drop(child.stdout.take());
            let deadline = Instant::now() + Duration::from_secs(2);
            let mut exited = false;
            while Instant::now() < deadline {
                match child.try_wait() {
                    Ok(Some(_)) => {
                        exited = true;
                        break;
                    }
                    Err(_) => break,
                    Ok(None) => thread::sleep(Duration::from_millis(50)),
                }
            }
            if !exited {
                let _ = child.kill();
                let _ = child.wait();
            }
            // A terminated PresentMon leaves its session registered; drop it
            // here so the next capture never has to reap anything.
            stop_trace_session(&session_name);
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
                write_diagnostic_line(&mut diagnostic, &error);
            }
        }
        std::process::exit(1);
    }
}

#[cfg(not(target_os = "windows"))]
fn main() {}
