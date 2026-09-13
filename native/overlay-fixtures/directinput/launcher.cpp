// clang-format off: Windows types must be visible before the Detours header.
#include <windows.h>
#include <detours.h>
// clang-format on

#include <iostream>
#include <string>
#include <vector>

namespace {

constexpr wchar_t kFixtureName[] =
    L"gamehub-overlay-qa-directinput-fixture.exe";
constexpr wchar_t kBootstrapName[] =
    L"gamehub-overlay-qa-directinput-bootstrap64.dll";

std::wstring ExecutableDirectory() {
  std::vector<wchar_t> buffer(32'768);
  const DWORD length = GetModuleFileNameW(nullptr, buffer.data(),
                                          static_cast<DWORD>(buffer.size()));
  if (length == 0 || length >= buffer.size())
    return {};
  std::wstring path(buffer.data(), length);
  const std::wstring::size_type separator = path.find_last_of(L"\\/");
  if (separator == std::wstring::npos)
    return {};
  path.resize(separator);
  return path;
}

std::wstring QuoteWindowsArgument(const std::wstring &value) {
  std::wstring quoted(1, L'\"');
  std::size_t backslashes = 0;
  for (const wchar_t character : value) {
    if (character == L'\\') {
      ++backslashes;
      continue;
    }
    if (character == L'\"') {
      quoted.append(backslashes * 2u + 1u, L'\\');
      quoted.push_back(L'\"');
      backslashes = 0;
      continue;
    }
    quoted.append(backslashes, L'\\');
    backslashes = 0;
    quoted.push_back(character);
  }
  quoted.append(backslashes * 2u, L'\\');
  quoted.push_back(L'\"');
  return quoted;
}

bool ExactAnsiPath(const std::wstring &wide, std::vector<char> *output) {
  BOOL used_default = FALSE;
  const int required =
      WideCharToMultiByte(CP_ACP, WC_NO_BEST_FIT_CHARS, wide.c_str(), -1,
                          nullptr, 0, nullptr, &used_default);
  if (required <= 0 || used_default)
    return false;
  output->assign(static_cast<std::size_t>(required), '\0');
  used_default = FALSE;
  const int written =
      WideCharToMultiByte(CP_ACP, WC_NO_BEST_FIT_CHARS, wide.c_str(), -1,
                          output->data(), required, nullptr, &used_default);
  return written == required && !used_default;
}

bool WriteIdentityFile(const std::wstring &path, HANDLE process, DWORD pid) {
  FILETIME created{};
  FILETIME exited{};
  FILETIME kernel{};
  FILETIME user{};
  if (!GetProcessTimes(process, &created, &exited, &kernel, &user)) {
    return false;
  }
  ULARGE_INTEGER ticks{};
  ticks.LowPart = created.dwLowDateTime;
  ticks.HighPart = created.dwHighDateTime;
  const std::string value =
      std::to_string(pid) + " " + std::to_string(ticks.QuadPart) + "\n";
  HANDLE file =
      CreateFileW(path.c_str(), GENERIC_WRITE, 0, nullptr, CREATE_NEW,
                  FILE_ATTRIBUTE_NORMAL | FILE_FLAG_WRITE_THROUGH, nullptr);
  if (file == INVALID_HANDLE_VALUE)
    return false;
  DWORD written = 0;
  const bool succeeded =
      WriteFile(file, value.data(), static_cast<DWORD>(value.size()), &written,
                nullptr) &&
      written == value.size() && FlushFileBuffers(file);
  CloseHandle(file);
  return succeeded;
}

bool ParseTimeout(const wchar_t *value, DWORD *timeout) {
  wchar_t *end = nullptr;
  const unsigned long parsed = wcstoul(value, &end, 10);
  if (end == value || *end != L'\0' || parsed < 100 || parsed > 60'000) {
    return false;
  }
  *timeout = static_cast<DWORD>(parsed);
  return true;
}

struct JobStartup {
  HANDLE job = nullptr;
  LPPROC_THREAD_ATTRIBUTE_LIST attributes = nullptr;
  STARTUPINFOEXW startup{};

  ~JobStartup() {
    if (attributes != nullptr) {
      DeleteProcThreadAttributeList(attributes);
      HeapFree(GetProcessHeap(), 0, attributes);
    }
    if (job != nullptr)
      CloseHandle(job);
  }
};

bool InitializeContainedStartup(JobStartup *contained) {
  contained->job = CreateJobObjectW(nullptr, nullptr);
  if (contained->job == nullptr)
    return false;
  JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits{};
  limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
  if (!SetInformationJobObject(contained->job,
                               JobObjectExtendedLimitInformation, &limits,
                               sizeof(limits))) {
    return false;
  }
  SIZE_T bytes = 0;
  InitializeProcThreadAttributeList(nullptr, 1, 0, &bytes);
  if (bytes == 0)
    return false;
  contained->attributes = static_cast<LPPROC_THREAD_ATTRIBUTE_LIST>(
      HeapAlloc(GetProcessHeap(), HEAP_ZERO_MEMORY, bytes));
  if (contained->attributes == nullptr ||
      !InitializeProcThreadAttributeList(contained->attributes, 1, 0, &bytes)) {
    return false;
  }
  if (!UpdateProcThreadAttribute(
          contained->attributes, 0, PROC_THREAD_ATTRIBUTE_JOB_LIST,
          &contained->job, sizeof(contained->job), nullptr, nullptr)) {
    return false;
  }
  contained->startup.StartupInfo.cb = sizeof(contained->startup);
  contained->startup.lpAttributeList = contained->attributes;
  return true;
}

} // namespace

int wmain(int argument_count, wchar_t **arguments) {
  if (argument_count != 5 && argument_count != 7 && argument_count != 9) {
    std::wcerr << L"usage: launcher --result <path> --scenario <name> "
                  L"[--timeout-ms <100..60000>] [--crash-pid <path>]\n";
    return 90;
  }
  if (wcscmp(arguments[1], L"--result") != 0 ||
      wcscmp(arguments[3], L"--scenario") != 0) {
    return 90;
  }
  DWORD timeout_ms = 10'000;
  std::wstring crash_pid_path;
  std::wstring identity_file_path;
  for (int index = 5; index + 1 < argument_count; index += 2) {
    if (wcscmp(arguments[index], L"--timeout-ms") == 0) {
      if (!ParseTimeout(arguments[index + 1], &timeout_ms))
        return 91;
    } else if (wcscmp(arguments[index], L"--crash-pid") == 0) {
      crash_pid_path = arguments[index + 1];
      if (crash_pid_path.empty())
        return 91;
    } else if (wcscmp(arguments[index], L"--identity-file") == 0) {
      identity_file_path = arguments[index + 1];
      if (identity_file_path.empty())
        return 91;
    } else {
      return 91;
    }
  }

  const std::wstring directory = ExecutableDirectory();
  if (directory.empty())
    return 92;
  const std::wstring fixture = directory + L"\\" + kFixtureName;
  const std::wstring bootstrap = directory + L"\\" + kBootstrapName;
  if (GetFileAttributesW(fixture.c_str()) == INVALID_FILE_ATTRIBUTES ||
      GetFileAttributesW(bootstrap.c_str()) == INVALID_FILE_ATTRIBUTES) {
    return 93;
  }
  std::vector<char> bootstrap_ansi;
  if (!ExactAnsiPath(bootstrap, &bootstrap_ansi))
    return 94;

  JobStartup contained;
  if (!InitializeContainedStartup(&contained))
    return 95;
  std::wstring command_line = QuoteWindowsArgument(fixture) + L" --result " +
                              QuoteWindowsArgument(arguments[2]) +
                              L" --scenario " +
                              QuoteWindowsArgument(arguments[4]);
  PROCESS_INFORMATION process{};
  const BOOL created = DetourCreateProcessWithDllW(
      fixture.c_str(), command_line.data(), nullptr, nullptr, FALSE,
      CREATE_SUSPENDED | EXTENDED_STARTUPINFO_PRESENT |
          CREATE_DEFAULT_ERROR_MODE,
      nullptr, directory.c_str(), &contained.startup.StartupInfo, &process,
      bootstrap_ansi.data(), nullptr);
  if (!created) {
    std::wcerr << L"DetourCreateProcessWithDllW failed: " << GetLastError()
               << L"\n";
    return 96;
  }

  if (!identity_file_path.empty() && !crash_pid_path.empty() &&
      identity_file_path == crash_pid_path) {
    return 91;
  }
  if (!identity_file_path.empty() &&
      !WriteIdentityFile(identity_file_path, process.hProcess,
                         process.dwProcessId)) {
    TerminateProcess(process.hProcess, 97);
    WaitForSingleObject(process.hProcess, 5'000);
    CloseHandle(process.hThread);
    CloseHandle(process.hProcess);
    return 97;
  }
  if (!crash_pid_path.empty()) {
    if (!WriteIdentityFile(crash_pid_path, process.hProcess,
                           process.dwProcessId)) {
      TerminateProcess(process.hProcess, 97);
      WaitForSingleObject(process.hProcess, 5'000);
      CloseHandle(process.hThread);
      CloseHandle(process.hProcess);
      return 97;
    }
    TerminateProcess(GetCurrentProcess(), 197);
    return 197;
  }

  const DWORD prior_suspend_count = ResumeThread(process.hThread);
  if (prior_suspend_count != 1u) {
    TerminateProcess(process.hProcess, 98);
    WaitForSingleObject(process.hProcess, 5'000);
    CloseHandle(process.hThread);
    CloseHandle(process.hProcess);
    return 98;
  }
  CloseHandle(process.hThread);
  const DWORD wait = WaitForSingleObject(process.hProcess, timeout_ms);
  if (wait != WAIT_OBJECT_0) {
    const BOOL terminated = TerminateProcess(process.hProcess, 99);
    const DWORD terminated_wait = WaitForSingleObject(process.hProcess, 5'000);
    CloseHandle(process.hProcess);
    if (!terminated || terminated_wait != WAIT_OBJECT_0)
      return 100;
    return wait == WAIT_TIMEOUT ? 99 : 100;
  }
  DWORD exit_code = 101;
  if (!GetExitCodeProcess(process.hProcess, &exit_code)) {
    CloseHandle(process.hProcess);
    return 101;
  }
  CloseHandle(process.hProcess);
  return static_cast<int>(exit_code);
}
