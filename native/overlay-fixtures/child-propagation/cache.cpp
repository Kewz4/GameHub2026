#include "contract.hpp"

namespace {

GameHubCreateProcessWFunction g_cached_w = nullptr;
GameHubCreateProcessAFunction g_cached_a = nullptr;
volatile LONG g_initialized = 0;

}  // namespace

extern "C" DWORD WINAPI GameHubChildQaCacheInitialized() {
  return static_cast<DWORD>(InterlockedCompareExchange(&g_initialized, 0, 0));
}

extern "C" ULONG_PTR WINAPI GameHubChildQaCachedCreateProcessW() {
  return reinterpret_cast<ULONG_PTR>(g_cached_w);
}

extern "C" ULONG_PTR WINAPI GameHubChildQaCachedCreateProcessA() {
  return reinterpret_cast<ULONG_PTR>(g_cached_a);
}

extern "C" BOOL WINAPI GameHubChildQaCallCachedCreateProcessW(
    LPCWSTR application_name, LPWSTR command_line,
    LPSECURITY_ATTRIBUTES process_attributes,
    LPSECURITY_ATTRIBUTES thread_attributes, BOOL inherit_handles,
    DWORD creation_flags, LPVOID environment, LPCWSTR current_directory,
    LPSTARTUPINFOW startup_info, LPPROCESS_INFORMATION process_information) {
  if (g_cached_w == nullptr) {
    SetLastError(ERROR_INVALID_FUNCTION);
    return FALSE;
  }
  return g_cached_w(application_name, command_line, process_attributes,
                    thread_attributes, inherit_handles, creation_flags,
                    environment, current_directory, startup_info,
                    process_information);
}

extern "C" BOOL WINAPI GameHubChildQaCallCachedCreateProcessA(
    LPCSTR application_name, LPSTR command_line,
    LPSECURITY_ATTRIBUTES process_attributes,
    LPSECURITY_ATTRIBUTES thread_attributes, BOOL inherit_handles,
    DWORD creation_flags, LPVOID environment, LPCSTR current_directory,
    LPSTARTUPINFOA startup_info, LPPROCESS_INFORMATION process_information) {
  if (g_cached_a == nullptr) {
    SetLastError(ERROR_INVALID_FUNCTION);
    return FALSE;
  }
  return g_cached_a(application_name, command_line, process_attributes,
                    thread_attributes, inherit_handles, creation_flags,
                    environment, current_directory, startup_info,
                    process_information);
}

BOOL WINAPI DllMain(HINSTANCE instance, DWORD reason, LPVOID) {
  if (reason == DLL_PROCESS_ATTACH) {
    DisableThreadLibraryCalls(instance);
    g_cached_w = &CreateProcessW;
    g_cached_a = &CreateProcessA;
    InterlockedExchange(&g_initialized,
                        g_cached_w != nullptr && g_cached_a != nullptr ? 1 : 0);
  }
  return TRUE;
}
