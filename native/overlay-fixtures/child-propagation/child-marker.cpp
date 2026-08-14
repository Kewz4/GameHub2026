#include "contract.hpp"

#include <detours.h>
#include <strsafe.h>

#include <array>

namespace {

using gamehub::overlay::child_propagation_qa::ChildHandshake;
using gamehub::overlay::child_propagation_qa::ChildMarkerSnapshot;
using gamehub::overlay::child_propagation_qa::HandshakeState;

volatile LONG g_restore_succeeded = 0;
volatile LONG g_loaded_before_entry = 0;
volatile LONG g_released_before_entry = 0;
DWORD g_process_id = 0;
ULONGLONG g_creation_ticks = 0;

ULONGLONG FileTimeTicks(const FILETIME& value) {
  ULARGE_INTEGER ticks{};
  ticks.LowPart = value.dwLowDateTime;
  ticks.HighPart = value.dwHighDateTime;
  return ticks.QuadPart;
}

bool CurrentIdentity(DWORD* process_id, ULONGLONG* creation_ticks) {
  FILETIME creation{};
  FILETIME exit{};
  FILETIME kernel{};
  FILETIME user{};
  if (!GetProcessTimes(GetCurrentProcess(), &creation, &exit, &kernel, &user)) {
    return false;
  }
  *process_id = GetCurrentProcessId();
  *creation_ticks = FileTimeTicks(creation);
  return *process_id != 0 && *creation_ticks != 0;
}

bool FormatObjectNames(DWORD process_id, ULONGLONG creation_ticks,
                       wchar_t* mapping, size_t mapping_count,
                       wchar_t* ready, size_t ready_count, wchar_t* release,
                       size_t release_count) {
  return SUCCEEDED(StringCchPrintfW(
             mapping, mapping_count, L"Local\\GameHubChildQa_%lu_%I64u_Map",
             process_id, creation_ticks)) &&
         SUCCEEDED(StringCchPrintfW(
             ready, ready_count, L"Local\\GameHubChildQa_%lu_%I64u_Ready",
             process_id, creation_ticks)) &&
         SUCCEEDED(StringCchPrintfW(
             release, release_count,
             L"Local\\GameHubChildQa_%lu_%I64u_Release", process_id,
             creation_ticks));
}

bool EnvironmentEquals(const wchar_t* expected) {
  std::array<wchar_t, 32> value{};
  const DWORD length = GetEnvironmentVariableW(
      L"GAMEHUB_CHILD_QA_MARKER_MODE", value.data(),
      static_cast<DWORD>(value.size()));
  return length != 0 && length < value.size() &&
         CompareStringOrdinal(value.data(), -1, expected, -1, FALSE) ==
             CSTR_EQUAL;
}

void AppendUnsigned(char* output, DWORD* count, DWORD capacity,
                    ULONGLONG value) {
  char digits[32]{};
  DWORD digit_count = 0;
  do {
    digits[digit_count++] = static_cast<char>('0' + value % 10);
    value /= 10;
  } while (value != 0 && digit_count < ARRAYSIZE(digits));
  while (digit_count > 0 && *count < capacity) {
    output[(*count)++] = digits[--digit_count];
  }
}

void WriteParentDeathProof(DWORD process_id, ULONGLONG creation_ticks) {
  std::array<wchar_t, 32'768> proof_path{};
  const DWORD length = GetEnvironmentVariableW(
      L"GAMEHUB_CHILD_QA_CRASH_PROOF", proof_path.data(),
      static_cast<DWORD>(proof_path.size()));
  if (length == 0 || length >= proof_path.size()) return;
  HANDLE file = CreateFileW(proof_path.data(), GENERIC_WRITE, 0, nullptr,
                            CREATE_NEW,
                            FILE_ATTRIBUTE_NORMAL | FILE_FLAG_WRITE_THROUGH,
                            nullptr);
  if (file == INVALID_HANDLE_VALUE) return;
  char digits[80]{};
  DWORD count = 0;
  AppendUnsigned(digits, &count, ARRAYSIZE(digits) - 2, process_id);
  digits[count++] = ',';
  AppendUnsigned(digits, &count, ARRAYSIZE(digits) - 1, creation_ticks);
  digits[count++] = '\n';
  DWORD written = 0;
  WriteFile(file, digits, count, &written, nullptr);
  FlushFileBuffers(file);
  CloseHandle(file);
}

bool PerformHandshake() {
  if (!CurrentIdentity(&g_process_id, &g_creation_ticks)) return false;
  std::array<wchar_t, 160> mapping_name{};
  std::array<wchar_t, 160> ready_name{};
  std::array<wchar_t, 160> release_name{};
  if (!FormatObjectNames(g_process_id, g_creation_ticks, mapping_name.data(),
                         mapping_name.size(), ready_name.data(),
                         ready_name.size(), release_name.data(),
                         release_name.size())) {
    return false;
  }
  HANDLE mapping =
      OpenFileMappingW(FILE_MAP_ALL_ACCESS, FALSE, mapping_name.data());
  HANDLE ready = OpenEventW(EVENT_MODIFY_STATE, FALSE, ready_name.data());
  HANDLE release =
      OpenEventW(SYNCHRONIZE, FALSE, release_name.data());
  HANDLE parent = nullptr;
  if (mapping == nullptr || ready == nullptr || release == nullptr) {
    if (release != nullptr) CloseHandle(release);
    if (ready != nullptr) CloseHandle(ready);
    if (mapping != nullptr) CloseHandle(mapping);
    return false;
  }
  auto* handshake = static_cast<ChildHandshake*>(MapViewOfFile(
      mapping, FILE_MAP_ALL_ACCESS, 0, 0, sizeof(ChildHandshake)));
  if (handshake == nullptr || handshake->structSize != sizeof(ChildHandshake) ||
      handshake->schemaVersion !=
          gamehub::overlay::child_propagation_qa::kSchemaVersion ||
      handshake->magic !=
          gamehub::overlay::child_propagation_qa::kHandshakeMagic ||
      handshake->expectedProcessId != g_process_id ||
      handshake->expectedParentProcessId == 0 ||
      handshake->expectedCreationTicks != g_creation_ticks) {
    if (handshake != nullptr) UnmapViewOfFile(handshake);
    CloseHandle(release);
    CloseHandle(ready);
    CloseHandle(mapping);
    return false;
  }
  parent = OpenProcess(SYNCHRONIZE | PROCESS_QUERY_LIMITED_INFORMATION, FALSE,
                       handshake->expectedParentProcessId);
  if (parent == nullptr) {
    UnmapViewOfFile(handshake);
    CloseHandle(release);
    CloseHandle(ready);
    CloseHandle(mapping);
    return false;
  }
  FILETIME parent_creation{};
  FILETIME parent_exit{};
  FILETIME parent_kernel{};
  FILETIME parent_user{};
  if (!GetProcessTimes(parent, &parent_creation, &parent_exit, &parent_kernel,
                       &parent_user) ||
      FileTimeTicks(parent_creation) != handshake->expectedParentCreationTicks) {
    CloseHandle(parent);
    UnmapViewOfFile(handshake);
    CloseHandle(release);
    CloseHandle(ready);
    CloseHandle(mapping);
    return false;
  }

  if (EnvironmentEquals(L"timeout")) {
    Sleep(gamehub::overlay::child_propagation_qa::kHandshakeTimeoutMs + 2'000);
    InterlockedExchange(&handshake->state,
                        static_cast<LONG>(HandshakeState::kMarkerFailed));
    UnmapViewOfFile(handshake);
    CloseHandle(parent);
    CloseHandle(release);
    CloseHandle(ready);
    CloseHandle(mapping);
    return false;
  }

  handshake->markerProcessId = g_process_id;
  handshake->markerCreationTicks =
      EnvironmentEquals(L"corrupt") ? g_creation_ticks + 1 : g_creation_ticks;
  handshake->restoreAfterWithSucceeded = static_cast<DWORD>(
      InterlockedCompareExchange(&g_restore_succeeded, 0, 0));
  handshake->markerLoadedBeforeEntry = 1;
  InterlockedExchange(&g_loaded_before_entry, 1);
  InterlockedExchange(&handshake->state,
                      static_cast<LONG>(HandshakeState::kMarkerReady));
  const bool ready_signaled = SetEvent(ready) != FALSE;
  HANDLE wait_handles[] = {release, parent};
  const DWORD wait =
      ready_signaled
          ? WaitForMultipleObjects(
                ARRAYSIZE(wait_handles), wait_handles, FALSE,
                gamehub::overlay::child_propagation_qa::kHandshakeTimeoutMs +
                    2'000)
          : WAIT_FAILED;
  const bool released = wait == WAIT_OBJECT_0;
  if (wait == WAIT_OBJECT_0 + 1) {
    WriteParentDeathProof(g_process_id, g_creation_ticks);
    TerminateProcess(GetCurrentProcess(), 78);
    return false;
  }
  InterlockedExchange(
      &handshake->state,
      static_cast<LONG>(released ? HandshakeState::kMarkerReleased
                                 : HandshakeState::kMarkerFailed));
  InterlockedExchange(&g_released_before_entry, released ? 1 : 0);
  UnmapViewOfFile(handshake);
  CloseHandle(parent);
  CloseHandle(release);
  CloseHandle(ready);
  CloseHandle(mapping);
  return released;
}

}  // namespace

extern "C" BOOL WINAPI GameHubChildQaGetMarkerSnapshot(
    ChildMarkerSnapshot* output, DWORD output_size) {
  if (output == nullptr || output_size != sizeof(ChildMarkerSnapshot)) {
    SetLastError(ERROR_INSUFFICIENT_BUFFER);
    return FALSE;
  }
  output->structSize = sizeof(ChildMarkerSnapshot);
  output->schemaVersion =
      gamehub::overlay::child_propagation_qa::kSchemaVersion;
  output->restoreAfterWithSucceeded = static_cast<DWORD>(
      InterlockedCompareExchange(&g_restore_succeeded, 0, 0));
  output->loadedBeforeEntry = static_cast<DWORD>(
      InterlockedCompareExchange(&g_loaded_before_entry, 0, 0));
  output->releasedBeforeEntry = static_cast<DWORD>(
      InterlockedCompareExchange(&g_released_before_entry, 0, 0));
  output->processId = g_process_id;
  output->creationTicks = g_creation_ticks;
  return TRUE;
}

BOOL WINAPI DllMain(HINSTANCE instance, DWORD reason, LPVOID) {
  if (DetourIsHelperProcess()) return TRUE;
  if (reason == DLL_PROCESS_ATTACH) {
    const BOOL restored = DetourRestoreAfterWith();
    InterlockedExchange(&g_restore_succeeded, restored ? 1 : 0);
    DisableThreadLibraryCalls(instance);
    return restored && PerformHandshake();
  }
  return TRUE;
}
