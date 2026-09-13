//! Fail-closed Windows.Gaming.Input (WGI) isolation.
//!
//! WGI exposes the same physical controller through several projections.  A
//! title is safe only after every projection present in the process has had its
//! polling vtable patched and every RawGameController has been tied to a typed
//! projection with a known released state.  Hotplug and activation races bump
//! an epoch; callers must re-check [`publish_token_is_current`] immediately
//! before committing the shared READY_PID word.

use std::collections::{HashMap, HashSet};
use std::ffi::c_void;
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use windows::core::Interface;
use windows::Foundation::EventHandler;
use windows::Gaming::Input::{
    ArcadeStick, ArcadeStickReading, FlightStick, FlightStickReading, GameControllerSwitchPosition,
    Gamepad, GamepadReading, IArcadeStick, IFlightStick, IGameController, IGamepad, IRacingWheel,
    IRawGameController, IUINavigationController, RacingWheel, RacingWheelReading,
    RawGameController, UINavigationController, UINavigationReading,
};
use windows::Win32::System::WinRT::{RoInitialize, RO_INIT_MULTITHREADED};
use windows_sys::core::HRESULT;
use windows_sys::Win32::System::Memory::{VirtualProtect, PAGE_READWRITE};

use super::{gate_latched, invalidate_hook_state, resolve};

pub const CAPABILITY_WINDOWS_GAMING_INPUT: u32 = 1 << 5;

const STATUS_WGI_INVALIDATED: u32 = 3_100;
const MAX_BUTTONS: usize = 256;
const MAX_SWITCHES: usize = 64;
const MAX_AXES: usize = 64;
const CALIBRATION_SAMPLES: u8 = 4;
const CALIBRATION_SPAN: Duration = Duration::from_millis(120);
const AXIS_STABILITY: f64 = 0.02;
const TYPED_RELEASE_TOLERANCE: f64 = 0.08;
const MAX_CONTROLLERS_PER_CLASS: u32 = 64;
const MAX_PUBLISHED_SNAPSHOTS: usize = 64;

type RawReadingFn = unsafe extern "system" fn(
    *mut c_void,
    u32,
    *mut bool,
    u32,
    *mut GameControllerSwitchPosition,
    u32,
    *mut f64,
    *mut u64,
) -> HRESULT;
type GamepadReadingFn = unsafe extern "system" fn(*mut c_void, *mut GamepadReading) -> HRESULT;
type ArcadeReadingFn = unsafe extern "system" fn(*mut c_void, *mut ArcadeStickReading) -> HRESULT;
type FlightReadingFn = unsafe extern "system" fn(*mut c_void, *mut FlightStickReading) -> HRESULT;
type RacingReadingFn = unsafe extern "system" fn(*mut c_void, *mut RacingWheelReading) -> HRESULT;
type UiReadingFn = unsafe extern "system" fn(*mut c_void, *mut UINavigationReading) -> HRESULT;

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
enum TypedKind {
    Gamepad,
    Arcade,
    Flight,
    Racing,
    Ui,
}

#[derive(Clone)]
struct NeutralReading {
    buttons: usize,
    switches: Vec<GameControllerSwitchPosition>,
    axes: Vec<f64>,
}

#[derive(Default)]
struct WgiState {
    raw: HashMap<usize, NeutralReading>,
    gamepads: HashSet<usize>,
    arcade: HashSet<usize>,
    flight: HashSet<usize>,
    racing: HashSet<usize>,
    ui: HashSet<usize>,
    last_signature: Option<TopologySignature>,
    stable_enumerations: u8,
    progress: HashMap<usize, CalibrationProgress>,
}

struct CalibrationProgress {
    first: Instant,
    samples: u8,
    neutral: NeutralReading,
    axis_min: Vec<f64>,
    axis_max: Vec<f64>,
    axis_sum: Vec<f64>,
}

#[derive(Clone, Default, Eq, PartialEq)]
struct TopologySignature {
    raw: HashSet<usize>,
    gamepads: HashSet<usize>,
    arcade: HashSet<usize>,
    flight: HashSet<usize>,
    racing: HashSet<usize>,
    ui: HashSet<usize>,
}

#[derive(Default)]
struct SweepSnapshot {
    signature: TopologySignature,
    raw_samples: HashMap<usize, NeutralReading>,
    raw_interfaces: HashMap<usize, usize>,
    covered: usize,
    failed: usize,
    hooks: HookSnapshot,
}

#[derive(Default)]
struct HookSnapshot {
    raw: HashMap<usize, NeutralReading>,
    gamepads: HashSet<usize>,
    arcade: HashSet<usize>,
    flight: HashSet<usize>,
    racing: HashSet<usize>,
    ui: HashSet<usize>,
}

pub struct WgiSweep {
    pub capability_ready: bool,
    pub fast_sweep: bool,
    pub unsupported: bool,
    pub covered: usize,
    pub failed: usize,
    /// Epoch to re-check in the final READY_PID publication transaction.
    pub publish_token: u64,
}

static STATE: OnceLock<Mutex<WgiState>> = OnceLock::new();
static TOPOLOGY_EPOCH: AtomicU64 = AtomicU64::new(1);
static DIRTY: AtomicBool = AtomicBool::new(true);
static PERMANENT_FAILURE: AtomicBool = AtomicBool::new(false);
static WINRT_INITIALIZED: AtomicBool = AtomicBool::new(false);

static REAL_RAW: AtomicUsize = AtomicUsize::new(0);
static REAL_GAMEPAD: AtomicUsize = AtomicUsize::new(0);
static REAL_ARCADE: AtomicUsize = AtomicUsize::new(0);
static REAL_FLIGHT: AtomicUsize = AtomicUsize::new(0);
static REAL_RACING: AtomicUsize = AtomicUsize::new(0);
static REAL_UI: AtomicUsize = AtomicUsize::new(0);
static REAL_RO_GET_ACTIVATION_FACTORY: AtomicUsize = AtomicUsize::new(0);
static REAL_WINDOWS_GET_STRING_RAW_BUFFER: AtomicUsize = AtomicUsize::new(0);
static HOOK_SNAPSHOT: AtomicUsize = AtomicUsize::new(0);
static HOOK_SNAPSHOT_SIGNATURE: AtomicU64 = AtomicU64::new(0);
static PUBLISHED_SNAPSHOT_COUNT: AtomicUsize = AtomicUsize::new(0);
static LAST_READY_TOKEN: AtomicU64 = AtomicU64::new(0);
static EVENTS_INSTALLED: AtomicBool = AtomicBool::new(false);
static EVENTS_INSTALL_ATTEMPTED: AtomicBool = AtomicBool::new(false);

#[cfg(test)]
static TEST_BLOCKING: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);
#[cfg(test)]
static TEST_FAIL_PATCH_RESTORE: AtomicBool = AtomicBool::new(false);
#[cfg(test)]
static TEST_EVENT_FAILURE_INDEX: AtomicUsize = AtomicUsize::new(usize::MAX);
#[cfg(test)]
static TEST_EVENT_REGISTRATION_COUNT: AtomicUsize = AtomicUsize::new(0);

fn state() -> &'static Mutex<WgiState> {
    STATE.get_or_init(|| Mutex::new(WgiState::default()))
}

fn blocking() -> bool {
    #[cfg(test)]
    match TEST_BLOCKING.load(Ordering::Acquire) {
        1 => return true,
        2 => return false,
        _ => {}
    }
    gate_latched()
}

fn invalidate() {
    LAST_READY_TOKEN.store(0, Ordering::Release);
    DIRTY.store(true, Ordering::Release);
    TOPOLOGY_EPOCH.fetch_add(1, Ordering::AcqRel);
    invalidate_hook_state(STATUS_WGI_INVALIDATED);
}

/// Must be called immediately before READY_PID is committed.  This closes the
/// event/activation race between `sweep` returning and the launcher's publish.
pub fn publish_token_is_current(token: u64) -> bool {
    token != 0
        && !DIRTY.load(Ordering::Acquire)
        && !PERMANENT_FAILURE.load(Ordering::Acquire)
        && TOPOLOGY_EPOCH.load(Ordering::Acquire) == token
}

fn hook_snapshot() -> Option<&'static HookSnapshot> {
    if DIRTY.load(Ordering::Acquire) {
        return None;
    }
    let pointer = HOOK_SNAPSHOT.load(Ordering::Acquire) as *const HookSnapshot;
    // A published allocation is immutable and intentionally never reclaimed
    // while foreign game threads can execute this DLL. The OS reclaims all of
    // them at process exit. This makes an Acquire pointer load sufficient and
    // removes both reader/publisher UAF races and quiescence waiting.
    unsafe { pointer.as_ref() }
}

fn publish_hook_snapshot(snapshot: HookSnapshot, fingerprint: u64) -> bool {
    if HOOK_SNAPSHOT_SIGNATURE.load(Ordering::Acquire) == fingerprint {
        return true;
    }
    let reserved =
        PUBLISHED_SNAPSHOT_COUNT.fetch_update(Ordering::AcqRel, Ordering::Acquire, |count| {
            (count < MAX_PUBLISHED_SNAPSHOTS).then_some(count + 1)
        });
    if reserved.is_err() {
        // Topology churn must not turn process-lifetime retention into
        // unbounded growth. Losing the capability is safer than reclamation
        // in an injected DLL whose callers cannot participate in an epoch.
        PERMANENT_FAILURE.store(true, Ordering::Release);
        invalidate();
        return false;
    }
    let new_pointer = Box::into_raw(Box::new(snapshot)) as usize;
    HOOK_SNAPSHOT.store(new_pointer, Ordering::Release);
    HOOK_SNAPSHOT_SIGNATURE.store(fingerprint, Ordering::Release);
    true
}

fn mix_fingerprint(mut hash: u64, value: u64) -> u64 {
    hash ^= value
        .wrapping_add(0x9e37_79b9_7f4a_7c15)
        .wrapping_add(hash << 6)
        .wrapping_add(hash >> 2);
    hash
}

fn set_fingerprint(mut hash: u64, values: &HashSet<usize>) -> u64 {
    let mut values: Vec<_> = values.iter().copied().collect();
    values.sort_unstable();
    hash = mix_fingerprint(hash, values.len() as u64);
    for value in values {
        hash = mix_fingerprint(hash, value as u64);
    }
    hash
}

fn hook_fingerprint(snapshot: &HookSnapshot) -> u64 {
    let mut hash = 0xcbf2_9ce4_8422_2325;
    hash = set_fingerprint(hash, &snapshot.gamepads);
    hash = set_fingerprint(hash, &snapshot.arcade);
    hash = set_fingerprint(hash, &snapshot.flight);
    hash = set_fingerprint(hash, &snapshot.racing);
    hash = set_fingerprint(hash, &snapshot.ui);
    let mut raw: Vec<_> = snapshot.raw.iter().collect();
    raw.sort_unstable_by_key(|(identity, _)| **identity);
    hash = mix_fingerprint(hash, raw.len() as u64);
    for (identity, neutral) in raw {
        hash = mix_fingerprint(hash, *identity as u64);
        hash = mix_fingerprint(hash, neutral.buttons as u64);
        for switch in &neutral.switches {
            hash = mix_fingerprint(hash, switch.0 as u64);
        }
        for axis in &neutral.axes {
            hash = mix_fingerprint(hash, axis.to_bits());
        }
    }
    // Reserve zero for "no snapshot".
    if hash == 0 {
        1
    } else {
        hash
    }
}

fn known_snapshot(interface: usize, kind: TypedKind) -> bool {
    hook_snapshot().is_some_and(|snapshot| match kind {
        TypedKind::Gamepad => snapshot.gamepads.contains(&interface),
        TypedKind::Arcade => snapshot.arcade.contains(&interface),
        TypedKind::Flight => snapshot.flight.contains(&interface),
        TypedKind::Racing => snapshot.racing.contains(&interface),
        TypedKind::Ui => snapshot.ui.contains(&interface),
    })
}

unsafe fn identity(interface: *mut c_void) -> Option<usize> {
    if interface.is_null() {
        return None;
    }
    let vtable = unsafe { *(interface as *mut *mut *mut c_void) };
    if vtable.is_null() {
        return None;
    }
    type Query = unsafe extern "system" fn(
        *mut c_void,
        *const windows_sys::core::GUID,
        *mut *mut c_void,
    ) -> HRESULT;
    let iid = windows_sys::core::GUID {
        data1: 0,
        data2: 0,
        data3: 0,
        data4: [0xc0, 0, 0, 0, 0, 0, 0, 0x46],
    };
    let query: Query = unsafe { std::mem::transmute(*vtable) };
    let mut unknown = std::ptr::null_mut();
    if unsafe { query(interface, &iid, &mut unknown) } < 0 || unknown.is_null() {
        return None;
    }
    let result = unknown as usize;
    // The returned controlling-IUnknown pointer is only safe to dereference if
    // it is a valid COM interface. A null vtable violates QueryInterface's
    // contract; there is no callable Release slot in that malformed object.
    // Fail closed and permanently refuse WGI rather than corrupting the
    // incoming interface's independent reference count.
    let unknown_vtable = unsafe { *(unknown as *mut *mut *mut c_void) };
    if unknown_vtable.is_null() {
        PERMANENT_FAILURE.store(true, Ordering::Release);
        invalidate();
        return None;
    }
    type Release = unsafe extern "system" fn(*mut c_void) -> u32;
    unsafe { std::mem::transmute::<*mut c_void, Release>(*unknown_vtable.add(2))(unknown) };
    Some(result)
}

fn fail_closed() -> HRESULT {
    invalidate();
    windows_sys::Win32::Foundation::E_FAIL
}

unsafe fn clear_raw(
    button_count: u32,
    buttons: *mut bool,
    switch_count: u32,
    switches: *mut GameControllerSwitchPosition,
    axis_count: u32,
    axes: *mut f64,
) {
    if button_count as usize <= MAX_BUTTONS && !buttons.is_null() {
        for index in 0..button_count as usize {
            unsafe { buttons.add(index).write(false) };
        }
    }
    if switch_count as usize <= MAX_SWITCHES && !switches.is_null() {
        for index in 0..switch_count as usize {
            unsafe {
                switches
                    .add(index)
                    .write(GameControllerSwitchPosition::Center)
            };
        }
    }
    if axis_count as usize <= MAX_AXES && !axes.is_null() {
        for index in 0..axis_count as usize {
            unsafe { axes.add(index).write(0.0) };
        }
    }
}

unsafe extern "system" fn hook_raw(
    this: *mut c_void,
    button_count: u32,
    buttons: *mut bool,
    switch_count: u32,
    switches: *mut GameControllerSwitchPosition,
    axis_count: u32,
    axes: *mut f64,
    timestamp: *mut u64,
) -> HRESULT {
    let real = REAL_RAW.load(Ordering::Acquire);
    if real == 0 {
        return fail_closed();
    }
    let result = unsafe {
        std::mem::transmute::<usize, RawReadingFn>(real)(
            this,
            button_count,
            buttons,
            switch_count,
            switches,
            axis_count,
            axes,
            timestamp,
        )
    };
    if result < 0 || !blocking() {
        return result;
    }
    let valid_pointers = (button_count == 0 || !buttons.is_null())
        && (switch_count == 0 || !switches.is_null())
        && (axis_count == 0 || !axes.is_null());
    let snapshot = hook_snapshot();
    let Some(neutral) = snapshot
        .as_ref()
        .and_then(|snapshot| snapshot.raw.get(&(this as usize)))
    else {
        unsafe {
            clear_raw(
                button_count,
                buttons,
                switch_count,
                switches,
                axis_count,
                axes,
            )
        };
        return fail_closed();
    };
    if !valid_pointers
        || neutral.buttons != button_count as usize
        || neutral.switches.len() != switch_count as usize
        || neutral.axes.len() != axis_count as usize
    {
        unsafe {
            clear_raw(
                button_count,
                buttons,
                switch_count,
                switches,
                axis_count,
                axes,
            )
        };
        return fail_closed();
    }
    unsafe {
        for index in 0..button_count as usize {
            buttons.add(index).write(false);
        }
        for (index, value) in neutral.switches.iter().enumerate() {
            switches.add(index).write(*value);
        }
        for (index, value) in neutral.axes.iter().enumerate() {
            axes.add(index).write(*value);
        }
    }
    result
}

macro_rules! typed_hook {
    ($name:ident, $real:ident, $reading:ty, $kind:expr, $neutralize:path) => {
        unsafe extern "system" fn $name(this: *mut c_void, reading: *mut $reading) -> HRESULT {
            let real = $real.load(Ordering::Acquire);
            if real == 0 {
                return fail_closed();
            }
            let result = unsafe {
                std::mem::transmute::<
                    usize,
                    unsafe extern "system" fn(*mut c_void, *mut $reading) -> HRESULT,
                >(real)(this, reading)
            };
            if result < 0 || !blocking() {
                return result;
            }
            if reading.is_null() {
                return fail_closed();
            }
            if !known_snapshot(this as usize, $kind) {
                // The real call has already filled the caller's buffer. Erase
                // it even though E_FAIL requires a conforming caller to ignore
                // the result, preventing accidental one-frame reuse/leakage.
                unsafe { $neutralize(reading) };
                return fail_closed();
            }
            unsafe { $neutralize(reading) };
            result
        }
    };
}

unsafe fn neutralize_gamepad(reading: *mut GamepadReading) {
    unsafe {
        (*reading).Buttons = Default::default();
        (*reading).LeftTrigger = 0.0;
        (*reading).RightTrigger = 0.0;
        (*reading).LeftThumbstickX = 0.0;
        (*reading).LeftThumbstickY = 0.0;
        (*reading).RightThumbstickX = 0.0;
        (*reading).RightThumbstickY = 0.0;
    }
}
unsafe fn neutralize_arcade(reading: *mut ArcadeStickReading) {
    unsafe {
        (*reading).Buttons = Default::default();
    }
}
unsafe fn neutralize_flight(reading: *mut FlightStickReading) {
    unsafe {
        (*reading).Buttons = Default::default();
        (*reading).HatSwitch = GameControllerSwitchPosition::Center;
        (*reading).Roll = 0.0;
        (*reading).Pitch = 0.0;
        (*reading).Yaw = 0.0;
        (*reading).Throttle = 0.0;
    }
}
unsafe fn neutralize_racing(reading: *mut RacingWheelReading) {
    unsafe {
        (*reading).Buttons = Default::default();
        (*reading).PatternShifterGear = 0;
        (*reading).Wheel = 0.0;
        (*reading).Throttle = 0.0;
        (*reading).Brake = 0.0;
        (*reading).Clutch = 0.0;
        (*reading).Handbrake = 0.0;
    }
}
unsafe fn neutralize_ui(reading: *mut UINavigationReading) {
    unsafe {
        (*reading).RequiredButtons = Default::default();
        (*reading).OptionalButtons = Default::default();
    }
}

typed_hook!(
    hook_gamepad,
    REAL_GAMEPAD,
    GamepadReading,
    TypedKind::Gamepad,
    neutralize_gamepad
);

unsafe fn typed_pointer_and_identity<T: Interface>(value: T) -> Option<(usize, usize)> {
    let pointer = value.as_raw() as usize;
    let id = unsafe { identity(value.as_raw()) }?;
    // Explicit drop at the call site balances the projected COM reference
    // before the next controller/sample is processed.
    drop(value);
    Some((pointer, id))
}
typed_hook!(
    hook_arcade,
    REAL_ARCADE,
    ArcadeStickReading,
    TypedKind::Arcade,
    neutralize_arcade
);
typed_hook!(
    hook_flight,
    REAL_FLIGHT,
    FlightStickReading,
    TypedKind::Flight,
    neutralize_flight
);
typed_hook!(
    hook_racing,
    REAL_RACING,
    RacingWheelReading,
    TypedKind::Racing,
    neutralize_racing
);
typed_hook!(
    hook_ui,
    REAL_UI,
    UINavigationReading,
    TypedKind::Ui,
    neutralize_ui
);

unsafe fn patch_slot(
    interface: *mut c_void,
    index: usize,
    real: &AtomicUsize,
    hook: usize,
) -> Result<(), ()> {
    if PERMANENT_FAILURE.load(Ordering::Acquire) || interface.is_null() {
        return Err(());
    }
    let vtable = unsafe { *(interface as *mut *mut usize) };
    if vtable.is_null() {
        return Err(());
    }
    let slot = unsafe { vtable.add(index) };
    let current = unsafe { slot.read() };
    if current == hook {
        return (real.load(Ordering::Acquire) != 0).then_some(()).ok_or(());
    }
    let previous_real = real.load(Ordering::Acquire);
    if previous_real != 0 && previous_real != current {
        PERMANENT_FAILURE.store(true, Ordering::Release);
        invalidate();
        return Err(());
    }
    let mut old_protection = 0;
    if unsafe {
        VirtualProtect(
            slot.cast(),
            std::mem::size_of::<usize>(),
            PAGE_READWRITE,
            &mut old_protection,
        )
    } == 0
    {
        return Err(());
    }
    real.store(current, Ordering::Release);
    unsafe { slot.write(hook) };

    #[cfg(test)]
    let restored = !TEST_FAIL_PATCH_RESTORE.swap(false, Ordering::AcqRel);
    #[cfg(not(test))]
    let restored = true;
    let mut ignored = 0;
    let restored = restored
        && unsafe {
            VirtualProtect(
                slot.cast(),
                std::mem::size_of::<usize>(),
                old_protection,
                &mut ignored,
            )
        } != 0;
    if restored {
        return Ok(());
    }

    // Transaction failure is never reinterpreted as success on the next sweep.
    // Best-effort rollback is followed by a permanent fail-closed latch.
    let mut writable = 0;
    if unsafe {
        VirtualProtect(
            slot.cast(),
            std::mem::size_of::<usize>(),
            PAGE_READWRITE,
            &mut writable,
        )
    } != 0
    {
        unsafe { slot.write(current) };
        let mut ignored = 0;
        unsafe {
            VirtualProtect(
                slot.cast(),
                std::mem::size_of::<usize>(),
                writable,
                &mut ignored,
            )
        };
    }
    real.store(previous_real, Ordering::Release);
    PERMANENT_FAILURE.store(true, Ordering::Release);
    invalidate();
    Err(())
}

fn raw_dimensions(raw: &RawGameController) -> Option<(usize, usize, usize)> {
    let buttons = raw.ButtonCount().ok()?;
    let switches = raw.SwitchCount().ok()?;
    let axes = raw.AxisCount().ok()?;
    if buttons < 0
        || switches < 0
        || axes < 0
        || buttons as usize > MAX_BUTTONS
        || switches as usize > MAX_SWITCHES
        || axes as usize > MAX_AXES
    {
        return None;
    }
    Some((buttons as usize, switches as usize, axes as usize))
}

fn released_raw_reading(raw: &RawGameController) -> Option<NeutralReading> {
    let (button_count, switch_count, axis_count) = raw_dimensions(raw)?;
    let mut buttons = vec![false; button_count];
    let mut switches = vec![GameControllerSwitchPosition::Center; switch_count];
    let mut axes = vec![0.0; axis_count];
    raw.GetCurrentReading(&mut buttons, &mut switches, &mut axes)
        .ok()?;
    if buttons.iter().any(|value| *value)
        || switches
            .iter()
            .any(|value| *value != GameControllerSwitchPosition::Center)
        || !raw_gamepad_axes_released(&axes)
    {
        return None;
    }
    Some(NeutralReading {
        buttons: button_count,
        switches,
        axes,
    })
}

fn raw_gamepad_axes_released(axes: &[f64]) -> bool {
    // A WGI Gamepad has exactly four bipolar stick axes (Raw rest ~= .5) and
    // two unipolar triggers (Raw rest ~= 0). Anything else is an axis that the
    // typed Gamepad reading cannot account for, so it is not calibratable.
    if axes.len() != 6 || axes.iter().any(|axis| !axis.is_finite()) {
        return false;
    }
    let centered = axes
        .iter()
        .filter(|axis| (**axis - 0.5).abs() <= TYPED_RELEASE_TOLERANCE)
        .count();
    let released = axes
        .iter()
        .filter(|axis| axis.abs() <= TYPED_RELEASE_TOLERANCE)
        .count();
    centered == 4 && released == 2
}

fn accumulate_calibration(
    progress: &mut Option<CalibrationProgress>,
    sample: &NeutralReading,
    now: Instant,
) -> Option<NeutralReading> {
    let current = progress.get_or_insert_with(|| CalibrationProgress {
        first: now,
        samples: 0,
        neutral: sample.clone(),
        axis_min: sample.axes.clone(),
        axis_max: sample.axes.clone(),
        axis_sum: vec![0.0; sample.axes.len()],
    });
    let dimensions_match = current.neutral.buttons == sample.buttons
        && current.neutral.switches.len() == sample.switches.len()
        && current.neutral.axes.len() == sample.axes.len();
    let stable = dimensions_match
        && sample
            .switches
            .iter()
            .all(|value| *value == GameControllerSwitchPosition::Center)
        && current
            .axis_min
            .iter()
            .zip(current.axis_max.iter())
            .zip(sample.axes.iter())
            .all(|((minimum, maximum), value)| {
                maximum.max(*value) - minimum.min(*value) <= AXIS_STABILITY
            });
    if !stable {
        *progress = None;
        return None;
    }
    current.samples = current.samples.saturating_add(1);
    for (index, value) in sample.axes.iter().enumerate() {
        current.axis_min[index] = current.axis_min[index].min(*value);
        current.axis_max[index] = current.axis_max[index].max(*value);
        current.axis_sum[index] += *value;
    }
    if current.samples < CALIBRATION_SAMPLES || now.duration_since(current.first) < CALIBRATION_SPAN
    {
        return None;
    }
    let samples = current.samples as f64;
    Some(NeutralReading {
        buttons: sample.buttons,
        switches: vec![GameControllerSwitchPosition::Center; sample.switches.len()],
        axes: current.axis_sum.iter().map(|sum| *sum / samples).collect(),
    })
}

fn install_hotplug_handlers() -> bool {
    if EVENTS_INSTALLED.load(Ordering::Acquire) {
        return true;
    }
    if EVENTS_INSTALL_ATTEMPTED.swap(true, Ordering::AcqRel) {
        return false;
    }
    let fail_install = || {
        PERMANENT_FAILURE.store(true, Ordering::Release);
        invalidate();
        false
    };
    macro_rules! register_pair {
        ($class:ty, $added:path, $removed:path) => {{
            let added = EventHandler::<$class>::new(|_, _| {
                invalidate();
                Ok(())
            });
            #[cfg(test)]
            let injected_failure = {
                let index = TEST_EVENT_REGISTRATION_COUNT.fetch_add(1, Ordering::AcqRel);
                TEST_EVENT_FAILURE_INDEX.load(Ordering::Acquire) == index
            };
            #[cfg(not(test))]
            let injected_failure = false;
            if injected_failure || $added(&added).is_err() {
                return fail_install();
            }
            std::mem::forget(added);
            let removed = EventHandler::<$class>::new(|_, _| {
                invalidate();
                Ok(())
            });
            #[cfg(test)]
            let injected_failure = {
                let index = TEST_EVENT_REGISTRATION_COUNT.fetch_add(1, Ordering::AcqRel);
                TEST_EVENT_FAILURE_INDEX.load(Ordering::Acquire) == index
            };
            #[cfg(not(test))]
            let injected_failure = false;
            if injected_failure || $removed(&removed).is_err() {
                return fail_install();
            }
            std::mem::forget(removed);
        }};
    }
    register_pair!(Gamepad, Gamepad::GamepadAdded, Gamepad::GamepadRemoved);
    register_pair!(
        RawGameController,
        RawGameController::RawGameControllerAdded,
        RawGameController::RawGameControllerRemoved
    );
    register_pair!(
        ArcadeStick,
        ArcadeStick::ArcadeStickAdded,
        ArcadeStick::ArcadeStickRemoved
    );
    register_pair!(
        FlightStick,
        FlightStick::FlightStickAdded,
        FlightStick::FlightStickRemoved
    );
    register_pair!(
        RacingWheel,
        RacingWheel::RacingWheelAdded,
        RacingWheel::RacingWheelRemoved
    );
    register_pair!(
        UINavigationController,
        UINavigationController::UINavigationControllerAdded,
        UINavigationController::UINavigationControllerRemoved
    );
    EVENTS_INSTALLED.store(true, Ordering::Release);
    true
}

fn add_typed<T: Interface>(
    value: &T,
    set: &mut HashSet<usize>,
    hook_set: &mut HashSet<usize>,
    real: &AtomicUsize,
    index: usize,
    hook: usize,
) -> bool {
    let Some(id) = (unsafe { identity(value.as_raw()) }) else {
        return false;
    };
    if !set.insert(id) {
        return false;
    }
    if unsafe { patch_slot(value.as_raw(), index, real, hook) }.is_err() {
        return false;
    }
    hook_set.insert(value.as_raw() as usize)
}

fn released_gamepad_for_raw(raw: &RawGameController) -> Option<Gamepad> {
    let Ok(controller) = raw.cast::<IGameController>() else {
        return None;
    };
    let gamepad = Gamepad::FromGameController(&controller).ok()?;
    if unsafe { identity(gamepad.as_raw()) } != unsafe { identity(raw.as_raw()) } {
        return None;
    }
    let reading = gamepad.GetCurrentReading().ok()?;
    let released = reading.Buttons == Default::default()
        && reading.LeftTrigger.abs() <= TYPED_RELEASE_TOLERANCE
        && reading.RightTrigger.abs() <= TYPED_RELEASE_TOLERANCE
        && reading.LeftThumbstickX.abs() <= TYPED_RELEASE_TOLERANCE
        && reading.LeftThumbstickY.abs() <= TYPED_RELEASE_TOLERANCE
        && reading.RightThumbstickX.abs() <= TYPED_RELEASE_TOLERANCE
        && reading.RightThumbstickY.abs() <= TYPED_RELEASE_TOLERANCE;
    released.then_some(gamepad)
}

fn enumerate() -> Option<SweepSnapshot> {
    // There is deliberately no STATE lock in this function: every factory,
    // vector, COM, real-vtable, and patch call happens against local state.
    let mut snapshot = SweepSnapshot::default();

    let raw_values = RawGameController::RawGameControllers().ok()?;
    let gamepad_values = Gamepad::Gamepads().ok()?;
    let arcade_values = ArcadeStick::ArcadeSticks().ok()?;
    let flight_values = FlightStick::FlightSticks().ok()?;
    let racing_values = RacingWheel::RacingWheels().ok()?;
    let ui_values = UINavigationController::UINavigationControllers().ok()?;
    for size in [
        raw_values.Size().ok()?,
        gamepad_values.Size().ok()?,
        arcade_values.Size().ok()?,
        flight_values.Size().ok()?,
        racing_values.Size().ok()?,
        ui_values.Size().ok()?,
    ] {
        if size > MAX_CONTROLLERS_PER_CLASS {
            return None;
        }
    }

    for value in gamepad_values {
        let Ok(interface) = value.cast::<IGamepad>() else {
            snapshot.failed += 1;
            continue;
        };
        if add_typed(
            &interface,
            &mut snapshot.signature.gamepads,
            &mut snapshot.hooks.gamepads,
            &REAL_GAMEPAD,
            8,
            hook_gamepad as GamepadReadingFn as usize,
        ) {
            snapshot.covered += 1;
        } else {
            snapshot.failed += 1;
        }
    }
    for value in arcade_values {
        let Ok(interface) = value.cast::<IArcadeStick>() else {
            snapshot.failed += 1;
            continue;
        };
        if add_typed(
            &interface,
            &mut snapshot.signature.arcade,
            &mut snapshot.hooks.arcade,
            &REAL_ARCADE,
            7,
            hook_arcade as ArcadeReadingFn as usize,
        ) {
            snapshot.covered += 1;
        } else {
            snapshot.failed += 1;
        }
    }
    for value in flight_values {
        let Ok(interface) = value.cast::<IFlightStick>() else {
            snapshot.failed += 1;
            continue;
        };
        if add_typed(
            &interface,
            &mut snapshot.signature.flight,
            &mut snapshot.hooks.flight,
            &REAL_FLIGHT,
            8,
            hook_flight as FlightReadingFn as usize,
        ) {
            snapshot.covered += 1;
        } else {
            snapshot.failed += 1;
        }
    }
    for value in racing_values {
        let Ok(interface) = value.cast::<IRacingWheel>() else {
            snapshot.failed += 1;
            continue;
        };
        if add_typed(
            &interface,
            &mut snapshot.signature.racing,
            &mut snapshot.hooks.racing,
            &REAL_RACING,
            13,
            hook_racing as RacingReadingFn as usize,
        ) {
            snapshot.covered += 1;
        } else {
            snapshot.failed += 1;
        }
    }
    for value in ui_values {
        let Ok(interface) = value.cast::<IUINavigationController>() else {
            snapshot.failed += 1;
            continue;
        };
        if add_typed(
            &interface,
            &mut snapshot.signature.ui,
            &mut snapshot.hooks.ui,
            &REAL_UI,
            6,
            hook_ui as UiReadingFn as usize,
        ) {
            snapshot.covered += 1;
        } else {
            snapshot.failed += 1;
        }
    }

    for raw in raw_values {
        let Ok(interface) = raw.cast::<IRawGameController>() else {
            snapshot.failed += 1;
            continue;
        };
        let Some(id) = (unsafe { identity(interface.as_raw()) }) else {
            snapshot.failed += 1;
            continue;
        };
        // The typed reading and Raw reading are sampled in the same sweep from
        // projections sharing the exact controlling IUnknown. Every projected
        // Gamepad is dropped before the next sample, balancing all COM refs.
        let Some(gamepad) = released_gamepad_for_raw(&raw) else {
            snapshot.failed += 1;
            continue;
        };
        let gamepad_represented = unsafe { identity(gamepad.as_raw()) }
            .is_some_and(|gamepad_id| snapshot.signature.gamepads.contains(&gamepad_id));
        let Some(neutral) = gamepad_represented
            .then(|| released_raw_reading(&raw))
            .flatten()
        else {
            snapshot.failed += 1;
            continue;
        };
        drop(gamepad);
        if unsafe {
            patch_slot(
                interface.as_raw(),
                13,
                &REAL_RAW,
                hook_raw as RawReadingFn as usize,
            )
        }
        .is_err()
        {
            snapshot.failed += 1;
            continue;
        }
        snapshot.signature.raw.insert(id);
        snapshot.raw_samples.insert(id, neutral);
        snapshot
            .raw_interfaces
            .insert(id, interface.as_raw() as usize);
        snapshot.covered += 1;
    }
    Some(snapshot)
}

fn ensure_winrt() -> bool {
    if WINRT_INITIALIZED.load(Ordering::Acquire) {
        return true;
    }
    // RPC_E_CHANGED_MODE still means WinRT is available on this thread.
    if let Err(error) = unsafe { RoInitialize(RO_INIT_MULTITHREADED) } {
        const RPC_E_CHANGED_MODE: i32 = -2_147_417_850;
        if error.code().0 != RPC_E_CHANGED_MODE {
            return false;
        }
    }
    WINRT_INITIALIZED.store(true, Ordering::Release);
    true
}

/// Captures the activation entry point.  A successful WGI capability requires
/// this import to be patched by the normal inputhook replacement table; runtime
/// GetProcAddress is covered by `late_bound_replacement` below.
pub fn capture_originals() {
    if REAL_RO_GET_ACTIVATION_FACTORY.load(Ordering::Acquire) == 0 {
        let address = resolve(
            "api-ms-win-core-winrt-l1-1-0.dll",
            b"RoGetActivationFactory\0",
        );
        if address != 0 {
            REAL_RO_GET_ACTIVATION_FACTORY.store(address, Ordering::Release);
        }
    }
    if REAL_WINDOWS_GET_STRING_RAW_BUFFER.load(Ordering::Acquire) == 0 {
        let address = resolve(
            "api-ms-win-core-winrt-string-l1-1-0.dll",
            b"WindowsGetStringRawBuffer\0",
        );
        if address != 0 {
            REAL_WINDOWS_GET_STRING_RAW_BUFFER.store(address, Ordering::Release);
        }
    }
}

fn is_wgi_name(value: &[u16]) -> bool {
    const PREFIX: &[u16] = &[
        87, 105, 110, 100, 111, 119, 115, 46, 71, 97, 109, 105, 110, 103, 46, 73, 110, 112, 117,
        116, 46,
    ]; // "Windows.Gaming.Input."
    value.starts_with(PREFIX)
}

unsafe fn activation_is_wgi(class_id: *mut c_void) -> Option<bool> {
    if class_id.is_null() {
        return None;
    }
    let raw_buffer = REAL_WINDOWS_GET_STRING_RAW_BUFFER.load(Ordering::Acquire);
    if raw_buffer == 0 {
        return None;
    }
    type RawBuffer = unsafe extern "system" fn(*mut c_void, *mut u32) -> *const u16;
    let mut length = 0u32;
    let buffer =
        unsafe { std::mem::transmute::<usize, RawBuffer>(raw_buffer)(class_id, &mut length) };
    if buffer.is_null() || length == 0 || length > 512 {
        return None;
    }
    Some(is_wgi_name(unsafe {
        std::slice::from_raw_parts(buffer, length as usize)
    }))
}

/// Fail-safe activation interception: any WGI activation while input is owned
/// invalidates readiness before the real factory is returned.  The launcher
/// keeps BLOCKED latched until it observes the invalidation and hides overlay.
unsafe extern "system" fn hook_ro_get_activation_factory(
    class_id: *mut c_void,
    iid: *const windows_sys::core::GUID,
    factory: *mut *mut c_void,
) -> HRESULT {
    if blocking() && unsafe { activation_is_wgi(class_id) }.unwrap_or(true) {
        invalidate();
        if !factory.is_null() {
            unsafe { factory.write(std::ptr::null_mut()) };
        }
        return windows_sys::Win32::Foundation::E_FAIL;
    }
    let real = REAL_RO_GET_ACTIVATION_FACTORY.load(Ordering::Acquire);
    if real == 0 {
        if !factory.is_null() {
            unsafe { factory.write(std::ptr::null_mut()) };
        }
        return fail_closed();
    }
    type RoGet = unsafe extern "system" fn(
        *mut c_void,
        *const windows_sys::core::GUID,
        *mut *mut c_void,
    ) -> HRESULT;
    unsafe { std::mem::transmute::<usize, RoGet>(real)(class_id, iid, factory) }
}

pub fn replacement() -> Option<(usize, usize)> {
    let original = REAL_RO_GET_ACTIVATION_FACTORY.load(Ordering::Acquire);
    (original != 0).then_some((
        original,
        hook_ro_get_activation_factory as *const () as usize,
    ))
}

pub fn late_bound_replacement(resolved: usize) -> Option<usize> {
    (resolved != 0 && resolved == REAL_RO_GET_ACTIVATION_FACTORY.load(Ordering::Acquire))
        .then_some(hook_ro_get_activation_factory as *const () as usize)
}

pub fn sweep(module_loaded: bool) -> WgiSweep {
    if !module_loaded {
        return WgiSweep {
            capability_ready: false,
            fast_sweep: false,
            unsupported: false,
            covered: 0,
            failed: 0,
            publish_token: 0,
        };
    }
    if blocking() {
        let token = LAST_READY_TOKEN.load(Ordering::Acquire);
        let ready = publish_token_is_current(token)
            && HOOK_SNAPSHOT.load(Ordering::Acquire) != 0
            && HOOK_SNAPSHOT_SIGNATURE.load(Ordering::Acquire) != 0;
        return WgiSweep {
            capability_ready: ready,
            // A validated blocked snapshot does not need the 100 ms calibration
            // cadence. Events/activation invalidate synchronously.
            fast_sweep: !ready,
            unsupported: !ready,
            covered: usize::from(ready),
            failed: usize::from(!ready),
            publish_token: ready.then_some(token).unwrap_or(0),
        };
    }
    if PERMANENT_FAILURE.load(Ordering::Acquire)
        || REAL_RO_GET_ACTIVATION_FACTORY.load(Ordering::Acquire) == 0
        || REAL_WINDOWS_GET_STRING_RAW_BUFFER.load(Ordering::Acquire) == 0
        || !ensure_winrt()
        || !install_hotplug_handlers()
    {
        return WgiSweep {
            capability_ready: false,
            fast_sweep: true,
            unsupported: true,
            covered: 0,
            failed: 1,
            publish_token: 0,
        };
    }

    let epoch = TOPOLOGY_EPOCH.load(Ordering::Acquire);
    let was_dirty = DIRTY.swap(false, Ordering::AcqRel);
    let Some(mut snapshot) = enumerate() else {
        invalidate();
        return WgiSweep {
            capability_ready: false,
            fast_sweep: true,
            unsupported: true,
            covered: 0,
            failed: 1,
            publish_token: 0,
        };
    };
    if TOPOLOGY_EPOCH.load(Ordering::Acquire) != epoch || DIRTY.load(Ordering::Acquire) {
        return WgiSweep {
            capability_ready: false,
            fast_sweep: true,
            unsupported: true,
            covered: snapshot.covered,
            failed: snapshot.failed.saturating_add(1),
            publish_token: 0,
        };
    }

    let (stable, calibrated, failed, covered) = {
        let Ok(mut guard) = state().lock() else {
            invalidate();
            return WgiSweep {
                capability_ready: false,
                fast_sweep: true,
                unsupported: true,
                covered: snapshot.covered,
                failed: snapshot.failed.saturating_add(1),
                publish_token: 0,
            };
        };
        let same = !was_dirty && guard.last_signature.as_ref() == Some(&snapshot.signature);
        if !same {
            guard.raw.clear();
            guard.progress.clear();
        }
        guard
            .raw
            .retain(|identity, _| snapshot.signature.raw.contains(identity));
        guard
            .progress
            .retain(|identity, _| snapshot.signature.raw.contains(identity));
        let now = Instant::now();
        for (identity, sample) in &snapshot.raw_samples {
            let existing_valid = guard.raw.get(identity).is_some_and(|neutral| {
                neutral.buttons == sample.buttons
                    && neutral.switches.len() == sample.switches.len()
                    && neutral.axes.len() == sample.axes.len()
                    && neutral
                        .axes
                        .iter()
                        .zip(sample.axes.iter())
                        .all(|(expected, actual)| (expected - actual).abs() <= AXIS_STABILITY)
            });
            if !existing_valid {
                guard.raw.remove(identity);
                let mut progress = guard.progress.remove(identity);
                if let Some(neutral) = accumulate_calibration(&mut progress, sample, now) {
                    guard.raw.insert(*identity, neutral);
                } else if let Some(progress) = progress {
                    guard.progress.insert(*identity, progress);
                }
            }
        }
        let calibrated = snapshot
            .signature
            .raw
            .iter()
            .all(|identity| guard.raw.contains_key(identity));
        guard.stable_enumerations = if same {
            guard.stable_enumerations.saturating_add(1)
        } else {
            0
        };
        for (identity, interface) in &snapshot.raw_interfaces {
            if let Some(neutral) = guard.raw.get(identity) {
                snapshot.hooks.raw.insert(*interface, neutral.clone());
            }
        }
        guard.gamepads = snapshot.signature.gamepads.clone();
        guard.arcade = snapshot.signature.arcade.clone();
        guard.flight = snapshot.signature.flight.clone();
        guard.racing = snapshot.signature.racing.clone();
        guard.ui = snapshot.signature.ui.clone();
        guard.last_signature = Some(snapshot.signature.clone());
        (
            guard.stable_enumerations >= 1 && calibrated,
            calibrated,
            snapshot.failed,
            snapshot.covered,
        )
    };
    let current = publish_token_is_current(epoch);
    let hooks_complete = snapshot.hooks.raw.len() == snapshot.signature.raw.len();
    let mut ready = stable && calibrated && hooks_complete && failed == 0 && current;
    let fingerprint = hook_fingerprint(&snapshot.hooks);
    if ready && HOOK_SNAPSHOT_SIGNATURE.load(Ordering::Acquire) != fingerprint {
        ready = publish_hook_snapshot(snapshot.hooks, fingerprint);
    }
    // An event can still race the snapshot store. DIRTY makes that snapshot
    // unusable to hooks, and this final check suppresses the publication token.
    ready = ready && publish_token_is_current(epoch);
    if ready {
        LAST_READY_TOKEN.store(epoch, Ordering::Release);
    }
    WgiSweep {
        capability_ready: ready,
        fast_sweep: !ready,
        unsupported: !ready,
        covered,
        failed,
        publish_token: ready.then_some(epoch).unwrap_or(0),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    static TEST_LOCK: Mutex<()> = Mutex::new(());

    fn serial() -> std::sync::MutexGuard<'static, ()> {
        TEST_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn reset_snapshot_test_state() {
        PUBLISHED_SNAPSHOT_COUNT.store(0, Ordering::Release);
        HOOK_SNAPSHOT_SIGNATURE.store(0, Ordering::Release);
        PERMANENT_FAILURE.store(false, Ordering::Release);
        DIRTY.store(false, Ordering::Release);
    }

    fn reset_event_test_state(failure_index: usize) {
        EVENTS_INSTALLED.store(false, Ordering::Release);
        EVENTS_INSTALL_ATTEMPTED.store(false, Ordering::Release);
        TEST_EVENT_FAILURE_INDEX.store(failure_index, Ordering::Release);
        TEST_EVENT_REGISTRATION_COUNT.store(0, Ordering::Release);
        PERMANENT_FAILURE.store(false, Ordering::Release);
        DIRTY.store(false, Ordering::Release);
    }

    #[test]
    fn raw_release_rejects_buttons_switches_and_non_finite_axes() {
        let _serial = serial();
        fn valid(
            buttons: &[bool],
            switches: &[GameControllerSwitchPosition],
            axes: &[f64],
        ) -> bool {
            !buttons.iter().any(|value| *value)
                && switches
                    .iter()
                    .all(|value| *value == GameControllerSwitchPosition::Center)
                && axes.iter().all(|value| value.is_finite())
        }
        assert!(!valid(
            &[true],
            &[GameControllerSwitchPosition::Center],
            &[0.0]
        ));
        assert!(!valid(
            &[false],
            &[GameControllerSwitchPosition::Up],
            &[0.0]
        ));
        assert!(!valid(
            &[false],
            &[GameControllerSwitchPosition::Center],
            &[f64::NAN]
        ));
        assert!(valid(
            &[false],
            &[GameControllerSwitchPosition::Center],
            &[0.0, 0.5]
        ));
    }

    #[test]
    fn raw_gamepad_schema_rejects_held_or_unrepresented_axes() {
        let _serial = serial();
        assert!(raw_gamepad_axes_released(&[0.5, 0.5, 0.5, 0.5, 0.0, 0.0]));
        assert!(!raw_gamepad_axes_released(&[0.5, 0.5, 0.5, 0.5, 0.0]));
        assert!(!raw_gamepad_axes_released(&[
            0.5, 0.5, 0.5, 0.5, 0.0, 0.0, 0.25
        ]));
        assert!(!raw_gamepad_axes_released(&[0.9, 0.5, 0.5, 0.5, 0.0, 0.0]));
        assert!(!raw_gamepad_axes_released(&[0.5, 0.5, 0.5, 0.5, 0.6, 0.0]));
    }

    #[test]
    fn publish_epoch_rejects_hotplug_after_sweep() {
        let _serial = serial();
        DIRTY.store(false, Ordering::Release);
        PERMANENT_FAILURE.store(false, Ordering::Release);
        let epoch = TOPOLOGY_EPOCH.load(Ordering::Acquire);
        assert!(publish_token_is_current(epoch));
        invalidate();
        assert!(!publish_token_is_current(epoch));
    }

    #[test]
    fn blocked_periodic_sweeps_keep_proven_capability_until_invalidation() {
        let _serial = serial();
        reset_snapshot_test_state();
        let epoch = TOPOLOGY_EPOCH.load(Ordering::Acquire);
        let mut snapshot = HookSnapshot::default();
        snapshot.gamepads.insert(0x1234);
        assert!(publish_hook_snapshot(snapshot, 0x5555));
        LAST_READY_TOKEN.store(epoch, Ordering::Release);
        TEST_BLOCKING.store(1, Ordering::Release);

        for _ in 0..20 {
            let result = sweep(true);
            assert!(result.capability_ready);
            assert!(!result.unsupported);
            assert_eq!(result.failed, 0);
            assert_eq!(result.publish_token, epoch);
            assert!(publish_token_is_current(result.publish_token));
        }

        invalidate();
        let result = sweep(true);
        assert!(!result.capability_ready);
        assert!(result.unsupported);
        assert_eq!(result.publish_token, 0);
        assert_eq!(TEST_BLOCKING.load(Ordering::Acquire), 1);
        TEST_BLOCKING.store(0, Ordering::Release);
        reset_snapshot_test_state();
        LAST_READY_TOKEN.store(0, Ordering::Release);
    }

    #[test]
    fn activation_hook_fails_before_factory_escape_while_blocked() {
        let _serial = serial();
        TEST_BLOCKING.store(1, Ordering::Release);
        let mut escaped = 1usize as *mut c_void;
        let result = unsafe {
            hook_ro_get_activation_factory(std::ptr::null_mut(), std::ptr::null(), &mut escaped)
        };
        assert_eq!(result, windows_sys::Win32::Foundation::E_FAIL);
        assert!(escaped.is_null());
        TEST_BLOCKING.store(0, Ordering::Release);
    }

    #[test]
    fn hot_hook_lock_contention_fails_closed_without_waiting() {
        let _serial = serial();
        TEST_BLOCKING.store(1, Ordering::Release);
        DIRTY.store(false, Ordering::Release);
        let guard = state().lock().unwrap();
        let started = std::time::Instant::now();
        assert!(!known_snapshot(123, TypedKind::Gamepad));
        assert!(started.elapsed() < std::time::Duration::from_millis(10));
        drop(guard);
        TEST_BLOCKING.store(0, Ordering::Release);
    }

    #[test]
    fn all_polling_classes_have_distinct_real_slots() {
        let _serial = serial();
        let addresses = [
            &REAL_RAW as *const _,
            &REAL_GAMEPAD as *const _,
            &REAL_ARCADE as *const _,
            &REAL_FLIGHT as *const _,
            &REAL_RACING as *const _,
            &REAL_UI as *const _,
        ];
        assert_eq!(addresses.into_iter().collect::<HashSet<_>>().len(), 6);
    }

    #[test]
    fn every_partial_event_failure_is_one_shot_and_permanent() {
        let _serial = serial();
        // Failure injection happens before the real registration call, so this
        // deterministically covers every Added/Removed slot without mutating
        // the host's actual WinRT subscriptions during the test.
        for failure_index in 0..12 {
            reset_event_test_state(failure_index);
            assert!(!install_hotplug_handlers());
            assert!(PERMANENT_FAILURE.load(Ordering::Acquire));
            assert!(DIRTY.load(Ordering::Acquire));
            let attempts = TEST_EVENT_REGISTRATION_COUNT.load(Ordering::Acquire);
            assert_eq!(attempts, failure_index + 1);
            for _ in 0..20 {
                assert!(!install_hotplug_handlers());
            }
            assert_eq!(
                TEST_EVENT_REGISTRATION_COUNT.load(Ordering::Acquire),
                attempts
            );
        }
        reset_event_test_state(usize::MAX);
    }

    #[test]
    fn snapshot_fingerprint_changes_without_dirty_event() {
        let _serial = serial();
        let mut first = HookSnapshot::default();
        first.gamepads.insert(0x1000);
        let mut second = HookSnapshot::default();
        second.gamepads.insert(0x2000);
        assert_ne!(hook_fingerprint(&first), hook_fingerprint(&second));

        second = HookSnapshot::default();
        second.gamepads.insert(0x1000);
        second.raw.insert(
            0x3000,
            NeutralReading {
                buttons: 1,
                switches: vec![GameControllerSwitchPosition::Center],
                axes: vec![0.5],
            },
        );
        assert_ne!(hook_fingerprint(&first), hook_fingerprint(&second));
    }

    #[test]
    fn stable_snapshot_fingerprint_does_not_request_rcu_growth() {
        let _serial = serial();
        let mut snapshot = HookSnapshot::default();
        snapshot.gamepads.insert(0x1000);
        snapshot.raw.insert(
            0x2000,
            NeutralReading {
                buttons: 4,
                switches: vec![GameControllerSwitchPosition::Center],
                axes: vec![0.0, 0.5],
            },
        );
        let fingerprint = hook_fingerprint(&snapshot);
        HOOK_SNAPSHOT_SIGNATURE.store(fingerprint, Ordering::Release);
        for _ in 0..100_000 {
            assert_eq!(hook_fingerprint(&snapshot), fingerprint);
            assert_eq!(HOOK_SNAPSHOT_SIGNATURE.load(Ordering::Acquire), fingerprint);
        }
    }

    #[test]
    fn gamepad_hook_erases_unknown_object_physical_sample() {
        let _serial = serial();
        unsafe extern "system" fn physical(
            _: *mut c_void,
            reading: *mut GamepadReading,
        ) -> HRESULT {
            unsafe {
                (*reading).Buttons = windows::Gaming::Input::GamepadButtons::A;
                (*reading).LeftTrigger = 1.0;
                (*reading).LeftThumbstickX = 1.0;
            }
            0
        }
        reset_snapshot_test_state();
        TEST_BLOCKING.store(1, Ordering::Release);
        assert!(publish_hook_snapshot(HookSnapshot::default(), 1));
        REAL_GAMEPAD.store(physical as *const () as usize, Ordering::Release);
        let mut reading = GamepadReading::default();
        let result = unsafe { hook_gamepad(0x1234usize as *mut c_void, &mut reading) };
        assert_eq!(result, windows_sys::Win32::Foundation::E_FAIL);
        assert_eq!(reading.Buttons, Default::default());
        assert_eq!(reading.LeftTrigger, 0.0);
        assert_eq!(reading.LeftThumbstickX, 0.0);
        TEST_BLOCKING.store(0, Ordering::Release);
        REAL_GAMEPAD.store(0, Ordering::Release);
    }

    #[test]
    fn raw_clear_bounds_oversized_counts_and_preserves_canaries() {
        let _serial = serial();
        let mut buttons = [true, true];
        let mut switches = [
            GameControllerSwitchPosition::Up,
            GameControllerSwitchPosition::Up,
        ];
        let mut axes = [0.75, 0.75];
        unsafe {
            clear_raw(
                (MAX_BUTTONS + 1) as u32,
                buttons.as_mut_ptr(),
                (MAX_SWITCHES + 1) as u32,
                switches.as_mut_ptr(),
                (MAX_AXES + 1) as u32,
                axes.as_mut_ptr(),
            )
        };
        assert_eq!(buttons, [true, true]);
        assert_eq!(switches, [GameControllerSwitchPosition::Up; 2]);
        assert_eq!(axes, [0.75, 0.75]);
    }

    #[test]
    fn raw_clear_dimension_mismatch_erases_only_declared_buffers() {
        let _serial = serial();
        let mut buttons = [true, true];
        let mut switches = [
            GameControllerSwitchPosition::Up,
            GameControllerSwitchPosition::Up,
        ];
        let mut axes = [0.75, 0.75];
        unsafe {
            clear_raw(
                1,
                buttons.as_mut_ptr(),
                1,
                switches.as_mut_ptr(),
                1,
                axes.as_mut_ptr(),
            )
        };
        assert_eq!(buttons, [false, true]);
        assert_eq!(
            switches,
            [
                GameControllerSwitchPosition::Center,
                GameControllerSwitchPosition::Up
            ]
        );
        assert_eq!(axes, [0.0, 0.75]);
    }

    #[test]
    fn lock_free_snapshot_lookup_stays_fast_under_load() {
        let _serial = serial();
        reset_snapshot_test_state();
        let mut snapshot = HookSnapshot::default();
        snapshot.gamepads.insert(0x1234);
        assert!(publish_hook_snapshot(snapshot, 2));
        let started = Instant::now();
        for _ in 0..250_000 {
            assert!(known_snapshot(0x1234, TypedKind::Gamepad));
        }
        assert!(started.elapsed() < Duration::from_secs(2));
    }

    #[test]
    fn immutable_snapshots_survive_concurrent_publication_and_reads() {
        let _serial = serial();
        reset_snapshot_test_state();
        let mut initial = HookSnapshot::default();
        initial.gamepads.insert(1);
        assert!(publish_hook_snapshot(initial, 1));

        let start = std::sync::Arc::new(std::sync::Barrier::new(9));
        let stop = std::sync::Arc::new(AtomicBool::new(false));
        let mut readers = Vec::new();
        for _ in 0..8 {
            let start = start.clone();
            let stop = stop.clone();
            readers.push(std::thread::spawn(move || {
                start.wait();
                while !stop.load(Ordering::Acquire) {
                    let snapshot = hook_snapshot().expect("a snapshot remains published");
                    assert_eq!(snapshot.gamepads.len(), 1);
                    let identity = *snapshot.gamepads.iter().next().unwrap();
                    assert!((1..MAX_PUBLISHED_SNAPSHOTS).contains(&identity));
                }
            }));
        }
        start.wait();
        for identity in 2..MAX_PUBLISHED_SNAPSHOTS {
            let mut snapshot = HookSnapshot::default();
            snapshot.gamepads.insert(identity);
            let fingerprint = hook_fingerprint(&snapshot);
            assert!(publish_hook_snapshot(snapshot, fingerprint));
        }
        stop.store(true, Ordering::Release);
        for reader in readers {
            reader.join().unwrap();
        }
        assert_eq!(
            PUBLISHED_SNAPSHOT_COUNT.load(Ordering::Acquire),
            MAX_PUBLISHED_SNAPSHOTS - 1
        );
        reset_snapshot_test_state();
    }

    #[test]
    fn snapshot_retention_cap_fails_closed_without_allocation() {
        let _serial = serial();
        reset_snapshot_test_state();
        PUBLISHED_SNAPSHOT_COUNT.store(MAX_PUBLISHED_SNAPSHOTS, Ordering::Release);
        assert!(!publish_hook_snapshot(HookSnapshot::default(), 99));
        assert!(PERMANENT_FAILURE.load(Ordering::Acquire));
        assert!(DIRTY.load(Ordering::Acquire));
        assert_eq!(
            PUBLISHED_SNAPSHOT_COUNT.load(Ordering::Acquire),
            MAX_PUBLISHED_SNAPSHOTS
        );
        reset_snapshot_test_state();
    }

    #[test]
    fn patch_restore_fault_latches_permanent_failure() {
        let _serial = serial();
        #[repr(C)]
        struct Fake {
            vtable: *mut usize,
        }
        unsafe extern "system" fn real(_: *mut c_void, _: *mut GamepadReading) -> HRESULT {
            0
        }
        let mut vtable = [real as *const () as usize; 9];
        let mut fake = Fake {
            vtable: vtable.as_mut_ptr(),
        };
        PERMANENT_FAILURE.store(false, Ordering::Release);
        REAL_GAMEPAD.store(0, Ordering::Release);
        TEST_FAIL_PATCH_RESTORE.store(true, Ordering::Release);
        let result = unsafe {
            patch_slot(
                (&mut fake as *mut Fake).cast(),
                8,
                &REAL_GAMEPAD,
                hook_gamepad as *const () as usize,
            )
        };
        assert!(result.is_err());
        assert!(PERMANENT_FAILURE.load(Ordering::Acquire));
        assert_eq!(vtable[8], real as *const () as usize);
        PERMANENT_FAILURE.store(false, Ordering::Release);
    }
}
