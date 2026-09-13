#include "contract.hpp"

#include <detours.h>

namespace {

using TargetFunction = DWORD(WINAPI*)(DWORD);

TargetFunction g_true_target = &GameHubCachedPointerTarget;
volatile LONG g_restore_after_with_succeeded = 0;
volatile LONG g_dependency_initialized_before_attach = 0;
volatile LONG g_cached_pointer_matched_target_before_attach = 0;
volatile LONG g_pre_attach_probe_value = 0;
volatile LONG g_attach_error = ERROR_INVALID_STATE;
volatile LONG g_attached = 0;
volatile LONG g_hook_call_count = 0;
volatile LONG g_detach_attempted = 0;
volatile LONG g_detach_error = ERROR_INVALID_STATE;
ULONG_PTR g_cached_pointer_before_attach = 0;
ULONG_PTR g_target_pointer_before_attach = 0;
ULONG_PTR g_cached_pointer_after_attach = 0;
ULONG_PTR g_cached_pointer_after_detach = 0;

DWORD WINAPI HookedTarget(DWORD input) {
  InterlockedIncrement(&g_hook_call_count);
  const DWORD original = g_true_target(input);
  return static_cast<DWORD>(
      original ^ gamehub::overlay::cached_pointer_qa::kHookXorMask);
}

LONG AbortTransaction(LONG error) {
  DetourTransactionAbort();
  return error;
}

LONG AttachBeforeApplicationEntry() {
  const DWORD dependency_initialized = GameHubCachedPointerCacheInitialized();
  const DWORD pre_attach_probe =
      GameHubCachedPointerCachePreAttachProbeValue();
  const ULONG_PTR cached_pointer = GameHubCachedPointerCacheAddress();
  const ULONG_PTR target_pointer =
      reinterpret_cast<ULONG_PTR>(&GameHubCachedPointerTarget);

  InterlockedExchange(&g_dependency_initialized_before_attach,
                      dependency_initialized == 1u ? 1 : 0);
  InterlockedExchange(&g_pre_attach_probe_value,
                      static_cast<LONG>(pre_attach_probe));
  g_cached_pointer_before_attach = cached_pointer;
  g_target_pointer_before_attach = target_pointer;
  const bool pointer_matches =
      cached_pointer != 0 && cached_pointer == target_pointer;
  InterlockedExchange(&g_cached_pointer_matched_target_before_attach,
                      pointer_matches ? 1 : 0);

  if (dependency_initialized != 1u || !pointer_matches ||
      pre_attach_probe !=
          gamehub::overlay::cached_pointer_qa::ExpectedOriginalValue(
              gamehub::overlay::cached_pointer_qa::kPreAttachProbe)) {
    return ERROR_INVALID_STATE;
  }

  g_true_target = &GameHubCachedPointerTarget;
  LONG error = DetourTransactionBegin();
  if (error != NO_ERROR) return error;
  error = DetourUpdateThread(GetCurrentThread());
  if (error != NO_ERROR) return AbortTransaction(error);
  error = DetourAttach(reinterpret_cast<PVOID*>(&g_true_target),
                       reinterpret_cast<PVOID>(&HookedTarget));
  if (error != NO_ERROR) return AbortTransaction(error);
  error = DetourTransactionCommit();
  if (error != NO_ERROR) return error;

  g_cached_pointer_after_attach = GameHubCachedPointerCacheAddress();
  InterlockedExchange(&g_attached, 1);
  return NO_ERROR;
}

LONG DetachAfterProof() {
  InterlockedExchange(&g_detach_attempted, 1);
  if (InterlockedCompareExchange(&g_attached, 0, 0) != 1) {
    return ERROR_INVALID_STATE;
  }

  LONG error = DetourTransactionBegin();
  if (error != NO_ERROR) return error;
  error = DetourUpdateThread(GetCurrentThread());
  if (error != NO_ERROR) return AbortTransaction(error);
  error = DetourDetach(reinterpret_cast<PVOID*>(&g_true_target),
                       reinterpret_cast<PVOID>(&HookedTarget));
  if (error != NO_ERROR) return AbortTransaction(error);
  error = DetourTransactionCommit();
  if (error != NO_ERROR) return error;

  g_cached_pointer_after_detach = GameHubCachedPointerCacheAddress();
  InterlockedExchange(&g_attached, 0);
  return NO_ERROR;
}

}  // namespace

extern "C" BOOL WINAPI GameHubCachedPointerQaGetSnapshot(
    gamehub::overlay::cached_pointer_qa::BootstrapSnapshot* output,
    DWORD output_size) {
  using gamehub::overlay::cached_pointer_qa::BootstrapSnapshot;
  if (output == nullptr || output_size != sizeof(BootstrapSnapshot)) {
    SetLastError(ERROR_INSUFFICIENT_BUFFER);
    return FALSE;
  }

  output->structSize = sizeof(BootstrapSnapshot);
  output->schemaVersion = gamehub::overlay::cached_pointer_qa::kSchemaVersion;
  output->restoreAfterWithSucceeded = static_cast<DWORD>(
      InterlockedCompareExchange(&g_restore_after_with_succeeded, 0, 0));
  output->dependencyInitializedBeforeAttach = static_cast<DWORD>(
      InterlockedCompareExchange(&g_dependency_initialized_before_attach, 0,
                                 0));
  output->cachedPointerMatchedTargetBeforeAttach = static_cast<DWORD>(
      InterlockedCompareExchange(
          &g_cached_pointer_matched_target_before_attach, 0, 0));
  output->preAttachProbeValue = static_cast<DWORD>(
      InterlockedCompareExchange(&g_pre_attach_probe_value, 0, 0));
  output->expectedPreAttachProbeValue =
      gamehub::overlay::cached_pointer_qa::ExpectedOriginalValue(
          gamehub::overlay::cached_pointer_qa::kPreAttachProbe);
  output->attachError =
      InterlockedCompareExchange(&g_attach_error, 0, 0);
  output->attached = static_cast<DWORD>(
      InterlockedCompareExchange(&g_attached, 0, 0));
  output->hookCallCount = static_cast<DWORD>(
      InterlockedCompareExchange(&g_hook_call_count, 0, 0));
  output->detachAttempted = static_cast<DWORD>(
      InterlockedCompareExchange(&g_detach_attempted, 0, 0));
  output->detachError =
      InterlockedCompareExchange(&g_detach_error, 0, 0);
  output->cachedPointerBeforeAttach = g_cached_pointer_before_attach;
  output->targetPointerBeforeAttach = g_target_pointer_before_attach;
  output->cachedPointerAfterAttach = g_cached_pointer_after_attach;
  output->cachedPointerAfterDetach = g_cached_pointer_after_detach;
  return TRUE;
}

extern "C" DWORD WINAPI GameHubCachedPointerQaDetach() {
  const LONG error = DetachAfterProof();
  InterlockedExchange(&g_detach_error, error);
  return static_cast<DWORD>(error);
}

BOOL WINAPI DllMain(HINSTANCE instance, DWORD reason, LPVOID reserved) {
  if (DetourIsHelperProcess()) return TRUE;

  if (reason == DLL_PROCESS_ATTACH) {
    const BOOL restored = DetourRestoreAfterWith();
    InterlockedExchange(&g_restore_after_with_succeeded, restored ? 1 : 0);
    DisableThreadLibraryCalls(instance);
    const DWORD restore_error = restored ? NO_ERROR : GetLastError();
    const LONG error =
        restored
            ? AttachBeforeApplicationEntry()
            : static_cast<LONG>(restore_error == NO_ERROR
                                    ? static_cast<DWORD>(ERROR_INVALID_STATE)
                                    : restore_error);
    InterlockedExchange(&g_attach_error, error);
  } else if (reason == DLL_PROCESS_DETACH && reserved == nullptr &&
             InterlockedCompareExchange(&g_attached, 0, 0) == 1) {
    const LONG error = DetachAfterProof();
    InterlockedExchange(&g_detach_error, error);
  }
  return TRUE;
}
