#include "contract.hpp"

#include <windows.h>

#include <filesystem>
#include <cstring>
#include <cwchar>
#include <sstream>
#include <string>
#include <vector>

namespace {

using gamehub::overlay::child_propagation_qa::CapabilityState;
using gamehub::overlay::child_propagation_qa::ParentBootstrapSnapshot;
using SnapshotFunction = BOOL(WINAPI*)(ParentBootstrapSnapshot*, DWORD);

struct Mode {
  bool ansi = false;
  bool callerSuspended = false;
  bool unknown = false;
  bool ambiguous = false;
  bool expectedAbort = false;
  const wchar_t* markerMode = L"normal";
};

bool ParseMode(const wchar_t* value, Mode* mode) {
  if (wcscmp(value, L"exact-w") == 0) return true;
  if (wcscmp(value, L"exact-w-suspended") == 0) {
    mode->callerSuspended = true;
    return true;
  }
  if (wcscmp(value, L"exact-a") == 0) {
    mode->ansi = true;
    return true;
  }
  if (wcscmp(value, L"unknown-w") == 0) {
    mode->unknown = true;
    return true;
  }
  if (wcscmp(value, L"ambiguous-w") == 0) {
    mode->ambiguous = true;
    return true;
  }
  if (wcscmp(value, L"timeout-w") == 0) {
    mode->expectedAbort = true;
    mode->markerMode = L"timeout";
    return true;
  }
  if (wcscmp(value, L"corrupt-w") == 0) {
    mode->expectedAbort = true;
    mode->markerMode = L"corrupt";
    return true;
  }
  if (wcscmp(value, L"parent-death-w") == 0) return true;
  return false;
}

std::wstring ExecutableDirectory() {
  std::vector<wchar_t> buffer(32'768);
  const DWORD length = GetModuleFileNameW(
      nullptr, buffer.data(), static_cast<DWORD>(buffer.size()));
  if (length == 0 || length >= buffer.size()) return {};
  std::wstring path(buffer.data(), length);
  const size_t separator = path.find_last_of(L"\\/");
  if (separator == std::wstring::npos) return {};
  path.resize(separator);
  return path;
}

std::wstring QuoteWindowsArgument(const std::wstring& value) {
  std::wstring quoted(1, L'"');
  size_t backslashes = 0;
  for (const wchar_t character : value) {
    if (character == L'\\') {
      ++backslashes;
      continue;
    }
    if (character == L'"') {
      quoted.append(backslashes * 2 + 1, L'\\');
      quoted.push_back(L'"');
      backslashes = 0;
      continue;
    }
    quoted.append(backslashes, L'\\');
    backslashes = 0;
    quoted.push_back(character);
  }
  quoted.append(backslashes * 2, L'\\');
  quoted.push_back(L'"');
  return quoted;
}

bool ExactAnsi(const std::wstring& wide, std::string* ansi) {
  BOOL used_default = FALSE;
  const int required = WideCharToMultiByte(
      CP_ACP, WC_NO_BEST_FIT_CHARS, wide.c_str(), -1, nullptr, 0, nullptr,
      &used_default);
  if (required <= 0 || used_default) return false;
  ansi->assign(static_cast<size_t>(required), '\0');
  used_default = FALSE;
  return WideCharToMultiByte(CP_ACP, WC_NO_BEST_FIT_CHARS, wide.c_str(), -1,
                             ansi->data(), required, nullptr,
                             &used_default) == required &&
         !used_default;
}

std::vector<wchar_t> BuildEnvironmentW(const std::wstring& token,
                                       const wchar_t* marker_mode) {
  std::vector<wchar_t> environment;
  LPWCH inherited = GetEnvironmentStringsW();
  if (inherited != nullptr) {
    const wchar_t* cursor = inherited;
    while (*cursor != L'\0') {
      const size_t length = wcslen(cursor) + 1;
      environment.insert(environment.end(), cursor, cursor + length);
      cursor += length;
    }
    FreeEnvironmentStringsW(inherited);
  }
  const std::wstring token_entry = L"GAMEHUB_CHILD_QA_TOKEN=" + token;
  const std::wstring mode_entry =
      std::wstring(L"GAMEHUB_CHILD_QA_MARKER_MODE=") + marker_mode;
  environment.insert(environment.end(), token_entry.begin(), token_entry.end());
  environment.push_back(L'\0');
  environment.insert(environment.end(), mode_entry.begin(), mode_entry.end());
  environment.push_back(L'\0');
  environment.push_back(L'\0');
  return environment;
}

std::vector<char> BuildEnvironmentA(const std::string& token) {
  std::vector<char> environment;
  const std::string token_entry = "GAMEHUB_CHILD_QA_TOKEN=" + token;
  const std::string mode_entry = "GAMEHUB_CHILD_QA_MARKER_MODE=normal";
  environment.insert(environment.end(), token_entry.begin(), token_entry.end());
  environment.push_back('\0');
  environment.insert(environment.end(), mode_entry.begin(), mode_entry.end());
  environment.push_back('\0');
  environment.push_back('\0');
  return environment;
}

bool WriteResult(const wchar_t* path, const std::string& text) {
  if (text.size() > MAXDWORD) return false;
  HANDLE file = CreateFileW(path, GENERIC_WRITE, 0, nullptr, CREATE_NEW,
                            FILE_ATTRIBUTE_NORMAL | FILE_FLAG_WRITE_THROUGH,
                            nullptr);
  if (file == INVALID_HANDLE_VALUE) return false;
  DWORD written = 0;
  const bool succeeded = WriteFile(file, text.data(),
                                   static_cast<DWORD>(text.size()), &written,
                                   nullptr) &&
                         written == text.size() && FlushFileBuffers(file);
  CloseHandle(file);
  return succeeded;
}

void AppendBool(std::ostringstream& output, bool value) {
  output << (value ? "true" : "false");
}

}  // namespace

int wmain(int argument_count, wchar_t** arguments) {
  if (argument_count != 4) return 90;
  Mode mode{};
  if (!ParseMode(arguments[1], &mode)) return 91;
  const std::wstring directory = ExecutableDirectory();
  if (directory.empty()) return 92;

  const wchar_t* child_name =
      mode.unknown
          ? gamehub::overlay::child_propagation_qa::kUnknownRendererName
          : gamehub::overlay::child_propagation_qa::kRendererName;
  const std::wstring child_path = directory + L"\\" + child_name;
  const bool expect_injected = !mode.unknown && !mode.ambiguous;
  const std::wstring token = mode.ansi
                                 ? L"GameHub ASCII spaces quoted-value"
                                 : L"GameHub Ω 雪 🎮 spaces \"quoted\"";
  std::wstring command_line =
      QuoteWindowsArgument(child_path) + L" --result " +
      QuoteWindowsArgument(arguments[3]) + L" --token " +
      QuoteWindowsArgument(token) + L" --expect-injected " +
      (expect_injected ? L"1" : L"0");

  SECURITY_ATTRIBUTES process_attributes{sizeof(SECURITY_ATTRIBUTES), nullptr,
                                         FALSE};
  SECURITY_ATTRIBUTES thread_attributes{sizeof(SECURITY_ATTRIBUTES), nullptr,
                                        FALSE};
  PROCESS_INFORMATION process{};
  DWORD original_flags = CREATE_DEFAULT_ERROR_MODE;
  if (mode.callerSuspended) original_flags |= CREATE_SUSPENDED;
  BOOL created = FALSE;
  DWORD create_error = ERROR_SUCCESS;
  ULONG_PTR expected_startup_pointer = 0;
  ULONG_PTR expected_environment_pointer = 0;

  std::vector<unsigned char> attribute_storage;
  LPPROC_THREAD_ATTRIBUTE_LIST attribute_list = nullptr;
  STARTUPINFOEXW startup_w{};
  STARTUPINFOA startup_a{};
  std::vector<wchar_t> environment_w;
  std::vector<char> environment_a;

  if (mode.ansi) {
    std::string child_ansi;
    std::string command_ansi;
    std::string directory_ansi;
    std::string token_ansi;
    if (!ExactAnsi(child_path, &child_ansi) ||
        !ExactAnsi(command_line, &command_ansi) ||
        !ExactAnsi(directory, &directory_ansi) || !ExactAnsi(token, &token_ansi)) {
      return 93;
    }
    environment_a = BuildEnvironmentA(token_ansi.c_str());
    startup_a.cb = sizeof(startup_a);
    expected_startup_pointer = reinterpret_cast<ULONG_PTR>(&startup_a);
    expected_environment_pointer =
        reinterpret_cast<ULONG_PTR>(environment_a.data());
    created = GameHubChildQaCallCachedCreateProcessA(
        child_ansi.c_str(), command_ansi.data(), &process_attributes,
        &thread_attributes, FALSE, original_flags, environment_a.data(),
        directory_ansi.c_str(), &startup_a, &process);
  } else {
    SIZE_T attribute_bytes = 0;
    InitializeProcThreadAttributeList(nullptr, 1, 0, &attribute_bytes);
    if (attribute_bytes == 0) return 94;
    attribute_storage.resize(attribute_bytes);
    attribute_list = reinterpret_cast<LPPROC_THREAD_ATTRIBUTE_LIST>(
        attribute_storage.data());
    if (!InitializeProcThreadAttributeList(attribute_list, 1, 0,
                                           &attribute_bytes)) {
      return 95;
    }
    const DWORD64 mitigation = PROCESS_CREATION_MITIGATION_POLICY_DEP_ENABLE;
    if (!UpdateProcThreadAttribute(
            attribute_list, 0, PROC_THREAD_ATTRIBUTE_MITIGATION_POLICY,
            const_cast<DWORD64*>(&mitigation), sizeof(mitigation), nullptr,
            nullptr)) {
      DeleteProcThreadAttributeList(attribute_list);
      return 96;
    }
    startup_w.StartupInfo.cb = sizeof(startup_w);
    startup_w.lpAttributeList = attribute_list;
    environment_w = BuildEnvironmentW(token, mode.markerMode);
    original_flags |= CREATE_UNICODE_ENVIRONMENT |
                      EXTENDED_STARTUPINFO_PRESENT;
    expected_startup_pointer = reinterpret_cast<ULONG_PTR>(&startup_w);
    expected_environment_pointer =
        reinterpret_cast<ULONG_PTR>(environment_w.data());
    created = GameHubChildQaCallCachedCreateProcessW(
        mode.ambiguous ? nullptr : child_path.c_str(), command_line.data(),
        &process_attributes, &thread_attributes, FALSE, original_flags,
        environment_w.data(), directory.c_str(), &startup_w.StartupInfo,
        &process);
    DeleteProcThreadAttributeList(attribute_list);
  }
  if (!created) create_error = GetLastError();

  DWORD caller_resume_previous_count = MAXDWORD;
  bool child_exited = false;
  DWORD child_exit_code = MAXDWORD;
  if (created) {
    if (mode.callerSuspended) {
      caller_resume_previous_count = ResumeThread(process.hThread);
    }
    CloseHandle(process.hThread);
    process.hThread = nullptr;
    const DWORD wait = WaitForSingleObject(process.hProcess, 10'000);
    child_exited = wait == WAIT_OBJECT_0;
    if (!child_exited) {
      TerminateProcess(process.hProcess, 97);
      WaitForSingleObject(process.hProcess, 5'000);
    }
    GetExitCodeProcess(process.hProcess, &child_exit_code);
    CloseHandle(process.hProcess);
    process.hProcess = nullptr;
  }

  HMODULE bootstrap = GetModuleHandleW(
      gamehub::overlay::child_propagation_qa::kParentBootstrapName);
  const auto get_snapshot =
      bootstrap == nullptr
          ? nullptr
          : reinterpret_cast<SnapshotFunction>(GetProcAddress(
                bootstrap, "GameHubChildQaGetParentSnapshot"));
  ParentBootstrapSnapshot snapshot{};
  const bool snapshot_available =
      get_snapshot != nullptr && get_snapshot(&snapshot, sizeof(snapshot));
  const bool cached_pointer_proof =
      snapshot_available && snapshot.cacheInitializedBeforeAttach == 1 &&
      snapshot.cachedPointersMatchedBeforeAttach == 1 &&
      snapshot.cachedCreateProcessW == snapshot.targetCreateProcessW &&
      snapshot.cachedCreateProcessA == snapshot.targetCreateProcessA;
  const bool hook_forwarding_echo_matches =
      snapshot_available &&
      snapshot.lastProcessAttributes ==
          reinterpret_cast<ULONG_PTR>(&process_attributes) &&
      snapshot.lastThreadAttributes ==
          reinterpret_cast<ULONG_PTR>(&thread_attributes) &&
      snapshot.lastEnvironment == expected_environment_pointer &&
      snapshot.lastStartupInfoForwarded == expected_startup_pointer &&
      snapshot.lastInheritHandlesForwarded == 0 &&
      snapshot.lastOriginalFlags == original_flags &&
      snapshot.lastForwardedFlags == (original_flags | CREATE_SUSPENDED);
  const bool suspended_semantics =
      !mode.callerSuspended || caller_resume_previous_count == 1;

  bool proof_passed = false;
  if (mode.expectedAbort) {
    proof_passed = !created && process.hProcess == nullptr &&
                   process.hThread == nullptr && snapshot_available &&
                   snapshot.capabilityState ==
                       static_cast<DWORD>(CapabilityState::kUnavailable) &&
                   snapshot.exactAttempts == 1 &&
                   snapshot.abortedNeverStartedChildren == 1;
  } else if (mode.unknown || mode.ambiguous) {
    proof_passed = created && child_exited && child_exit_code == 0 &&
                   snapshot_available && snapshot.passthroughChildren == 1 &&
                   snapshot.instrumentedChildren == 0 &&
                   snapshot.capabilityState ==
                       static_cast<DWORD>(CapabilityState::kUnavailable);
  } else {
    proof_passed = created && child_exited && child_exit_code == 0 &&
                   snapshot_available && cached_pointer_proof &&
                   hook_forwarding_echo_matches && suspended_semantics &&
                   snapshot.exactAttempts == 1 &&
                   snapshot.instrumentedChildren == 1 &&
                   snapshot.lastHandshakeReady == 1 &&
                   snapshot.lastIdentityValid == 1 &&
                   snapshot.lastSuspendBalanceValid == 1 &&
                   snapshot.capabilityState ==
                       static_cast<DWORD>(CapabilityState::kReady);
  }

  std::ostringstream output;
  output << "{\"schemaVersion\":1,\"parentEntryReached\":true,";
  output << "\"bootstrapLoadedBeforeEntry\":";
  AppendBool(output, bootstrap != nullptr);
  output << ",\"snapshotAvailable\":";
  AppendBool(output, snapshot_available);
  output << ",\"cachedCreateProcessPointerProof\":";
  AppendBool(output, cached_pointer_proof);
  output << ",\"processCreated\":";
  AppendBool(output, created != FALSE);
  output << ",\"createError\":" << create_error;
  output << ",\"childExited\":";
  AppendBool(output, child_exited);
  output << ",\"childExitCode\":" << child_exit_code;
  output << ",\"callerResumePreviousCount\":"
         << caller_resume_previous_count;
  output << ",\"callerSuspendSemanticsPreserved\":";
  AppendBool(output, suspended_semantics);
  output << ",\"hookForwardingEchoMatches\":";
  AppendBool(output, hook_forwarding_echo_matches);
  output << ",\"hookCallsW\":"
         << (snapshot_available ? snapshot.hookCallsW : 0);
  output << ",\"hookCallsA\":"
         << (snapshot_available ? snapshot.hookCallsA : 0);
  output << ",\"exactAttempts\":"
         << (snapshot_available ? snapshot.exactAttempts : 0);
  output << ",\"instrumentedChildren\":"
         << (snapshot_available ? snapshot.instrumentedChildren : 0);
  output << ",\"abortedNeverStartedChildren\":"
         << (snapshot_available ? snapshot.abortedNeverStartedChildren : 0);
  output << ",\"passthroughChildren\":"
         << (snapshot_available ? snapshot.passthroughChildren : 0);
  output << ",\"capabilityState\":"
         << (snapshot_available ? snapshot.capabilityState : 0);
  output << ",\"proofPassed\":";
  AppendBool(output, proof_passed);
  output << "}\n";

  if (!WriteResult(arguments[2], output.str())) return 98;
  return proof_passed ? 0 : 30;
}
