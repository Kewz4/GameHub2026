#include "contract.hpp"

namespace {

using TargetFunction = DWORD(WINAPI*)(DWORD);

TargetFunction g_cached_target = nullptr;
volatile LONG g_initialized = 0;
volatile LONG g_pre_attach_probe_value = 0;

}  // namespace

extern "C" DWORD WINAPI GameHubCachedPointerCacheCall(DWORD input) {
  TargetFunction cached = g_cached_target;
  return cached == nullptr ? 0u : cached(input);
}

extern "C" DWORD WINAPI GameHubCachedPointerCacheInitialized() {
  return static_cast<DWORD>(InterlockedCompareExchange(&g_initialized, 0, 0));
}

extern "C" DWORD WINAPI GameHubCachedPointerCachePreAttachProbeValue() {
  return static_cast<DWORD>(
      InterlockedCompareExchange(&g_pre_attach_probe_value, 0, 0));
}

extern "C" ULONG_PTR WINAPI GameHubCachedPointerCacheAddress() {
  return reinterpret_cast<ULONG_PTR>(g_cached_target);
}

BOOL WINAPI DllMain(HINSTANCE instance, DWORD reason, LPVOID) {
  if (reason == DLL_PROCESS_ATTACH) {
    // The injected bootstrap imports this DLL. Windows therefore initializes
    // this dependency before entering the bootstrap's DllMain. Cache the real
    // code address and execute it once while no Detours transaction exists.
    g_cached_target = &GameHubCachedPointerTarget;
    const DWORD probe = g_cached_target(
        gamehub::overlay::cached_pointer_qa::kPreAttachProbe);
    InterlockedExchange(&g_pre_attach_probe_value,
                        static_cast<LONG>(probe));
    InterlockedExchange(&g_initialized, 1);
    DisableThreadLibraryCalls(instance);
  }
  return TRUE;
}
