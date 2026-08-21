#define GAMEHUB_WGI_PROVIDER_DEFINITIONS
#include "contract.hpp"

#include <atomic>
#include <cstring>
#include <string_view>

namespace qa = gamehub::overlay::wgi_qa;
namespace abi = qa::abi;

namespace {

std::atomic<DWORD> g_activation_calls{0};
std::atomic<DWORD> g_poll_calls[qa::kProjectionCount]{};
std::atomic<DWORD> g_topology_callbacks{0};
std::atomic<DWORD> g_add_ref_calls{0};
std::atomic<DWORD> g_release_calls{0};
std::atomic<DWORD> g_over_release_attempts{0};
std::atomic<DWORD> g_fault{static_cast<DWORD>(qa::ProviderFault::kNone)};
std::atomic<unsigned long long> g_epoch{qa::kInitialEpoch};
std::atomic<DWORD> g_present_mask{qa::kAllProjectionMask};
std::atomic<BOOL> g_neutral{FALSE};
std::atomic<BOOL> g_alternate_arcade_active{FALSE};
std::atomic<unsigned long long> g_serials[qa::kProjectionCount] = {
    101, 101, 303, 404, 505, 606};

bool FaultIs(qa::ProviderFault value) noexcept {
  return g_fault.load(std::memory_order_acquire) ==
         static_cast<DWORD>(value);
}

ULONG StableAddRef(std::atomic<ULONG>& references) noexcept {
  g_add_ref_calls.fetch_add(1, std::memory_order_relaxed);
  return references.fetch_add(1, std::memory_order_relaxed) + 1;
}

ULONG StableRelease(std::atomic<ULONG>& references) noexcept {
  g_release_calls.fetch_add(1, std::memory_order_relaxed);
  ULONG current = references.load(std::memory_order_relaxed);
  if (current <= 1) {
    g_over_release_attempts.fetch_add(1, std::memory_order_relaxed);
    return 1;
  }
  while (current > 1) {
    if (references.compare_exchange_weak(current, current - 1,
                                         std::memory_order_relaxed)) {
      return current - 1;
    }
  }
  g_over_release_attempts.fetch_add(1, std::memory_order_relaxed);
  return 1;
}

HRESULT InspectableMetadata(ULONG* iid_count, IID** iids) noexcept {
  if (iid_count == nullptr || iids == nullptr) return E_POINTER;
  *iid_count = 0;
  *iids = nullptr;
  return E_NOTIMPL;
}

HRESULT RuntimeName(HSTRING* value) noexcept {
  if (value == nullptr) return E_POINTER;
  *value = nullptr;
  return S_OK;
}

HRESULT Trust(TrustLevel* value) noexcept {
  if (value == nullptr) return E_POINTER;
  *value = BaseTrust;
  return S_OK;
}

template <typename Interface>
class ProjectionBase : public Interface {
 public:
  HRESULT STDMETHODCALLTYPE QueryInterface(REFIID iid,
                                            void** output) override {
    if (output == nullptr) return E_POINTER;
    *output = nullptr;
    if (FaultIs(qa::ProviderFault::kQueryInterface)) return E_NOINTERFACE;
    if (iid == __uuidof(IUnknown) || iid == __uuidof(IInspectable) ||
        iid == __uuidof(Interface)) {
      *output = static_cast<Interface*>(this);
      AddRef();
      return S_OK;
    }
    return E_NOINTERFACE;
  }
  ULONG STDMETHODCALLTYPE AddRef() override { return StableAddRef(references_); }
  ULONG STDMETHODCALLTYPE Release() override {
    return StableRelease(references_);
  }
  HRESULT STDMETHODCALLTYPE GetIids(ULONG* count, IID** values) override {
    return InspectableMetadata(count, values);
  }
  HRESULT STDMETHODCALLTYPE GetRuntimeClassName(HSTRING* value) override {
    return RuntimeName(value);
  }
  HRESULT STDMETHODCALLTYPE GetTrustLevel(TrustLevel* value) override {
    return Trust(value);
  }
  DWORD TransientReferences() const noexcept {
    const ULONG references = references_.load(std::memory_order_acquire);
    return references > 0 ? references - 1u : 0u;
  }

 private:
  std::atomic<ULONG> references_{1};
};

class GamepadRaw final : public abi::IGamepad,
                         public abi::IRawGameController {
 public:
  HRESULT STDMETHODCALLTYPE QueryInterface(REFIID iid,
                                            void** output) override {
    if (output == nullptr) return E_POINTER;
    *output = nullptr;
    if (FaultIs(qa::ProviderFault::kQueryInterface)) return E_NOINTERFACE;
    if (iid == __uuidof(IUnknown) || iid == __uuidof(IInspectable) ||
        iid == __uuidof(abi::IGamepad)) {
      *output = static_cast<abi::IGamepad*>(this);
    } else if (iid == __uuidof(abi::IRawGameController)) {
      *output = static_cast<abi::IRawGameController*>(this);
    } else {
      return E_NOINTERFACE;
    }
    AddRef();
    return S_OK;
  }
  ULONG STDMETHODCALLTYPE AddRef() override { return StableAddRef(references_); }
  ULONG STDMETHODCALLTYPE Release() override {
    return StableRelease(references_);
  }
  HRESULT STDMETHODCALLTYPE GetIids(ULONG* count, IID** values) override {
    return InspectableMetadata(count, values);
  }
  HRESULT STDMETHODCALLTYPE GetRuntimeClassName(HSTRING* value) override {
    return RuntimeName(value);
  }
  HRESULT STDMETHODCALLTYPE GetTrustLevel(TrustLevel* value) override {
    return Trust(value);
  }
  DWORD TransientReferences() const noexcept {
    const ULONG references = references_.load(std::memory_order_acquire);
    return references > 0 ? references - 1u : 0u;
  }

  HRESULT STDMETHODCALLTYPE get_Vibration(abi::GamepadVibration* value) override {
    if (value == nullptr) return E_POINTER;
    *value = {};
    return S_OK;
  }
  HRESULT STDMETHODCALLTYPE put_Vibration(abi::GamepadVibration) override {
    return S_OK;
  }
  __declspec(noinline) HRESULT STDMETHODCALLTYPE
  GetCurrentReading(abi::GamepadReading* value) override {
    g_poll_calls[static_cast<DWORD>(qa::Projection::kGamepad)]
        .fetch_add(1, std::memory_order_relaxed);
    if (value == nullptr) return E_POINTER;
    *value = {};
    value->Timestamp = 1'001;
    if (!g_neutral.load(std::memory_order_acquire)) {
      value->Buttons = static_cast<abi::GamepadButtons>(0x1001);
      value->LeftTrigger = 0.75;
      value->RightTrigger = 0.25;
      value->LeftThumbstickX = -0.5;
      value->LeftThumbstickY = 0.6;
      value->RightThumbstickX = 0.7;
      value->RightThumbstickY = -0.8;
    }
    return S_OK;
  }

  HRESULT STDMETHODCALLTYPE get_AxisCount(INT32* value) override {
    if (value == nullptr) return E_POINTER;
    *value = FaultIs(qa::ProviderFault::kRawSchema) ? 5 : qa::kRawAxes;
    return S_OK;
  }
  HRESULT STDMETHODCALLTYPE get_ButtonCount(INT32* value) override {
    if (value == nullptr) return E_POINTER;
    *value = qa::kRawButtons;
    return S_OK;
  }
  HRESULT STDMETHODCALLTYPE get_ForceFeedbackMotors(
      __FIVectorView_1_Windows__CGaming__CInput__CForceFeedback__CForceFeedbackMotor**
          value) override {
    if (value == nullptr) return E_POINTER;
    *value = nullptr;
    return E_NOTIMPL;
  }
  HRESULT STDMETHODCALLTYPE get_HardwareProductId(UINT16* value) override {
    if (value == nullptr) return E_POINTER;
    *value = 0x028e;
    return S_OK;
  }
  HRESULT STDMETHODCALLTYPE get_HardwareVendorId(UINT16* value) override {
    if (value == nullptr) return E_POINTER;
    *value = 0x045e;
    return S_OK;
  }
  HRESULT STDMETHODCALLTYPE get_SwitchCount(INT32* value) override {
    if (value == nullptr) return E_POINTER;
    *value = qa::kRawSwitches;
    return S_OK;
  }
  HRESULT STDMETHODCALLTYPE GetButtonLabel(
      INT32 index, abi::GameControllerButtonLabel* value) override {
    if (value == nullptr) return E_POINTER;
    if (index < 0 || index >= static_cast<INT32>(qa::kRawButtons)) {
      return E_BOUNDS;
    }
    *value = static_cast<abi::GameControllerButtonLabel>(0);
    return S_OK;
  }
  __declspec(noinline) HRESULT STDMETHODCALLTYPE GetCurrentReading(
      UINT32 button_count, boolean* buttons, UINT32 switch_count,
      abi::GameControllerSwitchPosition* switches, UINT32 axis_count,
      DOUBLE* axes, UINT64* timestamp) override {
    g_poll_calls[static_cast<DWORD>(qa::Projection::kRaw)]
        .fetch_add(1, std::memory_order_relaxed);
    if (button_count != qa::kRawButtons || switch_count != qa::kRawSwitches ||
        axis_count != qa::kRawAxes || buttons == nullptr || switches == nullptr ||
        axes == nullptr || timestamp == nullptr) {
      return E_INVALIDARG;
    }
    std::memset(buttons, 0, sizeof(boolean) * button_count);
    switches[0] = static_cast<abi::GameControllerSwitchPosition>(0);
    const double neutral_axes[qa::kRawAxes] = {0.5, 0.5, 0.5,
                                               0.5, 0.0, 0.0};
    std::memcpy(axes, neutral_axes, sizeof(neutral_axes));
    if (!g_neutral.load(std::memory_order_acquire)) {
      // Exact fixture mapping to the values returned by IGamepad above.
      buttons[0] = TRUE;  // Menu.
      buttons[4] = TRUE;  // A.
      switches[0] = static_cast<abi::GameControllerSwitchPosition>(1);  // Up.
      axes[0] = 0.25;  // Left X -0.5 normalized to [0, 1].
      axes[1] = 0.8;   // Left Y  0.6 normalized to [0, 1].
      axes[2] = 0.85;  // Right X 0.7 normalized to [0, 1].
      axes[3] = 0.1;   // Right Y -0.8 normalized to [0, 1].
      axes[4] = 0.75;  // Left trigger.
      axes[5] = 0.25;  // Right trigger.
    }
    *timestamp = 2'002;
    return S_OK;
  }
  HRESULT STDMETHODCALLTYPE GetSwitchKind(
      INT32 index, abi::GameControllerSwitchKind* value) override {
    if (value == nullptr) return E_POINTER;
    if (index != 0) return E_BOUNDS;
    *value = static_cast<abi::GameControllerSwitchKind>(2);  // EightWay.
    return S_OK;
  }

 private:
  std::atomic<ULONG> references_{1};
};

class Racing final : public ProjectionBase<abi::IRacingWheel> {
 public:
  HRESULT STDMETHODCALLTYPE get_HasClutch(boolean* value) override {
    if (value == nullptr) return E_POINTER;
    *value = TRUE;
    return S_OK;
  }
  HRESULT STDMETHODCALLTYPE get_HasHandbrake(boolean* value) override {
    return get_HasClutch(value);
  }
  HRESULT STDMETHODCALLTYPE get_HasPatternShifter(boolean* value) override {
    return get_HasClutch(value);
  }
  HRESULT STDMETHODCALLTYPE get_MaxPatternShifterGear(INT32* value) override {
    if (value == nullptr) return E_POINTER;
    *value = 6;
    return S_OK;
  }
  HRESULT STDMETHODCALLTYPE get_MaxWheelAngle(DOUBLE* value) override {
    if (value == nullptr) return E_POINTER;
    *value = 6.0;
    return S_OK;
  }
  HRESULT STDMETHODCALLTYPE get_WheelMotor(
      ABI::Windows::Gaming::Input::ForceFeedback::IForceFeedbackMotor** value)
      override {
    if (value == nullptr) return E_POINTER;
    *value = nullptr;
    return E_NOTIMPL;
  }
  HRESULT STDMETHODCALLTYPE GetButtonLabel(
      abi::RacingWheelButtons,
      abi::GameControllerButtonLabel* value) override {
    if (value == nullptr) return E_POINTER;
    *value = static_cast<abi::GameControllerButtonLabel>(0);
    return S_OK;
  }
  __declspec(noinline) HRESULT STDMETHODCALLTYPE
  GetCurrentReading(abi::RacingWheelReading* value) override {
    g_poll_calls[static_cast<DWORD>(qa::Projection::kRacing)]
        .fetch_add(1, std::memory_order_relaxed);
    if (value == nullptr) return E_POINTER;
    *value = {};
    value->Timestamp = 3'003;
    if (!g_neutral.load(std::memory_order_acquire)) {
      value->Buttons = static_cast<abi::RacingWheelButtons>(1);
      value->PatternShifterGear = 4;
      value->Wheel = 0.7;
      value->Throttle = 0.8;
      value->Brake = 0.2;
      value->Clutch = 0.4;
      value->Handbrake = 0.3;
    }
    return S_OK;
  }
};

class Flight : public ProjectionBase<abi::IFlightStick> {
 public:
  HRESULT STDMETHODCALLTYPE get_HatSwitchKind(
      abi::GameControllerSwitchKind* value) override {
    if (value == nullptr) return E_POINTER;
    *value = static_cast<abi::GameControllerSwitchKind>(0);
    return S_OK;
  }
  HRESULT STDMETHODCALLTYPE GetButtonLabel(
      abi::FlightStickButtons,
      abi::GameControllerButtonLabel* value) override {
    if (value == nullptr) return E_POINTER;
    *value = static_cast<abi::GameControllerButtonLabel>(0);
    return S_OK;
  }
  __declspec(noinline) HRESULT STDMETHODCALLTYPE
  GetCurrentReading(abi::FlightStickReading* value) override {
    g_poll_calls[static_cast<DWORD>(qa::Projection::kFlight)]
        .fetch_add(1, std::memory_order_relaxed);
    if (value == nullptr) return E_POINTER;
    *value = {};
    value->Timestamp = 4'004;
    value->HatSwitch = static_cast<abi::GameControllerSwitchPosition>(0);
    if (!g_neutral.load(std::memory_order_acquire)) {
      value->Buttons = static_cast<abi::FlightStickButtons>(1);
      value->HatSwitch = static_cast<abi::GameControllerSwitchPosition>(2);
      value->Roll = 0.3;
      value->Pitch = -0.4;
      value->Yaw = 0.5;
      value->Throttle = 0.9;
    }
    return S_OK;
  }
};

class AlternateFlight final : public Flight {
 public:
  __declspec(noinline) HRESULT STDMETHODCALLTYPE
  GetCurrentReading(abi::FlightStickReading* value) override {
    if (value == nullptr) return E_POINTER;
    *value = {};
    value->Timestamp = 44'004;
    return S_OK;
  }
};

class Arcade final : public ProjectionBase<abi::IArcadeStick> {
 public:
  HRESULT STDMETHODCALLTYPE GetButtonLabel(
      abi::ArcadeStickButtons,
      abi::GameControllerButtonLabel* value) override {
    if (value == nullptr) return E_POINTER;
    *value = static_cast<abi::GameControllerButtonLabel>(0);
    return S_OK;
  }
  __declspec(noinline) HRESULT STDMETHODCALLTYPE
  GetCurrentReading(abi::ArcadeStickReading* value) override {
    g_poll_calls[static_cast<DWORD>(qa::Projection::kArcade)]
        .fetch_add(1, std::memory_order_relaxed);
    if (value == nullptr) return E_POINTER;
    *value = {};
    value->Timestamp = 5'005;
    if (!g_neutral.load(std::memory_order_acquire)) {
      value->Buttons = static_cast<abi::ArcadeStickButtons>(1);
    }
    return S_OK;
  }
};

class Ui final : public ProjectionBase<abi::IUINavigationController> {
 public:
  __declspec(noinline) HRESULT STDMETHODCALLTYPE
  GetCurrentReading(abi::UINavigationReading* value) override {
    g_poll_calls[static_cast<DWORD>(qa::Projection::kUi)]
        .fetch_add(1, std::memory_order_relaxed);
    if (value == nullptr) return E_POINTER;
    *value = {};
    value->Timestamp = 6'006;
    if (!g_neutral.load(std::memory_order_acquire)) {
      value->RequiredButtons =
          static_cast<abi::RequiredUINavigationButtons>(1);
      value->OptionalButtons =
          static_cast<abi::OptionalUINavigationButtons>(1);
    }
    return S_OK;
  }
  HRESULT STDMETHODCALLTYPE GetOptionalButtonLabel(
      abi::OptionalUINavigationButtons,
      abi::GameControllerButtonLabel* value) override {
    if (value == nullptr) return E_POINTER;
    *value = static_cast<abi::GameControllerButtonLabel>(0);
    return S_OK;
  }
  HRESULT STDMETHODCALLTYPE GetRequiredButtonLabel(
      abi::RequiredUINavigationButtons,
      abi::GameControllerButtonLabel* value) override {
    if (value == nullptr) return E_POINTER;
    *value = static_cast<abi::GameControllerButtonLabel>(0);
    return S_OK;
  }
};

class Factory final : public IInspectable {
 public:
  HRESULT STDMETHODCALLTYPE QueryInterface(REFIID iid,
                                            void** output) override {
    if (output == nullptr) return E_POINTER;
    *output = nullptr;
    if (iid != __uuidof(IUnknown) && iid != __uuidof(IInspectable)) {
      return E_NOINTERFACE;
    }
    *output = static_cast<IInspectable*>(this);
    AddRef();
    return S_OK;
  }
  ULONG STDMETHODCALLTYPE AddRef() override { return StableAddRef(references_); }
  ULONG STDMETHODCALLTYPE Release() override {
    return StableRelease(references_);
  }
  HRESULT STDMETHODCALLTYPE GetIids(ULONG* count, IID** values) override {
    return InspectableMetadata(count, values);
  }
  HRESULT STDMETHODCALLTYPE GetRuntimeClassName(HSTRING* value) override {
    return RuntimeName(value);
  }
  HRESULT STDMETHODCALLTYPE GetTrustLevel(TrustLevel* value) override {
    return Trust(value);
  }
  DWORD TransientReferences() const noexcept {
    const ULONG references = references_.load(std::memory_order_acquire);
    return references > 0 ? references - 1u : 0u;
  }

 private:
  std::atomic<ULONG> references_{1};
};

GamepadRaw g_gamepad_raw;
Racing g_racing;
Flight g_flight;
AlternateFlight g_alternate_flight;
Arcade g_arcade;
Arcade g_alternate_arcade;
Ui g_ui;
Factory g_factories[qa::kProjectionCount];
void* g_null_vtable_object = nullptr;

void NotifyTopology(unsigned long long epoch) noexcept {
  const HMODULE bootstrap = GetModuleHandleW(qa::kBootstrapModuleName);
  if (bootstrap == nullptr) return;
  const auto callback = reinterpret_cast<void(WINAPI*)(unsigned long long)>(
      GetProcAddress(bootstrap, "GameHubWgiQaTopologyChanged"));
  if (callback == nullptr) return;
  g_topology_callbacks.fetch_add(1, std::memory_order_relaxed);
  callback(epoch);
}

unsigned long long BumpEpoch() noexcept {
  const auto epoch = g_epoch.fetch_add(1, std::memory_order_acq_rel) + 1;
  NotifyTopology(epoch);
  return epoch;
}

bool ClassProjection(HSTRING class_id, DWORD* projection) noexcept {
  if (class_id == nullptr || projection == nullptr) return false;
  UINT32 length = 0;
  const wchar_t* value = WindowsGetStringRawBuffer(class_id, &length);
  if (value == nullptr || length == 0 || length > 128) return false;
  const std::wstring_view name(value, length);
  constexpr std::wstring_view names[qa::kProjectionCount] = {
      L"Windows.Gaming.Input.Gamepad",
      L"Windows.Gaming.Input.RawGameController",
      L"Windows.Gaming.Input.RacingWheel",
      L"Windows.Gaming.Input.FlightStick",
      L"Windows.Gaming.Input.ArcadeStick",
      L"Windows.Gaming.Input.UINavigationController"};
  for (DWORD index = 0; index < qa::kProjectionCount; ++index) {
    if (name == names[index]) {
      *projection = index;
      return true;
    }
  }
  return false;
}

void FillTopology(qa::Topology* output) noexcept {
  *output = {};
  output->structSize = sizeof(*output);
  output->schemaVersion = qa::kSchemaVersion;
  output->generation = qa::kGeneration;
  output->fault = g_fault.load(std::memory_order_acquire);
  output->epoch = g_epoch.load(std::memory_order_acquire);
  output->presentMask = g_present_mask.load(std::memory_order_acquire);
  output->rawButtonCount = qa::kRawButtons;
  output->rawSwitchCount = qa::kRawSwitches;
  output->rawAxisCount = FaultIs(qa::ProviderFault::kRawSchema) ? 5
                                                               : qa::kRawAxes;
  const double raw_neutral[qa::kRawAxes] = {0.5, 0.5, 0.5,
                                            0.5, 0.0, 0.0};
  std::memcpy(output->rawNeutralAxes, raw_neutral, sizeof(raw_neutral));
  output->objects[0] = reinterpret_cast<ULONG_PTR>(
      static_cast<abi::IGamepad*>(&g_gamepad_raw));
  output->objects[1] = reinterpret_cast<ULONG_PTR>(
      static_cast<abi::IRawGameController*>(&g_gamepad_raw));
  output->objects[2] = reinterpret_cast<ULONG_PTR>(
      static_cast<abi::IRacingWheel*>(&g_racing));
  output->objects[3] = reinterpret_cast<ULONG_PTR>(
      static_cast<abi::IFlightStick*>(FaultIs(qa::ProviderFault::kBodyMismatch)
                                          ? &g_alternate_flight
                                          : &g_flight));
  output->objects[4] = reinterpret_cast<ULONG_PTR>(
      static_cast<abi::IArcadeStick*>(
          g_alternate_arcade_active.load(std::memory_order_acquire)
              ? &g_alternate_arcade
              : &g_arcade));
  output->objects[5] = reinterpret_cast<ULONG_PTR>(
      static_cast<abi::IUINavigationController*>(&g_ui));
  if (FaultIs(qa::ProviderFault::kNullTopologyVtable)) {
    output->objects[2] = reinterpret_cast<ULONG_PTR>(&g_null_vtable_object);
  }
  for (DWORD index = 0; index < qa::kProjectionCount; ++index) {
    output->serials[index] =
        g_serials[index].load(std::memory_order_acquire);
  }
}

}  // namespace

extern "C" HRESULT WINAPI GameHubSyntheticRoGetActivationFactory(
    HSTRING class_id, REFIID iid, void** factory) {
  g_activation_calls.fetch_add(1, std::memory_order_relaxed);
  if (factory == nullptr) return E_POINTER;
  *factory = nullptr;
  if (FaultIs(qa::ProviderFault::kActivation)) return E_FAIL;
  DWORD projection = 0;
  if (!ClassProjection(class_id, &projection)) return REGDB_E_CLASSNOTREG;
  return g_factories[projection].QueryInterface(iid, factory);
}

extern "C" BOOL WINAPI GameHubSyntheticWgiGetTopology(
    qa::Topology* output, DWORD output_size) {
  if (output == nullptr || output_size != sizeof(*output)) return FALSE;
  FillTopology(output);
  return TRUE;
}

extern "C" BOOL WINAPI GameHubSyntheticWgiGetProviderSnapshot(
    qa::ProviderSnapshot* output, DWORD output_size) {
  if (output == nullptr || output_size != sizeof(*output)) return FALSE;
  *output = {};
  output->structSize = sizeof(*output);
  output->schemaVersion = qa::kSchemaVersion;
  output->activationCalls = g_activation_calls.load(std::memory_order_acquire);
  for (DWORD index = 0; index < qa::kProjectionCount; ++index) {
    output->pollingCalls[index] =
        g_poll_calls[index].load(std::memory_order_acquire);
  }
  output->topologyCallbacks =
      g_topology_callbacks.load(std::memory_order_acquire);
  output->fault = g_fault.load(std::memory_order_acquire);
  output->epoch = g_epoch.load(std::memory_order_acquire);
  output->presentMask = g_present_mask.load(std::memory_order_acquire);
  output->physicalNeutral =
      g_neutral.load(std::memory_order_acquire) ? 1u : 0u;
  output->transientReferences = g_gamepad_raw.TransientReferences() +
                                g_racing.TransientReferences() +
                                g_flight.TransientReferences() +
                                g_alternate_flight.TransientReferences() +
                                g_arcade.TransientReferences() +
                                g_alternate_arcade.TransientReferences() +
                                g_ui.TransientReferences();
  for (const Factory& factory : g_factories) {
    output->transientReferences += factory.TransientReferences();
  }
  output->addRefCalls = g_add_ref_calls.load(std::memory_order_acquire);
  output->releaseCalls = g_release_calls.load(std::memory_order_acquire);
  output->overReleaseAttempts =
      g_over_release_attempts.load(std::memory_order_acquire);
  return TRUE;
}

extern "C" BOOL WINAPI GameHubSyntheticWgiSetFault(DWORD fault) {
  if (fault > static_cast<DWORD>(qa::ProviderFault::kNonNeutral)) return FALSE;
  g_fault.store(fault, std::memory_order_release);
  BumpEpoch();
  return TRUE;
}

extern "C" BOOL WINAPI GameHubSyntheticWgiMutateTopology(DWORD operation) {
  switch (operation) {
    case 1:
      g_present_mask.fetch_and(~qa::Bit(qa::Projection::kArcade),
                               std::memory_order_acq_rel);
      g_serials[static_cast<DWORD>(qa::Projection::kArcade)]
          .fetch_add(1, std::memory_order_acq_rel);
      break;
    case 2:
      g_present_mask.fetch_or(qa::Bit(qa::Projection::kArcade),
                              std::memory_order_acq_rel);
      g_serials[static_cast<DWORD>(qa::Projection::kArcade)]
          .fetch_add(1, std::memory_order_acq_rel);
      break;
    case 3:
      g_serials[static_cast<DWORD>(qa::Projection::kGamepad)]
          .fetch_add(1, std::memory_order_acq_rel);
      g_serials[static_cast<DWORD>(qa::Projection::kRaw)]
          .fetch_add(1, std::memory_order_acq_rel);
      break;
    case 4:
      g_alternate_arcade_active.store(
          !g_alternate_arcade_active.load(std::memory_order_acquire),
          std::memory_order_release);
      g_serials[static_cast<DWORD>(qa::Projection::kArcade)]
          .fetch_add(1, std::memory_order_acq_rel);
      break;
    default:
      return FALSE;
  }
  BumpEpoch();
  return TRUE;
}

extern "C" BOOL WINAPI GameHubSyntheticWgiSetNeutral(BOOL neutral) {
  g_neutral.store(neutral ? TRUE : FALSE, std::memory_order_release);
  return TRUE;
}

extern "C" BOOL WINAPI GameHubSyntheticWgiExerciseOverRelease() {
  const DWORD before =
      g_over_release_attempts.load(std::memory_order_acquire);
  static_cast<abi::IGamepad*>(&g_gamepad_raw)->Release();
  return g_over_release_attempts.load(std::memory_order_acquire) == before + 1u
             ? TRUE
             : FALSE;
}

BOOL WINAPI DllMain(HINSTANCE, DWORD, void*) { return TRUE; }
