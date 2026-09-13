// clang-format off: Windows types must be visible before the Detours header.
#include <windows.h>
#include <detours.h>
// clang-format on

#include <string>
#include <vector>

namespace {

constexpr wchar_t kFixtureName[] = L"gamehub-overlay-qa-dxgi-d3d11-fixture.exe";
constexpr wchar_t kBootstrapName[] =
    L"gamehub-overlay-qa-dxgi-d3d11-bootstrap64.dll";

std::wstring ExecutableDirectory() {
  std::vector<wchar_t> buffer(32768);
  const DWORD length = GetModuleFileNameW(nullptr, buffer.data(),
                                          static_cast<DWORD>(buffer.size()));
  if (length == 0 || length >= buffer.size())
    return {};
  std::wstring path(buffer.data(), length);
  const std::size_t separator = path.find_last_of(L"\\/");
  if (separator == std::wstring::npos)
    return {};
  path.resize(separator);
  return path;
}

std::wstring Quote(const std::wstring &value) {
  std::wstring output(1, L'"');
  std::size_t slashes = 0;
  for (wchar_t character : value) {
    if (character == L'\\') {
      ++slashes;
    } else if (character == L'"') {
      output.append(slashes * 2 + 1, L'\\');
      output.push_back(L'"');
      slashes = 0;
    } else {
      output.append(slashes, L'\\');
      slashes = 0;
      output.push_back(character);
    }
  }
  output.append(slashes * 2, L'\\');
  output.push_back(L'"');
  return output;
}

bool ExactAnsi(const std::wstring &value, std::vector<char> *output) {
  BOOL used_default = FALSE;
  const int size =
      WideCharToMultiByte(CP_ACP, WC_NO_BEST_FIT_CHARS, value.c_str(), -1,
                          nullptr, 0, nullptr, &used_default);
  if (size <= 0 || used_default)
    return false;
  output->resize(static_cast<std::size_t>(size));
  used_default = FALSE;
  return WideCharToMultiByte(CP_ACP, WC_NO_BEST_FIT_CHARS, value.c_str(), -1,
                             output->data(), size, nullptr,
                             &used_default) == size &&
         !used_default;
}

struct ContainedStartup {
  HANDLE job = nullptr;
  LPPROC_THREAD_ATTRIBUTE_LIST attributes = nullptr;
  STARTUPINFOEXW startup{};
  ~ContainedStartup() {
    if (attributes != nullptr) {
      DeleteProcThreadAttributeList(attributes);
      HeapFree(GetProcessHeap(), 0, attributes);
    }
    if (job != nullptr)
      CloseHandle(job);
  }
};

bool InitializeContainment(ContainedStartup *value) {
  value->job = CreateJobObjectW(nullptr, nullptr);
  if (value->job == nullptr)
    return false;
  JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits{};
  limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
  if (!SetInformationJobObject(value->job, JobObjectExtendedLimitInformation,
                               &limits, sizeof(limits))) {
    return false;
  }
  SIZE_T size = 0;
  InitializeProcThreadAttributeList(nullptr, 1, 0, &size);
  value->attributes = static_cast<LPPROC_THREAD_ATTRIBUTE_LIST>(
      HeapAlloc(GetProcessHeap(), HEAP_ZERO_MEMORY, size));
  if (value->attributes == nullptr ||
      !InitializeProcThreadAttributeList(value->attributes, 1, 0, &size)) {
    return false;
  }
  if (!UpdateProcThreadAttribute(value->attributes, 0,
                                 PROC_THREAD_ATTRIBUTE_JOB_LIST, &value->job,
                                 sizeof(value->job), nullptr, nullptr)) {
    return false;
  }
  value->startup.StartupInfo.cb = sizeof(value->startup);
  value->startup.lpAttributeList = value->attributes;
  return true;
}

bool WriteIdentity(const wchar_t *path, HANDLE process, DWORD pid) {
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
      CreateFileW(path, GENERIC_WRITE, 0, nullptr, CREATE_NEW,
                  FILE_ATTRIBUTE_NORMAL | FILE_FLAG_WRITE_THROUGH, nullptr);
  if (file == INVALID_HANDLE_VALUE)
    return false;
  DWORD written = 0;
  const bool result =
      WriteFile(file, value.data(), static_cast<DWORD>(value.size()), &written,
                nullptr) &&
      written == value.size() && FlushFileBuffers(file);
  CloseHandle(file);
  return result;
}

} // namespace

int wmain(int count, wchar_t **values) {
  if ((count != 5 && count != 7) || wcscmp(values[1], L"--result") != 0 ||
      wcscmp(values[3], L"--scenario") != 0) {
    return 90;
  }
  const wchar_t *crash_identity = nullptr;
  if (count == 7) {
    if (wcscmp(values[5], L"--crash-pid") != 0 || values[6][0] == L'\0') {
      return 90;
    }
    crash_identity = values[6];
  }
  const std::wstring directory = ExecutableDirectory();
  const std::wstring fixture = directory + L"\\" + kFixtureName;
  const std::wstring bootstrap = directory + L"\\" + kBootstrapName;
  std::vector<char> bootstrap_ansi;
  if (directory.empty() || !ExactAnsi(bootstrap, &bootstrap_ansi))
    return 91;
  ContainedStartup contained;
  if (!InitializeContainment(&contained))
    return 92;
  std::wstring command = Quote(fixture) + L" --result " + Quote(values[2]) +
                         L" --scenario " + Quote(values[4]);
  PROCESS_INFORMATION process{};
  const BOOL created = DetourCreateProcessWithDllW(
      fixture.c_str(), command.data(), nullptr, nullptr, FALSE,
      CREATE_SUSPENDED | EXTENDED_STARTUPINFO_PRESENT |
          CREATE_DEFAULT_ERROR_MODE,
      nullptr, directory.c_str(), &contained.startup.StartupInfo, &process,
      bootstrap_ansi.data(), nullptr);
  if (!created)
    return 93;
  if (crash_identity != nullptr) {
    if (!WriteIdentity(crash_identity, process.hProcess, process.dwProcessId)) {
      TerminateProcess(process.hProcess, 97);
      WaitForSingleObject(process.hProcess, 5000);
      CloseHandle(process.hThread);
      CloseHandle(process.hProcess);
      return 97;
    }
    TerminateProcess(GetCurrentProcess(), 197);
    return 197;
  }
  if (ResumeThread(process.hThread) != 1u) {
    TerminateProcess(process.hProcess, 94);
    WaitForSingleObject(process.hProcess, 5000);
    CloseHandle(process.hThread);
    CloseHandle(process.hProcess);
    return 94;
  }
  CloseHandle(process.hThread);
  const DWORD wait = WaitForSingleObject(process.hProcess, 20000);
  if (wait != WAIT_OBJECT_0) {
    TerminateProcess(process.hProcess, 95);
    WaitForSingleObject(process.hProcess, 5000);
    CloseHandle(process.hProcess);
    return 95;
  }
  DWORD exit_code = 96;
  GetExitCodeProcess(process.hProcess, &exit_code);
  CloseHandle(process.hProcess);
  return static_cast<int>(exit_code);
}
