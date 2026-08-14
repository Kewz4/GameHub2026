#include "contract.hpp"

namespace {

using namespace gamehub::overlay::xinput_qa;

GetStateFunction g_get_state = nullptr;
GetStateExFunction g_get_state_ex = nullptr;
GetKeystrokeFunction g_get_keystroke = nullptr;
EnableFunction g_enable = nullptr;
SetStateFunction g_set_state = nullptr;
volatile LONG g_initialized = 0;
volatile LONG g_provider_module_resolved = 0;
volatile LONG g_all_pointers_matched = 0;
volatile LONG g_pre_state_status = ERROR_INVALID_STATE;
volatile LONG g_pre_state_ex_status = ERROR_INVALID_STATE;
State g_pre_state{};
State g_pre_state_ex{};

template <typename Function>
bool SameAddress(Function cached, FARPROC target) {
  return cached != nullptr && reinterpret_cast<ULONG_PTR>(cached) ==
                                  reinterpret_cast<ULONG_PTR>(target);
}

}  // namespace

extern "C" BOOL WINAPI GameHubXInputQaGetCacheSnapshot(
    gamehub::overlay::xinput_qa::CacheSnapshot* output, DWORD output_size) {
  using gamehub::overlay::xinput_qa::CacheSnapshot;
  if (output == nullptr || output_size != sizeof(CacheSnapshot)) {
    SetLastError(ERROR_INSUFFICIENT_BUFFER);
    return FALSE;
  }
  output->structSize = sizeof(CacheSnapshot);
  output->schemaVersion = gamehub::overlay::xinput_qa::kSchemaVersion;
  output->initializedBeforeBootstrap =
      static_cast<DWORD>(InterlockedCompareExchange(&g_initialized, 0, 0));
  output->providerModuleResolved = static_cast<DWORD>(
      InterlockedCompareExchange(&g_provider_module_resolved, 0, 0));
  output->allPointersMatchedProvider = static_cast<DWORD>(
      InterlockedCompareExchange(&g_all_pointers_matched, 0, 0));
  output->preAttachStateStatus =
      static_cast<DWORD>(InterlockedCompareExchange(&g_pre_state_status, 0, 0));
  output->preAttachStateExStatus = static_cast<DWORD>(
      InterlockedCompareExchange(&g_pre_state_ex_status, 0, 0));
  output->preAttachState = g_pre_state;
  output->preAttachStateEx = g_pre_state_ex;
  output->getStatePointer = reinterpret_cast<ULONG_PTR>(g_get_state);
  output->getStateExPointer = reinterpret_cast<ULONG_PTR>(g_get_state_ex);
  output->getKeystrokePointer = reinterpret_cast<ULONG_PTR>(g_get_keystroke);
  output->enablePointer = reinterpret_cast<ULONG_PTR>(g_enable);
  output->setStatePointer = reinterpret_cast<ULONG_PTR>(g_set_state);
  return TRUE;
}

extern "C" BOOL WINAPI GameHubXInputQaGetProviderSnapshot(
    gamehub::overlay::xinput_qa::ProviderSnapshot* output, DWORD output_size) {
  return GameHubSyntheticXInputGetProviderSnapshot(output, output_size);
}

extern "C" DWORD WINAPI GameHubXInputQaCallGetState(
    DWORD user_index, gamehub::overlay::xinput_qa::State* state) {
  return g_get_state == nullptr ? ERROR_INVALID_STATE
                                : g_get_state(user_index, state);
}

extern "C" DWORD WINAPI GameHubXInputQaCallGetStateEx(
    DWORD user_index, gamehub::overlay::xinput_qa::State* state) {
  return g_get_state_ex == nullptr ? ERROR_INVALID_STATE
                                   : g_get_state_ex(user_index, state);
}

extern "C" DWORD WINAPI GameHubXInputQaCallGetKeystroke(
    DWORD user_index, DWORD reserved,
    gamehub::overlay::xinput_qa::Keystroke* keystroke) {
  return g_get_keystroke == nullptr
             ? ERROR_INVALID_STATE
             : g_get_keystroke(user_index, reserved, keystroke);
}

extern "C" VOID WINAPI GameHubXInputQaCallEnable(BOOL enable) {
  if (g_enable != nullptr) g_enable(enable);
}

extern "C" DWORD WINAPI GameHubXInputQaCallSetState(
    DWORD user_index, gamehub::overlay::xinput_qa::Vibration* vibration) {
  return g_set_state == nullptr ? ERROR_INVALID_STATE
                                : g_set_state(user_index, vibration);
}

extern "C" BOOL WINAPI GameHubXInputQaSetPhysical(BOOL connected, BOOL neutral,
                                                  DWORD packet_number) {
  return GameHubSyntheticXInputSetPhysical(connected, neutral, packet_number);
}

extern "C" BOOL WINAPI GameHubXInputQaQueueKeystrokes(DWORD count) {
  return GameHubSyntheticXInputQueueKeystrokes(count);
}

BOOL WINAPI DllMain(HINSTANCE instance, DWORD reason, LPVOID) {
  if (reason != DLL_PROCESS_ATTACH) return TRUE;

  DisableThreadLibraryCalls(instance);
  g_get_state = &XInputGetState;
  g_get_keystroke = &XInputGetKeystroke;
  g_enable = &XInputEnable;
  g_set_state = &XInputSetState;

  HMODULE provider = nullptr;
  const BOOL module_resolved =
      GetModuleHandleExW(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS |
                             GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT,
                         reinterpret_cast<LPCWSTR>(g_get_state), &provider);
  InterlockedExchange(&g_provider_module_resolved,
                      module_resolved && provider != nullptr ? 1 : 0);
  if (!module_resolved || provider == nullptr) return TRUE;

  g_get_state_ex = reinterpret_cast<GetStateExFunction>(
      GetProcAddress(provider, MAKEINTRESOURCEA(100)));
  const bool matched =
      SameAddress(g_get_state, GetProcAddress(provider, "XInputGetState")) &&
      SameAddress(g_get_state_ex,
                  GetProcAddress(provider, MAKEINTRESOURCEA(100))) &&
      SameAddress(g_get_keystroke,
                  GetProcAddress(provider, "XInputGetKeystroke")) &&
      SameAddress(g_enable, GetProcAddress(provider, "XInputEnable")) &&
      SameAddress(g_set_state, GetProcAddress(provider, "XInputSetState"));
  InterlockedExchange(&g_all_pointers_matched, matched ? 1 : 0);
  if (!matched) return TRUE;

  ZeroMemory(&g_pre_state, sizeof(g_pre_state));
  ZeroMemory(&g_pre_state_ex, sizeof(g_pre_state_ex));
  const DWORD state_status = g_get_state(0, &g_pre_state);
  const DWORD state_ex_status = g_get_state_ex(0, &g_pre_state_ex);
  InterlockedExchange(&g_pre_state_status, static_cast<LONG>(state_status));
  InterlockedExchange(&g_pre_state_ex_status,
                      static_cast<LONG>(state_ex_status));
  const bool probes_valid =
      state_status == ERROR_SUCCESS && state_ex_status == ERROR_SUCCESS &&
      gamehub::overlay::xinput_qa::IsPhysicalState(g_pre_state) &&
      gamehub::overlay::xinput_qa::IsPhysicalStateEx(g_pre_state_ex);
  InterlockedExchange(&g_initialized, probes_valid ? 1 : 0);
  return TRUE;
}
