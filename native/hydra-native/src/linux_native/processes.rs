use super::parse_process_stat;
use crate::NativeProcessControlResult;
use std::collections::{HashMap, HashSet, VecDeque};
use std::fs;
use std::os::fd::{AsRawFd, FromRawFd, OwnedFd};

pub fn creation_ticks(pid: u32) -> Option<String> {
    if pid <= 1 {
        return None;
    }
    let stat = fs::read_to_string(format!("/proc/{pid}/stat")).ok()?;
    parse_process_stat(&stat).map(|(_, ticks)| ticks)
}

fn effective_uid(pid: u32) -> Option<u32> {
    fs::read_to_string(format!("/proc/{pid}/status"))
        .ok()?
        .lines()
        .find_map(|line| {
            line.strip_prefix("Uid:")?
                .split_whitespace()
                .nth(1)?
                .parse()
                .ok()
        })
}

pub fn is_elevated(pid: u32) -> bool {
    effective_uid(pid) == Some(0)
}

fn failure(root: u32, message: &str, unsupported: bool) -> NativeProcessControlResult {
    NativeProcessControlResult {
        succeeded_pids: vec![],
        failed_pids: vec![root],
        unsupported,
        error: Some(message.into()),
    }
}

pub fn control_tree(root: u32, action: &str) -> NativeProcessControlResult {
    let signal = match action {
        "suspend" => libc::SIGSTOP,
        "resume" => libc::SIGCONT,
        "terminate" => libc::SIGKILL,
        _ => return failure(root, "unsupported process action", false),
    };
    if root <= 4 || root == std::process::id() {
        return failure(root, "unsafe process target rejected", false);
    }
    let Some(root_identity) = creation_ticks(root) else {
        return failure(root, "game process is no longer available", false);
    };
    let uid = unsafe { libc::geteuid() };
    if effective_uid(root) != Some(uid) {
        return failure(root, "game process belongs to another user", false);
    }
    let mut descendants: HashMap<u32, Vec<(u32, String)>> = HashMap::new();
    if let Ok(entries) = fs::read_dir("/proc") {
        for entry in entries.flatten() {
            let Ok(pid) = entry.file_name().to_string_lossy().parse::<u32>() else {
                continue;
            };
            let Ok(stat) = fs::read_to_string(entry.path().join("stat")) else {
                continue;
            };
            if let Some((parent, identity)) = parse_process_stat(&stat) {
                descendants.entry(parent).or_default().push((pid, identity));
            }
        }
    }
    let mut pending = VecDeque::from([(root, root_identity)]);
    let mut visited = HashSet::new();
    let mut targets = Vec::new();
    while let Some((pid, identity)) = pending.pop_front() {
        if !visited.insert(pid) {
            continue;
        }
        if pid <= 4 || pid == std::process::id() || targets.len() >= 4096 {
            return failure(root, "unsafe or oversized process tree rejected", false);
        }
        targets.push((pid, identity));
        if let Some(children) = descendants.get(&pid) {
            pending.extend(children.iter().cloned());
        }
    }
    // Open stable kernel PID references for every target BEFORE sending any
    // signal. This prevents PID reuse from redirecting a later resume/close.
    let mut handles = Vec::new();
    for (pid, identity) in targets {
        let fd = unsafe { libc::syscall(libc::SYS_pidfd_open, pid, 0) };
        if fd < 0 {
            let error = std::io::Error::last_os_error();
            return failure(
                root,
                &format!("cannot acquire safe game process handle: {error}"),
                error.raw_os_error() == Some(libc::ENOSYS),
            );
        }
        let fd = unsafe { OwnedFd::from_raw_fd(fd as i32) };
        if creation_ticks(pid).as_deref() != Some(identity.as_str())
            || effective_uid(pid) != Some(uid)
        {
            return failure(root, "game process identity changed before control", false);
        }
        handles.push((pid, fd));
    }
    if action != "resume" {
        handles.reverse();
    }
    let mut succeeded_pids = Vec::new();
    let mut failed_pids = Vec::new();
    for (pid, handle) in handles {
        let result = unsafe {
            libc::syscall(
                libc::SYS_pidfd_send_signal,
                handle.as_raw_fd(),
                signal,
                std::ptr::null::<libc::siginfo_t>(),
                0,
            )
        };
        if result == 0 {
            succeeded_pids.push(pid);
        } else {
            failed_pids.push(pid);
        }
    }
    NativeProcessControlResult {
        error: (!failed_pids.is_empty())
            .then(|| "one or more game processes denied the requested action".into()),
        succeeded_pids,
        failed_pids,
        unsupported: false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::{Child, Command};

    struct Fixture(Child);
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = self.0.kill();
            let _ = self.0.wait();
        }
    }

    #[test]
    fn rejects_self_and_system_without_signalling() {
        for pid in [0, 1, 4, std::process::id()] {
            assert!(control_tree(pid, "suspend").succeeded_pids.is_empty());
        }
    }

    #[test]
    fn spawned_fixture_can_stop_continue_and_terminate() {
        let mut child = Fixture(Command::new("sleep").arg("30").spawn().unwrap());
        let pid = child.0.id();
        let identity = creation_ticks(pid).unwrap();
        let stopped = control_tree(pid, "suspend");
        // Kill/reap our own fixture even when an old sandbox kernel lacks pidfd.
        if !stopped.succeeded_pids.contains(&pid) {
            assert!(stopped.unsupported, "{:?}", stopped.error);
            return;
        }
        assert_eq!(creation_ticks(pid), Some(identity));
        assert!(control_tree(pid, "resume").succeeded_pids.contains(&pid));
        assert!(control_tree(pid, "terminate").succeeded_pids.contains(&pid));
        child.0.wait().unwrap();
    }
}
