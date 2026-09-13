#include "contract.hpp"

#include <shellapi.h>

namespace {

using gamehub::overlay::cached_pointer_qa::BootstrapSnapshot;
using SnapshotFunction = BOOL(WINAPI*)(BootstrapSnapshot*, DWORD);
using DetachFunction = DWORD(WINAPI*)();

struct Buffer {
  char* data;
  SIZE_T size;
  SIZE_T capacity;
  bool valid;
};

void AppendBytes(Buffer* output, const char* value, SIZE_T length) {
  if (!output->valid || length > output->capacity - output->size) {
    output->valid = false;
    return;
  }
  for (SIZE_T index = 0; index < length; ++index) {
    output->data[output->size + index] = value[index];
  }
  output->size += length;
}

void AppendLiteral(Buffer* output, const char* value) {
  SIZE_T length = 0;
  while (value[length] != '\0') ++length;
  AppendBytes(output, value, length);
}

void AppendUnsigned(Buffer* output, unsigned long long value) {
  char digits[32];
  SIZE_T count = 0;
  do {
    digits[count++] = static_cast<char>('0' + value % 10u);
    value /= 10u;
  } while (value != 0);
  while (count > 0) {
    --count;
    AppendBytes(output, &digits[count], 1);
  }
}

void AppendBool(Buffer* output, bool value) {
  AppendLiteral(output, value ? "true" : "false");
}

void AppendPointerString(Buffer* output, ULONG_PTR value) {
  AppendLiteral(output, "\"");
  AppendUnsigned(output, static_cast<unsigned long long>(value));
  AppendLiteral(output, "\"");
}

bool WideEquals(const wchar_t* left, const wchar_t* right) {
  SIZE_T index = 0;
  while (left[index] != L'\0' && right[index] != L'\0') {
    if (left[index] != right[index]) return false;
    ++index;
  }
  return left[index] == right[index];
}

void ClearSnapshot(BootstrapSnapshot* snapshot) {
  snapshot->structSize = 0;
  snapshot->schemaVersion = 0;
  snapshot->restoreAfterWithSucceeded = 0;
  snapshot->dependencyInitializedBeforeAttach = 0;
  snapshot->cachedPointerMatchedTargetBeforeAttach = 0;
  snapshot->preAttachProbeValue = 0;
  snapshot->expectedPreAttachProbeValue = 0;
  snapshot->attachError = 0;
  snapshot->attached = 0;
  snapshot->hookCallCount = 0;
  snapshot->detachAttempted = 0;
  snapshot->detachError = 0;
  snapshot->cachedPointerBeforeAttach = 0;
  snapshot->targetPointerBeforeAttach = 0;
  snapshot->cachedPointerAfterAttach = 0;
  snapshot->cachedPointerAfterDetach = 0;
}

bool WriteResult(const wchar_t* result_path, const char* data, SIZE_T size) {
  if (size > MAXDWORD) return false;
  HANDLE result =
      CreateFileW(result_path, GENERIC_WRITE, 0, nullptr, CREATE_NEW,
                  FILE_ATTRIBUTE_NORMAL | FILE_FLAG_WRITE_THROUGH, nullptr);
  if (result == INVALID_HANDLE_VALUE) return false;
  DWORD written = 0;
  const bool succeeded =
      WriteFile(result, data, static_cast<DWORD>(size), &written, nullptr) &&
      written == size && FlushFileBuffers(result);
  CloseHandle(result);
  return succeeded;
}

[[noreturn]] void Finish(DWORD exit_code) { ExitProcess(exit_code); }

}  // namespace

extern "C" void WINAPI GameHubCachedPointerFixtureEntry() {
  int argument_count = 0;
  wchar_t** arguments = CommandLineToArgvW(GetCommandLineW(), &argument_count);
  if (arguments == nullptr || argument_count != 3 ||
      !WideEquals(arguments[1], L"--result")) {
    if (arguments != nullptr) LocalFree(arguments);
    Finish(20);
  }

  HMODULE bootstrap = GetModuleHandleW(
      gamehub::overlay::cached_pointer_qa::kBootstrapModuleName);
  const auto get_snapshot =
      bootstrap == nullptr
          ? nullptr
          : reinterpret_cast<SnapshotFunction>(
                GetProcAddress(bootstrap,
                               "GameHubCachedPointerQaGetSnapshot"));
  const auto detach =
      bootstrap == nullptr
          ? nullptr
          : reinterpret_cast<DetachFunction>(
                GetProcAddress(bootstrap, "GameHubCachedPointerQaDetach"));

  BootstrapSnapshot before;
  BootstrapSnapshot after_hook;
  BootstrapSnapshot after_detach;
  BootstrapSnapshot final_snapshot;
  ClearSnapshot(&before);
  ClearSnapshot(&after_hook);
  ClearSnapshot(&after_detach);
  ClearSnapshot(&final_snapshot);
  const bool bootstrap_loaded_before_entry = bootstrap != nullptr;
  const bool snapshot_before_available =
      get_snapshot != nullptr && get_snapshot(&before, sizeof(before));
  const DWORD hook_calls_before =
      snapshot_before_available ? before.hookCallCount : 0u;

  // This is the pointer cached by the dependency's DllMain before the injected
  // bootstrap started DetourAttach. No pointer refresh occurs here.
  const DWORD hooked_call_value = GameHubCachedPointerCacheCall(
      gamehub::overlay::cached_pointer_qa::kHookProbe);
  const bool snapshot_after_hook_available =
      get_snapshot != nullptr &&
      get_snapshot(&after_hook, sizeof(after_hook));
  const bool cached_call_reached_hook =
      snapshot_before_available && snapshot_after_hook_available &&
      hooked_call_value ==
          gamehub::overlay::cached_pointer_qa::ExpectedHookedValue(
              gamehub::overlay::cached_pointer_qa::kHookProbe) &&
      after_hook.hookCallCount == hook_calls_before + 1u;

  const DWORD detach_error =
      detach == nullptr ? ERROR_INVALID_STATE : detach();
  const bool snapshot_after_detach_available =
      get_snapshot != nullptr &&
      get_snapshot(&after_detach, sizeof(after_detach));
  const DWORD hook_calls_after_detach =
      snapshot_after_detach_available ? after_detach.hookCallCount : 0u;

  // The same cached address is called again after DetourDetach. It must now
  // execute the restored original prologue without incrementing hook state.
  const DWORD restored_call_value = GameHubCachedPointerCacheCall(
      gamehub::overlay::cached_pointer_qa::kRestoreProbe);
  const bool final_snapshot_available =
      get_snapshot != nullptr &&
      get_snapshot(&final_snapshot, sizeof(final_snapshot));
  const bool restored_call_was_original =
      snapshot_after_detach_available && final_snapshot_available &&
      detach_error == NO_ERROR && after_detach.attached == 0u &&
      restored_call_value ==
          gamehub::overlay::cached_pointer_qa::ExpectedOriginalValue(
              gamehub::overlay::cached_pointer_qa::kRestoreProbe) &&
      final_snapshot.hookCallCount == hook_calls_after_detach;

  const ULONG_PTR current_cached_pointer =
      GameHubCachedPointerCacheAddress();
  const bool cached_pointer_address_stable =
      snapshot_before_available && snapshot_after_detach_available &&
      before.cachedPointerBeforeAttach != 0u &&
      before.cachedPointerBeforeAttach == before.targetPointerBeforeAttach &&
      before.cachedPointerBeforeAttach == before.cachedPointerAfterAttach &&
      before.cachedPointerBeforeAttach == after_detach.cachedPointerAfterDetach &&
      before.cachedPointerBeforeAttach == current_cached_pointer;
  const bool dependency_proof =
      snapshot_before_available &&
      before.restoreAfterWithSucceeded == 1u &&
      before.dependencyInitializedBeforeAttach == 1u &&
      before.cachedPointerMatchedTargetBeforeAttach == 1u &&
      before.preAttachProbeValue == before.expectedPreAttachProbeValue &&
      before.preAttachProbeValue ==
          gamehub::overlay::cached_pointer_qa::ExpectedOriginalValue(
              gamehub::overlay::cached_pointer_qa::kPreAttachProbe);
  const bool hook_attached_before_entry =
      snapshot_before_available && before.attachError == NO_ERROR &&
      before.attached == 1u;
  const bool proof_passed =
      bootstrap_loaded_before_entry && dependency_proof &&
      hook_attached_before_entry && cached_call_reached_hook &&
      restored_call_was_original && cached_pointer_address_stable;

  char json[2048];
  Buffer output{json, 0, sizeof(json), true};
  AppendLiteral(&output, "{\"schemaVersion\":1,\"entryReached\":true,");
  AppendLiteral(&output, "\"bootstrapLoadedBeforeEntry\":");
  AppendBool(&output, bootstrap_loaded_before_entry);
  AppendLiteral(&output, ",\"snapshotBeforeAvailable\":");
  AppendBool(&output, snapshot_before_available);
  AppendLiteral(&output, ",\"restoreAfterWithSucceeded\":");
  AppendBool(&output, snapshot_before_available &&
                          before.restoreAfterWithSucceeded == 1u);
  AppendLiteral(&output, ",\"dependencyInitializedBeforeAttach\":");
  AppendBool(&output, snapshot_before_available &&
                          before.dependencyInitializedBeforeAttach == 1u);
  AppendLiteral(&output, ",\"cachedPointerMatchedTargetBeforeAttach\":");
  AppendBool(&output, snapshot_before_available &&
                          before.cachedPointerMatchedTargetBeforeAttach == 1u);
  AppendLiteral(&output, ",\"preAttachProbeValue\":");
  AppendUnsigned(&output, snapshot_before_available
                              ? before.preAttachProbeValue
                              : 0u);
  AppendLiteral(&output, ",\"expectedPreAttachProbeValue\":");
  AppendUnsigned(
      &output,
      gamehub::overlay::cached_pointer_qa::ExpectedOriginalValue(
          gamehub::overlay::cached_pointer_qa::kPreAttachProbe));
  AppendLiteral(&output, ",\"attachError\":");
  AppendUnsigned(&output, snapshot_before_available
                              ? static_cast<DWORD>(before.attachError)
                              : static_cast<DWORD>(ERROR_INVALID_STATE));
  AppendLiteral(&output, ",\"hookAttachedBeforeEntry\":");
  AppendBool(&output, hook_attached_before_entry);
  AppendLiteral(&output, ",\"hookCallsBefore\":");
  AppendUnsigned(&output, hook_calls_before);
  AppendLiteral(&output, ",\"hookedCallValue\":");
  AppendUnsigned(&output, hooked_call_value);
  AppendLiteral(&output, ",\"expectedHookedCallValue\":");
  AppendUnsigned(
      &output, gamehub::overlay::cached_pointer_qa::ExpectedHookedValue(
                   gamehub::overlay::cached_pointer_qa::kHookProbe));
  AppendLiteral(&output, ",\"hookCallsAfter\":");
  AppendUnsigned(&output, snapshot_after_hook_available
                              ? after_hook.hookCallCount
                              : 0u);
  AppendLiteral(&output, ",\"cachedCallReachedHook\":");
  AppendBool(&output, cached_call_reached_hook);
  AppendLiteral(&output, ",\"detachError\":");
  AppendUnsigned(&output, detach_error);
  AppendLiteral(&output, ",\"detached\":");
  AppendBool(&output, snapshot_after_detach_available &&
                          after_detach.attached == 0u &&
                          after_detach.detachAttempted == 1u &&
                          after_detach.detachError == NO_ERROR);
  AppendLiteral(&output, ",\"restoredCallValue\":");
  AppendUnsigned(&output, restored_call_value);
  AppendLiteral(&output, ",\"expectedRestoredCallValue\":");
  AppendUnsigned(
      &output, gamehub::overlay::cached_pointer_qa::ExpectedOriginalValue(
                   gamehub::overlay::cached_pointer_qa::kRestoreProbe));
  AppendLiteral(&output, ",\"hookCallsAfterRestore\":");
  AppendUnsigned(&output, final_snapshot_available
                              ? final_snapshot.hookCallCount
                              : 0u);
  AppendLiteral(&output, ",\"restoredCallWasOriginal\":");
  AppendBool(&output, restored_call_was_original);
  AppendLiteral(&output, ",\"cachedPointerBeforeAttach\":");
  AppendPointerString(&output, snapshot_before_available
                                   ? before.cachedPointerBeforeAttach
                                   : 0u);
  AppendLiteral(&output, ",\"targetPointerBeforeAttach\":");
  AppendPointerString(&output, snapshot_before_available
                                   ? before.targetPointerBeforeAttach
                                   : 0u);
  AppendLiteral(&output, ",\"cachedPointerAfterAttach\":");
  AppendPointerString(&output, snapshot_before_available
                                   ? before.cachedPointerAfterAttach
                                   : 0u);
  AppendLiteral(&output, ",\"cachedPointerAfterDetach\":");
  AppendPointerString(&output, snapshot_after_detach_available
                                   ? after_detach.cachedPointerAfterDetach
                                   : 0u);
  AppendLiteral(&output, ",\"currentCachedPointer\":");
  AppendPointerString(&output, current_cached_pointer);
  AppendLiteral(&output, ",\"cachedPointerAddressStable\":");
  AppendBool(&output, cached_pointer_address_stable);
  AppendLiteral(&output, ",\"proofPassed\":");
  AppendBool(&output, proof_passed);
  AppendLiteral(&output, "}\n");

  const bool wrote_result =
      output.valid && WriteResult(arguments[2], output.data, output.size);
  LocalFree(arguments);
  if (!wrote_result) Finish(21);
  Finish(proof_passed ? 0u : 30u);
}
