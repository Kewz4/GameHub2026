#define GAMEHUB_DI_CACHE_EXPORTS
#include "contract.hpp"

#include <cstring>

namespace {

using namespace gamehub::overlay::directinput_qa;

CacheSnapshot g_snapshot{};
IDirectInput8A *g_root_a = nullptr;
IDirectInput8W *g_root_w = nullptr;
IDirectInputDevice8A *g_device_a = nullptr;
IDirectInputDevice8W *g_device_w = nullptr;
bool g_released = false;

template <typename Function> ULONG_PTR Address(Function function) {
  return reinterpret_cast<ULONG_PTR>(function);
}

bool InitializeBeforeBootstrap() {
  HMODULE provider = GetModuleHandleW(L"dinput8.dll");
  if (provider == nullptr)
    return false;
  const auto factory = reinterpret_cast<DirectInput8CreateFunction>(
      GetProcAddress(provider, "DirectInput8Create"));
  if (factory == nullptr)
    return false;

  g_snapshot = {};
  g_snapshot.structSize = sizeof(g_snapshot);
  g_snapshot.schemaVersion = kSchemaVersion;
  g_snapshot.providerModule = reinterpret_cast<ULONG_PTR>(provider);
  g_snapshot.factoryBody = Address(factory);
  HMODULE factory_module = nullptr;
  const BOOL factory_resolved =
      GetModuleHandleExW(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS |
                             GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT,
                         reinterpret_cast<LPCWSTR>(factory), &factory_module);
  g_snapshot.exactProviderResolved =
      factory_resolved && factory_module == provider &&
              reinterpret_cast<ULONG_PTR>(GetProcAddress(
                  provider, "DirectInput8Create")) == g_snapshot.factoryBody
          ? 1u
          : 0u;
  if (g_snapshot.exactProviderResolved != 1u)
    return false;
  if (FAILED(factory(GetModuleHandleW(nullptr), DIRECTINPUT_VERSION,
                     IID_IDirectInput8A, reinterpret_cast<void **>(&g_root_a),
                     nullptr)) ||
      FAILED(factory(GetModuleHandleW(nullptr), DIRECTINPUT_VERSION,
                     IID_IDirectInput8W, reinterpret_cast<void **>(&g_root_w),
                     nullptr)) ||
      g_root_a == nullptr || g_root_w == nullptr) {
    return false;
  }
  g_snapshot.preAttachFactoryCalls = 2;

  g_snapshot.rootCreateBodyA = Address(g_root_a->lpVtbl->CreateDevice);
  g_snapshot.rootCreateBodyW = Address(g_root_w->lpVtbl->CreateDevice);
  if (FAILED(g_root_a->lpVtbl->CreateDevice(g_root_a, GUID_SysKeyboard,
                                            &g_device_a, nullptr)) ||
      FAILED(g_root_w->lpVtbl->CreateDevice(g_root_w, GUID_Joystick,
                                            &g_device_w, nullptr)) ||
      g_device_a == nullptr || g_device_w == nullptr) {
    return false;
  }
  g_snapshot.preAttachRootCreateCalls = 2;

#define CACHE_DEVICE_BODIES(Suffix, Device)                                    \
  g_snapshot.deviceQueryBody##Suffix =                                         \
      Address(Device->lpVtbl->QueryInterface);                                 \
  g_snapshot.deviceAddRefBody##Suffix = Address(Device->lpVtbl->AddRef);       \
  g_snapshot.deviceReleaseBody##Suffix = Address(Device->lpVtbl->Release);     \
  g_snapshot.deviceGetPropertyBody##Suffix =                                   \
      Address(Device->lpVtbl->GetProperty);                                    \
  g_snapshot.deviceSetPropertyBody##Suffix =                                   \
      Address(Device->lpVtbl->SetProperty);                                    \
  g_snapshot.deviceAcquireBody##Suffix = Address(Device->lpVtbl->Acquire);     \
  g_snapshot.deviceUnacquireBody##Suffix = Address(Device->lpVtbl->Unacquire); \
  g_snapshot.deviceGetStateBody##Suffix =                                      \
      Address(Device->lpVtbl->GetDeviceState);                                 \
  g_snapshot.deviceGetDataBody##Suffix =                                       \
      Address(Device->lpVtbl->GetDeviceData);                                  \
  g_snapshot.deviceSetFormatBody##Suffix =                                     \
      Address(Device->lpVtbl->SetDataFormat);                                  \
  g_snapshot.deviceSetEventBody##Suffix =                                      \
      Address(Device->lpVtbl->SetEventNotification);                           \
  g_snapshot.deviceSetCoopBody##Suffix =                                       \
      Address(Device->lpVtbl->SetCooperativeLevel);                            \
  g_snapshot.devicePollBody##Suffix = Address(Device->lpVtbl->Poll);           \
  g_snapshot.deviceSetActionMapBody##Suffix =                                  \
      Address(Device->lpVtbl->SetActionMap)

  CACHE_DEVICE_BODIES(A, g_device_a);
  CACHE_DEVICE_BODIES(W, g_device_w);

  const DIDATAFORMAT *keyboard_format =
      GameHubSyntheticDiGetFormat(FormatKind::kKeyboard);
  const DIDATAFORMAT *joystick_format =
      GameHubSyntheticDiGetFormat(FormatKind::kJoystick2);
  if (keyboard_format == nullptr || joystick_format == nullptr ||
      FAILED(g_device_a->lpVtbl->SetDataFormat(g_device_a, keyboard_format)) ||
      FAILED(g_device_w->lpVtbl->SetDataFormat(g_device_w, joystick_format))) {
    return false;
  }
  DIPROPRANGE preattach_range{};
  preattach_range.diph.dwSize = sizeof(preattach_range);
  preattach_range.diph.dwHeaderSize = sizeof(preattach_range.diph);
  preattach_range.diph.dwObj = static_cast<DWORD>(offsetof(DIJOYSTATE2, lX));
  preattach_range.diph.dwHow = DIPH_BYOFFSET;
  preattach_range.lMin = kPreAttachAxisMinimum;
  preattach_range.lMax = kPreAttachAxisMaximum;
  if (FAILED(g_device_w->lpVtbl->SetProperty(
          g_device_w, DIPROP_RANGE,
          reinterpret_cast<const DIPROPHEADER *>(&preattach_range))) ||
      FAILED(g_device_a->lpVtbl->SetCooperativeLevel(
          g_device_a, GetDesktopWindow(),
          DISCL_BACKGROUND | DISCL_NONEXCLUSIVE)) ||
      FAILED(g_device_w->lpVtbl->SetCooperativeLevel(
          g_device_w, GetDesktopWindow(),
          DISCL_BACKGROUND | DISCL_NONEXCLUSIVE)) ||
      FAILED(g_device_a->lpVtbl->Acquire(g_device_a)) ||
      FAILED(g_device_w->lpVtbl->Acquire(g_device_w))) {
    return false;
  }
  unsigned char keyboard[256]{};
  DIJOYSTATE2 joystick{};
  const HRESULT keyboard_result = g_device_a->lpVtbl->GetDeviceState(
      g_device_a, sizeof(keyboard), keyboard);
  const HRESULT joystick_result = g_device_w->lpVtbl->GetDeviceState(
      g_device_w, sizeof(joystick), &joystick);
  g_snapshot.preAttachDeviceStateCalls = 2;
  g_snapshot.preAttachPhysicalObserved =
      SUCCEEDED(keyboard_result) && SUCCEEDED(joystick_result) &&
              keyboard[0] == 0x80u && joystick.lX == kPreAttachAxisMinimum
          ? 1u
          : 0u;
  g_snapshot.initializedBeforeBootstrap = 1;
  return true;
}

} // namespace

extern "C" BOOL WINAPI GameHubDiQaGetCacheSnapshot(CacheSnapshot *output,
                                                   DWORD output_size) {
  if (output == nullptr || output_size != sizeof(*output))
    return FALSE;
  *output = g_snapshot;
  return TRUE;
}

extern "C" BOOL WINAPI GameHubDiQaGetProviderSnapshot(ProviderSnapshot *output,
                                                      DWORD output_size) {
  return GameHubSyntheticDiGetProviderSnapshot(output, output_size);
}

extern "C" IDirectInput8A *WINAPI GameHubDiQaGetRootA() { return g_root_a; }
extern "C" IDirectInput8W *WINAPI GameHubDiQaGetRootW() { return g_root_w; }
extern "C" IDirectInputDevice8A *WINAPI GameHubDiQaGetDeviceA() {
  return g_device_a;
}
extern "C" IDirectInputDevice8W *WINAPI GameHubDiQaGetDeviceW() {
  return g_device_w;
}

extern "C" BOOL WINAPI GameHubDiQaSetPhysical(BOOL neutral, DWORD queued_events,
                                              HRESULT next_data_result) {
  return GameHubSyntheticDiSetPhysical(neutral, queued_events,
                                       next_data_result);
}

extern "C" BOOL WINAPI GameHubDiQaSetActionMapResult(HRESULT result) {
  return GameHubSyntheticDiSetActionMapResult(result);
}

extern "C" BOOL WINAPI GameHubDiQaSetRange(LPUNKNOWN device, DWORD offset,
                                           LONG minimum, LONG maximum) {
  return GameHubSyntheticDiSetRange(device, offset, minimum, maximum);
}

extern "C" BOOL WINAPI GameHubDiQaReleaseAll() {
  if (g_released)
    return TRUE;
  g_released = true;
  if (g_device_a != nullptr) {
    g_device_a->lpVtbl->Unacquire(g_device_a);
    g_device_a->lpVtbl->Release(g_device_a);
    g_device_a = nullptr;
  }
  if (g_device_w != nullptr) {
    g_device_w->lpVtbl->Unacquire(g_device_w);
    g_device_w->lpVtbl->Release(g_device_w);
    g_device_w = nullptr;
  }
  if (g_root_a != nullptr) {
    g_root_a->lpVtbl->Release(g_root_a);
    g_root_a = nullptr;
  }
  if (g_root_w != nullptr) {
    g_root_w->lpVtbl->Release(g_root_w);
    g_root_w = nullptr;
  }
  ProviderSnapshot snapshot{};
  return GameHubSyntheticDiGetProviderSnapshot(&snapshot, sizeof(snapshot)) &&
                 snapshot.liveRootObjects == 0u &&
                 snapshot.liveDeviceObjects == 0u &&
                 snapshot.totalReferences == 0u
             ? TRUE
             : FALSE;
}

extern "C" BOOL WINAPI
GameHubDiQaTamperPollSlotForNegativeControl(BOOL restore) {
  if (g_device_a == nullptr || g_snapshot.devicePollBodyA == 0u ||
      g_snapshot.deviceUnacquireBodyA == 0u) {
    return FALSE;
  }
  g_device_a->lpVtbl->Poll = reinterpret_cast<DevicePollAFunction>(
      restore ? g_snapshot.devicePollBodyA : g_snapshot.deviceUnacquireBodyA);
  return TRUE;
}

BOOL WINAPI DllMain(HINSTANCE instance, DWORD reason, LPVOID) {
  if (reason == DLL_PROCESS_ATTACH) {
    DisableThreadLibraryCalls(instance);
    return InitializeBeforeBootstrap() ? TRUE : FALSE;
  }
  return TRUE;
}
