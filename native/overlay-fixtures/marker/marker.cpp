// Detours requires the Windows architecture macros before detours.h.
// clang-format off
#include <windows.h>
#include <detours.h>
// clang-format on

namespace {

constexpr DWORD kMarkerMagic = 0x47485141;  // "GHQA"
volatile LONG g_marker_magic = 0;

}  // namespace

extern "C" __declspec(dllexport) DWORD WINAPI GameHubOverlayQaMarkerMagic() {
  return static_cast<DWORD>(InterlockedCompareExchange(&g_marker_magic, 0, 0));
}

BOOL WINAPI DllMain(HINSTANCE instance, DWORD reason, LPVOID) {
  if (DetourIsHelperProcess()) return TRUE;
  if (reason == DLL_PROCESS_ATTACH) {
    DetourRestoreAfterWith();
    DisableThreadLibraryCalls(instance);
    InterlockedExchange(&g_marker_magic, static_cast<LONG>(kMarkerMagic));
  }
  return TRUE;
}
