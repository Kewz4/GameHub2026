use crate::NativeWindowBounds;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};
use x11rb::connection::Connection;
use x11rb::protocol::xproto::{
    AtomEnum, ClientMessageEvent, ConfigureWindowAux, ConnectionExt, EventMask, MapState, StackMode,
};
use x11rb::rust_connection::RustConnection;

struct Desktop {
    connection: RustConnection,
    root: u32,
    active: u32,
    clients: u32,
    pid: u32,
    compositor: u32,
}

impl Desktop {
    fn connect() -> Option<Self> {
        // Never assume Wayland grants global window enumeration. This connects
        // only to the session's X server; native Wayland windows remain unknown.
        if std::env::var_os("DISPLAY").is_none() {
            return None;
        }
        let (connection, screen) = x11rb::connect(None).ok()?;
        let root = connection.setup().roots.get(screen)?.root;
        let atom = |name: &[u8]| {
            connection
                .intern_atom(false, name)
                .ok()?
                .reply()
                .ok()
                .map(|r| r.atom)
        };
        let active = atom(b"_NET_ACTIVE_WINDOW")?;
        let clients = atom(b"_NET_CLIENT_LIST_STACKING")?;
        let pid = atom(b"_NET_WM_PID")?;
        let compositor = atom(format!("_NET_WM_CM_S{screen}").as_bytes())?;
        Some(Self {
            connection,
            root,
            active,
            clients,
            pid,
            compositor,
        })
    }

    fn property(&self, window: u32, atom: u32, kind: AtomEnum) -> Option<Vec<u32>> {
        let reply = self
            .connection
            .get_property(false, window, atom, kind, 0, 4096)
            .ok()?
            .reply()
            .ok()?;
        let values = reply.value32()?.collect();
        Some(values)
    }

    fn foreground(&self) -> Option<u32> {
        let window = *self
            .property(self.root, self.active, AtomEnum::WINDOW)?
            .first()?;
        self.property(window, self.pid, AtomEnum::CARDINAL)?
            .first()
            .copied()
    }

    fn bounds(&self, pid: u32) -> Option<NativeWindowBounds> {
        if pid <= 1 {
            return None;
        }
        let windows = self.property(self.root, self.clients, AtomEnum::WINDOW)?;
        let mut best: Option<NativeWindowBounds> = None;
        // Stacking list is bottom-to-top; for equal-sized game windows prefer
        // the uppermost mapped client, never an invisible launcher/helper.
        for window in windows {
            if self
                .property(window, self.pid, AtomEnum::CARDINAL)
                .and_then(|v| v.first().copied())
                != Some(pid)
            {
                continue;
            }
            let Some(attributes) = self
                .connection
                .get_window_attributes(window)
                .ok()
                .and_then(|r| r.reply().ok())
            else {
                continue;
            };
            if attributes.map_state != MapState::VIEWABLE {
                continue;
            }
            let Some(geometry) = self
                .connection
                .get_geometry(window)
                .ok()
                .and_then(|r| r.reply().ok())
            else {
                continue;
            };
            let Some(origin) = self
                .connection
                .translate_coordinates(window, self.root, 0, 0)
                .ok()
                .and_then(|r| r.reply().ok())
            else {
                continue;
            };
            let width = i32::from(geometry.width);
            let height = i32::from(geometry.height);
            if width <= 0 || height <= 0 {
                continue;
            }
            if best.as_ref().is_some_and(|b| {
                i64::from(b.width) * i64::from(b.height) > i64::from(width) * i64::from(height)
            }) {
                continue;
            }
            best = Some(NativeWindowBounds {
                x: i32::from(origin.dst_x),
                y: i32::from(origin.dst_y),
                width,
                height,
                window_id: window.to_string(),
            });
        }
        best
    }

    fn focus(&self, window: u32) -> bool {
        if window == 0 {
            return false;
        }
        let message =
            ClientMessageEvent::new(32, window, self.active, [2, x11rb::CURRENT_TIME, 0, 0, 0]);
        self.connection
            .send_event(
                false,
                self.root,
                EventMask::SUBSTRUCTURE_REDIRECT | EventMask::SUBSTRUCTURE_NOTIFY,
                message,
            )
            .ok()
            .is_some_and(|request| request.check().is_ok())
            && self.connection.flush().is_ok()
    }
}

struct CachedDesktop {
    desktop: Option<Desktop>,
    retry_at: Instant,
}
static DESKTOP: OnceLock<Mutex<CachedDesktop>> = OnceLock::new();

fn with_desktop<T>(operation: impl FnOnce(&Desktop) -> T) -> Option<T> {
    let state = DESKTOP.get_or_init(|| {
        Mutex::new(CachedDesktop {
            desktop: None,
            retry_at: Instant::now(),
        })
    });
    let mut state = state.lock().ok()?;
    if state.desktop.is_none() && Instant::now() >= state.retry_at {
        state.desktop = Desktop::connect();
        state.retry_at = Instant::now() + Duration::from_secs(5);
    }
    // Drop an errored connection so compositor/session restart is recoverable.
    if state
        .desktop
        .as_ref()
        .is_some_and(|desktop| desktop.connection.poll_for_event().is_err())
    {
        state.desktop = None;
    }
    state.desktop.as_ref().map(operation)
}

pub fn foreground_pid() -> u32 {
    with_desktop(|desktop| desktop.foreground())
        .flatten()
        .unwrap_or(0)
}
pub fn has_compositor() -> bool {
    with_desktop(|desktop| desktop.connection.get_selection_owner(desktop.compositor)
        .ok().and_then(|request| request.reply().ok()).is_some_and(|reply| reply.owner != 0))
        .unwrap_or(false)
}
pub fn bounds(pid: u32) -> Option<NativeWindowBounds> {
    with_desktop(|desktop| desktop.bounds(pid)).flatten()
}
pub fn focus_process(pid: u32) -> bool {
    with_desktop(|desktop| {
        desktop
            .bounds(pid)
            .and_then(|b| b.window_id.parse().ok())
            .is_some_and(|window| desktop.focus(window))
    })
    .unwrap_or(false)
}
pub fn focus_window(window: u32) -> bool {
    with_desktop(|desktop| desktop.focus(window)).unwrap_or(false)
}
pub fn place_window(window: u32, pid: u32) -> bool {
    with_desktop(|desktop| {
        let Some(bounds) = desktop.bounds(pid) else {
            return false;
        };
        if window == 0 {
            return false;
        }
        desktop
            .connection
            .configure_window(
                window,
                &ConfigureWindowAux::new()
                    .x(bounds.x)
                    .y(bounds.y)
                    .width(bounds.width as u32)
                    .height(bounds.height as u32)
                    .stack_mode(StackMode::ABOVE),
            )
            .ok()
            .is_some_and(|request| request.check().is_ok())
            && desktop.connection.flush().is_ok()
    })
    .unwrap_or(false)
}
