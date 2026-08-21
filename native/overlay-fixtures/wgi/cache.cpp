#define GAMEHUB_WGI_CACHE_EXPORTS
#include "contract.hpp"

#include <array>
#include <cstring>

namespace {

using namespace gamehub::overlay::wgi_qa;

constexpr const wchar_t* kRuntimeClasses[kProjectionCount] = {
    L"Windows.Gaming.Input.Gamepad",
    L"Windows.Gaming.Input.RawGameController",
    L"Windows.Gaming.Input.RacingWheel",
    L"Windows.Gaming.Input.FlightStick",
    L"Windows.Gaming.Input.ArcadeStick",
    L"Windows.Gaming.Input.UINavigationController"};

constexpr DWORD kReadingSlots[kProjectionCount] = {
    kGamepadReadingSlot, kRawReadingSlot,    kRacingReadingSlot,
    kFlightReadingSlot,  kArcadeReadingSlot, kUiReadingSlot};

CacheSnapshot g_snapshot{};
Topology g_topology{};
RoGetActivationFactoryFunction g_ro_get_activation_factory = nullptr;
GamepadReadingFunction g_gamepad_reading = nullptr;
RawReadingFunction g_raw_reading = nullptr;
RacingReadingFunction g_racing_reading = nullptr;
FlightReadingFunction g_flight_reading = nullptr;
ArcadeReadingFunction g_arcade_reading = nullptr;
UiReadingFunction g_ui_reading = nullptr;

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

bool Same(double left, double right) noexcept {
  return left == right;
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

bool ValidateObjects(const Topology& topology, CacheSnapshot* snapshot) {
  std::array<IUnknown*, kProjectionCount> controlling{};
  bool vtables = true;
  bool round_tripped = true;
  bool identities = true;

  for (DWORD index = 0; index < kProjectionCount; ++index) {
    void* object = reinterpret_cast<void*>(topology.objects[index]);
    void* body = PollingBody(object, index);
    if (body == nullptr || !IsExecutable(body)) {
      vtables = false;
      break;
    }

    auto* inspectable = reinterpret_cast<IInspectable*>(object);
    IUnknown* unknown = nullptr;
    void* same_interface = nullptr;
    IInspectable* inspectable_round_trip = nullptr;
    const HRESULT unknown_result =
        inspectable->QueryInterface(IID_PPV_ARGS(&unknown));
    const HRESULT interface_result =
        inspectable->QueryInterface(ProjectionIid(index), &same_interface);
    const HRESULT inspectable_result =
        inspectable->QueryInterface(IID_PPV_ARGS(&inspectable_round_trip));
    if (FAILED(unknown_result) || unknown == nullptr ||
        FAILED(interface_result) || same_interface != object ||
        FAILED(inspectable_result) || inspectable_round_trip == nullptr) {
      round_tripped = false;
    }
    if (unknown != nullptr) controlling[index] = unknown;
    if (same_interface != nullptr) {
      reinterpret_cast<IUnknown*>(same_interface)->Release();
    }
    if (inspectable_round_trip != nullptr) inspectable_round_trip->Release();
  }

  if (!vtables || !round_tripped) {
    for (IUnknown* value : controlling) {
      if (value != nullptr) value->Release();
    }
    snapshot->allObjectsHadVtables = vtables ? 1u : 0u;
    snapshot->exactInterfacesRoundTripped = round_tripped ? 1u : 0u;
    return false;
  }

  identities = controlling[0] != nullptr && controlling[1] != nullptr &&
               controlling[0] == controlling[1];
  bool other_distinct = identities;
  for (DWORD index = 2; index < kProjectionCount; ++index) {
    other_distinct = other_distinct && controlling[index] != nullptr;
    for (DWORD prior = 0; prior < index; ++prior) {
      other_distinct = other_distinct && controlling[index] != controlling[prior];
    }
  }

  snapshot->allObjectsHadVtables = 1;
  snapshot->exactInterfacesRoundTripped = 1;
  snapshot->controllingUnknownsValid = identities && other_distinct ? 1u : 0u;
  snapshot->gamepadRawSharedIdentity = identities ? 1u : 0u;
  snapshot->otherIdentitiesDistinct = other_distinct ? 1u : 0u;
  for (IUnknown* value : controlling) {
    if (value != nullptr) value->Release();
  }
  return identities && other_distinct;
}

bool CacheBodies(const Topology& topology) noexcept {
  g_gamepad_reading = reinterpret_cast<GamepadReadingFunction>(
      PollingBody(reinterpret_cast<void*>(topology.objects[0]), 0));
  g_raw_reading = reinterpret_cast<RawReadingFunction>(
      PollingBody(reinterpret_cast<void*>(topology.objects[1]), 1));
  g_racing_reading = reinterpret_cast<RacingReadingFunction>(
      PollingBody(reinterpret_cast<void*>(topology.objects[2]), 2));
  g_flight_reading = reinterpret_cast<FlightReadingFunction>(
      PollingBody(reinterpret_cast<void*>(topology.objects[3]), 3));
  g_arcade_reading = reinterpret_cast<ArcadeReadingFunction>(
      PollingBody(reinterpret_cast<void*>(topology.objects[4]), 4));
  g_ui_reading = reinterpret_cast<UiReadingFunction>(
      PollingBody(reinterpret_cast<void*>(topology.objects[5]), 5));
  return g_gamepad_reading != nullptr && g_raw_reading != nullptr &&
         g_racing_reading != nullptr && g_flight_reading != nullptr &&
         g_arcade_reading != nullptr && g_ui_reading != nullptr;
}

bool ValidateRawSchema(const Topology& topology) noexcept {
  constexpr double expected[kRawAxes] = {0.5, 0.5, 0.5, 0.5, 0.0, 0.0};
  if (topology.rawButtonCount != kRawButtons ||
      topology.rawSwitchCount != kRawSwitches ||
      topology.rawAxisCount != kRawAxes) {
    return false;
  }
  for (DWORD index = 0; index < kRawAxes; ++index) {
    if (!Same(topology.rawNeutralAxes[index], expected[index])) return false;
  }
  return true;
}

bool ActivateBeforeBootstrap() {
  for (DWORD index = 0; index < kProjectionCount; ++index) {
    HSTRING_HEADER header{};
    HSTRING runtime_class = nullptr;
    const UINT32 length = static_cast<UINT32>(wcslen(kRuntimeClasses[index]));
    if (FAILED(WindowsCreateStringReference(kRuntimeClasses[index], length,
                                            &header, &runtime_class))) {
      return false;
    }
    IInspectable* factory = nullptr;
    if (FAILED(g_ro_get_activation_factory(
            runtime_class, __uuidof(IInspectable),
            reinterpret_cast<void**>(&factory))) ||
        factory == nullptr) {
      return false;
    }
    factory->Release();
  }
  return true;
}

bool PollPhysicalBeforeBootstrap(const Topology& topology) {
  abi::GamepadReading gamepad{};
  abi::RacingWheelReading racing{};
  abi::FlightStickReading flight{};
  abi::ArcadeStickReading arcade{};
  abi::UINavigationReading ui{};
  boolean buttons[kRawButtons]{};
  abi::GameControllerSwitchPosition switches[kRawSwitches]{};
  DOUBLE axes[kRawAxes]{};
  UINT64 timestamp = 0;

  const bool succeeded =
      SUCCEEDED(g_gamepad_reading(
          reinterpret_cast<abi::IGamepad*>(topology.objects[0]), &gamepad)) &&
      SUCCEEDED(g_raw_reading(
          reinterpret_cast<abi::IRawGameController*>(topology.objects[1]),
          kRawButtons, buttons, kRawSwitches, switches, kRawAxes, axes,
          &timestamp)) &&
      SUCCEEDED(g_racing_reading(
          reinterpret_cast<abi::IRacingWheel*>(topology.objects[2]),
          &racing)) &&
      SUCCEEDED(g_flight_reading(
          reinterpret_cast<abi::IFlightStick*>(topology.objects[3]),
          &flight)) &&
      SUCCEEDED(g_arcade_reading(
          reinterpret_cast<abi::IArcadeStick*>(topology.objects[4]),
          &arcade)) &&
      SUCCEEDED(g_ui_reading(
          reinterpret_cast<abi::IUINavigationController*>(topology.objects[5]),
          &ui));
  if (!succeeded) return false;

  return gamepad.Timestamp == 1'001 &&
         static_cast<DWORD>(gamepad.Buttons) == 0x1001u &&
         Same(gamepad.LeftTrigger, 0.75) && Same(gamepad.RightTrigger, 0.25) &&
         Same(gamepad.LeftThumbstickX, -0.5) &&
         Same(gamepad.LeftThumbstickY, 0.6) &&
         Same(gamepad.RightThumbstickX, 0.7) &&
         Same(gamepad.RightThumbstickY, -0.8) && timestamp == 2'002 &&
         buttons[0] && buttons[4] &&
         static_cast<DWORD>(switches[0]) == 1u && Same(axes[0], 0.25) &&
         Same(axes[1], 0.8) && Same(axes[2], 0.85) && Same(axes[3], 0.1) &&
         Same(axes[4], 0.75) && Same(axes[5], 0.25) &&
         racing.Timestamp == 3'003 && racing.Buttons != 0 &&
         flight.Timestamp == 4'004 && flight.Buttons != 0 &&
         arcade.Timestamp == 5'005 && arcade.Buttons != 0 &&
         ui.Timestamp == 6'006 && ui.RequiredButtons != 0;
}

bool InitializeBeforeBootstrap() {
  g_snapshot = {};
  g_snapshot.structSize = sizeof(g_snapshot);
  g_snapshot.schemaVersion = kSchemaVersion;

  HMODULE provider = nullptr;
  if (!GetModuleHandleExW(
          GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS |
              GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT,
          reinterpret_cast<LPCWSTR>(&GameHubSyntheticWgiGetTopology),
          &provider) ||
      provider == nullptr) {
    return false;
  }
  g_ro_get_activation_factory =
      reinterpret_cast<RoGetActivationFactoryFunction>(
          GetProcAddress(provider, "RoGetActivationFactory"));
  if (g_ro_get_activation_factory == nullptr) return false;

  if (!GameHubSyntheticWgiGetTopology(&g_topology, sizeof(g_topology)) ||
      g_topology.structSize != sizeof(g_topology) ||
      g_topology.schemaVersion != kSchemaVersion ||
      g_topology.generation != kGeneration ||
      g_topology.fault != static_cast<DWORD>(ProviderFault::kNone) ||
      g_topology.epoch != kInitialEpoch ||
      g_topology.presentMask != kAllProjectionMask) {
    return false;
  }
  g_snapshot.exactRawSchema = ValidateRawSchema(g_topology) ? 1u : 0u;
  if (g_snapshot.exactRawSchema == 0 ||
      !ValidateObjects(g_topology, &g_snapshot) ||
      !CacheBodies(g_topology)) {
    return false;
  }

  g_snapshot.roGetActivationFactory =
      reinterpret_cast<ULONG_PTR>(g_ro_get_activation_factory);
  for (DWORD index = 0; index < kProjectionCount; ++index) {
    g_snapshot.objects[index] = g_topology.objects[index];
    g_snapshot.pollingBodies[index] = reinterpret_cast<ULONG_PTR>(
        PollingBody(reinterpret_cast<void*>(g_topology.objects[index]), index));
  }

  if (!ActivateBeforeBootstrap() || !PollPhysicalBeforeBootstrap(g_topology)) {
    return false;
  }
  ProviderSnapshot provider_snapshot{};
  if (!GameHubSyntheticWgiGetProviderSnapshot(&provider_snapshot,
                                               sizeof(provider_snapshot))) {
    return false;
  }
  DWORD polls = 0;
  for (DWORD count : provider_snapshot.pollingCalls) polls += count;
  g_snapshot.activationCallsBeforeBootstrap = provider_snapshot.activationCalls;
  g_snapshot.physicalPollsBeforeBootstrap = polls;
  g_snapshot.initializedBeforeBootstrap =
      provider_snapshot.activationCalls == kProjectionCount &&
              polls == kProjectionCount &&
              provider_snapshot.transientReferences == 0 &&
              provider_snapshot.addRefCalls == provider_snapshot.releaseCalls &&
              provider_snapshot.overReleaseAttempts == 0
          ? 1u
          : 0u;
  return g_snapshot.initializedBeforeBootstrap != 0;
}

}  // namespace

extern "C" BOOL WINAPI GameHubWgiQaGetCacheSnapshot(
    gamehub::overlay::wgi_qa::CacheSnapshot* output, DWORD output_size) {
  if (output == nullptr || output_size != sizeof(*output)) return FALSE;
  *output = g_snapshot;
  return TRUE;
}

extern "C" BOOL WINAPI GameHubWgiQaGetTopology(
    gamehub::overlay::wgi_qa::Topology* output, DWORD output_size) {
  return GameHubSyntheticWgiGetTopology(output, output_size);
}

extern "C" BOOL WINAPI GameHubWgiQaGetProviderSnapshot(
    gamehub::overlay::wgi_qa::ProviderSnapshot* output, DWORD output_size) {
  return GameHubSyntheticWgiGetProviderSnapshot(output, output_size);
}

extern "C" BOOL WINAPI GameHubWgiQaSetFault(DWORD fault) {
  return GameHubSyntheticWgiSetFault(fault);
}

extern "C" BOOL WINAPI GameHubWgiQaMutateTopology(DWORD operation) {
  return GameHubSyntheticWgiMutateTopology(operation);
}

extern "C" BOOL WINAPI GameHubWgiQaSetNeutral(BOOL neutral) {
  return GameHubSyntheticWgiSetNeutral(neutral);
}

extern "C" BOOL WINAPI GameHubWgiQaExerciseOverRelease() {
  return GameHubSyntheticWgiExerciseOverRelease();
}

extern "C" HRESULT WINAPI GameHubWgiQaActivate(DWORD projection,
                                                void** factory) {
  if (factory == nullptr) return E_POINTER;
  *factory = nullptr;
  if (projection >= kProjectionCount || g_ro_get_activation_factory == nullptr) {
    return E_INVALIDARG;
  }
  HSTRING_HEADER header{};
  HSTRING runtime_class = nullptr;
  const UINT32 length =
      static_cast<UINT32>(wcslen(kRuntimeClasses[projection]));
  const HRESULT string_result = WindowsCreateStringReference(
      kRuntimeClasses[projection], length, &header, &runtime_class);
  if (FAILED(string_result)) return string_result;
  return g_ro_get_activation_factory(runtime_class, __uuidof(IInspectable),
                                     factory);
}

extern "C" HRESULT WINAPI GameHubWgiQaPoll(
    DWORD projection, void* reading_or_buttons, void* switches, void* axes,
    UINT64* timestamp) {
  if (projection >= kProjectionCount) return E_INVALIDARG;
  switch (static_cast<Projection>(projection)) {
    case Projection::kGamepad:
      return g_gamepad_reading(
          reinterpret_cast<abi::IGamepad*>(g_topology.objects[projection]),
          reinterpret_cast<abi::GamepadReading*>(reading_or_buttons));
    case Projection::kRaw:
      return g_raw_reading(
          reinterpret_cast<abi::IRawGameController*>(
              g_topology.objects[projection]),
          kRawButtons, reinterpret_cast<boolean*>(reading_or_buttons),
          kRawSwitches,
          reinterpret_cast<abi::GameControllerSwitchPosition*>(switches),
          kRawAxes, reinterpret_cast<DOUBLE*>(axes), timestamp);
    case Projection::kRacing:
      return g_racing_reading(
          reinterpret_cast<abi::IRacingWheel*>(g_topology.objects[projection]),
          reinterpret_cast<abi::RacingWheelReading*>(reading_or_buttons));
    case Projection::kFlight:
      return g_flight_reading(
          reinterpret_cast<abi::IFlightStick*>(g_topology.objects[projection]),
          reinterpret_cast<abi::FlightStickReading*>(reading_or_buttons));
    case Projection::kArcade:
      return g_arcade_reading(
          reinterpret_cast<abi::IArcadeStick*>(g_topology.objects[projection]),
          reinterpret_cast<abi::ArcadeStickReading*>(reading_or_buttons));
    case Projection::kUi:
      return g_ui_reading(
          reinterpret_cast<abi::IUINavigationController*>(
              g_topology.objects[projection]),
          reinterpret_cast<abi::UINavigationReading*>(reading_or_buttons));
  }
  return E_INVALIDARG;
}

BOOL WINAPI DllMain(HINSTANCE instance, DWORD reason, LPVOID) {
  if (reason != DLL_PROCESS_ATTACH) return TRUE;
  DisableThreadLibraryCalls(instance);
  return InitializeBeforeBootstrap() ? TRUE : FALSE;
}
