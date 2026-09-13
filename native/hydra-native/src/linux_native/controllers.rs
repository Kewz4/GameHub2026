use super::controller_mask;
use libloading::Library;
use std::cell::RefCell;
use std::collections::HashMap;
use std::ffi::{c_char, c_int, c_void};
use std::time::{Duration, Instant};

type Controller = *mut c_void;
struct Sdl {
    _library: Library,
    update: unsafe extern "C" fn(),
    count: unsafe extern "C" fn() -> c_int,
    is_controller: unsafe extern "C" fn(c_int) -> c_int,
    device_id: unsafe extern "C" fn(c_int) -> c_int,
    open: unsafe extern "C" fn(c_int) -> Controller,
    close: unsafe extern "C" fn(Controller),
    attached: unsafe extern "C" fn(Controller) -> c_int,
    button: unsafe extern "C" fn(Controller, c_int) -> u8,
    axis: unsafe extern "C" fn(Controller, c_int) -> i16,
    controllers: HashMap<c_int, Controller>,
    scan_at: Instant,
}

impl Sdl {
    unsafe fn load() -> Option<Self> {
        // Runtime optional: keep the launcher usable on minimal desktops. SDL
        // ships the maintained mappings for Xbox/PlayStation/Nintendo pads;
        // guessing evdev button indexes would swap accept/back on many devices.
        let library = Library::new("libSDL2-2.0.so.0").ok()?;
        let init = *library
            .get::<unsafe extern "C" fn(u32) -> c_int>(b"SDL_InitSubSystem\0")
            .ok()?;
        let hint = *library
            .get::<unsafe extern "C" fn(*const c_char, *const c_char) -> c_int>(b"SDL_SetHint\0")
            .ok()?;
        let update = *library.get(b"SDL_GameControllerUpdate\0").ok()?;
        let count = *library.get(b"SDL_NumJoysticks\0").ok()?;
        let is_controller = *library.get(b"SDL_IsGameController\0").ok()?;
        let device_id = *library.get(b"SDL_JoystickGetDeviceInstanceID\0").ok()?;
        let open = *library.get(b"SDL_GameControllerOpen\0").ok()?;
        let close = *library.get(b"SDL_GameControllerClose\0").ok()?;
        let attached = *library.get(b"SDL_GameControllerGetAttached\0").ok()?;
        let button = *library.get(b"SDL_GameControllerGetButton\0").ok()?;
        let axis = *library.get(b"SDL_GameControllerGetAxis\0").ok()?;
        hint(
            c"SDL_JOYSTICK_ALLOW_BACKGROUND_EVENTS".as_ptr(),
            c"1".as_ptr(),
        );
        if init(0x00002000) != 0 {
            return None;
        }
        Some(Self {
            _library: library,
            update,
            count,
            is_controller,
            device_id,
            open,
            close,
            attached,
            button,
            axis,
            controllers: HashMap::new(),
            scan_at: Instant::now(),
        })
    }

    fn buttons(&mut self) -> u32 {
        unsafe {
            (self.update)();
            self.controllers.retain(|_, controller| {
                if (self.attached)(*controller) != 0 {
                    return true;
                }
                (self.close)(*controller);
                false
            });
            if Instant::now() >= self.scan_at {
                self.scan_at = Instant::now() + Duration::from_secs(1);
                for index in 0..(self.count)().clamp(0, 32) {
                    if (self.is_controller)(index) == 0 {
                        continue;
                    }
                    let id = (self.device_id)(index);
                    if id < 0 || self.controllers.contains_key(&id) {
                        continue;
                    }
                    let controller = (self.open)(index);
                    if !controller.is_null() {
                        self.controllers.insert(id, controller);
                    }
                }
            }
            self.controllers.values().fold(0, |mask, controller| {
                let buttons =
                    std::array::from_fn(|index| (self.button)(*controller, index as c_int) != 0);
                mask | controller_mask(
                    &buttons,
                    (self.axis)(*controller, 0),
                    (self.axis)(*controller, 1),
                )
            })
        }
    }
}

impl Drop for Sdl {
    fn drop(&mut self) {
        for controller in self.controllers.values() {
            unsafe {
                (self.close)(*controller);
            }
        }
        // Never SDL_Quit: Chromium or another native module may also use SDL.
    }
}

struct State {
    sdl: Option<Sdl>,
    retry_at: Instant,
}
thread_local! { static STATE: RefCell<State> = RefCell::new(State { sdl: None, retry_at: Instant::now() }); }

pub fn buttons() -> u32 {
    // Called on Electron's main thread. Thread-local ownership also makes it
    // impossible for a worker to move SDL handles across initialization threads.
    STATE.with(|state| {
        let mut state = state.borrow_mut();
        if state.sdl.is_none() && Instant::now() >= state.retry_at {
            state.sdl = unsafe { Sdl::load() };
            state.retry_at = Instant::now() + Duration::from_secs(30);
        }
        state.sdl.as_mut().map(Sdl::buttons).unwrap_or(0)
    })
}
