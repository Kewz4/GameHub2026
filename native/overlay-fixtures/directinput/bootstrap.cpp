// clang-format off: Windows types must be visible before the Detours header.
#include "contract.hpp"
#include <detours.h>
// clang-format on

#include <tlhelp32.h>

#include <array>
#include <cstring>

namespace {

using namespace gamehub::overlay::directinput_qa;

struct ObjectDescriptor {
  const GUID *guid = nullptr;
  DWORD offset = 0;
  DWORD type = 0;
  DWORD width = 0;
  LONG minimum = -1000;
  LONG maximum = 1000;
};

struct DeviceRecord {
  IDirectInputDevice8A *a = nullptr;
  IDirectInputDevice8W *w = nullptr;
  bool active = false;
  bool acquired = false;
  bool formatValid = false;
  bool unsupported = false;
  LONG trackedReferences = 0;
  FormatKind formatKind = FormatKind::kNone;
  DWORD formatFlags = 0;
  DWORD dataSize = 0;
  DWORD objectCount = 0;
  std::array<ObjectDescriptor, kMaxFormatObjects> objects{};
  std::array<GUID, kMaxFormatObjects> guids{};
};

std::array<DeviceRecord, kMaxTrackedDevices> g_devices{};
SRWLOCK g_registry_lock = SRWLOCK_INIT;
SRWLOCK g_command_lock = SRWLOCK_INIT;

DirectInput8CreateFunction g_true_factory = nullptr;
RootCreateAFunction g_true_root_create_a = nullptr;
RootCreateWFunction g_true_root_create_w = nullptr;
DeviceQueryAFunction g_true_query_a = nullptr;
DeviceQueryWFunction g_true_query_w = nullptr;
DeviceAddRefAFunction g_true_add_ref_a = nullptr;
DeviceAddRefWFunction g_true_add_ref_w = nullptr;
DeviceReleaseAFunction g_true_release_a = nullptr;
DeviceReleaseWFunction g_true_release_w = nullptr;
DeviceGetPropertyAFunction g_true_get_property_a = nullptr;
DeviceGetPropertyWFunction g_true_get_property_w = nullptr;
DeviceSetPropertyAFunction g_true_set_property_a = nullptr;
DeviceSetPropertyWFunction g_true_set_property_w = nullptr;
DeviceAcquireAFunction g_true_acquire_a = nullptr;
DeviceAcquireWFunction g_true_acquire_w = nullptr;
DeviceUnacquireAFunction g_true_unacquire_a = nullptr;
DeviceUnacquireWFunction g_true_unacquire_w = nullptr;
DeviceGetStateAFunction g_true_get_state_a = nullptr;
DeviceGetStateWFunction g_true_get_state_w = nullptr;
DeviceGetDataAFunction g_true_get_data_a = nullptr;
DeviceGetDataWFunction g_true_get_data_w = nullptr;
DeviceSetFormatAFunction g_true_set_format_a = nullptr;
DeviceSetFormatWFunction g_true_set_format_w = nullptr;
DeviceSetEventAFunction g_true_set_event_a = nullptr;
DeviceSetEventWFunction g_true_set_event_w = nullptr;
DeviceSetCoopAFunction g_true_set_coop_a = nullptr;
DeviceSetCoopWFunction g_true_set_coop_w = nullptr;
DevicePollAFunction g_true_poll_a = nullptr;
DevicePollWFunction g_true_poll_w = nullptr;
DeviceSetActionMapAFunction g_true_set_action_map_a = nullptr;
DeviceSetActionMapWFunction g_true_set_action_map_w = nullptr;

volatile LONG g_restore_after_with = 0;
volatile LONG g_cache_initialized = 0;
volatile LONG g_attached = 0;
volatile LONG g_attach_error = ERROR_INVALID_STATE;
volatile LONG g_exact_provider = 0;
volatile LONG g_exact_bodies = 0;
volatile LONG g_root_interfaces = 0;
volatile LONG g_ref_delta = 0;
volatile LONG g_unsupported_surface = 0;
volatile LONG g_block_latched = 0;
volatile LONG g_readiness_valid = 0;
volatile LONG g_fence_phase = static_cast<LONG>(FencePhase::kUnarmed);
volatile LONG g_fault_code = static_cast<LONG>(FaultCode::kNone);
volatile LONG g_neutral_samples = 0;
volatile LONG g_factory_calls = 0;
volatile LONG g_root_create_calls_a = 0;
volatile LONG g_root_create_calls_w = 0;
volatile LONG g_query_calls = 0;
volatile LONG g_add_ref_calls = 0;
volatile LONG g_release_calls = 0;
volatile LONG g_get_state_calls = 0;
volatile LONG g_get_data_calls = 0;
volatile LONG g_poll_calls = 0;
volatile LONG g_acquire_calls = 0;
volatile LONG g_unacquire_calls = 0;
volatile LONG g_set_format_calls = 0;
volatile LONG g_set_coop_calls = 0;
volatile LONG g_set_property_calls = 0;
volatile LONG g_set_event_calls = 0;
volatile LONG g_set_action_map_calls = 0;
volatile LONG g_neutral_probe_calls = 0;
volatile LONG g_drained_events = 0;
volatile LONG g_topology_invalidations = 0;
volatile LONG g_restore_failure = 0;
volatile LONG g_recovered_axis_ranges = 0;
volatile LONG g_rearm_calls = 0;
volatile LONG g_in_flight_hooks = 0;
volatile LONG g_peak_in_flight_hooks = 0;
volatile LONG g_detaching = 0;
volatile LONG g_detach_wait_loops = 0;
volatile LONG g_detach_quiesced = 0;
volatile LONG g_pause_hot_calls = 0;

DWORD g_generation = kGeneration;
unsigned long long g_topology_epoch = kTopologyEpoch;
unsigned long long g_neutral_since_ms = 0;
unsigned long long g_last_observation_ms = 0;
bool g_neutral_since_set = false;
bool g_last_observation_set = false;

class HookCallGuard {
public:
  HookCallGuard() noexcept {
    for (;;) {
      while (InterlockedCompareExchange(&g_detaching, 0, 0) != 0)
        SwitchToThread();
      const LONG current = InterlockedIncrement(&g_in_flight_hooks);
      if (InterlockedCompareExchange(&g_detaching, 0, 0) == 0) {
        LONG peak = InterlockedCompareExchange(&g_peak_in_flight_hooks, 0, 0);
        while (current > peak) {
          const LONG prior = InterlockedCompareExchange(&g_peak_in_flight_hooks,
                                                        current, peak);
          if (prior == peak)
            break;
          peak = prior;
        }
        while (InterlockedCompareExchange(&g_pause_hot_calls, 0, 0) != 0 &&
               InterlockedCompareExchange(&g_detaching, 0, 0) == 0) {
          SwitchToThread();
        }
        return;
      }
      InterlockedDecrement(&g_in_flight_hooks);
    }
  }

  ~HookCallGuard() { InterlockedDecrement(&g_in_flight_hooks); }

  HookCallGuard(const HookCallGuard &) = delete;
  HookCallGuard &operator=(const HookCallGuard &) = delete;
};

class RegistryExclusiveGuard {
public:
  RegistryExclusiveGuard() noexcept {
    AcquireSRWLockExclusive(&g_registry_lock);
  }
  ~RegistryExclusiveGuard() { ReleaseSRWLockExclusive(&g_registry_lock); }
  RegistryExclusiveGuard(const RegistryExclusiveGuard &) = delete;
  RegistryExclusiveGuard &operator=(const RegistryExclusiveGuard &) = delete;
};

class RegistrySharedGuard {
public:
  RegistrySharedGuard() noexcept { AcquireSRWLockShared(&g_registry_lock); }
  ~RegistrySharedGuard() { ReleaseSRWLockShared(&g_registry_lock); }
  RegistrySharedGuard(const RegistrySharedGuard &) = delete;
  RegistrySharedGuard &operator=(const RegistrySharedGuard &) = delete;
};

class CommandExclusiveGuard {
public:
  CommandExclusiveGuard() noexcept { AcquireSRWLockExclusive(&g_command_lock); }
  ~CommandExclusiveGuard() { ReleaseSRWLockExclusive(&g_command_lock); }
  CommandExclusiveGuard(const CommandExclusiveGuard &) = delete;
  CommandExclusiveGuard &operator=(const CommandExclusiveGuard &) = delete;
};

class CommandSharedGuard {
public:
  CommandSharedGuard() noexcept { AcquireSRWLockShared(&g_command_lock); }
  ~CommandSharedGuard() { ReleaseSRWLockShared(&g_command_lock); }
  CommandSharedGuard(const CommandSharedGuard &) = delete;
  CommandSharedGuard &operator=(const CommandSharedGuard &) = delete;
};

#define HOT_CALL_GUARDS()                                                      \
  HookCallGuard hook_call_guard;                                               \
  RegistryExclusiveGuard registry_guard

bool IdentityMatches(DWORD generation,
                     unsigned long long topology_epoch) noexcept {
  return generation == g_generation && topology_epoch == g_topology_epoch;
}

void ResetNeutralWindow() noexcept {
  InterlockedExchange(&g_neutral_samples, 0);
  g_neutral_since_ms = 0;
  g_last_observation_ms = 0;
  g_neutral_since_set = false;
  g_last_observation_set = false;
}

void MarkFault(FaultCode code) noexcept {
  InterlockedCompareExchange(&g_fault_code, static_cast<LONG>(code),
                             static_cast<LONG>(FaultCode::kNone));
  InterlockedExchange(&g_readiness_valid, 0);
  InterlockedExchange(&g_fence_phase, static_cast<LONG>(FencePhase::kFault));
}

DWORD PropertyId(REFGUID property) noexcept {
  const ULONG_PTR address = reinterpret_cast<ULONG_PTR>(&property);
  return address <= 0xffffu ? static_cast<DWORD>(address) : 0u;
}

DWORD ObjectWidth(DWORD type) noexcept {
  if ((type & DIDFT_BUTTON) != 0u)
    return sizeof(BYTE);
  if ((type & DIDFT_AXIS) != 0u || (type & DIDFT_POV) != 0u) {
    return sizeof(LONG);
  }
  return 0;
}

bool IsAxisGuid(REFGUID guid) noexcept {
  return IsEqualGUID(guid, GUID_XAxis) || IsEqualGUID(guid, GUID_YAxis) ||
         IsEqualGUID(guid, GUID_ZAxis) || IsEqualGUID(guid, GUID_RxAxis) ||
         IsEqualGUID(guid, GUID_RyAxis) || IsEqualGUID(guid, GUID_RzAxis) ||
         IsEqualGUID(guid, GUID_Slider);
}

bool IsKnownObject(const DIOBJECTDATAFORMAT &object) noexcept {
  if (object.pguid == nullptr)
    return false;
  if ((object.dwType & DIDFT_BUTTON) != 0u) {
    return IsEqualGUID(*object.pguid, GUID_Button) ||
           IsEqualGUID(*object.pguid, GUID_Key);
  }
  if ((object.dwType & DIDFT_POV) != 0u) {
    return IsEqualGUID(*object.pguid, GUID_POV);
  }
  return (object.dwType & DIDFT_AXIS) != 0u && IsAxisGuid(*object.pguid);
}

FormatKind IdentifyFormat(const DIDATAFORMAT *format) noexcept {
  if (format == GameHubSyntheticDiGetFormat(FormatKind::kKeyboard)) {
    return FormatKind::kKeyboard;
  }
  if (format == GameHubSyntheticDiGetFormat(FormatKind::kMouse)) {
    return FormatKind::kMouse;
  }
  if (format == GameHubSyntheticDiGetFormat(FormatKind::kMouse2)) {
    return FormatKind::kMouse2;
  }
  if (format == GameHubSyntheticDiGetFormat(FormatKind::kJoystick)) {
    return FormatKind::kJoystick;
  }
  if (format == GameHubSyntheticDiGetFormat(FormatKind::kJoystick2)) {
    return FormatKind::kJoystick2;
  }
  return FormatKind::kCustom;
}

DeviceRecord *FindA(IDirectInputDevice8A *device) noexcept {
  for (auto &record : g_devices) {
    if (record.active && record.a == device)
      return &record;
  }
  return nullptr;
}

DeviceRecord *FindW(IDirectInputDevice8W *device) noexcept {
  for (auto &record : g_devices) {
    if (record.active && record.w == device)
      return &record;
  }
  return nullptr;
}

DeviceRecord *AllocateRecord() noexcept {
  for (auto &record : g_devices) {
    if (!record.active) {
      record = {};
      record.active = true;
      return &record;
    }
  }
  MarkFault(FaultCode::kRegistryFull);
  return nullptr;
}

DeviceRecord *EnsureA(IDirectInputDevice8A *device) noexcept {
  if (device == nullptr)
    return nullptr;
  DeviceRecord *record = FindA(device);
  if (record != nullptr)
    return record;
  record = AllocateRecord();
  if (record != nullptr)
    record->a = device;
  return record;
}

DeviceRecord *EnsureW(IDirectInputDevice8W *device) noexcept {
  if (device == nullptr)
    return nullptr;
  DeviceRecord *record = FindW(device);
  if (record != nullptr)
    return record;
  record = AllocateRecord();
  if (record != nullptr)
    record->w = device;
  return record;
}

bool CopyFormat(DeviceRecord *record, const DIDATAFORMAT *candidate) noexcept {
  if (record == nullptr || candidate == nullptr ||
      candidate->dwSize != sizeof(DIDATAFORMAT) ||
      candidate->dwObjSize != sizeof(DIOBJECTDATAFORMAT) ||
      candidate->dwDataSize == 0 || candidate->dwDataSize > kMaxFormatBytes ||
      candidate->dwNumObjs == 0 || candidate->dwNumObjs > kMaxFormatObjects ||
      candidate->rgodf == nullptr ||
      (candidate->dwFlags != DIDF_ABSAXIS &&
       candidate->dwFlags != DIDF_RELAXIS)) {
    return false;
  }

  std::array<bool, kMaxFormatBytes> occupied{};
  for (DWORD index = 0; index < candidate->dwNumObjs; ++index) {
    const DIOBJECTDATAFORMAT &object = candidate->rgodf[index];
    const DWORD width = ObjectWidth(object.dwType);
    if (width == 0 || !IsKnownObject(object) ||
        object.dwOfs >= candidate->dwDataSize ||
        width > candidate->dwDataSize - object.dwOfs) {
      return false;
    }
    for (DWORD byte = 0; byte < width; ++byte) {
      if (occupied[object.dwOfs + byte])
        return false;
      occupied[object.dwOfs + byte] = true;
    }
  }

  record->formatKind = IdentifyFormat(candidate);
  record->formatFlags = candidate->dwFlags;
  record->dataSize = candidate->dwDataSize;
  record->objectCount = candidate->dwNumObjs;
  record->unsupported = false;
  for (DWORD index = 0; index < candidate->dwNumObjs; ++index) {
    record->guids[index] = *candidate->rgodf[index].pguid;
    record->objects[index].guid = &record->guids[index];
    record->objects[index].offset = candidate->rgodf[index].dwOfs;
    record->objects[index].type = candidate->rgodf[index].dwType;
    record->objects[index].width = ObjectWidth(candidate->rgodf[index].dwType);
    record->objects[index].minimum = -1000;
    record->objects[index].maximum = 1000;
  }
  record->formatValid = true;
  return true;
}

bool RecoverAxisRanges(DeviceRecord *record) noexcept {
  if (record == nullptr || !record->formatValid)
    return false;
  for (DWORD index = 0; index < record->objectCount; ++index) {
    ObjectDescriptor &object = record->objects[index];
    if ((object.type & DIDFT_AXIS) == 0u)
      continue;
    DIPROPRANGE range{};
    range.diph.dwSize = sizeof(range);
    range.diph.dwHeaderSize = sizeof(range.diph);
    range.diph.dwObj = object.offset;
    range.diph.dwHow = DIPH_BYOFFSET;
    HRESULT result = DIERR_GENERIC;
    if (record->a != nullptr) {
      result = g_true_get_property_a(record->a, DIPROP_RANGE,
                                     reinterpret_cast<DIPROPHEADER *>(&range));
    } else if (record->w != nullptr) {
      result = g_true_get_property_w(record->w, DIPROP_RANGE,
                                     reinterpret_cast<DIPROPHEADER *>(&range));
    }
    if (FAILED(result) || range.lMin >= range.lMax)
      return false;
    object.minimum = range.lMin;
    object.maximum = range.lMax;
    InterlockedIncrement(&g_recovered_axis_ranges);
  }
  return true;
}

bool RegistryValid() noexcept {
  DWORD count = 0;
  for (const auto &record : g_devices) {
    if (!record.active)
      continue;
    ++count;
    if (!record.formatValid || record.unsupported)
      return false;
  }
  return count >= 2u;
}

void RefreshReadiness() noexcept {
  const bool valid =
      InterlockedCompareExchange(&g_attached, 0, 0) == 1 &&
      InterlockedCompareExchange(&g_exact_provider, 0, 0) == 1 &&
      InterlockedCompareExchange(&g_exact_bodies, 0, 0) == 1 &&
      InterlockedCompareExchange(&g_unsupported_surface, 0, 0) == 0 &&
      InterlockedCompareExchange(&g_fault_code, 0, 0) ==
          static_cast<LONG>(FaultCode::kNone) &&
      RegistryValid();
  InterlockedExchange(&g_readiness_valid, valid ? 1 : 0);
}

void RegisterAlias(DeviceRecord *record, REFIID iid, void *output) noexcept {
  if (record == nullptr || output == nullptr) {
    MarkFault(FaultCode::kUnknownInterface);
    return;
  }
  if (IsEqualIID(iid, IID_IUnknown) ||
      IsEqualIID(iid, IID_IDirectInputDevice8A)) {
    auto *a = static_cast<IDirectInputDevice8A *>(output);
    if (record->a != nullptr && record->a != a) {
      MarkFault(FaultCode::kBodyTopology);
    } else {
      record->a = a;
    }
  } else if (IsEqualIID(iid, IID_IDirectInputDevice8W)) {
    auto *w = static_cast<IDirectInputDevice8W *>(output);
    if (record->w != nullptr && record->w != w) {
      MarkFault(FaultCode::kBodyTopology);
    } else {
      record->w = w;
    }
  }
}

bool Neutralize(DeviceRecord *record, DWORD bytes, void *output) noexcept {
  if (record == nullptr || !record->formatValid || output == nullptr ||
      bytes != record->dataSize) {
    return false;
  }
  auto *data = static_cast<unsigned char *>(output);
  for (DWORD index = 0; index < record->objectCount; ++index) {
    const ObjectDescriptor &object = record->objects[index];
    if ((object.type & DIDFT_BUTTON) != 0u) {
      data[object.offset] = 0;
    } else if ((object.type & DIDFT_POV) != 0u) {
      const DWORD neutral = 0xffffffffu;
      std::memcpy(data + object.offset, &neutral, sizeof(neutral));
    } else if ((object.type & DIDFT_AXIS) != 0u) {
      LONG neutral = 0;
      if (record->formatFlags == DIDF_ABSAXIS) {
        const long long minimum = object.minimum;
        const long long maximum = object.maximum;
        neutral = static_cast<LONG>(minimum + (maximum - minimum) / 2);
      }
      std::memcpy(data + object.offset, &neutral, sizeof(neutral));
    }
  }
  return true;
}

bool PayloadNeutral(const DeviceRecord &record,
                    const unsigned char *data) noexcept {
  for (DWORD index = 0; index < record.objectCount; ++index) {
    const ObjectDescriptor &object = record.objects[index];
    if ((object.type & DIDFT_BUTTON) != 0u) {
      if (data[object.offset] != 0u)
        return false;
    } else {
      DWORD value = 0;
      std::memcpy(&value, data + object.offset, sizeof(value));
      if ((object.type & DIDFT_POV) != 0u) {
        if (value != 0xffffffffu)
          return false;
      } else if (record.formatFlags == DIDF_ABSAXIS) {
        const long long minimum = object.minimum;
        const long long maximum = object.maximum;
        const LONG midpoint =
            static_cast<LONG>(minimum + (maximum - minimum) / 2);
        if (static_cast<LONG>(value) != midpoint)
          return false;
      } else if (value != 0u) {
        return false;
      }
    }
  }
  return true;
}

bool DrainRecord(DeviceRecord &record) noexcept {
  if (!record.active || !record.acquired)
    return true;
  DWORD count = INFINITE;
  HRESULT result = DIERR_GENERIC;
  if (record.a != nullptr) {
    result = g_true_get_data_a(record.a, sizeof(DIDEVICEOBJECTDATA), nullptr,
                               &count, 0);
  } else if (record.w != nullptr) {
    result = g_true_get_data_w(record.w, sizeof(DIDEVICEOBJECTDATA), nullptr,
                               &count, 0);
  }
  if (FAILED(result))
    return false;
  InterlockedExchangeAdd(&g_drained_events, static_cast<LONG>(count));
  return true;
}

bool DrainAll() noexcept {
  for (auto &record : g_devices) {
    if (!DrainRecord(record))
      return false;
  }
  return true;
}

bool ProbePhysicalNeutral() noexcept {
  ProviderSnapshot provider{};
  if (!GameHubDiQaGetProviderSnapshot(&provider, sizeof(provider)) ||
      provider.schemaVersion != kSchemaVersion ||
      provider.physicalNeutral != 1u || provider.queuedEvents != 0u) {
    return false;
  }
  std::array<unsigned char, kMaxFormatBytes> state{};
  for (auto &record : g_devices) {
    if (!record.active || !record.acquired)
      continue;
    state.fill(0xcc);
    HRESULT result = DIERR_GENERIC;
    if (record.a != nullptr) {
      result = g_true_get_state_a(record.a, record.dataSize, state.data());
    } else if (record.w != nullptr) {
      result = g_true_get_state_w(record.w, record.dataSize, state.data());
    }
    InterlockedIncrement(&g_neutral_probe_calls);
    if (FAILED(result) || !PayloadNeutral(record, state.data()))
      return false;
  }
  return true;
}

void InvalidateForNewDevice() noexcept {
  if (InterlockedCompareExchange(&g_block_latched, 0, 0) == 0)
    return;
  InterlockedIncrement(&g_topology_invalidations);
  InterlockedExchange(&g_readiness_valid, 0);
  InterlockedExchange(&g_fence_phase,
                      static_cast<LONG>(FencePhase::kInvalidated));
  ResetNeutralWindow();
}

HRESULT WINAPI HookFactory(HINSTANCE instance, DWORD version, REFIID iid,
                           void **output, IUnknown *outer) {
  HOT_CALL_GUARDS();
  InterlockedIncrement(&g_factory_calls);
  const HRESULT result = g_true_factory(instance, version, iid, output, outer);
  if (SUCCEEDED(result) && output != nullptr && *output != nullptr) {
    InterlockedIncrement(&g_root_interfaces);
  }
  return result;
}

HRESULT STDMETHODCALLTYPE HookRootCreateA(IDirectInput8A *self, REFGUID guid,
                                          IDirectInputDevice8A **output,
                                          IUnknown *outer) {
  HOT_CALL_GUARDS();
  InterlockedIncrement(&g_root_create_calls_a);
  const HRESULT result = g_true_root_create_a(self, guid, output, outer);
  if (SUCCEEDED(result) && output != nullptr && *output != nullptr) {
    DeviceRecord *record = EnsureA(*output);
    if (record != nullptr) {
      ++record->trackedReferences;
      InterlockedIncrement(&g_ref_delta);
    }
    InvalidateForNewDevice();
    RefreshReadiness();
  }
  return result;
}

HRESULT STDMETHODCALLTYPE HookRootCreateW(IDirectInput8W *self, REFGUID guid,
                                          IDirectInputDevice8W **output,
                                          IUnknown *outer) {
  HOT_CALL_GUARDS();
  InterlockedIncrement(&g_root_create_calls_w);
  const HRESULT result = g_true_root_create_w(self, guid, output, outer);
  if (SUCCEEDED(result) && output != nullptr && *output != nullptr) {
    DeviceRecord *record = EnsureW(*output);
    if (record != nullptr) {
      ++record->trackedReferences;
      InterlockedIncrement(&g_ref_delta);
    }
    InvalidateForNewDevice();
    RefreshReadiness();
  }
  return result;
}

HRESULT STDMETHODCALLTYPE HookQueryA(IDirectInputDevice8A *self, REFIID iid,
                                     void **output) {
  HOT_CALL_GUARDS();
  InterlockedIncrement(&g_query_calls);
  DeviceRecord *record = EnsureA(self);
  const HRESULT result = g_true_query_a(self, iid, output);
  if (SUCCEEDED(result) && output != nullptr && *output != nullptr) {
    RegisterAlias(record, iid, *output);
    if (record != nullptr) {
      ++record->trackedReferences;
      InterlockedIncrement(&g_ref_delta);
    }
  }
  return result;
}

HRESULT STDMETHODCALLTYPE HookQueryW(IDirectInputDevice8W *self, REFIID iid,
                                     void **output) {
  HOT_CALL_GUARDS();
  InterlockedIncrement(&g_query_calls);
  DeviceRecord *record = EnsureW(self);
  const HRESULT result = g_true_query_w(self, iid, output);
  if (SUCCEEDED(result) && output != nullptr && *output != nullptr) {
    RegisterAlias(record, iid, *output);
    if (record != nullptr) {
      ++record->trackedReferences;
      InterlockedIncrement(&g_ref_delta);
    }
  }
  return result;
}

ULONG STDMETHODCALLTYPE HookAddRefA(IDirectInputDevice8A *self) {
  HOT_CALL_GUARDS();
  InterlockedIncrement(&g_add_ref_calls);
  const ULONG result = g_true_add_ref_a(self);
  DeviceRecord *record = FindA(self);
  if (record == nullptr) {
    MarkFault(FaultCode::kUnknownInterface);
  } else {
    ++record->trackedReferences;
    InterlockedIncrement(&g_ref_delta);
  }
  return result;
}

ULONG STDMETHODCALLTYPE HookAddRefW(IDirectInputDevice8W *self) {
  HOT_CALL_GUARDS();
  InterlockedIncrement(&g_add_ref_calls);
  const ULONG result = g_true_add_ref_w(self);
  DeviceRecord *record = FindW(self);
  if (record == nullptr) {
    MarkFault(FaultCode::kUnknownInterface);
  } else {
    ++record->trackedReferences;
    InterlockedIncrement(&g_ref_delta);
  }
  return result;
}

void ConsumeTrackedReference(DeviceRecord *record) noexcept {
  if (record != nullptr && record->trackedReferences > 0) {
    --record->trackedReferences;
    InterlockedDecrement(&g_ref_delta);
  }
}

ULONG STDMETHODCALLTYPE HookReleaseA(IDirectInputDevice8A *self) {
  HOT_CALL_GUARDS();
  InterlockedIncrement(&g_release_calls);
  DeviceRecord *record = FindA(self);
  const ULONG remaining = g_true_release_a(self);
  ConsumeTrackedReference(record);
  if (remaining == 0 && record != nullptr)
    record->active = false;
  return remaining;
}

ULONG STDMETHODCALLTYPE HookReleaseW(IDirectInputDevice8W *self) {
  HOT_CALL_GUARDS();
  InterlockedIncrement(&g_release_calls);
  DeviceRecord *record = FindW(self);
  const ULONG remaining = g_true_release_w(self);
  ConsumeTrackedReference(record);
  if (remaining == 0 && record != nullptr)
    record->active = false;
  return remaining;
}

template <typename Interface, typename TrueFunction>
HRESULT HookGetProperty(Interface *self, REFGUID property, DIPROPHEADER *header,
                        TrueFunction function) {
  return function(self, property, header);
}

HRESULT STDMETHODCALLTYPE HookGetPropertyA(IDirectInputDevice8A *self,
                                           REFGUID property,
                                           DIPROPHEADER *header) {
  HOT_CALL_GUARDS();
  return HookGetProperty(self, property, header, g_true_get_property_a);
}

HRESULT STDMETHODCALLTYPE HookGetPropertyW(IDirectInputDevice8W *self,
                                           REFGUID property,
                                           DIPROPHEADER *header) {
  HOT_CALL_GUARDS();
  return HookGetProperty(self, property, header, g_true_get_property_w);
}

void UpdateRange(DeviceRecord *record, REFGUID property,
                 const DIPROPHEADER *header) noexcept {
  if (record == nullptr || header == nullptr || PropertyId(property) != 4u ||
      header->dwSize != sizeof(DIPROPRANGE) ||
      header->dwHeaderSize != sizeof(DIPROPHEADER) ||
      header->dwHow != DIPH_BYOFFSET) {
    return;
  }
  const auto *range = reinterpret_cast<const DIPROPRANGE *>(header);
  for (DWORD index = 0; index < record->objectCount; ++index) {
    ObjectDescriptor &object = record->objects[index];
    if (object.offset == header->dwObj && (object.type & DIDFT_AXIS) != 0u) {
      object.minimum = range->lMin;
      object.maximum = range->lMax;
      return;
    }
  }
}

HRESULT STDMETHODCALLTYPE HookSetPropertyA(IDirectInputDevice8A *self,
                                           REFGUID property,
                                           const DIPROPHEADER *header) {
  HOT_CALL_GUARDS();
  InterlockedIncrement(&g_set_property_calls);
  const HRESULT result = g_true_set_property_a(self, property, header);
  if (SUCCEEDED(result))
    UpdateRange(EnsureA(self), property, header);
  return result;
}

HRESULT STDMETHODCALLTYPE HookSetPropertyW(IDirectInputDevice8W *self,
                                           REFGUID property,
                                           const DIPROPHEADER *header) {
  HOT_CALL_GUARDS();
  InterlockedIncrement(&g_set_property_calls);
  const HRESULT result = g_true_set_property_w(self, property, header);
  if (SUCCEEDED(result))
    UpdateRange(EnsureW(self), property, header);
  return result;
}

HRESULT STDMETHODCALLTYPE HookAcquireA(IDirectInputDevice8A *self) {
  HOT_CALL_GUARDS();
  InterlockedIncrement(&g_acquire_calls);
  const HRESULT result = g_true_acquire_a(self);
  if (SUCCEEDED(result)) {
    DeviceRecord *record = EnsureA(self);
    if (record == nullptr) {
      g_true_unacquire_a(self);
      MarkFault(FaultCode::kRegistryFull);
      return DIERR_UNSUPPORTED;
    }
    record->acquired = true;
  }
  return result;
}

HRESULT STDMETHODCALLTYPE HookAcquireW(IDirectInputDevice8W *self) {
  HOT_CALL_GUARDS();
  InterlockedIncrement(&g_acquire_calls);
  const HRESULT result = g_true_acquire_w(self);
  if (SUCCEEDED(result)) {
    DeviceRecord *record = EnsureW(self);
    if (record == nullptr) {
      g_true_unacquire_w(self);
      MarkFault(FaultCode::kRegistryFull);
      return DIERR_UNSUPPORTED;
    }
    record->acquired = true;
  }
  return result;
}

HRESULT STDMETHODCALLTYPE HookUnacquireA(IDirectInputDevice8A *self) {
  HOT_CALL_GUARDS();
  InterlockedIncrement(&g_unacquire_calls);
  const HRESULT result = g_true_unacquire_a(self);
  if (SUCCEEDED(result)) {
    DeviceRecord *record = EnsureA(self);
    if (record == nullptr) {
      MarkFault(FaultCode::kRegistryFull);
      return DIERR_UNSUPPORTED;
    }
    record->acquired = false;
  }
  return result;
}

HRESULT STDMETHODCALLTYPE HookUnacquireW(IDirectInputDevice8W *self) {
  HOT_CALL_GUARDS();
  InterlockedIncrement(&g_unacquire_calls);
  const HRESULT result = g_true_unacquire_w(self);
  if (SUCCEEDED(result)) {
    DeviceRecord *record = EnsureW(self);
    if (record == nullptr) {
      MarkFault(FaultCode::kRegistryFull);
      return DIERR_UNSUPPORTED;
    }
    record->acquired = false;
  }
  return result;
}

template <typename Interface, typename TrueFunction>
HRESULT HookGetState(Interface *self, DWORD bytes, void *output,
                     DeviceRecord *record, TrueFunction function) {
  const HRESULT result = function(self, bytes, output);
  if (InterlockedCompareExchange(&g_block_latched, 0, 0) == 0 ||
      FAILED(result)) {
    return result;
  }
  if (!Neutralize(record, bytes, output)) {
    if (output != nullptr && bytes <= kMaxFormatBytes) {
      SecureZeroMemory(output, bytes);
    }
    MarkFault(FaultCode::kUnsupportedFormat);
    return DIERR_UNSUPPORTED;
  }
  return result;
}

HRESULT STDMETHODCALLTYPE HookGetStateA(IDirectInputDevice8A *self, DWORD bytes,
                                        void *output) {
  HOT_CALL_GUARDS();
  InterlockedIncrement(&g_get_state_calls);
  return HookGetState(self, bytes, output, FindA(self), g_true_get_state_a);
}

HRESULT STDMETHODCALLTYPE HookGetStateW(IDirectInputDevice8W *self, DWORD bytes,
                                        void *output) {
  HOT_CALL_GUARDS();
  InterlockedIncrement(&g_get_state_calls);
  return HookGetState(self, bytes, output, FindW(self), g_true_get_state_w);
}

template <typename Interface, typename TrueFunction>
HRESULT HookGetData(Interface *self, DWORD object_bytes,
                    DIDEVICEOBJECTDATA *events, DWORD *count, DWORD flags,
                    DeviceRecord *record, TrueFunction function) {
  if (InterlockedCompareExchange(&g_block_latched, 0, 0) == 0 ||
      count == nullptr || object_bytes != sizeof(DIDEVICEOBJECTDATA)) {
    return function(self, object_bytes, events, count, flags);
  }
  DWORD drained = INFINITE;
  const HRESULT result = function(self, object_bytes, nullptr, &drained, 0);
  if (FAILED(result)) {
    MarkFault(FaultCode::kDrainFailed);
    return result;
  }
  InterlockedExchangeAdd(&g_drained_events, static_cast<LONG>(drained));
  *count = 0;
  if (record == nullptr) {
    MarkFault(FaultCode::kUnknownInterface);
    return DIERR_UNSUPPORTED;
  }
  return DI_OK;
}

HRESULT STDMETHODCALLTYPE HookGetDataA(IDirectInputDevice8A *self,
                                       DWORD object_bytes,
                                       DIDEVICEOBJECTDATA *events, DWORD *count,
                                       DWORD flags) {
  HOT_CALL_GUARDS();
  InterlockedIncrement(&g_get_data_calls);
  return HookGetData(self, object_bytes, events, count, flags, FindA(self),
                     g_true_get_data_a);
}

HRESULT STDMETHODCALLTYPE HookGetDataW(IDirectInputDevice8W *self,
                                       DWORD object_bytes,
                                       DIDEVICEOBJECTDATA *events, DWORD *count,
                                       DWORD flags) {
  HOT_CALL_GUARDS();
  InterlockedIncrement(&g_get_data_calls);
  return HookGetData(self, object_bytes, events, count, flags, FindW(self),
                     g_true_get_data_w);
}

void AcceptOrFenceFormat(DeviceRecord *record,
                         const DIDATAFORMAT *format) noexcept {
  if (!CopyFormat(record, format)) {
    if (record != nullptr) {
      record->formatValid = false;
      record->unsupported = true;
    }
    InterlockedExchange(&g_unsupported_surface, 1);
    MarkFault(FaultCode::kUnsupportedFormat);
  }
  RefreshReadiness();
}

HRESULT STDMETHODCALLTYPE HookSetFormatA(IDirectInputDevice8A *self,
                                         const DIDATAFORMAT *format) {
  HOT_CALL_GUARDS();
  InterlockedIncrement(&g_set_format_calls);
  const HRESULT result = g_true_set_format_a(self, format);
  if (SUCCEEDED(result))
    AcceptOrFenceFormat(EnsureA(self), format);
  return result;
}

HRESULT STDMETHODCALLTYPE HookSetFormatW(IDirectInputDevice8W *self,
                                         const DIDATAFORMAT *format) {
  HOT_CALL_GUARDS();
  InterlockedIncrement(&g_set_format_calls);
  const HRESULT result = g_true_set_format_w(self, format);
  if (SUCCEEDED(result))
    AcceptOrFenceFormat(EnsureW(self), format);
  return result;
}

template <typename Interface, typename TrueFunction>
HRESULT HookSetEvent(Interface *self, HANDLE event_handle,
                     TrueFunction function) {
  const HRESULT result = function(self, event_handle);
  InterlockedExchange(&g_unsupported_surface, 1);
  MarkFault(FaultCode::kUnsupportedSurface);
  return result;
}

HRESULT STDMETHODCALLTYPE HookSetEventA(IDirectInputDevice8A *self,
                                        HANDLE event_handle) {
  HOT_CALL_GUARDS();
  InterlockedIncrement(&g_set_event_calls);
  return HookSetEvent(self, event_handle, g_true_set_event_a);
}

HRESULT STDMETHODCALLTYPE HookSetEventW(IDirectInputDevice8W *self,
                                        HANDLE event_handle) {
  HOT_CALL_GUARDS();
  InterlockedIncrement(&g_set_event_calls);
  return HookSetEvent(self, event_handle, g_true_set_event_w);
}

HRESULT STDMETHODCALLTYPE HookSetCoopA(IDirectInputDevice8A *self, HWND window,
                                       DWORD flags) {
  HOT_CALL_GUARDS();
  InterlockedIncrement(&g_set_coop_calls);
  return g_true_set_coop_a(self, window, flags);
}

HRESULT STDMETHODCALLTYPE HookSetCoopW(IDirectInputDevice8W *self, HWND window,
                                       DWORD flags) {
  HOT_CALL_GUARDS();
  InterlockedIncrement(&g_set_coop_calls);
  return g_true_set_coop_w(self, window, flags);
}

HRESULT STDMETHODCALLTYPE HookPollA(IDirectInputDevice8A *self) {
  HOT_CALL_GUARDS();
  InterlockedIncrement(&g_poll_calls);
  return g_true_poll_a(self);
}

HRESULT STDMETHODCALLTYPE HookPollW(IDirectInputDevice8W *self) {
  HOT_CALL_GUARDS();
  InterlockedIncrement(&g_poll_calls);
  return g_true_poll_w(self);
}

HRESULT STDMETHODCALLTYPE HookSetActionMapA(IDirectInputDevice8A *self,
                                            DIACTIONFORMATA *format,
                                            const char *user, DWORD flags) {
  HOT_CALL_GUARDS();
  InterlockedIncrement(&g_set_action_map_calls);
  const HRESULT result = g_true_set_action_map_a(self, format, user, flags);
  InterlockedExchange(&g_unsupported_surface, 1);
  MarkFault(FaultCode::kUnsupportedSurface);
  return result;
}

HRESULT STDMETHODCALLTYPE HookSetActionMapW(IDirectInputDevice8W *self,
                                            DIACTIONFORMATW *format,
                                            const wchar_t *user, DWORD flags) {
  HOT_CALL_GUARDS();
  InterlockedIncrement(&g_set_action_map_calls);
  const HRESULT result = g_true_set_action_map_w(self, format, user, flags);
  InterlockedExchange(&g_unsupported_surface, 1);
  MarkFault(FaultCode::kUnsupportedSurface);
  return result;
}

LONG AbortTransaction(LONG error) noexcept {
  DetourTransactionAbort();
  return error;
}

bool BeginDetachQuiescence() noexcept {
  InterlockedExchange(&g_detach_quiesced, 0);
  if (InterlockedCompareExchange(&g_detaching, 1, 0) != 0)
    return false;
  const ULONGLONG deadline = GetTickCount64() + 5000u;
  while (InterlockedCompareExchange(&g_in_flight_hooks, 0, 0) != 0) {
    InterlockedIncrement(&g_detach_wait_loops);
    if (GetTickCount64() >= deadline) {
      InterlockedExchange(&g_detaching, 0);
      return false;
    }
    SwitchToThread();
  }
  InterlockedExchange(&g_detach_quiesced, 1);
  return true;
}

class DetourThreadSet {
public:
  static constexpr std::size_t kCapacity = 256;

  ~DetourThreadSet() {
    for (std::size_t index = 0; index < count_; ++index)
      CloseHandle(handles_[index]);
  }

  LONG EnlistProcessThreads() noexcept {
    const DWORD process_id = GetCurrentProcessId();
    const DWORD current_thread_id = GetCurrentThreadId();
    HANDLE snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPTHREAD, 0);
    if (snapshot == INVALID_HANDLE_VALUE)
      return static_cast<LONG>(GetLastError());
    THREADENTRY32 entry{};
    entry.dwSize = sizeof(entry);
    BOOL has_entry = Thread32First(snapshot, &entry);
    while (has_entry) {
      if (entry.th32OwnerProcessID == process_id &&
          entry.th32ThreadID != current_thread_id) {
        if (count_ == handles_.size()) {
          CloseHandle(snapshot);
          return ERROR_TOO_MANY_TCBS;
        }
        HANDLE thread = OpenThread(THREAD_SUSPEND_RESUME | THREAD_GET_CONTEXT |
                                       THREAD_SET_CONTEXT,
                                   FALSE, entry.th32ThreadID);
        if (thread == nullptr) {
          const LONG error = static_cast<LONG>(GetLastError());
          CloseHandle(snapshot);
          return error;
        }
        const LONG error = DetourUpdateThread(thread);
        if (error != NO_ERROR) {
          CloseHandle(thread);
          CloseHandle(snapshot);
          return error;
        }
        handles_[count_++] = thread;
      }
      has_entry = Thread32Next(snapshot, &entry);
    }
    const LONG enumeration_error = static_cast<LONG>(GetLastError());
    CloseHandle(snapshot);
    return enumeration_error == ERROR_NO_MORE_FILES ? NO_ERROR
                                                    : enumeration_error;
  }

  DetourThreadSet(const DetourThreadSet &) = delete;
  DetourThreadSet &operator=(const DetourThreadSet &) = delete;
  DetourThreadSet() = default;

private:
  std::array<HANDLE, kCapacity> handles_{};
  std::size_t count_ = 0;
};

LONG AbortDetachTransaction(LONG error) noexcept {
  DetourTransactionAbort();
  InterlockedExchange(&g_detaching, 0);
  InterlockedExchange(&g_restore_failure, 1);
  MarkFault(FaultCode::kDetachFailed);
  return error;
}

bool AddressInModule(ULONG_PTR address, HMODULE module) noexcept {
  if (address == 0 || module == nullptr)
    return false;
  HMODULE resolved = nullptr;
  return GetModuleHandleExW(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS |
                                GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT,
                            reinterpret_cast<LPCWSTR>(address), &resolved) &&
         resolved == module;
}

bool ValidateCachedBodies(const CacheSnapshot &cache) noexcept {
  const std::array<ULONG_PTR, 31> bodies = {cache.factoryBody,
                                            cache.rootCreateBodyA,
                                            cache.rootCreateBodyW,
                                            cache.deviceQueryBodyA,
                                            cache.deviceQueryBodyW,
                                            cache.deviceAddRefBodyA,
                                            cache.deviceAddRefBodyW,
                                            cache.deviceReleaseBodyA,
                                            cache.deviceReleaseBodyW,
                                            cache.deviceGetPropertyBodyA,
                                            cache.deviceGetPropertyBodyW,
                                            cache.deviceSetPropertyBodyA,
                                            cache.deviceSetPropertyBodyW,
                                            cache.deviceAcquireBodyA,
                                            cache.deviceAcquireBodyW,
                                            cache.deviceUnacquireBodyA,
                                            cache.deviceUnacquireBodyW,
                                            cache.deviceGetStateBodyA,
                                            cache.deviceGetStateBodyW,
                                            cache.deviceGetDataBodyA,
                                            cache.deviceGetDataBodyW,
                                            cache.deviceSetFormatBodyA,
                                            cache.deviceSetFormatBodyW,
                                            cache.deviceSetEventBodyA,
                                            cache.deviceSetEventBodyW,
                                            cache.deviceSetCoopBodyA,
                                            cache.deviceSetCoopBodyW,
                                            cache.devicePollBodyA,
                                            cache.devicePollBodyW,
                                            cache.deviceSetActionMapBodyA,
                                            cache.deviceSetActionMapBodyW};
  HMODULE module = reinterpret_cast<HMODULE>(cache.providerModule);
  for (std::size_t index = 0; index < 31; ++index) {
    if (!AddressInModule(bodies[index], module))
      return false;
    for (std::size_t prior = 0; prior < index; ++prior) {
      if (bodies[index] == bodies[prior])
        return false;
    }
  }

  IDirectInput8A *root_a = GameHubDiQaGetRootA();
  IDirectInput8W *root_w = GameHubDiQaGetRootW();
  IDirectInputDevice8A *device_a = GameHubDiQaGetDeviceA();
  IDirectInputDevice8W *device_w = GameHubDiQaGetDeviceW();
  return reinterpret_cast<ULONG_PTR>(GetProcAddress(
             module, "DirectInput8Create")) == cache.factoryBody &&
         root_a != nullptr && root_w != nullptr && device_a != nullptr &&
         device_w != nullptr &&
         reinterpret_cast<ULONG_PTR>(root_a->lpVtbl->CreateDevice) ==
             cache.rootCreateBodyA &&
         reinterpret_cast<ULONG_PTR>(root_w->lpVtbl->CreateDevice) ==
             cache.rootCreateBodyW &&
         reinterpret_cast<ULONG_PTR>(device_a->lpVtbl->QueryInterface) ==
             cache.deviceQueryBodyA &&
         reinterpret_cast<ULONG_PTR>(device_w->lpVtbl->QueryInterface) ==
             cache.deviceQueryBodyW &&
         reinterpret_cast<ULONG_PTR>(device_a->lpVtbl->AddRef) ==
             cache.deviceAddRefBodyA &&
         reinterpret_cast<ULONG_PTR>(device_w->lpVtbl->AddRef) ==
             cache.deviceAddRefBodyW &&
         reinterpret_cast<ULONG_PTR>(device_a->lpVtbl->Release) ==
             cache.deviceReleaseBodyA &&
         reinterpret_cast<ULONG_PTR>(device_w->lpVtbl->Release) ==
             cache.deviceReleaseBodyW &&
         reinterpret_cast<ULONG_PTR>(device_a->lpVtbl->GetProperty) ==
             cache.deviceGetPropertyBodyA &&
         reinterpret_cast<ULONG_PTR>(device_w->lpVtbl->GetProperty) ==
             cache.deviceGetPropertyBodyW &&
         reinterpret_cast<ULONG_PTR>(device_a->lpVtbl->SetProperty) ==
             cache.deviceSetPropertyBodyA &&
         reinterpret_cast<ULONG_PTR>(device_w->lpVtbl->SetProperty) ==
             cache.deviceSetPropertyBodyW &&
         reinterpret_cast<ULONG_PTR>(device_a->lpVtbl->Acquire) ==
             cache.deviceAcquireBodyA &&
         reinterpret_cast<ULONG_PTR>(device_w->lpVtbl->Acquire) ==
             cache.deviceAcquireBodyW &&
         reinterpret_cast<ULONG_PTR>(device_a->lpVtbl->Unacquire) ==
             cache.deviceUnacquireBodyA &&
         reinterpret_cast<ULONG_PTR>(device_w->lpVtbl->Unacquire) ==
             cache.deviceUnacquireBodyW &&
         reinterpret_cast<ULONG_PTR>(device_a->lpVtbl->GetDeviceState) ==
             cache.deviceGetStateBodyA &&
         reinterpret_cast<ULONG_PTR>(device_w->lpVtbl->GetDeviceState) ==
             cache.deviceGetStateBodyW &&
         reinterpret_cast<ULONG_PTR>(device_a->lpVtbl->GetDeviceData) ==
             cache.deviceGetDataBodyA &&
         reinterpret_cast<ULONG_PTR>(device_w->lpVtbl->GetDeviceData) ==
             cache.deviceGetDataBodyW &&
         reinterpret_cast<ULONG_PTR>(device_a->lpVtbl->SetDataFormat) ==
             cache.deviceSetFormatBodyA &&
         reinterpret_cast<ULONG_PTR>(device_w->lpVtbl->SetDataFormat) ==
             cache.deviceSetFormatBodyW &&
         reinterpret_cast<ULONG_PTR>(device_a->lpVtbl->SetEventNotification) ==
             cache.deviceSetEventBodyA &&
         reinterpret_cast<ULONG_PTR>(device_w->lpVtbl->SetEventNotification) ==
             cache.deviceSetEventBodyW &&
         reinterpret_cast<ULONG_PTR>(device_a->lpVtbl->SetCooperativeLevel) ==
             cache.deviceSetCoopBodyA &&
         reinterpret_cast<ULONG_PTR>(device_w->lpVtbl->SetCooperativeLevel) ==
             cache.deviceSetCoopBodyW &&
         reinterpret_cast<ULONG_PTR>(device_a->lpVtbl->Poll) ==
             cache.devicePollBodyA &&
         reinterpret_cast<ULONG_PTR>(device_w->lpVtbl->Poll) ==
             cache.devicePollBodyW &&
         reinterpret_cast<ULONG_PTR>(device_a->lpVtbl->SetActionMap) ==
             cache.deviceSetActionMapBodyA &&
         reinterpret_cast<ULONG_PTR>(device_w->lpVtbl->SetActionMap) ==
             cache.deviceSetActionMapBodyW;
}

bool TopologyStillExact() noexcept {
  CacheSnapshot cache{};
  return GameHubDiQaGetCacheSnapshot(&cache, sizeof(cache)) &&
         cache.schemaVersion == kSchemaVersion &&
         cache.exactProviderResolved == 1u && ValidateCachedBodies(cache);
}

template <typename Function> Function Body(ULONG_PTR address) noexcept {
  return reinterpret_cast<Function>(address);
}

LONG AttachHooks() noexcept {
  CacheSnapshot cache{};
  if (!GameHubDiQaGetCacheSnapshot(&cache, sizeof(cache)) ||
      cache.schemaVersion != kSchemaVersion ||
      cache.initializedBeforeBootstrap != 1u ||
      cache.preAttachPhysicalObserved != 1u) {
    MarkFault(FaultCode::kCacheInvalid);
    return ERROR_INVALID_DATA;
  }
  InterlockedExchange(&g_cache_initialized, 1);
  const bool exact_provider =
      cache.exactProviderResolved == 1u && cache.providerModule != 0u &&
      reinterpret_cast<ULONG_PTR>(
          GetProcAddress(reinterpret_cast<HMODULE>(cache.providerModule),
                         "DirectInput8Create")) == cache.factoryBody;
  InterlockedExchange(&g_exact_provider, exact_provider ? 1 : 0);
  if (!exact_provider) {
    MarkFault(FaultCode::kProviderIdentity);
    return ERROR_INVALID_IMAGE_HASH;
  }
  const bool bodies_valid = ValidateCachedBodies(cache);
  InterlockedExchange(&g_exact_bodies, bodies_valid ? 1 : 0);
  if (!bodies_valid) {
    MarkFault(FaultCode::kBodyTopology);
    return ERROR_INVALID_ADDRESS;
  }

#define ASSIGN_TRUE(name, Field) name = Body<decltype(name)>(cache.Field)
  ASSIGN_TRUE(g_true_factory, factoryBody);
  ASSIGN_TRUE(g_true_root_create_a, rootCreateBodyA);
  ASSIGN_TRUE(g_true_root_create_w, rootCreateBodyW);
  ASSIGN_TRUE(g_true_query_a, deviceQueryBodyA);
  ASSIGN_TRUE(g_true_query_w, deviceQueryBodyW);
  ASSIGN_TRUE(g_true_add_ref_a, deviceAddRefBodyA);
  ASSIGN_TRUE(g_true_add_ref_w, deviceAddRefBodyW);
  ASSIGN_TRUE(g_true_release_a, deviceReleaseBodyA);
  ASSIGN_TRUE(g_true_release_w, deviceReleaseBodyW);
  ASSIGN_TRUE(g_true_get_property_a, deviceGetPropertyBodyA);
  ASSIGN_TRUE(g_true_get_property_w, deviceGetPropertyBodyW);
  ASSIGN_TRUE(g_true_set_property_a, deviceSetPropertyBodyA);
  ASSIGN_TRUE(g_true_set_property_w, deviceSetPropertyBodyW);
  ASSIGN_TRUE(g_true_acquire_a, deviceAcquireBodyA);
  ASSIGN_TRUE(g_true_acquire_w, deviceAcquireBodyW);
  ASSIGN_TRUE(g_true_unacquire_a, deviceUnacquireBodyA);
  ASSIGN_TRUE(g_true_unacquire_w, deviceUnacquireBodyW);
  ASSIGN_TRUE(g_true_get_state_a, deviceGetStateBodyA);
  ASSIGN_TRUE(g_true_get_state_w, deviceGetStateBodyW);
  ASSIGN_TRUE(g_true_get_data_a, deviceGetDataBodyA);
  ASSIGN_TRUE(g_true_get_data_w, deviceGetDataBodyW);
  ASSIGN_TRUE(g_true_set_format_a, deviceSetFormatBodyA);
  ASSIGN_TRUE(g_true_set_format_w, deviceSetFormatBodyW);
  ASSIGN_TRUE(g_true_set_event_a, deviceSetEventBodyA);
  ASSIGN_TRUE(g_true_set_event_w, deviceSetEventBodyW);
  ASSIGN_TRUE(g_true_set_coop_a, deviceSetCoopBodyA);
  ASSIGN_TRUE(g_true_set_coop_w, deviceSetCoopBodyW);
  ASSIGN_TRUE(g_true_poll_a, devicePollBodyA);
  ASSIGN_TRUE(g_true_poll_w, devicePollBodyW);
  ASSIGN_TRUE(g_true_set_action_map_a, deviceSetActionMapBodyA);
  ASSIGN_TRUE(g_true_set_action_map_w, deviceSetActionMapBodyW);
#undef ASSIGN_TRUE

  DeviceRecord *cached_a = EnsureA(GameHubDiQaGetDeviceA());
  DeviceRecord *cached_w = EnsureW(GameHubDiQaGetDeviceW());
  if (!CopyFormat(cached_a,
                  GameHubSyntheticDiGetFormat(FormatKind::kKeyboard)) ||
      !CopyFormat(cached_w,
                  GameHubSyntheticDiGetFormat(FormatKind::kJoystick2)) ||
      !RecoverAxisRanges(cached_a) || !RecoverAxisRanges(cached_w)) {
    MarkFault(FaultCode::kUnsupportedFormat);
    return ERROR_INVALID_DATA;
  }
  cached_a->acquired = true;
  cached_w->acquired = true;
  InterlockedExchange(&g_root_interfaces, 2);

  LONG error = DetourTransactionBegin();
  if (error != NO_ERROR)
    return error;
  error = DetourUpdateThread(GetCurrentThread());
  if (error != NO_ERROR)
    return AbortTransaction(error);
#define ATTACH(True, Hook)                                                     \
  error = DetourAttach(reinterpret_cast<PVOID *>(&(True)),                     \
                       reinterpret_cast<PVOID>(&(Hook)));                      \
  if (error != NO_ERROR)                                                       \
  return AbortTransaction(error)
  ATTACH(g_true_factory, HookFactory);
  ATTACH(g_true_root_create_a, HookRootCreateA);
  ATTACH(g_true_root_create_w, HookRootCreateW);
  ATTACH(g_true_query_a, HookQueryA);
  ATTACH(g_true_query_w, HookQueryW);
  ATTACH(g_true_add_ref_a, HookAddRefA);
  ATTACH(g_true_add_ref_w, HookAddRefW);
  ATTACH(g_true_release_a, HookReleaseA);
  ATTACH(g_true_release_w, HookReleaseW);
  ATTACH(g_true_get_property_a, HookGetPropertyA);
  ATTACH(g_true_get_property_w, HookGetPropertyW);
  ATTACH(g_true_set_property_a, HookSetPropertyA);
  ATTACH(g_true_set_property_w, HookSetPropertyW);
  ATTACH(g_true_acquire_a, HookAcquireA);
  ATTACH(g_true_acquire_w, HookAcquireW);
  ATTACH(g_true_unacquire_a, HookUnacquireA);
  ATTACH(g_true_unacquire_w, HookUnacquireW);
  ATTACH(g_true_get_state_a, HookGetStateA);
  ATTACH(g_true_get_state_w, HookGetStateW);
  ATTACH(g_true_get_data_a, HookGetDataA);
  ATTACH(g_true_get_data_w, HookGetDataW);
  ATTACH(g_true_set_format_a, HookSetFormatA);
  ATTACH(g_true_set_format_w, HookSetFormatW);
  ATTACH(g_true_set_event_a, HookSetEventA);
  ATTACH(g_true_set_event_w, HookSetEventW);
  ATTACH(g_true_set_coop_a, HookSetCoopA);
  ATTACH(g_true_set_coop_w, HookSetCoopW);
  ATTACH(g_true_poll_a, HookPollA);
  ATTACH(g_true_poll_w, HookPollW);
  ATTACH(g_true_set_action_map_a, HookSetActionMapA);
  ATTACH(g_true_set_action_map_w, HookSetActionMapW);
#undef ATTACH
  error = DetourTransactionCommit();
  if (error != NO_ERROR)
    return error;
  InterlockedExchange(&g_attached, 1);
  RefreshReadiness();
  return NO_ERROR;
}

LONG DetachHooks() noexcept {
  if (InterlockedCompareExchange(&g_attached, 0, 0) != 1 ||
      InterlockedCompareExchange(&g_block_latched, 0, 0) != 0 ||
      InterlockedCompareExchange(&g_ref_delta, 0, 0) != 0) {
    return ERROR_INVALID_STATE;
  }
  if (!BeginDetachQuiescence()) {
    InterlockedExchange(&g_restore_failure, 1);
    MarkFault(FaultCode::kDetachFailed);
    return WAIT_TIMEOUT;
  }
  LONG error = DetourTransactionBegin();
  if (error != NO_ERROR) {
    InterlockedExchange(&g_detaching, 0);
    InterlockedExchange(&g_restore_failure, 1);
    MarkFault(FaultCode::kDetachFailed);
    return error;
  }
  error = DetourUpdateThread(GetCurrentThread());
  if (error != NO_ERROR)
    return AbortDetachTransaction(error);
  DetourThreadSet thread_set;
  error = thread_set.EnlistProcessThreads();
  if (error != NO_ERROR)
    return AbortDetachTransaction(error);
#define DETACH(True, Hook)                                                     \
  error = DetourDetach(reinterpret_cast<PVOID *>(&(True)),                     \
                       reinterpret_cast<PVOID>(&(Hook)));                      \
  if (error != NO_ERROR)                                                       \
  return AbortDetachTransaction(error)
  DETACH(g_true_set_action_map_w, HookSetActionMapW);
  DETACH(g_true_set_action_map_a, HookSetActionMapA);
  DETACH(g_true_poll_w, HookPollW);
  DETACH(g_true_poll_a, HookPollA);
  DETACH(g_true_set_coop_w, HookSetCoopW);
  DETACH(g_true_set_coop_a, HookSetCoopA);
  DETACH(g_true_set_event_w, HookSetEventW);
  DETACH(g_true_set_event_a, HookSetEventA);
  DETACH(g_true_set_format_w, HookSetFormatW);
  DETACH(g_true_set_format_a, HookSetFormatA);
  DETACH(g_true_get_data_w, HookGetDataW);
  DETACH(g_true_get_data_a, HookGetDataA);
  DETACH(g_true_get_state_w, HookGetStateW);
  DETACH(g_true_get_state_a, HookGetStateA);
  DETACH(g_true_unacquire_w, HookUnacquireW);
  DETACH(g_true_unacquire_a, HookUnacquireA);
  DETACH(g_true_acquire_w, HookAcquireW);
  DETACH(g_true_acquire_a, HookAcquireA);
  DETACH(g_true_set_property_w, HookSetPropertyW);
  DETACH(g_true_set_property_a, HookSetPropertyA);
  DETACH(g_true_get_property_w, HookGetPropertyW);
  DETACH(g_true_get_property_a, HookGetPropertyA);
  DETACH(g_true_release_w, HookReleaseW);
  DETACH(g_true_release_a, HookReleaseA);
  DETACH(g_true_add_ref_w, HookAddRefW);
  DETACH(g_true_add_ref_a, HookAddRefA);
  DETACH(g_true_query_w, HookQueryW);
  DETACH(g_true_query_a, HookQueryA);
  DETACH(g_true_root_create_w, HookRootCreateW);
  DETACH(g_true_root_create_a, HookRootCreateA);
  DETACH(g_true_factory, HookFactory);
#undef DETACH
  error = DetourTransactionCommit();
  if (error == NO_ERROR) {
    InterlockedExchange(&g_attached, 0);
    InterlockedExchange(&g_readiness_valid, 0);
  } else {
    InterlockedExchange(&g_restore_failure, 1);
    MarkFault(FaultCode::kDetachFailed);
  }
  InterlockedExchange(&g_detaching, 0);
  return error;
}

DWORD ActiveDeviceObjects() noexcept {
  DWORD count = 0;
  for (const auto &record : g_devices) {
    if (record.active)
      ++count;
  }
  return count;
}

DWORD ActiveDeviceInterfaces() noexcept {
  DWORD count = 0;
  for (const auto &record : g_devices) {
    if (!record.active)
      continue;
    if (record.a != nullptr)
      ++count;
    if (record.w != nullptr)
      ++count;
  }
  return count;
}

} // namespace

extern "C" BOOL WINAPI GameHubDiQaGetBootstrapSnapshot(
    gamehub::overlay::directinput_qa::BootstrapSnapshot *output,
    DWORD output_size) {
  using gamehub::overlay::directinput_qa::BootstrapSnapshot;
  CommandSharedGuard command_guard;
  RegistrySharedGuard registry_guard;
  if (output == nullptr || output_size != sizeof(BootstrapSnapshot)) {
    SetLastError(ERROR_INSUFFICIENT_BUFFER);
    return FALSE;
  }
  output->structSize = sizeof(BootstrapSnapshot);
  output->schemaVersion = kSchemaVersion;
  output->restoreAfterWithSucceeded = static_cast<DWORD>(
      InterlockedCompareExchange(&g_restore_after_with, 0, 0));
  output->cacheInitializedBeforeAttach = static_cast<DWORD>(
      InterlockedCompareExchange(&g_cache_initialized, 0, 0));
  output->attachedBeforeEntry =
      static_cast<DWORD>(InterlockedCompareExchange(&g_attached, 0, 0));
  output->attachError = InterlockedCompareExchange(&g_attach_error, 0, 0);
  output->exactProviderValidated =
      static_cast<DWORD>(InterlockedCompareExchange(&g_exact_provider, 0, 0));
  output->exactBodiesValidated =
      static_cast<DWORD>(InterlockedCompareExchange(&g_exact_bodies, 0, 0));
  output->registeredRootInterfaces =
      static_cast<DWORD>(InterlockedCompareExchange(&g_root_interfaces, 0, 0));
  output->registeredDeviceInterfaces = ActiveDeviceInterfaces();
  output->registeredDeviceObjects = ActiveDeviceObjects();
  output->queryInterfaceBalanced =
      InterlockedCompareExchange(&g_ref_delta, 0, 0) == 0 ? 1u : 0u;
  output->formatRegistryValid = RegistryValid() ? 1u : 0u;
  output->unsupportedSurfaceObserved = static_cast<DWORD>(
      InterlockedCompareExchange(&g_unsupported_surface, 0, 0));
  output->blockLatched =
      static_cast<DWORD>(InterlockedCompareExchange(&g_block_latched, 0, 0));
  output->readinessValid =
      static_cast<DWORD>(InterlockedCompareExchange(&g_readiness_valid, 0, 0));
  output->generation = g_generation;
  output->topologyEpoch = g_topology_epoch;
  output->fencePhase =
      static_cast<DWORD>(InterlockedCompareExchange(&g_fence_phase, 0, 0));
  output->faultCode =
      static_cast<DWORD>(InterlockedCompareExchange(&g_fault_code, 0, 0));
  output->neutralSamples =
      static_cast<DWORD>(InterlockedCompareExchange(&g_neutral_samples, 0, 0));
  output->neutralSinceMs = g_neutral_since_ms;
#define SNAPSHOT_COUNTER(Field, Variable)                                      \
  output->Field =                                                              \
      static_cast<DWORD>(InterlockedCompareExchange(&(Variable), 0, 0))
  SNAPSHOT_COUNTER(factoryHookCalls, g_factory_calls);
  SNAPSHOT_COUNTER(rootCreateHookCallsA, g_root_create_calls_a);
  SNAPSHOT_COUNTER(rootCreateHookCallsW, g_root_create_calls_w);
  SNAPSHOT_COUNTER(queryHookCalls, g_query_calls);
  SNAPSHOT_COUNTER(addRefHookCalls, g_add_ref_calls);
  SNAPSHOT_COUNTER(releaseHookCalls, g_release_calls);
  SNAPSHOT_COUNTER(getStateHookCalls, g_get_state_calls);
  SNAPSHOT_COUNTER(getDataHookCalls, g_get_data_calls);
  SNAPSHOT_COUNTER(pollHookCalls, g_poll_calls);
  SNAPSHOT_COUNTER(acquireHookCalls, g_acquire_calls);
  SNAPSHOT_COUNTER(unacquireHookCalls, g_unacquire_calls);
  SNAPSHOT_COUNTER(setFormatHookCalls, g_set_format_calls);
  SNAPSHOT_COUNTER(setCoopHookCalls, g_set_coop_calls);
  SNAPSHOT_COUNTER(setPropertyHookCalls, g_set_property_calls);
  SNAPSHOT_COUNTER(setEventHookCalls, g_set_event_calls);
  SNAPSHOT_COUNTER(setActionMapHookCalls, g_set_action_map_calls);
  SNAPSHOT_COUNTER(neutralProbeCalls, g_neutral_probe_calls);
  SNAPSHOT_COUNTER(drainedEvents, g_drained_events);
  SNAPSHOT_COUNTER(topologyInvalidations, g_topology_invalidations);
  SNAPSHOT_COUNTER(restoreFailurePermanent, g_restore_failure);
  SNAPSHOT_COUNTER(recoveredAxisRanges, g_recovered_axis_ranges);
  SNAPSHOT_COUNTER(rearmCalls, g_rearm_calls);
  SNAPSHOT_COUNTER(inFlightHookCalls, g_in_flight_hooks);
  SNAPSHOT_COUNTER(peakInFlightHookCalls, g_peak_in_flight_hooks);
  SNAPSHOT_COUNTER(detachWaitLoops, g_detach_wait_loops);
  SNAPSHOT_COUNTER(detachQuiesced, g_detach_quiesced);
#undef SNAPSHOT_COUNTER
  return TRUE;
}

extern "C" DWORD WINAPI
GameHubDiQaBeginBlock(DWORD generation, unsigned long long topology_epoch) {
  CommandExclusiveGuard command_guard;
  RegistryExclusiveGuard registry_guard;
  if (!IdentityMatches(generation, topology_epoch)) {
    return static_cast<DWORD>(FenceEvent::kIgnoredStale);
  }
  RefreshReadiness();
  if (!TopologyStillExact()) {
    MarkFault(FaultCode::kBodyTopology);
    return static_cast<DWORD>(FenceEvent::kRejected);
  }
  if (InterlockedCompareExchange(&g_readiness_valid, 0, 0) != 1 ||
      InterlockedCompareExchange(&g_fence_phase, 0, 0) !=
          static_cast<LONG>(FencePhase::kUnarmed)) {
    return static_cast<DWORD>(FenceEvent::kRejected);
  }
  InterlockedExchange(&g_block_latched, 1);
  if (!DrainAll()) {
    MarkFault(FaultCode::kDrainFailed);
    return static_cast<DWORD>(FenceEvent::kRejected);
  }
  ResetNeutralWindow();
  InterlockedExchange(&g_fence_phase, static_cast<LONG>(FencePhase::kBlocked));
  return static_cast<DWORD>(FenceEvent::kApplied);
}

extern "C" DWORD WINAPI
GameHubDiQaRequestClose(DWORD generation, unsigned long long topology_epoch) {
  CommandExclusiveGuard command_guard;
  RegistryExclusiveGuard registry_guard;
  if (!IdentityMatches(generation, topology_epoch)) {
    return static_cast<DWORD>(FenceEvent::kIgnoredStale);
  }
  const LONG phase = InterlockedCompareExchange(&g_fence_phase, 0, 0);
  if (phase == static_cast<LONG>(FencePhase::kClosing)) {
    return static_cast<DWORD>(FenceEvent::kApplied);
  }
  if (phase != static_cast<LONG>(FencePhase::kBlocked) ||
      InterlockedCompareExchange(&g_block_latched, 0, 0) != 1) {
    return static_cast<DWORD>(FenceEvent::kRejected);
  }
  ResetNeutralWindow();
  InterlockedExchange(&g_fence_phase, static_cast<LONG>(FencePhase::kClosing));
  return static_cast<DWORD>(FenceEvent::kApplied);
}

extern "C" DWORD WINAPI
GameHubDiQaObserveRelease(DWORD generation, unsigned long long topology_epoch,
                          unsigned long long now_ms) {
  CommandExclusiveGuard command_guard;
  RegistryExclusiveGuard registry_guard;
  if (!IdentityMatches(generation, topology_epoch)) {
    return static_cast<DWORD>(FenceEvent::kIgnoredStale);
  }
  if (InterlockedCompareExchange(&g_fence_phase, 0, 0) !=
          static_cast<LONG>(FencePhase::kClosing) ||
      InterlockedCompareExchange(&g_block_latched, 0, 0) != 1) {
    return static_cast<DWORD>(FenceEvent::kRejected);
  }
  if (g_last_observation_set && now_ms < g_last_observation_ms) {
    ResetNeutralWindow();
  }
  g_last_observation_ms = now_ms;
  g_last_observation_set = true;
  if (!DrainAll()) {
    MarkFault(FaultCode::kDrainFailed);
    return static_cast<DWORD>(FenceEvent::kRejected);
  }
  if (!ProbePhysicalNeutral()) {
    ResetNeutralWindow();
    return static_cast<DWORD>(FenceEvent::kApplied);
  }
  if (!g_neutral_since_set) {
    g_neutral_since_ms = now_ms;
    g_neutral_since_set = true;
  }
  const DWORD samples =
      static_cast<DWORD>(InterlockedIncrement(&g_neutral_samples));
  if (samples < kRequiredNeutralSamples ||
      now_ms - g_neutral_since_ms < kRequiredNeutralMs) {
    return static_cast<DWORD>(FenceEvent::kApplied);
  }
  if (!DrainAll()) {
    MarkFault(FaultCode::kDrainFailed);
    return static_cast<DWORD>(FenceEvent::kRejected);
  }
  InterlockedExchange(&g_fence_phase, static_cast<LONG>(FencePhase::kReleased));
  InterlockedExchange(&g_block_latched, 0);
  return static_cast<DWORD>(FenceEvent::kReleased);
}

extern "C" DWORD WINAPI GameHubDiQaInvalidateTopology(
    DWORD generation, unsigned long long topology_epoch) {
  CommandExclusiveGuard command_guard;
  RegistryExclusiveGuard registry_guard;
  if (!IdentityMatches(generation, topology_epoch)) {
    return static_cast<DWORD>(FenceEvent::kIgnoredStale);
  }
  if (InterlockedCompareExchange(&g_block_latched, 0, 0) != 1) {
    return static_cast<DWORD>(FenceEvent::kRejected);
  }
  InterlockedIncrement(&g_topology_invalidations);
  InterlockedExchange(&g_readiness_valid, 0);
  InterlockedExchange(&g_fence_phase,
                      static_cast<LONG>(FencePhase::kInvalidated));
  ResetNeutralWindow();
  return static_cast<DWORD>(FenceEvent::kApplied);
}

extern "C" DWORD WINAPI
GameHubDiQaRevalidate(DWORD generation, unsigned long long topology_epoch) {
  CommandExclusiveGuard command_guard;
  RegistryExclusiveGuard registry_guard;
  if (generation != g_generation || topology_epoch <= g_topology_epoch) {
    return static_cast<DWORD>(FenceEvent::kIgnoredStale);
  }
  if (InterlockedCompareExchange(&g_fence_phase, 0, 0) !=
          static_cast<LONG>(FencePhase::kInvalidated) ||
      InterlockedCompareExchange(&g_block_latched, 0, 0) != 1 ||
      InterlockedCompareExchange(&g_unsupported_surface, 0, 0) != 0 ||
      !RegistryValid() || !TopologyStillExact()) {
    return static_cast<DWORD>(FenceEvent::kRejected);
  }
  g_topology_epoch = topology_epoch;
  ResetNeutralWindow();
  InterlockedExchange(&g_readiness_valid, 1);
  InterlockedExchange(&g_fence_phase, static_cast<LONG>(FencePhase::kBlocked));
  return static_cast<DWORD>(FenceEvent::kApplied);
}

extern "C" DWORD WINAPI GameHubDiQaRearm(
    DWORD completed_generation, unsigned long long completed_topology_epoch,
    DWORD new_generation, unsigned long long new_topology_epoch,
    unsigned long long authorization) {
  CommandExclusiveGuard command_guard;
  RegistryExclusiveGuard registry_guard;
  InterlockedIncrement(&g_rearm_calls);
  if (authorization != kRearmAuthorization) {
    return static_cast<DWORD>(FenceEvent::kRejected);
  }
  if (!IdentityMatches(completed_generation, completed_topology_epoch)) {
    return static_cast<DWORD>(FenceEvent::kIgnoredStale);
  }
  if (completed_generation == MAXDWORD || completed_topology_epoch == ~0ull ||
      new_generation != completed_generation + 1u ||
      new_topology_epoch != completed_topology_epoch + 1u ||
      InterlockedCompareExchange(&g_fence_phase, 0, 0) !=
          static_cast<LONG>(FencePhase::kReleased) ||
      InterlockedCompareExchange(&g_block_latched, 0, 0) != 0 ||
      InterlockedCompareExchange(&g_attached, 0, 0) != 1 ||
      InterlockedCompareExchange(&g_fault_code, 0, 0) !=
          static_cast<LONG>(FaultCode::kNone) ||
      InterlockedCompareExchange(&g_unsupported_surface, 0, 0) != 0 ||
      InterlockedCompareExchange(&g_ref_delta, 0, 0) != 0 || !RegistryValid() ||
      !TopologyStillExact()) {
    return static_cast<DWORD>(FenceEvent::kRejected);
  }
  g_generation = new_generation;
  g_topology_epoch = new_topology_epoch;
  ResetNeutralWindow();
  InterlockedExchange(&g_fence_phase, static_cast<LONG>(FencePhase::kUnarmed));
  RefreshReadiness();
  return InterlockedCompareExchange(&g_readiness_valid, 0, 0) == 1
             ? static_cast<DWORD>(FenceEvent::kApplied)
             : static_cast<DWORD>(FenceEvent::kRejected);
}

extern "C" DWORD WINAPI GameHubDiQaDetach() {
  CommandExclusiveGuard command_guard;
  return static_cast<DWORD>(DetachHooks());
}

extern "C" DWORD WINAPI GameHubDiQaAttachLateForNegativeControl() {
  CommandExclusiveGuard command_guard;
  RegistryExclusiveGuard registry_guard;
  if (InterlockedCompareExchange(&g_attached, 0, 0) != 0) {
    return ERROR_ALREADY_INITIALIZED;
  }
  const LONG error = AttachHooks();
  InterlockedExchange(&g_attach_error, error);
  return static_cast<DWORD>(error);
}

extern "C" BOOL WINAPI GameHubDiQaSetHotCallPauseForStress(BOOL pause) {
  CommandExclusiveGuard command_guard;
  InterlockedExchange(&g_pause_hot_calls, pause ? 1 : 0);
  return TRUE;
}

BOOL WINAPI DllMain(HINSTANCE instance, DWORD reason, LPVOID reserved) {
  if (DetourIsHelperProcess())
    return TRUE;
  if (reason == DLL_PROCESS_ATTACH) {
    const BOOL restored = DetourRestoreAfterWith();
    InterlockedExchange(&g_restore_after_with, restored ? 1 : 0);
    DisableThreadLibraryCalls(instance);
    const LONG error = restored
                           ? AttachHooks()
                           : static_cast<LONG>(GetLastError() == ERROR_SUCCESS
                                                   ? ERROR_INVALID_STATE
                                                   : GetLastError());
    InterlockedExchange(&g_attach_error, error);
  }
  (void)reserved;
  return TRUE;
}
