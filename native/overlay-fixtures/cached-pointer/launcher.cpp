#include <windows.h>

#include <detours.h>

#include <iostream>
#include <string>
#include <vector>

namespace {

constexpr wchar_t kFixtureName[] =
    L"gamehub-overlay-qa-cached-pointer-fixture.exe";
constexpr wchar_t kBootstrapName[] =
    L"gamehub-overlay-qa-cached-pointer-bootstrap64.dll";
constexpr DWORD kFixtureTimeoutMs = 10'000;

std::wstring ExecutableDirectory() {
  std::vector<wchar_t> buffer(32'768);
  const DWORD length = GetModuleFileNameW(
      nullptr, buffer.data(), static_cast<DWORD>(buffer.size()));
  if (length == 0 || length >= buffer.size()) return {};
  std::wstring path(buffer.data(), length);
  const std::wstring::size_type separator = path.find_last_of(L"\\/");
  if (separator == std::wstring::npos) return {};
  path.resize(separator);
  return path;
}

std::wstring QuoteWindowsArgument(const std::wstring& value) {
  std::wstring quoted;
  quoted.push_back(L'"');
  std::size_t backslashes = 0;
  for (const wchar_t character : value) {
    if (character == L'\\') {
      ++backslashes;
      continue;
    }
    if (character == L'"') {
      quoted.append(backslashes * 2u + 1u, L'\\');
      quoted.push_back(L'"');
      backslashes = 0;
      continue;
    }
    quoted.append(backslashes, L'\\');
    backslashes = 0;
    quoted.push_back(character);
  }
  quoted.append(backslashes * 2u, L'\\');
  quoted.push_back(L'"');
  return quoted;
}

bool ExactAnsiPath(const std::wstring& wide, std::vector<char>* output) {
  BOOL used_default = FALSE;
  const int required = WideCharToMultiByte(
      CP_ACP, WC_NO_BEST_FIT_CHARS, wide.c_str(), -1, nullptr, 0, nullptr,
      &used_default);
  if (required <= 0 || used_default) return false;
  output->assign(static_cast<std::size_t>(required), '\0');
  used_default = FALSE;
  const int written = WideCharToMultiByte(
      CP_ACP, WC_NO_BEST_FIT_CHARS, wide.c_str(), -1, output->data(), required,
      nullptr, &used_default);
  return written == required && !used_default;
}

}  // namespace

int wmain(int argument_count, wchar_t** arguments) {
  if (argument_count != 2 || arguments[1][0] == L'\0') {
    std::wcerr << L"usage: cached-pointer-launcher <absolute-result-path>\n";
    return 90;
  }

  const std::wstring directory = ExecutableDirectory();
  if (directory.empty()) {
    std::wcerr << L"could not resolve launcher directory\n";
    return 91;
  }
  const std::wstring fixture = directory + L"\\" + kFixtureName;
  const std::wstring bootstrap = directory + L"\\" + kBootstrapName;
  if (GetFileAttributesW(fixture.c_str()) == INVALID_FILE_ATTRIBUTES ||
      GetFileAttributesW(bootstrap.c_str()) == INVALID_FILE_ATTRIBUTES) {
    std::wcerr << L"adjacent fixture artifacts are missing\n";
    return 92;
  }

  std::vector<char> bootstrap_ansi;
  if (!ExactAnsiPath(bootstrap, &bootstrap_ansi)) {
    std::wcerr << L"Detours QA DLL path is not exactly representable in ACP\n";
    return 93;
  }

  std::wstring command_line = QuoteWindowsArgument(fixture) + L" --result " +
                              QuoteWindowsArgument(arguments[1]);
  STARTUPINFOW startup{};
  startup.cb = sizeof(startup);
  PROCESS_INFORMATION process{};
  const BOOL created = DetourCreateProcessWithDllW(
      fixture.c_str(), command_line.data(), nullptr, nullptr, FALSE,
      CREATE_DEFAULT_ERROR_MODE, nullptr, directory.c_str(), &startup, &process,
      bootstrap_ansi.data(), nullptr);
  if (!created) {
    std::wcerr << L"DetourCreateProcessWithDllW failed: " << GetLastError()
               << L"\n";
    return 94;
  }

  CloseHandle(process.hThread);
  const DWORD wait = WaitForSingleObject(process.hProcess, kFixtureTimeoutMs);
  if (wait != WAIT_OBJECT_0) {
    TerminateProcess(process.hProcess, 95);
    WaitForSingleObject(process.hProcess, 5'000);
    CloseHandle(process.hProcess);
    std::wcerr << L"cached-pointer fixture timed out\n";
    return 95;
  }

  DWORD exit_code = 96;
  if (!GetExitCodeProcess(process.hProcess, &exit_code)) {
    std::wcerr << L"GetExitCodeProcess failed: " << GetLastError() << L"\n";
    CloseHandle(process.hProcess);
    return 96;
  }
  CloseHandle(process.hProcess);
  return static_cast<int>(exit_code);
}
