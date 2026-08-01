//! Elevated helper for the GameHub overlay.
//!
//! # Why
//!
//! Two overlay features need a token the launcher does not have:
//!
//! * Injecting the input gate into a game that runs at higher integrity than
//!   GameHub. `OpenProcess` returns ERROR_ACCESS_DENIED (5) — measured against
//!   Hades II, where the repack launches elevated.
//! * Running PresentMon, whose ETW session needs administrator rights.
//!
//! Elevating per launch with ShellExecuteExW "runas" prompts every single time,
//! which is unusable for something that happens on every game start. Instead
//! this binary is registered once as a Scheduled Task at RunLevel Highest. A
//! non-elevated process may *start* such a task without any prompt, so the user
//! sees exactly one UAC dialog — at registration — and none afterwards.
//!
//! # Security
//!
//! An elevated service that injects DLLs on request is a privilege-escalation
//! vector if anything local can drive it, so two checks gate every connection:
//!
//! 1. The peer's executable must be the exact launcher path baked in at
//!    registration (`--client-executable`), resolved via
//!    GetNamedPipeClientProcessId + QueryFullProcessImageNameW.
//! 2. Any DLL to inject must live under the directory the broker itself was
//!    installed from (`--allow-directory`), so a compromised-but-authorised
//!    client still cannot ask for an arbitrary payload.
//!
//! The pipe carries a tab-delimited line protocol rather than JSON: it needs no
//! dependency, paths never contain tabs, and it stays readable in a trace.

#![cfg_attr(target_os = "windows", windows_subsystem = "windows")]

#[cfg(target_os = "windows")]
#[path = "../win_inject.rs"]
mod win_inject;

#[cfg(target_os = "windows")]
mod broker {
    use super::win_inject::{inject_dll, wide_string};

    use std::collections::HashMap;
    use std::ffi::OsString;
    use std::os::windows::process::CommandExt;
    use std::path::{Path, PathBuf};
    use std::process::{Child, Command, Stdio};
    use std::time::{Duration, Instant};

    use windows_sys::Win32::Foundation::{
        CloseHandle, GetLastError, ERROR_PIPE_CONNECTED, HANDLE, INVALID_HANDLE_VALUE,
    };
    use windows_sys::Win32::Storage::FileSystem::{
        ReadFile, WriteFile, FILE_FLAG_FIRST_PIPE_INSTANCE, PIPE_ACCESS_DUPLEX,
    };
    use windows_sys::Win32::System::Pipes::{
        ConnectNamedPipe, CreateNamedPipeW, DisconnectNamedPipe, GetNamedPipeClientProcessId,
        PIPE_READMODE_BYTE, PIPE_TYPE_BYTE, PIPE_WAIT,
    };
    use windows_sys::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, CREATE_NO_WINDOW,
        PROCESS_QUERY_LIMITED_INFORMATION,
    };

    /// The broker exits once no client has spoken to it for this long, so a
    /// forgotten elevated process cannot linger for the whole session.
    const IDLE_TIMEOUT: Duration = Duration::from_secs(15 * 60);

    pub struct Options {
        pub pipe_name: String,
        pub client_executable: PathBuf,
        pub allow_directory: PathBuf,
    }

    pub fn parse_options() -> Result<Options, String> {
        let mut values: HashMap<String, String> = HashMap::new();
        let args: Vec<String> = std::env::args().skip(1).collect();
        let mut index = 0;
        while index + 1 < args.len() {
            if let Some(key) = args[index].strip_prefix("--") {
                values.insert(key.to_string(), args[index + 1].clone());
                index += 2;
            } else {
                index += 1;
            }
        }

        let take = |key: &str| -> Result<String, String> {
            values
                .get(key)
                .cloned()
                .ok_or_else(|| format!("missing --{key}"))
        };

        Ok(Options {
            pipe_name: take("pipe")?,
            client_executable: PathBuf::from(take("client-executable")?),
            allow_directory: PathBuf::from(take("allow-directory")?),
        })
    }

    /// Windows paths are case-insensitive, and a client may report a path with
    /// different casing or short-name expansion than the one registered.
    fn paths_equal(left: &Path, right: &Path) -> bool {
        let normalize = |path: &Path| {
            std::fs::canonicalize(path)
                .unwrap_or_else(|_| path.to_path_buf())
                .to_string_lossy()
                .trim_start_matches(r"\\?\")
                .to_lowercase()
        };
        normalize(left) == normalize(right)
    }

    fn client_executable(pipe: HANDLE) -> Option<PathBuf> {
        let mut client_pid = 0u32;
        if unsafe { GetNamedPipeClientProcessId(pipe, &mut client_pid) } == 0 || client_pid == 0 {
            return None;
        }
        let process =
            unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, client_pid) };
        if process.is_null() {
            return None;
        }
        let mut buffer = vec![0u16; 32_768];
        let mut length = buffer.len() as u32;
        let ok = unsafe {
            QueryFullProcessImageNameW(process, 0, buffer.as_mut_ptr(), &mut length)
        } != 0;
        unsafe { CloseHandle(process) };
        if !ok {
            return None;
        }
        buffer.truncate(length as usize);
        Some(PathBuf::from(String::from_utf16_lossy(&buffer)))
    }

    struct PresentMon {
        child: Child,
    }

    pub struct Session {
        options: Options,
        presentmon: Option<PresentMon>,
    }

    impl Session {
        pub fn new(options: Options) -> Self {
            Self {
                options,
                presentmon: None,
            }
        }

        /// Refuse any payload outside the directory the broker was installed
        /// from — an authorised client must still not be able to name an
        /// arbitrary DLL for an elevated load.
        fn dll_is_allowed(&self, dll: &Path) -> bool {
            let root = std::fs::canonicalize(&self.options.allow_directory)
                .unwrap_or_else(|_| self.options.allow_directory.clone());
            let candidate = match std::fs::canonicalize(dll) {
                Ok(path) => path,
                Err(_) => return false,
            };
            candidate.starts_with(&root)
        }

        fn stop_presentmon(&mut self) {
            if let Some(mut running) = self.presentmon.take() {
                let _ = running.child.kill();
                let _ = running.child.wait();
            }
        }

        fn start_presentmon(&mut self, fields: &[&str]) -> String {
            let (Some(executable), Some(pid), Some(output), Some(session)) =
                (fields.first(), fields.get(1), fields.get(2), fields.get(3))
            else {
                return "ERR\tbad-arguments".into();
            };
            let Ok(pid) = pid.parse::<u32>() else {
                return "ERR\tbad-pid".into();
            };
            let executable = PathBuf::from(executable);
            if !self.dll_is_allowed(&executable) || !executable.is_file() {
                return "ERR\tforbidden-executable".into();
            }

            self.stop_presentmon();

            let Ok(file) = std::fs::File::create(output) else {
                return "ERR\toutput-unavailable".into();
            };

            // Display, GPU and input tracking are off deliberately: with them
            // on, PresentMon waits for a display correlation that never
            // arrives here and emits nothing at all.
            match Command::new(&executable)
                .args([
                    OsString::from("--process_id"),
                    OsString::from(pid.to_string()),
                    OsString::from("--output_stdout"),
                    OsString::from("--no_console_stats"),
                    OsString::from("--no_track_display"),
                    OsString::from("--no_track_gpu"),
                    OsString::from("--no_track_input"),
                    OsString::from("--terminate_on_proc_exit"),
                    OsString::from("--session_name"),
                    OsString::from(*session),
                    OsString::from("--stop_existing_session"),
                ])
                .stdout(Stdio::from(file))
                .stderr(Stdio::null())
                .creation_flags(CREATE_NO_WINDOW)
                .spawn()
            {
                Ok(child) => {
                    self.presentmon = Some(PresentMon { child });
                    "OK\tstarted".into()
                }
                Err(error) => format!("ERR\tspawn-failed: {error}"),
            }
        }

        fn handle(&mut self, line: &str) -> String {
            let mut fields = line.split('\t');
            let op = fields.next().unwrap_or_default();
            let rest: Vec<&str> = fields.collect();

            match op {
                "ping" => "OK\tpong".into(),
                "inject" => {
                    let (Some(pid), Some(dll)) = (rest.first(), rest.get(1)) else {
                        return "ERR\tbad-arguments".into();
                    };
                    let Ok(pid) = pid.parse::<u32>() else {
                        return "ERR\tbad-pid".into();
                    };
                    let dll = PathBuf::from(dll);
                    if !self.dll_is_allowed(&dll) {
                        return "ERR\tforbidden-dll".into();
                    }
                    let outcome = inject_dll(pid, &dll.to_string_lossy());
                    format!(
                        "OK\t{}\t{}\t{}",
                        outcome.injected, outcome.stage, outcome.error_code
                    )
                }
                "presentmon.start" => self.start_presentmon(&rest),
                "presentmon.stop" => {
                    self.stop_presentmon();
                    "OK\tstopped".into()
                }
                "shutdown" => "OK\tbye".into(),
                _ => "ERR\tunknown-op".into(),
            }
        }
    }

    fn read_line(pipe: HANDLE) -> Option<String> {
        let mut collected: Vec<u8> = Vec::new();
        let mut byte = [0u8; 1];
        loop {
            let mut read = 0u32;
            if unsafe {
                ReadFile(
                    pipe,
                    byte.as_mut_ptr() as *mut _,
                    1,
                    &mut read,
                    std::ptr::null_mut(),
                )
            } == 0
                || read == 0
            {
                return if collected.is_empty() {
                    None
                } else {
                    Some(String::from_utf8_lossy(&collected).into_owned())
                };
            }
            if byte[0] == b'\n' {
                return Some(String::from_utf8_lossy(&collected).into_owned());
            }
            if byte[0] != b'\r' {
                collected.push(byte[0]);
            }
            if collected.len() > 8192 {
                return None;
            }
        }
    }

    fn write_line(pipe: HANDLE, text: &str) {
        let payload = format!("{text}\n");
        let mut written = 0u32;
        unsafe {
            WriteFile(
                pipe,
                payload.as_ptr() as *const _,
                payload.len() as u32,
                &mut written,
                std::ptr::null_mut(),
            )
        };
    }

    pub fn run(options: Options) -> Result<(), String> {
        let pipe_path = format!(r"\\.\pipe\{}", options.pipe_name);
        let wide_path = wide_string(&pipe_path);
        let mut session = Session::new(options);
        let mut first_instance = true;
        let mut last_activity = Instant::now();

        loop {
            if last_activity.elapsed() > IDLE_TIMEOUT {
                session.stop_presentmon();
                return Ok(());
            }

            // FILE_FLAG_FIRST_PIPE_INSTANCE on the first create makes a second
            // broker fail fast instead of silently serving half the clients.
            let open_mode = PIPE_ACCESS_DUPLEX
                | if first_instance {
                    FILE_FLAG_FIRST_PIPE_INSTANCE
                } else {
                    0
                };
            let pipe = unsafe {
                CreateNamedPipeW(
                    wide_path.as_ptr(),
                    open_mode,
                    PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_WAIT,
                    1,
                    64 * 1024,
                    64 * 1024,
                    5_000,
                    std::ptr::null(),
                )
            };
            if pipe == INVALID_HANDLE_VALUE {
                return Err(format!("could not create pipe: {}", unsafe {
                    GetLastError()
                }));
            }
            first_instance = false;

            let connected = unsafe { ConnectNamedPipe(pipe, std::ptr::null_mut()) } != 0
                || unsafe { GetLastError() } == ERROR_PIPE_CONNECTED;

            if connected {
                let authorised = client_executable(pipe)
                    .is_some_and(|path| paths_equal(&path, &session.options.client_executable));

                if authorised {
                    last_activity = Instant::now();
                    while let Some(line) = read_line(pipe) {
                        if line.is_empty() {
                            continue;
                        }
                        let shutdown = line.starts_with("shutdown");
                        let reply = session.handle(&line);
                        write_line(pipe, &reply);
                        last_activity = Instant::now();
                        if shutdown {
                            unsafe { DisconnectNamedPipe(pipe) };
                            unsafe { CloseHandle(pipe) };
                            session.stop_presentmon();
                            return Ok(());
                        }
                    }
                } else {
                    write_line(pipe, "ERR\tunauthorised");
                }
                unsafe { DisconnectNamedPipe(pipe) };
            }
            unsafe { CloseHandle(pipe) };
        }
    }
}

#[cfg(target_os = "windows")]
fn main() {
    let Ok(options) = broker::parse_options() else {
        std::process::exit(2);
    };
    if broker::run(options).is_err() {
        std::process::exit(1);
    }
}

#[cfg(not(target_os = "windows"))]
fn main() {}
