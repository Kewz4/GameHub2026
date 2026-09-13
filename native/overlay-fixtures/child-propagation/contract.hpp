#pragma once

#include <windows.h>

namespace gamehub::overlay::child_propagation_qa {

inline constexpr DWORD kSchemaVersion = 1;
inline constexpr DWORD kHandshakeMagic = 0x47484350;  // GHCP
inline constexpr DWORD kHandshakeTimeoutMs = 3'000;
inline constexpr wchar_t kRendererName[] =
    L"gamehub-overlay-qa-child-renderer.exe";
inline constexpr wchar_t kUnknownRendererName[] =
    L"gamehub-overlay-qa-child-unknown.exe";
inline constexpr wchar_t kParentFixtureName[] =
    L"gamehub-overlay-qa-child-parent.exe";
inline constexpr wchar_t kParentBootstrapName[] =
    L"gamehub-overlay-qa-child-parent-bootstrap64.dll";
inline constexpr wchar_t kChildMarkerName[] =
    L"gamehub-overlay-qa-child-marker64.dll";

enum class CapabilityState : DWORD {
  kUnknown = 0,
  kReady = 1,
  kUnavailable = 2,
};

enum class HandshakeState : LONG {
  kEmpty = 0,
  kMarkerReady = 1,
  kMarkerReleased = 2,
  kMarkerFailed = 3,
};

struct ChildHandshake {
  DWORD structSize;
  DWORD schemaVersion;
  DWORD magic;
  DWORD expectedProcessId;
  DWORD expectedParentProcessId;
  ULONGLONG expectedCreationTicks;
  ULONGLONG expectedParentCreationTicks;
  volatile LONG state;
  DWORD markerProcessId;
  ULONGLONG markerCreationTicks;
  DWORD restoreAfterWithSucceeded;
  DWORD markerLoadedBeforeEntry;
};

struct ParentBootstrapSnapshot {
  DWORD structSize;
  DWORD schemaVersion;
  DWORD restoreAfterWithSucceeded;
  DWORD cacheInitializedBeforeAttach;
  DWORD cachedPointersMatchedBeforeAttach;
  LONG attachError;
  DWORD attached;
  DWORD hookCallsW;
  DWORD hookCallsA;
  DWORD exactAttempts;
  DWORD instrumentedChildren;
  DWORD abortedNeverStartedChildren;
  DWORD passthroughChildren;
  DWORD capabilityState;
  DWORD lastError;
  DWORD lastOriginalFlags;
  DWORD lastForwardedFlags;
  DWORD lastCallerRequestedSuspended;
  DWORD lastHandshakeReady;
  DWORD lastIdentityValid;
  DWORD lastSuspendBalanceValid;
  DWORD lastInheritHandlesForwarded;
  ULONG_PTR cachedCreateProcessW;
  ULONG_PTR targetCreateProcessW;
  ULONG_PTR cachedCreateProcessA;
  ULONG_PTR targetCreateProcessA;
  ULONG_PTR lastProcessAttributes;
  ULONG_PTR lastThreadAttributes;
  ULONG_PTR lastEnvironment;
  ULONG_PTR lastStartupInfoForwarded;
  DWORD lastProcessId;
  ULONGLONG lastCreationTicks;
};

struct ChildMarkerSnapshot {
  DWORD structSize;
  DWORD schemaVersion;
  DWORD restoreAfterWithSucceeded;
  DWORD loadedBeforeEntry;
  DWORD releasedBeforeEntry;
  DWORD processId;
  ULONGLONG creationTicks;
};

}  // namespace gamehub::overlay::child_propagation_qa

extern "C" {

using GameHubCreateProcessWFunction = BOOL(WINAPI*)(
    LPCWSTR, LPWSTR, LPSECURITY_ATTRIBUTES, LPSECURITY_ATTRIBUTES, BOOL, DWORD,
    LPVOID, LPCWSTR, LPSTARTUPINFOW, LPPROCESS_INFORMATION);
using GameHubCreateProcessAFunction = BOOL(WINAPI*)(
    LPCSTR, LPSTR, LPSECURITY_ATTRIBUTES, LPSECURITY_ATTRIBUTES, BOOL, DWORD,
    LPVOID, LPCSTR, LPSTARTUPINFOA, LPPROCESS_INFORMATION);

#if defined(GAMEHUB_CHILD_QA_CACHE_EXPORTS)
#define GAMEHUB_CHILD_QA_CACHE_API __declspec(dllexport)
#else
#define GAMEHUB_CHILD_QA_CACHE_API __declspec(dllimport)
#endif

GAMEHUB_CHILD_QA_CACHE_API DWORD WINAPI GameHubChildQaCacheInitialized();
GAMEHUB_CHILD_QA_CACHE_API ULONG_PTR WINAPI GameHubChildQaCachedCreateProcessW();
GAMEHUB_CHILD_QA_CACHE_API ULONG_PTR WINAPI GameHubChildQaCachedCreateProcessA();
GAMEHUB_CHILD_QA_CACHE_API BOOL WINAPI GameHubChildQaCallCachedCreateProcessW(
    LPCWSTR application_name, LPWSTR command_line,
    LPSECURITY_ATTRIBUTES process_attributes,
    LPSECURITY_ATTRIBUTES thread_attributes, BOOL inherit_handles,
    DWORD creation_flags, LPVOID environment, LPCWSTR current_directory,
    LPSTARTUPINFOW startup_info, LPPROCESS_INFORMATION process_information);
GAMEHUB_CHILD_QA_CACHE_API BOOL WINAPI GameHubChildQaCallCachedCreateProcessA(
    LPCSTR application_name, LPSTR command_line,
    LPSECURITY_ATTRIBUTES process_attributes,
    LPSECURITY_ATTRIBUTES thread_attributes, BOOL inherit_handles,
    DWORD creation_flags, LPVOID environment, LPCSTR current_directory,
    LPSTARTUPINFOA startup_info, LPPROCESS_INFORMATION process_information);

}

#undef GAMEHUB_CHILD_QA_CACHE_API
