#include "contract.hpp"

#include <detours.h>

#include <iostream>
#include <string>
#include <vector>

namespace {

constexpr DWORD kParentTimeoutMs = 20'000;

bool EnvironmentEquals(const wchar_t* name, const wchar_t* expected) {
  wchar_t value[8]{};
  const DWORD length = GetEnvironmentVariableW(name, value, ARRAYSIZE(value));
  return length != 0 && length < ARRAYSIZE(value) &&
         CompareStringOrdinal(value, -1, expected, -1, FALSE) == CSTR_EQUAL;
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

bool ExactAnsi(const std::wstring& wide, std::vector<char>* output) {
  BOOL used_default = FALSE;
  const int required = WideCharToMultiByte(
      CP_ACP, WC_NO_BEST_FIT_CHARS, wide.c_str(), -1, nullptr, 0, nullptr,
      &used_default);
  if (required <= 0 || used_default) return false;
  output->assign(static_cast<size_t>(required), '\0');
  used_default = FALSE;
  return WideCharToMultiByte(CP_ACP, WC_NO_BEST_FIT_CHARS, wide.c_str(), -1,
                             output->data(), required, nullptr,
                             &used_default) == required &&
         !used_default;
}

}  // namespace

int wmain(int argument_count, wchar_t** arguments) {
  if (argument_count != 4) {
    std::wcerr << L"usage: child-launcher <mode> <parent-result> <child-result>\n";
    return 90;
  }
  const std::wstring directory = ExecutableDirectory();
  if (directory.empty()) return 91;
  const std::wstring parent =
      directory + L"\\" +
      gamehub::overlay::child_propagation_qa::kParentFixtureName;
  const std::wstring bootstrap =
      directory + L"\\" +
      gamehub::overlay::child_propagation_qa::kParentBootstrapName;
  if (GetFileAttributesW(parent.c_str()) == INVALID_FILE_ATTRIBUTES ||
      GetFileAttributesW(bootstrap.c_str()) == INVALID_FILE_ATTRIBUTES) {
    return 92;
  }
  std::vector<char> bootstrap_ansi;
  if (!ExactAnsi(bootstrap, &bootstrap_ansi)) return 93;
  std::wstring command_line = QuoteWindowsArgument(parent) + L" " +
                              QuoteWindowsArgument(arguments[1]) + L" " +
                              QuoteWindowsArgument(arguments[2]) + L" " +
                              QuoteWindowsArgument(arguments[3]);
  STARTUPINFOW startup{};
  startup.cb = sizeof(startup);
  PROCESS_INFORMATION process{};
  const BOOL created = DetourCreateProcessWithDllW(
      parent.c_str(), command_line.data(), nullptr, nullptr, FALSE,
      CREATE_DEFAULT_ERROR_MODE, nullptr, directory.c_str(), &startup, &process,
      bootstrap_ansi.data(), nullptr);
  if (!created) {
    std::wcerr << L"DetourCreateProcessWithDllW failed: " << GetLastError()
               << L"\n";
    return 94;
  }
  CloseHandle(process.hThread);
  const DWORD wait = WaitForSingleObject(process.hProcess, kParentTimeoutMs);
  if (wait != WAIT_OBJECT_0) {
    TerminateProcess(process.hProcess, 95);
    WaitForSingleObject(process.hProcess, 5'000);
    CloseHandle(process.hProcess);
    return 95;
  }
  DWORD exit_code = 96;
  if (!GetExitCodeProcess(process.hProcess, &exit_code)) {
    CloseHandle(process.hProcess);
    return 96;
  }
  CloseHandle(process.hProcess);
  if (exit_code == 77 &&
      EnvironmentEquals(L"GAMEHUB_CHILD_QA_PARENT_CRASH_AFTER_READY", L"1")) {
    // The injected parent intentionally dies while its marker-blocked child is
    // still alive. Detach from inherited stdio so spawnSync can observe the
    // parent exit immediately; the separate proof file authenticates the
    // child's PID + creation FILETIME and the test waits for that identity.
    FreeConsole();
    SetStdHandle(STD_INPUT_HANDLE, nullptr);
    SetStdHandle(STD_OUTPUT_HANDLE, nullptr);
    SetStdHandle(STD_ERROR_HANDLE, nullptr);
  }
  return static_cast<int>(exit_code);
}
