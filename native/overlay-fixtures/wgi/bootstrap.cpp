// clang-format off: Windows types must be visible before the Detours header.
#include "contract.hpp"
#include <detours.h>
// clang-format on

#include <array>
#include <atomic>
#include <cstring>

namespace {

using namespace gamehub::overlay::wgi_qa;

struct HotEntry {
  DWORD projection = 0;
  ULONG_PTR interfacePointer = 0;
  ULONG_PTR controllingUnknown = 0;
  unsigned long long serial = 0;
  std::atomic<unsigned long long> drainedEpoch{0};
};

struct HotSnapshot {
  DWORD count = 0;
  DWORD generation = 0;
  HotEntry entries[kSnapshotCap]{};
};

struct HotValue {
  DWORD projection = 0;
  ULONG_PTR interfacePointer = 0;
  ULONG_PTR controllingUnknown = 0;
  unsigned long long serial = 0;
};

static_assert(std::atomic<DWORD>::is_always_lock_free);
static_assert(std::atomic<ULONG_PTR>::is_always_lock_free);
static_assert(std::atomic<unsigned long long>::is_always_lock_free);

RoGetActivationFactoryFunction g_true_ro_get_activation_factory = nullptr;
GamepadReadingFunction g_true_gamepad_reading = nullptr;
RawReadingFunction g_true_raw_reading = nullptr;
RacingReadingFunction g_true_racing_reading = nullptr;
FlightReadingFunction g_true_flight_reading = nullptr;
ArcadeReadingFunction g_true_arcade_reading = nullptr;
UiReadingFunction g_true_ui_reading = nullptr;

CacheSnapshot g_cache{};
HotSnapshot g_hot_snapshots[kSnapshotGenerationCap]{};
std::atomic<DWORD> g_active_hot_snapshot{MAXDWORD};
std::atomic<DWORD> g_published_snapshot_count{0};
std::atomic<unsigned long long> g_block_drain_epoch{0};
std::atomic<unsigned long long> g_validated_epoch{0};
std::atomic<unsigned long long> g_validated_serials[kProjectionCount]{};
SRWLOCK g_publish_lock = SRWLOCK_INIT;

volatile LONG g_restore_after_with = 0;
volatile LONG g_cache_initialized = 0;
volatile LONG g_cached_pointers_matched = 0;
volatile LONG g_attach_error = ERROR_INVALID_STATE;
volatile LONG g_attached = 0;
volatile LONG g_block_latched = 0;
volatile LONG g_readiness_valid = 0;
volatile LONG g_fence_phase = static_cast<LONG>(FencePhase::kUnarmed);
volatile LONG g_permanent_fault = 0;
volatile LONG g_topology_invalidations = 0;
volatile LONG g_revalidations = 0;
volatile LONG g_neutral_samples = 0;
volatile LONG g_activation_hook_calls = 0;
volatile LONG g_polling_hook_calls[kProjectionCount]{};
volatile LONG g_pause_armed = 0;
volatile LONG g_pause_projection = -1;
std::atomic<ULONG_PTR> g_pause_entered_event{0};
std::atomic<ULONG_PTR> g_pause_resume_event{0};
unsigned long long g_neutral_since_ms = 0;
unsigned long long g_last_observation_ms = 0;
bool g_neutral_since_set = false;
bool g_last_observation_set = false;

constexpr DWORD kReadingSlots[kProjectionCount] = {
    kGamepadReadingSlot, kRawReadingSlot,    kRacingReadingSlot,
    kFlightReadingSlot,  kArcadeReadingSlot, kUiReadingSlot};

bool IsReadable(const void* address, std::size_t bytes) noexcept {
  if (address == nullptr || bytes == 0) return false;
  MEMORY_BASIC_INFORMATION memory{};
  if (VirtualQuery(address, &memory, sizeof(memory)) != sizeof(memory) ||
      memory.State != MEM_COMMIT ||
      (memory.Protect & (PAGE_GUARD | PAGE_NOACCESS)) != 0) {
    return false;
  }
  const auto start = reinterpret_cast<std::uintptr_t>(address);
  const auto base = reinterpret_cast<std::uintptr_t>(memory.BaseAddress);
  return start >= base && bytes <= memory.RegionSize - (start - base);
}

bool IsExecutable(const void* address) noexcept {
  MEMORY_BASIC_INFORMATION memory{};
  if (address == nullptr ||
      VirtualQuery(address, &memory, sizeof(memory)) != sizeof(memory) ||
      memory.State != MEM_COMMIT ||
      (memory.Protect & (PAGE_GUARD | PAGE_NOACCESS)) != 0) {
    return false;
  }
  const DWORD protection = memory.Protect & 0xffu;
  return protection == PAGE_EXECUTE || protection == PAGE_EXECUTE_READ ||
         protection == PAGE_EXECUTE_READWRITE ||
         protection == PAGE_EXECUTE_WRITECOPY;
}

const IID& ProjectionIid(DWORD projection) noexcept {
  static const IID iids[kProjectionCount] = {
      __uuidof(abi::IGamepad),
      __uuidof(abi::IRawGameController),
      __uuidof(abi::IRacingWheel),
      __uuidof(abi::IFlightStick),
      __uuidof(abi::IArcadeStick),
      __uuidof(abi::IUINavigationController),
  };
  return iids[projection];
}

void* PollingBody(void* object, DWORD projection) noexcept {
  if (!IsReadable(object, sizeof(void*))) return nullptr;
  void** table = *reinterpret_cast<void***>(object);
  const DWORD slot = kReadingSlots[projection];
  if (!IsReadable(table, sizeof(void*) * (slot + 1u))) return nullptr;
  return table[slot];
}

void ResetNeutralWindow() noexcept {
  InterlockedExchange(&g_neutral_samples, 0);
  g_neutral_since_ms = 0;
  g_last_observation_ms = 0;
  g_neutral_since_set = false;
  g_last_observation_set = false;
}

bool ExactRawSchema(const Topology& topology) noexcept {
  constexpr double neutral[kRawAxes] = {0.5, 0.5, 0.5, 0.5, 0.0, 0.0};
  if (topology.rawButtonCount != kRawButtons ||
      topology.rawSwitchCount != kRawSwitches ||
      topology.rawAxisCount != kRawAxes) {
    return false;
  }
  for (DWORD index = 0; index < kRawAxes; ++index) {
    if (topology.rawNeutralAxes[index] != neutral[index]) return false;
  }
  return true;
}

bool ValidateTopology(const Topology& topology,
                      std::array<ULONG_PTR, kProjectionCount>* identities,
                      bool activate_factories) {
  if (topology.structSize != sizeof(topology) ||
      topology.schemaVersion != kSchemaVersion ||
      topology.generation != kGeneration ||
      topology.fault != static_cast<DWORD>(ProviderFault::kNone) ||
      topology.presentMask != kAllProjectionMask ||
      topology.epoch == 0 || !ExactRawSchema(topology) ||
      topology.serials[0] == 0 || topology.serials[0] != topology.serials[1]) {
    return false;
  }

  std::array<IUnknown*, kProjectionCount> controlling{};
  bool valid = true;
  for (DWORD index = 0; index < kProjectionCount && valid; ++index) {
    void* object = reinterpret_cast<void*>(topology.objects[index]);
    void* body = PollingBody(object, index);
    if (object == nullptr || body == nullptr || !IsExecutable(body) ||
        reinterpret_cast<ULONG_PTR>(body) != g_cache.pollingBodies[index]) {
      valid = false;
      break;
    }
    auto* inspectable = reinterpret_cast<IInspectable*>(object);
    void* exact_interface = nullptr;
    IUnknown* unknown = nullptr;
    IInspectable* inspectable_round_trip = nullptr;
    const HRESULT interface_result =
        inspectable->QueryInterface(ProjectionIid(index), &exact_interface);
    const HRESULT unknown_result =
        inspectable->QueryInterface(IID_PPV_ARGS(&unknown));
    const HRESULT inspectable_result =
        inspectable->QueryInterface(IID_PPV_ARGS(&inspectable_round_trip));
    valid = SUCCEEDED(interface_result) && exact_interface == object &&
            SUCCEEDED(unknown_result) && unknown != nullptr &&
            SUCCEEDED(inspectable_result) && inspectable_round_trip != nullptr;
    if (exact_interface != nullptr) {
      reinterpret_cast<IUnknown*>(exact_interface)->Release();
    }
    if (inspectable_round_trip != nullptr) inspectable_round_trip->Release();
    controlling[index] = unknown;
  }

  if (valid) {
    valid = controlling[0] != nullptr && controlling[0] == controlling[1];
    for (DWORD index = 2; index < kProjectionCount && valid; ++index) {
      valid = controlling[index] != nullptr;
      for (DWORD prior = 0; prior < index && valid; ++prior) {
        valid = controlling[index] != controlling[prior];
      }
    }
  }
  if (valid && activate_factories) {
    for (DWORD index = 0; index < kProjectionCount && valid; ++index) {
      IInspectable* factory = nullptr;
      valid = SUCCEEDED(GameHubWgiQaActivate(
                  index, reinterpret_cast<void**>(&factory))) &&
              factory != nullptr;
      if (factory != nullptr) factory->Release();
    }
  }
  if (valid) {
    for (DWORD index = 0; index < kProjectionCount; ++index) {
      (*identities)[index] =
          reinterpret_cast<ULONG_PTR>(controlling[index]);
    }
  }
  for (IUnknown* value : controlling) {
    if (value != nullptr) value->Release();
  }
  return valid;
}

bool PublishSnapshot(
    const Topology& topology,
    const std::array<ULONG_PTR, kProjectionCount>& identities) noexcept {
  AcquireSRWLockExclusive(&g_publish_lock);
  HotValue values[kSnapshotCap]{};
  DWORD value_count = 0;
  if (InterlockedCompareExchange(&g_block_latched, 0, 0) != 0) {
    const DWORD active =
        g_active_hot_snapshot.load(std::memory_order_acquire);
    if (active >= kSnapshotGenerationCap) {
      ReleaseSRWLockExclusive(&g_publish_lock);
      return false;
    }
    const HotSnapshot& current = g_hot_snapshots[active];
    value_count = current.count;
    if (value_count > kSnapshotCap) {
      ReleaseSRWLockExclusive(&g_publish_lock);
      return false;
    }
    for (DWORD index = 0; index < value_count; ++index) {
      values[index].projection = current.entries[index].projection;
      values[index].interfacePointer = current.entries[index].interfacePointer;
      values[index].controllingUnknown =
          current.entries[index].controllingUnknown;
      values[index].serial = current.entries[index].serial;
    }
  }
  for (DWORD projection = 0; projection < kProjectionCount; ++projection) {
    DWORD match = value_count;
    for (DWORD index = 0; index < value_count; ++index) {
      if (values[index].projection == projection &&
          values[index].interfacePointer == topology.objects[projection]) {
        match = index;
        break;
      }
    }
    if (match == value_count) {
      if (value_count == kSnapshotCap) {
        ReleaseSRWLockExclusive(&g_publish_lock);
        return false;
      }
      ++value_count;
    }
    values[match].projection = projection;
    values[match].interfacePointer = topology.objects[projection];
    values[match].controllingUnknown = identities[projection];
    values[match].serial = topology.serials[projection];
  }

  const DWORD next =
      g_published_snapshot_count.load(std::memory_order_relaxed);
  if (next >= kSnapshotGenerationCap) {
    ReleaseSRWLockExclusive(&g_publish_lock);
    return false;
  }
  HotSnapshot& snapshot = g_hot_snapshots[next];
  snapshot.count = value_count;
  snapshot.generation = next + 1u;
  for (DWORD index = 0; index < value_count; ++index) {
    snapshot.entries[index].projection = values[index].projection;
    snapshot.entries[index].interfacePointer = values[index].interfacePointer;
    snapshot.entries[index].controllingUnknown =
        values[index].controllingUnknown;
    snapshot.entries[index].serial = values[index].serial;
    snapshot.entries[index].drainedEpoch.store(0, std::memory_order_relaxed);
  }
  for (DWORD index = 0; index < kProjectionCount; ++index) {
    g_validated_serials[index].store(topology.serials[index],
                                     std::memory_order_release);
  }
  g_validated_epoch.store(topology.epoch, std::memory_order_release);
  g_active_hot_snapshot.store(next, std::memory_order_release);
  g_published_snapshot_count.store(next + 1u, std::memory_order_release);
  ReleaseSRWLockExclusive(&g_publish_lock);
  return true;
}

struct Registration {
  HotEntry* entry = nullptr;
  unsigned long long drainEpoch = 0;
  DWORD snapshotGeneration = 0;
};

bool PauseReaderIfArmed(DWORD projection) noexcept {
  if (InterlockedCompareExchange(&g_pause_projection, 0, 0) !=
          static_cast<LONG>(projection) ||
      InterlockedCompareExchange(&g_pause_armed, 0, 1) != 1) {
    return true;
  }
  const HANDLE entered = reinterpret_cast<HANDLE>(
      g_pause_entered_event.load(std::memory_order_acquire));
  const HANDLE resume = reinterpret_cast<HANDLE>(
      g_pause_resume_event.load(std::memory_order_acquire));
  const bool entered_signaled = entered != nullptr && SetEvent(entered);
  const DWORD wait = resume == nullptr ? WAIT_FAILED
                                       : WaitForSingleObject(resume, 5'000);
  g_pause_entered_event.store(0, std::memory_order_release);
  g_pause_resume_event.store(0, std::memory_order_release);
  InterlockedExchange(&g_pause_projection, -1);
  if (!entered_signaled || wait != WAIT_OBJECT_0) {
    InterlockedExchange(&g_permanent_fault, 1);
    InterlockedExchange(&g_readiness_valid, 0);
    InterlockedExchange(&g_fence_phase,
                        static_cast<LONG>(FencePhase::kFault));
    return false;
  }
  return true;
}

bool FindRegistration(DWORD projection, const void* interface_pointer,
                      Registration* registration) noexcept {
  if (registration == nullptr) return false;
  *registration = {};
  const DWORD active =
      g_active_hot_snapshot.load(std::memory_order_acquire);
  if (active >= kSnapshotGenerationCap) return false;
  HotSnapshot& snapshot = g_hot_snapshots[active];
  const DWORD count = snapshot.count;
  if (count > kSnapshotCap) return false;
  const ULONG_PTR expected = reinterpret_cast<ULONG_PTR>(interface_pointer);
  for (DWORD index = 0; index < count; ++index) {
    if (snapshot.entries[index].projection == projection &&
        snapshot.entries[index].interfacePointer == expected &&
        snapshot.entries[index].controllingUnknown != 0 &&
        snapshot.entries[index].serial != 0) {
      registration->entry = &snapshot.entries[index];
      registration->drainEpoch =
          g_block_drain_epoch.load(std::memory_order_acquire);
      registration->snapshotGeneration = snapshot.generation;
      return PauseReaderIfArmed(projection);
    }
  }
  return false;
}

void MarkDrained(DWORD projection, const Registration& registration) noexcept {
  (void)projection;
  if (registration.entry == nullptr || registration.drainEpoch == 0 ||
      registration.snapshotGeneration == 0) {
    return;
  }
  registration.entry->drainedEpoch.store(registration.drainEpoch,
                                          std::memory_order_release);
}

DWORD DrainedEntryCount() noexcept {
  const DWORD active =
      g_active_hot_snapshot.load(std::memory_order_acquire);
  if (active >= kSnapshotGenerationCap) return 0;
  const HotSnapshot& snapshot = g_hot_snapshots[active];
  const DWORD count = snapshot.count;
  if (count > kSnapshotCap) return 0;
  const unsigned long long drain_epoch =
      g_block_drain_epoch.load(std::memory_order_acquire);
  DWORD drained = 0;
  for (DWORD index = 0; index < count; ++index) {
    const unsigned long long observed =
        snapshot.entries[index].drainedEpoch.load(std::memory_order_acquire);
    if (drain_epoch != 0 && observed == drain_epoch) ++drained;
  }
  return drained;
}

DWORD ActiveSnapshotCount() noexcept {
  const DWORD active =
      g_active_hot_snapshot.load(std::memory_order_acquire);
  return active < kSnapshotGenerationCap ? g_hot_snapshots[active].count : 0u;
}

DWORD ActiveDrainMask() noexcept {
  const DWORD active =
      g_active_hot_snapshot.load(std::memory_order_acquire);
  if (active >= kSnapshotGenerationCap) return 0;
  const HotSnapshot& snapshot = g_hot_snapshots[active];
  if (snapshot.count > kSnapshotCap) return 0;
  const unsigned long long drain_epoch =
      g_block_drain_epoch.load(std::memory_order_acquire);
  DWORD mask = 0;
  for (DWORD index = 0; index < snapshot.count; ++index) {
    if (snapshot.entries[index].drainedEpoch.load(std::memory_order_acquire) ==
        drain_epoch) {
      mask |= Bit(static_cast<Projection>(snapshot.entries[index].projection));
    }
  }
  return mask;
}

bool BlockLatched() noexcept {
  return InterlockedCompareExchange(&g_block_latched, 0, 0) != 0;
}

template <typename Reading>
HRESULT RejectUnknownReading(Reading* reading) noexcept {
  if (reading != nullptr) *reading = {};
  return E_ACCESSDENIED;
}

HRESULT WINAPI HookRoGetActivationFactory(HSTRING class_id, REFIID iid,
                                           void** factory) {
  InterlockedIncrement(&g_activation_hook_calls);
  return g_true_ro_get_activation_factory(class_id, iid, factory);
}

HRESULT STDMETHODCALLTYPE HookGamepadReading(abi::IGamepad* object,
                                              abi::GamepadReading* reading) {
  InterlockedIncrement(&g_polling_hook_calls[0]);
  Registration registration{};
  if (BlockLatched() && !FindRegistration(0, object, &registration)) {
    return RejectUnknownReading(reading);
  }
  const HRESULT result = g_true_gamepad_reading(object, reading);
  if (!BlockLatched()) return result;
  if (registration.entry == nullptr &&
      !FindRegistration(0, object, &registration)) {
    return RejectUnknownReading(reading);
  }
  if (SUCCEEDED(result) && reading != nullptr) {
    MarkDrained(0, registration);
    const UINT64 timestamp = reading->Timestamp;
    *reading = {};
    reading->Timestamp = timestamp;
  }
  return result;
}

HRESULT STDMETHODCALLTYPE HookRawReading(
    abi::IRawGameController* object, UINT32 button_count, boolean* buttons,
    UINT32 switch_count, abi::GameControllerSwitchPosition* switches,
    UINT32 axis_count, DOUBLE* axes, UINT64* timestamp) {
  InterlockedIncrement(&g_polling_hook_calls[1]);
  Registration registration{};
  if (BlockLatched() && !FindRegistration(1, object, &registration)) {
    if (timestamp != nullptr) *timestamp = 0;
    if (button_count <= kSnapshotCap && buttons != nullptr) {
      std::memset(buttons, 0, sizeof(boolean) * button_count);
    }
    if (switch_count <= kSnapshotCap && switches != nullptr) {
      std::memset(switches, 0, sizeof(*switches) * switch_count);
    }
    if (axis_count <= kSnapshotCap && axes != nullptr) {
      std::memset(axes, 0, sizeof(*axes) * axis_count);
    }
    return E_ACCESSDENIED;
  }
  const HRESULT result = g_true_raw_reading(
      object, button_count, buttons, switch_count, switches, axis_count, axes,
      timestamp);
  if (!BlockLatched()) return result;
  if (registration.entry == nullptr &&
      !FindRegistration(1, object, &registration)) {
    if (timestamp != nullptr) *timestamp = 0;
    if (button_count <= kSnapshotCap && buttons != nullptr) {
      std::memset(buttons, 0, sizeof(boolean) * button_count);
    }
    if (switch_count <= kSnapshotCap && switches != nullptr) {
      std::memset(switches, 0, sizeof(*switches) * switch_count);
    }
    if (axis_count <= kSnapshotCap && axes != nullptr) {
      std::memset(axes, 0, sizeof(*axes) * axis_count);
    }
    return E_ACCESSDENIED;
  }
  if (SUCCEEDED(result) && button_count == kRawButtons &&
      switch_count == kRawSwitches && axis_count == kRawAxes &&
      buttons != nullptr && switches != nullptr && axes != nullptr &&
      timestamp != nullptr) {
    MarkDrained(1, registration);
    std::memset(buttons, 0, sizeof(boolean) * kRawButtons);
    switches[0] = static_cast<abi::GameControllerSwitchPosition>(0);
    constexpr DOUBLE neutral[kRawAxes] = {0.5, 0.5, 0.5, 0.5, 0.0, 0.0};
    std::memcpy(axes, neutral, sizeof(neutral));
  }
  return result;
}

HRESULT STDMETHODCALLTYPE HookRacingReading(
    abi::IRacingWheel* object, abi::RacingWheelReading* reading) {
  InterlockedIncrement(&g_polling_hook_calls[2]);
  Registration registration{};
  if (BlockLatched() && !FindRegistration(2, object, &registration)) {
    return RejectUnknownReading(reading);
  }
  const HRESULT result = g_true_racing_reading(object, reading);
  if (!BlockLatched()) return result;
  if (registration.entry == nullptr &&
      !FindRegistration(2, object, &registration)) {
    return RejectUnknownReading(reading);
  }
  if (SUCCEEDED(result) && reading != nullptr) {
    MarkDrained(2, registration);
    const UINT64 timestamp = reading->Timestamp;
    *reading = {};
    reading->Timestamp = timestamp;
  }
  return result;
}

HRESULT STDMETHODCALLTYPE HookFlightReading(abi::IFlightStick* object,
                                             abi::FlightStickReading* reading) {
  InterlockedIncrement(&g_polling_hook_calls[3]);
  Registration registration{};
  if (BlockLatched() && !FindRegistration(3, object, &registration)) {
    return RejectUnknownReading(reading);
  }
  const HRESULT result = g_true_flight_reading(object, reading);
  if (!BlockLatched()) return result;
  if (registration.entry == nullptr &&
      !FindRegistration(3, object, &registration)) {
    return RejectUnknownReading(reading);
  }
  if (SUCCEEDED(result) && reading != nullptr) {
    MarkDrained(3, registration);
    const UINT64 timestamp = reading->Timestamp;
    *reading = {};
    reading->Timestamp = timestamp;
    reading->HatSwitch =
        static_cast<abi::GameControllerSwitchPosition>(0);
  }
  return result;
}

HRESULT STDMETHODCALLTYPE HookArcadeReading(abi::IArcadeStick* object,
                                             abi::ArcadeStickReading* reading) {
  InterlockedIncrement(&g_polling_hook_calls[4]);
  Registration registration{};
  if (BlockLatched() && !FindRegistration(4, object, &registration)) {
    return RejectUnknownReading(reading);
  }
  const HRESULT result = g_true_arcade_reading(object, reading);
  if (!BlockLatched()) return result;
  if (registration.entry == nullptr &&
      !FindRegistration(4, object, &registration)) {
    return RejectUnknownReading(reading);
  }
  if (SUCCEEDED(result) && reading != nullptr) {
    MarkDrained(4, registration);
    const UINT64 timestamp = reading->Timestamp;
    *reading = {};
    reading->Timestamp = timestamp;
  }
  return result;
}

HRESULT STDMETHODCALLTYPE HookUiReading(
    abi::IUINavigationController* object, abi::UINavigationReading* reading) {
  InterlockedIncrement(&g_polling_hook_calls[5]);
  Registration registration{};
  if (BlockLatched() && !FindRegistration(5, object, &registration)) {
    return RejectUnknownReading(reading);
  }
  const HRESULT result = g_true_ui_reading(object, reading);
  if (!BlockLatched()) return result;
  if (registration.entry == nullptr &&
      !FindRegistration(5, object, &registration)) {
    return RejectUnknownReading(reading);
  }
  if (SUCCEEDED(result) && reading != nullptr) {
    MarkDrained(5, registration);
    const UINT64 timestamp = reading->Timestamp;
    *reading = {};
    reading->Timestamp = timestamp;
  }
  return result;
}

LONG AttachHooks() {
  LONG error = DetourTransactionBegin();
  if (error == NO_ERROR) error = DetourUpdateThread(GetCurrentThread());
#define ATTACH(Function, Hook)                                                \
  if (error == NO_ERROR) {                                                    \
    error = DetourAttach(reinterpret_cast<PVOID*>(&(Function)),               \
                         reinterpret_cast<PVOID>(Hook));                      \
  }
  ATTACH(g_true_ro_get_activation_factory, HookRoGetActivationFactory)
  ATTACH(g_true_gamepad_reading, HookGamepadReading)
  ATTACH(g_true_raw_reading, HookRawReading)
  ATTACH(g_true_racing_reading, HookRacingReading)
  ATTACH(g_true_flight_reading, HookFlightReading)
  ATTACH(g_true_arcade_reading, HookArcadeReading)
  ATTACH(g_true_ui_reading, HookUiReading)
#undef ATTACH
  if (error == NO_ERROR) error = DetourTransactionCommit();
  if (error != NO_ERROR) DetourTransactionAbort();
  return error;
}

LONG DetachHooks() {
  LONG error = DetourTransactionBegin();
  if (error == NO_ERROR) error = DetourUpdateThread(GetCurrentThread());
#define DETACH(Function, Hook)                                                \
  if (error == NO_ERROR) {                                                    \
    error = DetourDetach(reinterpret_cast<PVOID*>(&(Function)),               \
                         reinterpret_cast<PVOID>(Hook));                      \
  }
  DETACH(g_true_ro_get_activation_factory, HookRoGetActivationFactory)
  DETACH(g_true_gamepad_reading, HookGamepadReading)
  DETACH(g_true_raw_reading, HookRawReading)
  DETACH(g_true_racing_reading, HookRacingReading)
  DETACH(g_true_flight_reading, HookFlightReading)
  DETACH(g_true_arcade_reading, HookArcadeReading)
  DETACH(g_true_ui_reading, HookUiReading)
#undef DETACH
  if (error == NO_ERROR) error = DetourTransactionCommit();
  if (error != NO_ERROR) DetourTransactionAbort();
  return error;
}

bool InitializeAndAttach() {
  InterlockedExchange(&g_restore_after_with,
                      DetourRestoreAfterWith() ? 1 : 0);
  if (!GameHubWgiQaGetCacheSnapshot(&g_cache, sizeof(g_cache)) ||
      g_cache.structSize != sizeof(g_cache) ||
      g_cache.schemaVersion != kSchemaVersion ||
      g_cache.initializedBeforeBootstrap == 0 ||
      g_cache.activationCallsBeforeBootstrap != kProjectionCount ||
      g_cache.physicalPollsBeforeBootstrap != kProjectionCount ||
      g_cache.allObjectsHadVtables == 0 ||
      g_cache.exactInterfacesRoundTripped == 0 ||
      g_cache.controllingUnknownsValid == 0 ||
      g_cache.gamepadRawSharedIdentity == 0 ||
      g_cache.otherIdentitiesDistinct == 0 ||
      g_cache.exactRawSchema == 0 ||
      g_cache.roGetActivationFactory == 0) {
    return false;
  }
  InterlockedExchange(&g_cache_initialized, 1);

  g_true_ro_get_activation_factory =
      reinterpret_cast<RoGetActivationFactoryFunction>(
          g_cache.roGetActivationFactory);
  g_true_gamepad_reading =
      reinterpret_cast<GamepadReadingFunction>(g_cache.pollingBodies[0]);
  g_true_raw_reading =
      reinterpret_cast<RawReadingFunction>(g_cache.pollingBodies[1]);
  g_true_racing_reading =
      reinterpret_cast<RacingReadingFunction>(g_cache.pollingBodies[2]);
  g_true_flight_reading =
      reinterpret_cast<FlightReadingFunction>(g_cache.pollingBodies[3]);
  g_true_arcade_reading =
      reinterpret_cast<ArcadeReadingFunction>(g_cache.pollingBodies[4]);
  g_true_ui_reading =
      reinterpret_cast<UiReadingFunction>(g_cache.pollingBodies[5]);

  Topology topology{};
  std::array<ULONG_PTR, kProjectionCount> identities{};
  if (!GameHubWgiQaGetTopology(&topology, sizeof(topology)) ||
      !ValidateTopology(topology, &identities, false)) {
    return false;
  }
  for (DWORD index = 0; index < kProjectionCount; ++index) {
    if (topology.objects[index] != g_cache.objects[index]) return false;
  }
  InterlockedExchange(&g_cached_pointers_matched, 1);
  if (!PublishSnapshot(topology, identities)) return false;
  InterlockedExchange(&g_readiness_valid, 1);

  const LONG error = AttachHooks();
  InterlockedExchange(&g_attach_error, error);
  if (error != NO_ERROR) {
    InterlockedExchange(&g_permanent_fault, 1);
    InterlockedExchange(&g_fence_phase,
                        static_cast<LONG>(FencePhase::kFault));
    return false;
  }
  InterlockedExchange(&g_attached, 1);
  return true;
}

}  // namespace

extern "C" BOOL WINAPI GameHubWgiQaGetBootstrapSnapshot(
    gamehub::overlay::wgi_qa::BootstrapSnapshot* output, DWORD output_size) {
  if (output == nullptr || output_size != sizeof(*output)) return FALSE;
  *output = {};
  output->structSize = sizeof(*output);
  output->schemaVersion = kSchemaVersion;
  output->restoreAfterWithSucceeded = static_cast<DWORD>(
      InterlockedCompareExchange(&g_restore_after_with, 0, 0));
  output->cacheInitializedBeforeAttach = static_cast<DWORD>(
      InterlockedCompareExchange(&g_cache_initialized, 0, 0));
  output->cachedPointersMatchedBeforeAttach = static_cast<DWORD>(
      InterlockedCompareExchange(&g_cached_pointers_matched, 0, 0));
  output->attachError = InterlockedCompareExchange(&g_attach_error, 0, 0);
  output->attachedBeforeEntry =
      static_cast<DWORD>(InterlockedCompareExchange(&g_attached, 0, 0));
  output->blockLatched =
      static_cast<DWORD>(InterlockedCompareExchange(&g_block_latched, 0, 0));
  output->readinessValid =
      static_cast<DWORD>(InterlockedCompareExchange(&g_readiness_valid, 0, 0));
  output->fencePhase =
      static_cast<DWORD>(InterlockedCompareExchange(&g_fence_phase, 0, 0));
  const DWORD active =
      g_active_hot_snapshot.load(std::memory_order_acquire);
  output->snapshotCount = ActiveSnapshotCount();
  output->activeSnapshotGeneration =
      active < kSnapshotGenerationCap ? g_hot_snapshots[active].generation : 0u;
  output->publishedSnapshotCount =
      g_published_snapshot_count.load(std::memory_order_acquire);
  output->permanentFault =
      static_cast<DWORD>(InterlockedCompareExchange(&g_permanent_fault, 0, 0));
  output->topologyInvalidations = static_cast<DWORD>(
      InterlockedCompareExchange(&g_topology_invalidations, 0, 0));
  output->revalidations =
      static_cast<DWORD>(InterlockedCompareExchange(&g_revalidations, 0, 0));
  output->drainMask = ActiveDrainMask();
  output->requiredDrainEntries = output->snapshotCount;
  output->drainedEntryCount = DrainedEntryCount();
  output->blockDrainEpoch =
      g_block_drain_epoch.load(std::memory_order_acquire);
  output->neutralSamples =
      static_cast<DWORD>(InterlockedCompareExchange(&g_neutral_samples, 0, 0));
  output->neutralSinceMs = g_neutral_since_ms;
  output->validatedEpoch =
      g_validated_epoch.load(std::memory_order_acquire);
  for (DWORD index = 0; index < kProjectionCount; ++index) {
    output->validatedSerials[index] =
        g_validated_serials[index].load(std::memory_order_acquire);
    output->pollingHookCalls[index] = static_cast<DWORD>(
        InterlockedCompareExchange(&g_polling_hook_calls[index], 0, 0));
    output->pollingBodiesBeforeAttach[index] = g_cache.pollingBodies[index];
  }
  output->activationHookCalls = static_cast<DWORD>(
      InterlockedCompareExchange(&g_activation_hook_calls, 0, 0));
  output->roBodyBeforeAttach = g_cache.roGetActivationFactory;
  return TRUE;
}

extern "C" DWORD WINAPI GameHubWgiQaBeginBlock(
    DWORD generation, unsigned long long epoch) {
  if (generation != kGeneration ||
      epoch != g_validated_epoch.load(std::memory_order_acquire)) {
    return static_cast<DWORD>(FenceEvent::kIgnoredStale);
  }
  if (InterlockedCompareExchange(&g_permanent_fault, 0, 0) != 0 ||
      InterlockedCompareExchange(&g_attached, 0, 0) == 0 ||
      InterlockedCompareExchange(&g_readiness_valid, 0, 0) == 0) {
    return static_cast<DWORD>(FenceEvent::kRejected);
  }
  if (InterlockedCompareExchange(&g_block_latched, 1, 0) == 0) {
    g_block_drain_epoch.fetch_add(1, std::memory_order_acq_rel);
    ResetNeutralWindow();
  }
  InterlockedExchange(&g_fence_phase,
                      static_cast<LONG>(FencePhase::kBlocked));
  return static_cast<DWORD>(FenceEvent::kApplied);
}

extern "C" DWORD WINAPI GameHubWgiQaExplicitRevalidate(
    DWORD generation, unsigned long long epoch) {
  if (generation != kGeneration ||
      InterlockedCompareExchange(&g_block_latched, 0, 0) == 0 ||
      InterlockedCompareExchange(&g_permanent_fault, 0, 0) != 0) {
    return static_cast<DWORD>(FenceEvent::kRejected);
  }
  Topology topology{};
  std::array<ULONG_PTR, kProjectionCount> identities{};
  if (!GameHubWgiQaGetTopology(&topology, sizeof(topology)) ||
      topology.epoch != epoch ||
      !ValidateTopology(topology, &identities, true)) {
    InterlockedExchange(&g_readiness_valid, 0);
    InterlockedExchange(&g_fence_phase,
                        static_cast<LONG>(FencePhase::kInvalidated));
    ResetNeutralWindow();
    return static_cast<DWORD>(FenceEvent::kRejected);
  }
  if (!PublishSnapshot(topology, identities)) {
    InterlockedExchange(&g_readiness_valid, 0);
    InterlockedExchange(&g_fence_phase,
                        static_cast<LONG>(FencePhase::kInvalidated));
    return static_cast<DWORD>(FenceEvent::kRejected);
  }
  InterlockedExchange(&g_readiness_valid, 1);
  InterlockedIncrement(&g_revalidations);
  ResetNeutralWindow();
  InterlockedExchange(&g_fence_phase,
                      static_cast<LONG>(FencePhase::kBlocked));
  return static_cast<DWORD>(FenceEvent::kApplied);
}

extern "C" DWORD WINAPI GameHubWgiQaObserveRelease(
    DWORD generation, unsigned long long epoch, unsigned long long now_ms) {
  if (generation != kGeneration ||
      epoch != g_validated_epoch.load(std::memory_order_acquire)) {
    return static_cast<DWORD>(FenceEvent::kIgnoredStale);
  }
  if (InterlockedCompareExchange(&g_block_latched, 0, 0) == 0) {
    return static_cast<DWORD>(FenceEvent::kReleased);
  }
  if (InterlockedCompareExchange(&g_readiness_valid, 0, 0) == 0 ||
      InterlockedCompareExchange(&g_permanent_fault, 0, 0) != 0 ||
      ActiveDrainMask() != kAllProjectionMask ||
      ActiveSnapshotCount() < kProjectionCount ||
      DrainedEntryCount() != ActiveSnapshotCount()) {
    return static_cast<DWORD>(FenceEvent::kRejected);
  }

  Topology topology{};
  ProviderSnapshot provider{};
  std::array<ULONG_PTR, kProjectionCount> identities{};
  bool exact = GameHubWgiQaGetTopology(&topology, sizeof(topology)) &&
               GameHubWgiQaGetProviderSnapshot(&provider, sizeof(provider)) &&
               topology.epoch == epoch && provider.epoch == epoch &&
               provider.transientReferences == 0 &&
               provider.addRefCalls == provider.releaseCalls &&
               provider.overReleaseAttempts == 0 &&
               ValidateTopology(topology, &identities, false);
  for (DWORD index = 0; index < kProjectionCount && exact; ++index) {
    exact = topology.serials[index] ==
            g_validated_serials[index].load(std::memory_order_acquire);
  }
  if (!exact) {
    GameHubWgiQaTopologyChanged(topology.epoch);
    return static_cast<DWORD>(FenceEvent::kRejected);
  }
  if (provider.physicalNeutral == 0) {
    ResetNeutralWindow();
    InterlockedExchange(&g_fence_phase,
                        static_cast<LONG>(FencePhase::kBlocked));
    return static_cast<DWORD>(FenceEvent::kApplied);
  }
  if (g_last_observation_set && now_ms < g_last_observation_ms) {
    ResetNeutralWindow();
  }
  g_last_observation_ms = now_ms;
  g_last_observation_set = true;
  if (!g_neutral_since_set) {
    g_neutral_since_ms = now_ms;
    g_neutral_since_set = true;
  }
  const LONG samples = InterlockedIncrement(&g_neutral_samples);
  InterlockedExchange(&g_fence_phase,
                      static_cast<LONG>(FencePhase::kDwelling));
  if (samples < static_cast<LONG>(kRequiredNeutralSamples) ||
      now_ms - g_neutral_since_ms < kRequiredNeutralMs) {
    return static_cast<DWORD>(FenceEvent::kApplied);
  }
  InterlockedExchange(&g_fence_phase,
                      static_cast<LONG>(FencePhase::kReleased));
  InterlockedExchange(&g_block_latched, 0);
  return static_cast<DWORD>(FenceEvent::kReleased);
}

extern "C" DWORD WINAPI GameHubWgiQaDetach() {
  if (InterlockedCompareExchange(&g_attached, 0, 0) == 0) return NO_ERROR;
  if (InterlockedCompareExchange(&g_block_latched, 0, 0) != 0) {
    return ERROR_BUSY;
  }
  const LONG error = DetachHooks();
  if (error == NO_ERROR) {
    InterlockedExchange(&g_attached, 0);
  } else {
    InterlockedExchange(&g_permanent_fault, 1);
    InterlockedExchange(&g_fence_phase,
                        static_cast<LONG>(FencePhase::kFault));
  }
  return static_cast<DWORD>(error);
}

extern "C" DWORD WINAPI GameHubWgiQaAttachLateForNegativeControl() {
  return static_cast<DWORD>(InterlockedCompareExchange(&g_attach_error, 0, 0));
}

extern "C" BOOL WINAPI GameHubWgiQaArmPausedReader(
    DWORD projection, HANDLE entered_event, HANDLE resume_event) {
  if (projection >= kProjectionCount || entered_event == nullptr ||
      resume_event == nullptr ||
      WaitForSingleObject(entered_event, 0) != WAIT_TIMEOUT ||
      WaitForSingleObject(resume_event, 0) != WAIT_TIMEOUT ||
      InterlockedCompareExchange(&g_pause_armed, 0, 0) != 0) {
    return FALSE;
  }
  g_pause_entered_event.store(reinterpret_cast<ULONG_PTR>(entered_event),
                              std::memory_order_release);
  g_pause_resume_event.store(reinterpret_cast<ULONG_PTR>(resume_event),
                             std::memory_order_release);
  InterlockedExchange(&g_pause_projection, static_cast<LONG>(projection));
  if (InterlockedCompareExchange(&g_pause_armed, 1, 0) != 0) {
    g_pause_entered_event.store(0, std::memory_order_release);
    g_pause_resume_event.store(0, std::memory_order_release);
    InterlockedExchange(&g_pause_projection, -1);
    return FALSE;
  }
  return TRUE;
}

extern "C" void WINAPI GameHubWgiQaTopologyChanged(
    unsigned long long epoch) {
  if (epoch == g_validated_epoch.load(std::memory_order_acquire)) return;
  InterlockedIncrement(&g_topology_invalidations);
  InterlockedExchange(&g_readiness_valid, 0);
  ResetNeutralWindow();
  InterlockedExchange(&g_fence_phase,
                      static_cast<LONG>(FencePhase::kInvalidated));
}

BOOL WINAPI DllMain(HINSTANCE instance, DWORD reason, LPVOID) {
  if (reason != DLL_PROCESS_ATTACH) return TRUE;
  DisableThreadLibraryCalls(instance);
  InitializeAndAttach();
  return TRUE;
}
