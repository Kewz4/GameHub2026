#include "contract.hpp"

#include <shellapi.h>

namespace {

using gamehub::overlay::child_propagation_qa::ChildMarkerSnapshot;
using MarkerSnapshotFunction = BOOL(WINAPI*)(ChildMarkerSnapshot*, DWORD);

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

void AppendBool(Buffer* output, bool value) {
  AppendLiteral(output, value ? "true" : "false");
}

bool WideEquals(const wchar_t* left, const wchar_t* right) {
  return CompareStringOrdinal(left, -1, right, -1, FALSE) == CSTR_EQUAL;
}

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

bool CurrentDirectoryMatchesExecutableDirectory() {
  static wchar_t executable[32'768];
  static wchar_t directory[32'768];
  const DWORD executable_length =
      GetModuleFileNameW(nullptr, executable, ARRAYSIZE(executable));
  const DWORD directory_length =
      GetCurrentDirectoryW(ARRAYSIZE(directory), directory);
  if (executable_length == 0 || executable_length >= ARRAYSIZE(executable) ||
      directory_length == 0 || directory_length >= ARRAYSIZE(directory)) {
    return false;
  }
  for (DWORD index = executable_length; index > 0; --index) {
    if (executable[index - 1] == L'\\' || executable[index - 1] == L'/') {
      executable[index - 1] = L'\0';
      return CompareStringOrdinal(executable, -1, directory, -1, TRUE) ==
             CSTR_EQUAL;
    }
  }
  return false;
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

extern "C" void WINAPI GameHubChildRendererEntry() {
  int argument_count = 0;
  wchar_t** arguments = CommandLineToArgvW(GetCommandLineW(), &argument_count);
  if (arguments == nullptr || argument_count != 7 ||
      !WideEquals(arguments[1], L"--result") ||
      !WideEquals(arguments[3], L"--token") ||
      !WideEquals(arguments[5], L"--expect-injected") ||
      (!WideEquals(arguments[6], L"0") && !WideEquals(arguments[6], L"1"))) {
    if (arguments != nullptr) LocalFree(arguments);
    Finish(20);
  }

  const bool expect_injected = WideEquals(arguments[6], L"1");
  wchar_t environment_token[512];
  const DWORD environment_length = GetEnvironmentVariableW(
      L"GAMEHUB_CHILD_QA_TOKEN", environment_token,
      ARRAYSIZE(environment_token));
  const bool environment_preserved =
      environment_length != 0 && environment_length < ARRAYSIZE(environment_token) &&
      WideEquals(arguments[4], environment_token);
  const bool current_directory_preserved =
      CurrentDirectoryMatchesExecutableDirectory();

  HMODULE marker = GetModuleHandleW(
      gamehub::overlay::child_propagation_qa::kChildMarkerName);
  const auto get_snapshot =
      marker == nullptr
          ? nullptr
          : reinterpret_cast<MarkerSnapshotFunction>(GetProcAddress(
                marker, "GameHubChildQaGetMarkerSnapshot"));
  ChildMarkerSnapshot snapshot{};
  const bool snapshot_available =
      get_snapshot != nullptr && get_snapshot(&snapshot, sizeof(snapshot));
  DWORD process_id = 0;
  ULONGLONG creation_ticks = 0;
  const bool identity_available =
      CurrentIdentity(&process_id, &creation_ticks);
  const bool marker_identity_matches =
      snapshot_available && identity_available &&
      snapshot.processId == process_id && snapshot.creationTicks == creation_ticks;
  const bool injected_before_entry =
      marker != nullptr && snapshot_available &&
      snapshot.restoreAfterWithSucceeded == 1 && snapshot.loadedBeforeEntry == 1 &&
      snapshot.releasedBeforeEntry == 1 && marker_identity_matches;
  const bool injection_expectation_met =
      expect_injected ? injected_before_entry
                      : marker == nullptr && !snapshot_available;
  const bool proof_passed = injection_expectation_met && environment_preserved &&
                            current_directory_preserved;

  char json[1024];
  Buffer output{json, 0, sizeof(json), true};
  AppendLiteral(&output, "{\"schemaVersion\":1,\"entryReached\":true,");
  AppendLiteral(&output, "\"expectInjected\":");
  AppendBool(&output, expect_injected);
  AppendLiteral(&output, ",\"markerLoadedBeforeEntry\":");
  AppendBool(&output, marker != nullptr);
  AppendLiteral(&output, ",\"markerSnapshotAvailable\":");
  AppendBool(&output, snapshot_available);
  AppendLiteral(&output, ",\"restoreAfterWithSucceeded\":");
  AppendBool(&output,
             snapshot_available && snapshot.restoreAfterWithSucceeded == 1);
  AppendLiteral(&output, ",\"markerHandshakeReleasedBeforeEntry\":");
  AppendBool(&output,
             snapshot_available && snapshot.releasedBeforeEntry == 1);
  AppendLiteral(&output, ",\"markerIdentityMatches\":");
  AppendBool(&output, marker_identity_matches);
  AppendLiteral(&output, ",\"environmentAndUnicodeArgumentsPreserved\":");
  AppendBool(&output, environment_preserved);
  AppendLiteral(&output, ",\"currentDirectoryPreserved\":");
  AppendBool(&output, current_directory_preserved);
  AppendLiteral(&output, ",\"proofPassed\":");
  AppendBool(&output, proof_passed);
  AppendLiteral(&output, "}\n");

  const bool wrote =
      output.valid && WriteResult(arguments[2], output.data, output.size);
  LocalFree(arguments);
  if (!wrote) Finish(21);
  Finish(proof_passed ? 0 : 30);
}
