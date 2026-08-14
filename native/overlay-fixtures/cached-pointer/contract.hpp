#pragma once

#include <windows.h>

#include <cstdint>

namespace gamehub::overlay::cached_pointer_qa {

constexpr DWORD kSchemaVersion = 1;
constexpr DWORD kPreAttachProbe = 0x10203040u;
constexpr DWORD kHookProbe = 0x11223344u;
constexpr DWORD kRestoreProbe = 0x55667788u;
constexpr DWORD kOriginalXorMask = 0xa5a55a5au;
constexpr DWORD kOriginalBias = 0x13579bdfu;
constexpr DWORD kHookXorMask = 0xc0dec0deu;
constexpr wchar_t kBootstrapModuleName[] =
    L"gamehub-overlay-qa-cached-pointer-bootstrap64.dll";

constexpr DWORD RotateLeft7(DWORD value) noexcept {
  return static_cast<DWORD>((value << 7u) | (value >> 25u));
}

constexpr DWORD ExpectedOriginalValue(DWORD input) noexcept {
  return static_cast<DWORD>(
      RotateLeft7(static_cast<DWORD>(input ^ kOriginalXorMask)) +
      kOriginalBias);
}

constexpr DWORD ExpectedHookedValue(DWORD input) noexcept {
  return static_cast<DWORD>(ExpectedOriginalValue(input) ^ kHookXorMask);
}

struct BootstrapSnapshot {
  DWORD structSize;
  DWORD schemaVersion;
  DWORD restoreAfterWithSucceeded;
  DWORD dependencyInitializedBeforeAttach;
  DWORD cachedPointerMatchedTargetBeforeAttach;
  DWORD preAttachProbeValue;
  DWORD expectedPreAttachProbeValue;
  LONG attachError;
  DWORD attached;
  DWORD hookCallCount;
  DWORD detachAttempted;
  LONG detachError;
  ULONG_PTR cachedPointerBeforeAttach;
  ULONG_PTR targetPointerBeforeAttach;
  ULONG_PTR cachedPointerAfterAttach;
  ULONG_PTR cachedPointerAfterDetach;
};

}  // namespace gamehub::overlay::cached_pointer_qa

#if defined(GAMEHUB_CACHED_POINTER_TARGET_EXPORTS)
#define GAMEHUB_CACHED_POINTER_TARGET_API __declspec(dllexport)
#else
#define GAMEHUB_CACHED_POINTER_TARGET_API __declspec(dllimport)
#endif

#if defined(GAMEHUB_CACHED_POINTER_CACHE_EXPORTS)
#define GAMEHUB_CACHED_POINTER_CACHE_API __declspec(dllexport)
#else
#define GAMEHUB_CACHED_POINTER_CACHE_API __declspec(dllimport)
#endif

extern "C" GAMEHUB_CACHED_POINTER_TARGET_API DWORD WINAPI
GameHubCachedPointerTarget(DWORD input);

extern "C" GAMEHUB_CACHED_POINTER_CACHE_API DWORD WINAPI
GameHubCachedPointerCacheCall(DWORD input);
extern "C" GAMEHUB_CACHED_POINTER_CACHE_API DWORD WINAPI
GameHubCachedPointerCacheInitialized();
extern "C" GAMEHUB_CACHED_POINTER_CACHE_API DWORD WINAPI
GameHubCachedPointerCachePreAttachProbeValue();
extern "C" GAMEHUB_CACHED_POINTER_CACHE_API ULONG_PTR WINAPI
GameHubCachedPointerCacheAddress();

extern "C" BOOL WINAPI GameHubCachedPointerQaGetSnapshot(
    gamehub::overlay::cached_pointer_qa::BootstrapSnapshot* output,
    DWORD output_size);
extern "C" DWORD WINAPI GameHubCachedPointerQaDetach();
