// Detours requires the Windows architecture macros before detours.h.
// clang-format off
#include <windows.h>
#include <detours.h>
// clang-format on

#include <algorithm>
#include <cctype>
#include <charconv>
#include <cstdint>
#include <exception>
#include <limits>
#include <map>
#include <sstream>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

#include "protocol.hpp"

namespace gamehub::overlay::qa {
namespace {

constexpr DWORD kInitialRequestTimeoutMs = 30'000;
constexpr DWORD kDecisionTimeoutMs = 20'000;
constexpr DWORD kTerminationTimeoutMs = 5'000;
constexpr DWORD kSupervisorTerminationCode = 0x47485141;  // "GHQA"
constexpr std::size_t kMaximumMessageBytes = 32 * 1024;
constexpr std::size_t kMaximumArguments = 128;
constexpr std::size_t kMaximumArgumentBytes = 4 * 1024;
constexpr wchar_t kFixtureName[] = L"gamehub-overlay-preentry-fixture.exe";
constexpr wchar_t kMarkerName[] = L"gamehub-overlay-qa-marker64.dll";
constexpr wchar_t kResultsDirectoryName[] = L"qa-results";
constexpr char kFallbackSessionId[] = "00000000000000000000000000000000";

class UniqueHandle {
 public:
  UniqueHandle() = default;
  explicit UniqueHandle(HANDLE handle) : handle_(handle) {}
  ~UniqueHandle() { Reset(); }

  UniqueHandle(const UniqueHandle&) = delete;
  UniqueHandle& operator=(const UniqueHandle&) = delete;

  UniqueHandle(UniqueHandle&& other) noexcept
      : handle_(std::exchange(other.handle_, nullptr)) {}
  UniqueHandle& operator=(UniqueHandle&& other) noexcept {
    if (this != &other) {
      Reset(std::exchange(other.handle_, nullptr));
    }
    return *this;
  }

  HANDLE Get() const { return handle_; }
  explicit operator bool() const {
    return handle_ != nullptr && handle_ != INVALID_HANDLE_VALUE;
  }
  void Reset(HANDLE replacement = nullptr) {
    if (*this) CloseHandle(handle_);
    handle_ = replacement;
  }

 private:
  HANDLE handle_ = nullptr;
};

struct PrepareRequest {
  std::string session_id;
  std::wstring executable_path;
  std::vector<std::string> arguments;
  std::wstring working_directory;
};

struct DecisionRequest {
  enum class Operation { kCommit, kAbort };
  Operation operation = Operation::kAbort;
  std::string session_id;
  DWORD pid = 0;
  std::uint64_t creation_ticks = 0;
  std::wstring canonical_executable;
};

struct SuspendedFixture {
  UniqueHandle process;
  UniqueHandle thread;
  UniqueHandle job;
  DWORD pid = 0;
  std::uint64_t creation_ticks = 0;
  std::wstring canonical_executable;
};

std::wstring JoinPath(const std::wstring& parent, const std::wstring& child) {
  if (parent.empty()) return child;
  if (parent.back() == L'\\') return parent + child;
  return parent + L'\\' + child;
}

std::wstring ParentPath(const std::wstring& path) {
  const std::size_t separator = path.find_last_of(L"\\/");
  if (separator == std::wstring::npos) return L".";
  if (separator == 2 && path.size() >= 3 && path[1] == L':') {
    return path.substr(0, 3);
  }
  return path.substr(0, separator);
}

std::wstring FileName(const std::wstring& path) {
  const std::size_t separator = path.find_last_of(L"\\/");
  return separator == std::wstring::npos ? path : path.substr(separator + 1);
}

bool EqualPath(const std::wstring& left, const std::wstring& right) {
  return CompareStringOrdinal(left.c_str(), static_cast<int>(left.size()),
                              right.c_str(), static_cast<int>(right.size()),
                              TRUE) == CSTR_EQUAL;
}

std::wstring StripExtendedPrefix(std::wstring path) {
  if (path.rfind(L"\\\\?\\UNC\\", 0) == 0) {
    return L"\\\\" + path.substr(8);
  }
  if (path.rfind(L"\\\\?\\", 0) == 0) return path.substr(4);
  return path;
}

std::wstring ModulePath() {
  std::vector<wchar_t> buffer(512);
  while (true) {
    const DWORD length = GetModuleFileNameW(nullptr, buffer.data(),
                                            static_cast<DWORD>(buffer.size()));
    if (length == 0) throw std::runtime_error("module-path-unavailable");
    if (length < buffer.size() - 1) {
      return std::wstring(buffer.data(), length);
    }
    if (buffer.size() >= 32'768) {
      throw std::runtime_error("module-path-too-long");
    }
    buffer.resize(buffer.size() * 2);
  }
}

std::wstring CanonicalizeExistingPath(const std::wstring& path,
                                      bool directory) {
  const DWORD flags = directory ? FILE_FLAG_BACKUP_SEMANTICS : 0;
  UniqueHandle handle(
      CreateFileW(path.c_str(), FILE_READ_ATTRIBUTES,
                  FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
                  nullptr, OPEN_EXISTING, flags, nullptr));
  if (!handle) throw std::runtime_error("canonical-open-failed");

  std::vector<wchar_t> buffer(512);
  while (true) {
    const DWORD length = GetFinalPathNameByHandleW(
        handle.Get(), buffer.data(), static_cast<DWORD>(buffer.size()),
        FILE_NAME_NORMALIZED | VOLUME_NAME_DOS);
    if (length == 0) throw std::runtime_error("canonical-path-failed");
    if (length < buffer.size()) {
      return StripExtendedPrefix(std::wstring(buffer.data(), length));
    }
    if (length >= 32'768) throw std::runtime_error("canonical-path-too-long");
    buffer.resize(static_cast<std::size_t>(length) + 1);
  }
}

std::wstring ProcessImagePath(HANDLE process) {
  std::vector<wchar_t> buffer(512);
  while (true) {
    DWORD length = static_cast<DWORD>(buffer.size());
    if (QueryFullProcessImageNameW(process, 0, buffer.data(), &length)) {
      return CanonicalizeExistingPath(std::wstring(buffer.data(), length),
                                      false);
    }
    if (GetLastError() != ERROR_INSUFFICIENT_BUFFER ||
        buffer.size() >= 32'768) {
      throw std::runtime_error("process-image-query-failed");
    }
    buffer.resize(buffer.size() * 2);
  }
}

std::uint64_t CreationTicks(HANDLE process) {
  FILETIME creation{};
  FILETIME exit{};
  FILETIME kernel{};
  FILETIME user{};
  if (!GetProcessTimes(process, &creation, &exit, &kernel, &user)) {
    throw std::runtime_error("process-times-query-failed");
  }
  ULARGE_INTEGER ticks{};
  ticks.LowPart = creation.dwLowDateTime;
  ticks.HighPart = creation.dwHighDateTime;
  return ticks.QuadPart;
}

bool ValidSessionId(const std::string& session_id) {
  if (session_id.size() < 32 || session_id.size() > 128) return false;
  return std::all_of(
      session_id.begin(), session_id.end(), [](unsigned char character) {
        return std::isalnum(character) || character == '_' || character == '-';
      });
}

bool ValidResultFile(const std::string& result_file) {
  if (result_file.size() < 6 || result_file.size() > 72 ||
      result_file.ends_with(".json") == false ||
      result_file.find("..") != std::string::npos) {
    return false;
  }
  return std::all_of(result_file.begin(), result_file.end(),
                     [](unsigned char character) {
                       return std::isalnum(character) || character == '.' ||
                              character == '_' || character == '-';
                     });
}

const JsonValue* Member(const JsonValue& object, const char* key) {
  const auto iterator = object.object.find(key);
  return iterator == object.object.end() ? nullptr : &iterator->second;
}

bool HasExactKeys(const JsonValue& object,
                  const std::vector<std::string>& expected) {
  if (object.object.size() != expected.size()) return false;
  return std::all_of(
      expected.begin(), expected.end(),
      [&](const std::string& key) { return object.object.contains(key); });
}

bool ParsePrepare(const std::string& frame, PrepareRequest* request,
                  std::string* error) {
  if (frame.size() > kMaximumMessageBytes) {
    *error = "message-too-large";
    return false;
  }
  JsonValue root;
  if (!ParseJson(frame, &root, error)) return false;
  if (root.type != JsonValue::Type::kObject ||
      !HasExactKeys(root, {"version", "type", "sessionId", "executablePath",
                           "args", "workingDirectory", "decisionTimeoutMs"})) {
    *error = "invalid launch object keys";
    return false;
  }
  const JsonValue* version = Member(root, "version");
  const JsonValue* type = Member(root, "type");
  const JsonValue* session_id = Member(root, "sessionId");
  const JsonValue* executable_path = Member(root, "executablePath");
  const JsonValue* arguments = Member(root, "args");
  const JsonValue* working_directory = Member(root, "workingDirectory");
  const JsonValue* decision_timeout = Member(root, "decisionTimeoutMs");
  if (session_id->type == JsonValue::Type::kString &&
      ValidSessionId(session_id->string)) {
    request->session_id = session_id->string;
  }
  if (version->type != JsonValue::Type::kInteger || version->integer != 1 ||
      type->type != JsonValue::Type::kString || type->string != "launch" ||
      session_id->type != JsonValue::Type::kString ||
      !ValidSessionId(session_id->string) ||
      executable_path->type != JsonValue::Type::kString ||
      executable_path->string.find('\0') != std::string::npos ||
      arguments->type != JsonValue::Type::kArray ||
      arguments->array.size() > kMaximumArguments ||
      working_directory->type != JsonValue::Type::kString ||
      working_directory->string.find('\0') != std::string::npos ||
      decision_timeout->type != JsonValue::Type::kInteger ||
      decision_timeout->integer != kDecisionTimeoutMs) {
    *error = "invalid launch object values";
    return false;
  }
  request->arguments.clear();
  for (const JsonValue& argument : arguments->array) {
    if (argument.type != JsonValue::Type::kString ||
        argument.string.find('\0') != std::string::npos ||
        argument.string.size() > kMaximumArgumentBytes) {
      *error = "invalid fixture argument";
      return false;
    }
    try {
      (void)Utf8ToWide(argument.string);
    } catch (const std::exception&) {
      *error = "fixture argument is not UTF-8";
      return false;
    }
    request->arguments.push_back(argument.string);
  }
  try {
    request->executable_path = Utf8ToWide(executable_path->string);
    request->working_directory = Utf8ToWide(working_directory->string);
  } catch (const std::exception&) {
    *error = "launch path is not UTF-8";
    return false;
  }
  return true;
}

bool ParseUnsignedTicks(const std::string& value, std::uint64_t* ticks) {
  if (value.empty() || value.front() == '0') return false;
  if (!std::all_of(value.begin(), value.end(), [](unsigned char character) {
        return character >= '0' && character <= '9';
      })) {
    return false;
  }
  const auto parsed =
      std::from_chars(value.data(), value.data() + value.size(), *ticks);
  return parsed.ec == std::errc() &&
         parsed.ptr == value.data() + value.size() && *ticks != 0;
}

bool ParseDecision(const std::string& frame, const PrepareRequest& launch,
                   const SuspendedFixture& fixture, DecisionRequest* request,
                   std::string* error) {
  if (frame.size() > kMaximumMessageBytes) {
    *error = "message-too-large";
    return false;
  }
  JsonValue root;
  if (!ParseJson(frame, &root, error)) return false;
  if (root.type != JsonValue::Type::kObject) {
    *error = "invalid decision object keys";
    return false;
  }
  const JsonValue* type = Member(root, "type");
  if (type == nullptr || type->type != JsonValue::Type::kString ||
      (type->string != "commit" && type->string != "abort")) {
    *error = "decision must be commit or abort";
    return false;
  }
  const bool abort = type->string == "abort";
  const std::vector<std::string> expected =
      abort
          ? std::vector<std::string>{"version",       "type",
                                     "sessionId",     "pid",
                                     "creationTicks", "canonicalExecutablePath",
                                     "reason"}
          : std::vector<std::string>{
                "version", "type",          "sessionId",
                "pid",     "creationTicks", "canonicalExecutablePath"};
  if (!HasExactKeys(root, expected)) {
    *error = "invalid decision object keys";
    return false;
  }
  const JsonValue* version = Member(root, "version");
  const JsonValue* session_id = Member(root, "sessionId");
  const JsonValue* pid = Member(root, "pid");
  const JsonValue* creation_ticks = Member(root, "creationTicks");
  const JsonValue* canonical_path = Member(root, "canonicalExecutablePath");
  std::uint64_t parsed_ticks = 0;
  if (version->type != JsonValue::Type::kInteger || version->integer != 1 ||
      session_id->type != JsonValue::Type::kString ||
      session_id->string != launch.session_id ||
      pid->type != JsonValue::Type::kInteger || pid->integer <= 4 ||
      pid->integer > std::numeric_limits<DWORD>::max() ||
      static_cast<DWORD>(pid->integer) != fixture.pid ||
      creation_ticks->type != JsonValue::Type::kString ||
      !ParseUnsignedTicks(creation_ticks->string, &parsed_ticks) ||
      parsed_ticks != fixture.creation_ticks ||
      canonical_path->type != JsonValue::Type::kString ||
      canonical_path->string.find('\0') != std::string::npos) {
    *error = "invalid decision values";
    return false;
  }
  try {
    request->canonical_executable = Utf8ToWide(canonical_path->string);
  } catch (const std::exception&) {
    *error = "decision path is not UTF-8";
    return false;
  }
  if (!EqualPath(request->canonical_executable, fixture.canonical_executable)) {
    *error = "decision executable identity mismatch";
    return false;
  }
  if (abort) {
    const JsonValue* reason = Member(root, "reason");
    if (reason->type != JsonValue::Type::kString || reason->string.empty() ||
        reason->string.size() > 128 ||
        reason->string.find('\0') != std::string::npos) {
      *error = "invalid abort reason";
      return false;
    }
  }
  request->operation = abort ? DecisionRequest::Operation::kAbort
                             : DecisionRequest::Operation::kCommit;
  request->session_id = session_id->string;
  request->pid = static_cast<DWORD>(pid->integer);
  request->creation_ticks = parsed_ticks;
  return true;
}

bool WriteFrame(HANDLE output, const std::string& frame) {
  const std::string line = frame + "\n";
  std::size_t offset = 0;
  while (offset < line.size()) {
    DWORD written = 0;
    const DWORD remaining = static_cast<DWORD>(std::min<std::size_t>(
        line.size() - offset, std::numeric_limits<DWORD>::max()));
    if (!WriteFile(output, line.data() + offset, remaining, &written,
                   nullptr) ||
        written == 0) {
      return false;
    }
    offset += written;
  }
  return true;
}

std::string ErrorFrame(const std::string& session_id, const std::string& stage,
                       DWORD code, const std::string& message) {
  std::ostringstream output;
  output << "{\"version\":1,\"type\":\"error\",\"sessionId\":\""
         << JsonEscape(ValidSessionId(session_id) ? session_id
                                                  : kFallbackSessionId)
         << "\",\"stage\":\"" << JsonEscape(stage) << "\",\"code\":" << code
         << ",\"message\":\"" << JsonEscape(message) << "\"}";
  return output.str();
}

std::string IdentityFrame(const char* type, const PrepareRequest& request,
                          const SuspendedFixture& fixture) {
  std::ostringstream output;
  output << "{\"version\":1,\"type\":\"" << type << "\",\"sessionId\":\""
         << JsonEscape(request.session_id) << "\",\"pid\":" << fixture.pid
         << ",\"creationTicks\":\"" << fixture.creation_ticks
         << "\",\"canonicalExecutablePath\":\""
         << JsonEscape(WideToUtf8(fixture.canonical_executable)) << "\"}";
  return output.str();
}

std::string AcpPathForDetours(const std::wstring& path) {
  const auto lossless_encode = [](const std::wstring& candidate,
                                  std::string* encoded) {
    BOOL used_default = FALSE;
    const int byte_count = WideCharToMultiByte(
        CP_ACP, WC_NO_BEST_FIT_CHARS, candidate.c_str(),
        static_cast<int>(candidate.size()), nullptr, 0, nullptr, &used_default);
    if (byte_count <= 0 || used_default) return false;
    encoded->assign(static_cast<std::size_t>(byte_count), '\0');
    used_default = FALSE;
    if (WideCharToMultiByte(CP_ACP, WC_NO_BEST_FIT_CHARS, candidate.c_str(),
                            static_cast<int>(candidate.size()), encoded->data(),
                            byte_count, nullptr, &used_default) != byte_count ||
        used_default) {
      return false;
    }
    std::wstring round_trip(candidate.size(), L'\0');
    return MultiByteToWideChar(CP_ACP, MB_ERR_INVALID_CHARS, encoded->data(),
                               byte_count, round_trip.data(),
                               static_cast<int>(round_trip.size())) ==
               static_cast<int>(round_trip.size()) &&
           EqualPath(candidate, round_trip);
  };

  std::string encoded;
  if (lossless_encode(path, &encoded)) return encoded;

  const DWORD short_length = GetShortPathNameW(path.c_str(), nullptr, 0);
  if (short_length == 0) {
    throw std::runtime_error("detours-dll-path-not-ansi-representable");
  }
  std::wstring short_path(short_length, L'\0');
  const DWORD copied =
      GetShortPathNameW(path.c_str(), short_path.data(), short_length);
  if (copied == 0 || copied >= short_length) {
    throw std::runtime_error("detours-dll-short-path-failed");
  }
  short_path.resize(copied);
  if (!lossless_encode(short_path, &encoded)) {
    throw std::runtime_error("detours-dll-path-not-lossless");
  }
  return encoded;
}

void ValidateMarkerDll(const std::wstring& marker_path) {
  const std::wstring canonical = CanonicalizeExistingPath(marker_path, false);
  if (!EqualPath(FileName(canonical), kMarkerName)) {
    throw std::runtime_error("marker-name-mismatch");
  }
  HMODULE module =
      LoadLibraryExW(marker_path.c_str(), nullptr, DONT_RESOLVE_DLL_REFERENCES);
  if (module == nullptr) throw std::runtime_error("marker-inspection-failed");
  const bool valid =
      GetProcAddress(module, reinterpret_cast<LPCSTR>(1)) != nullptr &&
      GetProcAddress(module, "GameHubOverlayQaMarkerMagic") != nullptr;
  FreeLibrary(module);
  if (!valid) throw std::runtime_error("marker-exports-invalid");
}

void ValidateMitigations(HANDLE process) {
  PROCESS_MITIGATION_DYNAMIC_CODE_POLICY dynamic_code{};
  if (!GetProcessMitigationPolicy(process, ProcessDynamicCodePolicy,
                                  &dynamic_code, sizeof(dynamic_code))) {
    throw std::runtime_error("dynamic-code-policy-query-failed");
  }
  if (dynamic_code.ProhibitDynamicCode) {
    throw std::runtime_error("dynamic-code-policy-rejected");
  }

  PROCESS_MITIGATION_BINARY_SIGNATURE_POLICY signature{};
  if (!GetProcessMitigationPolicy(process, ProcessSignaturePolicy, &signature,
                                  sizeof(signature))) {
    throw std::runtime_error("signature-policy-query-failed");
  }
  if (signature.MicrosoftSignedOnly || signature.StoreSignedOnly ||
      signature.MitigationOptIn) {
    throw std::runtime_error("signature-policy-rejected");
  }

  PROCESS_PROTECTION_LEVEL_INFORMATION protection{};
  if (!GetProcessInformation(process, ProcessProtectionLevelInfo, &protection,
                             sizeof(protection))) {
    throw std::runtime_error("protection-level-query-failed");
  }
  if (protection.ProtectionLevel != PROTECTION_LEVEL_NONE) {
    throw std::runtime_error("protected-process-rejected");
  }

  using IsWow64Process2Function = BOOL(WINAPI*)(HANDLE, USHORT*, USHORT*);
  const HMODULE kernel32 = GetModuleHandleW(L"kernel32.dll");
  const auto is_wow64_process2 = reinterpret_cast<IsWow64Process2Function>(
      GetProcAddress(kernel32, "IsWow64Process2"));
  if (is_wow64_process2 == nullptr) {
    throw std::runtime_error("iswow64process2-unavailable");
  }
  USHORT process_machine = IMAGE_FILE_MACHINE_UNKNOWN;
  USHORT native_machine = IMAGE_FILE_MACHINE_UNKNOWN;
  if (!is_wow64_process2(process, &process_machine, &native_machine)) {
    throw std::runtime_error("process-architecture-query-failed");
  }
  if (process_machine != IMAGE_FILE_MACHINE_UNKNOWN ||
      native_machine != IMAGE_FILE_MACHINE_AMD64) {
    throw std::runtime_error("non-x64-target-rejected");
  }
}

bool TerminateNeverStarted(SuspendedFixture* fixture) {
  if (!fixture->process) return true;
  const bool terminate_requested =
      TerminateProcess(fixture->process.Get(), kSupervisorTerminationCode) !=
      FALSE;
  if (!terminate_requested) {
    const DWORD exit_code_error = GetLastError();
    DWORD exit_code = STILL_ACTIVE;
    if (exit_code_error != ERROR_ACCESS_DENIED ||
        !GetExitCodeProcess(fixture->process.Get(), &exit_code) ||
        exit_code == STILL_ACTIVE) {
      // Closing an armed private job is the final fail-safe for an otherwise
      // unkillable never-started child. Keep the process handle open so the
      // termination can still be observed rather than inferred.
      fixture->job.Reset();
    }
  }
  if (WaitForSingleObject(fixture->process.Get(), kTerminationTimeoutMs) ==
      WAIT_OBJECT_0) {
    return true;
  }
  fixture->job.Reset();
  return WaitForSingleObject(fixture->process.Get(), kTerminationTimeoutMs) ==
         WAIT_OBJECT_0;
}

void ArmPrivateJob(HANDLE job) {
  JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits{};
  limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
  if (!SetInformationJobObject(job, JobObjectExtendedLimitInformation, &limits,
                               sizeof(limits))) {
    throw std::runtime_error("private-job-arm-failed");
  }
}

bool DisarmPrivateJob(HANDLE job) {
  JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits{};
  return SetInformationJobObject(job, JobObjectExtendedLimitInformation,
                                 &limits, sizeof(limits)) != FALSE;
}

SuspendedFixture CreateSuspendedFixture(const PrepareRequest& request,
                                        std::wstring* result_path) {
  const std::wstring supervisor_path =
      CanonicalizeExistingPath(ModulePath(), false);
  const std::wstring supervisor_directory = ParentPath(supervisor_path);
  const std::wstring fixture_path = CanonicalizeExistingPath(
      JoinPath(supervisor_directory, kFixtureName), false);
  const std::wstring marker_path = CanonicalizeExistingPath(
      JoinPath(supervisor_directory, kMarkerName), false);
  const std::wstring results_directory = CanonicalizeExistingPath(
      JoinPath(supervisor_directory, kResultsDirectoryName), true);

  if (!EqualPath(ParentPath(fixture_path), supervisor_directory) ||
      !EqualPath(ParentPath(marker_path), supervisor_directory) ||
      !EqualPath(FileName(fixture_path), kFixtureName) ||
      !EqualPath(FileName(marker_path), kMarkerName)) {
    throw std::runtime_error("companion-path-boundary-failed");
  }

  const std::wstring requested_fixture =
      CanonicalizeExistingPath(request.executable_path, false);
  const std::wstring requested_working_directory =
      CanonicalizeExistingPath(request.working_directory, true);
  if (!EqualPath(requested_fixture, fixture_path) ||
      !EqualPath(requested_working_directory, supervisor_directory) ||
      !EqualPath(ParentPath(requested_fixture), requested_working_directory)) {
    throw std::runtime_error("fixture-only-boundary-rejected");
  }

  ValidateMarkerDll(marker_path);
  const std::string marker_path_ansi = AcpPathForDetours(marker_path);

  if (request.arguments.size() < 3 || request.arguments[0] != "--result" ||
      request.arguments[2] != "--") {
    throw std::runtime_error("fixture-argument-contract-rejected");
  }
  *result_path = Utf8ToWide(request.arguments[1]);
  const std::wstring requested_result_parent =
      CanonicalizeExistingPath(ParentPath(*result_path), true);
  const std::string requested_result_name = WideToUtf8(FileName(*result_path));
  if (!EqualPath(requested_result_parent, results_directory) ||
      !ValidResultFile(requested_result_name)) {
    throw std::runtime_error("fixture-result-boundary-rejected");
  }
  if (GetFileAttributesW(result_path->c_str()) != INVALID_FILE_ATTRIBUTES) {
    throw std::runtime_error("result-file-already-exists");
  }

  std::vector<std::wstring> arguments;
  arguments.reserve(request.arguments.size());
  for (const std::string& argument : request.arguments) {
    arguments.push_back(Utf8ToWide(argument));
  }
  std::wstring command_line = BuildCommandLine(fixture_path, arguments);
  if (command_line.size() >= 32'767) {
    throw std::runtime_error("fixture-command-line-too-long");
  }
  std::vector<wchar_t> mutable_command(command_line.begin(),
                                       command_line.end());
  mutable_command.push_back(L'\0');

  STARTUPINFOEXW startup_extended{};
  startup_extended.StartupInfo.cb = sizeof(startup_extended);
  PROCESS_INFORMATION process_information{};
  SuspendedFixture fixture;
  fixture.job.Reset(CreateJobObjectW(nullptr, nullptr));
  if (!fixture.job) throw std::runtime_error("private-job-create-failed");
  ArmPrivateJob(fixture.job.Get());

  SIZE_T attribute_bytes = 0;
  (void)InitializeProcThreadAttributeList(nullptr, 1, 0, &attribute_bytes);
  if (attribute_bytes == 0) {
    throw std::runtime_error("job-attribute-size-failed");
  }
  auto* attribute_memory = static_cast<LPPROC_THREAD_ATTRIBUTE_LIST>(
      HeapAlloc(GetProcessHeap(), HEAP_ZERO_MEMORY, attribute_bytes));
  if (attribute_memory == nullptr) {
    throw std::runtime_error("job-attribute-allocation-failed");
  }
  struct AttributeCleanup {
    LPPROC_THREAD_ATTRIBUTE_LIST value;
    bool initialized = false;
    ~AttributeCleanup() {
      if (value != nullptr) {
        if (initialized) DeleteProcThreadAttributeList(value);
        HeapFree(GetProcessHeap(), 0, value);
      }
    }
  } attribute_cleanup{attribute_memory};
  if (!InitializeProcThreadAttributeList(attribute_memory, 1, 0,
                                         &attribute_bytes)) {
    throw std::runtime_error("job-attribute-initialize-failed");
  }
  attribute_cleanup.initialized = true;
  HANDLE job_handle = fixture.job.Get();
  if (!UpdateProcThreadAttribute(attribute_memory, 0,
                                 PROC_THREAD_ATTRIBUTE_JOB_LIST, &job_handle,
                                 sizeof(job_handle), nullptr, nullptr)) {
    throw std::runtime_error("job-attribute-update-failed");
  }
  startup_extended.lpAttributeList = attribute_memory;

  const DWORD creation_flags = CREATE_SUSPENDED | CREATE_NO_WINDOW |
                               CREATE_DEFAULT_ERROR_MODE |
                               EXTENDED_STARTUPINFO_PRESENT;
  if (!CreateProcessW(fixture_path.c_str(), mutable_command.data(), nullptr,
                      nullptr, FALSE, creation_flags, nullptr,
                      supervisor_directory.c_str(),
                      &startup_extended.StartupInfo, &process_information)) {
    throw std::runtime_error("fixture-create-failed");
  }

  fixture.process.Reset(process_information.hProcess);
  fixture.thread.Reset(process_information.hThread);
  fixture.pid = process_information.dwProcessId;

  // Synthetic fault injection only: the token is consumed by the fixture
  // contract and cannot alter the target. TerminateProcess bypasses C++
  // destructors, proving the kernel-held job association closes the formerly
  // dangerous CreateProcess-to-user-cleanup crash window.
#if defined(GAMEHUB_OVERLAY_SUPERVISOR_ACCEPTANCE_FAULTS)
  wchar_t crash_fault[8];
  if (GetEnvironmentVariableW(L"GAMEHUB_QA_CRASH_AFTER_CREATE", crash_fault,
                              static_cast<DWORD>(std::size(crash_fault))) ==
          1 &&
      crash_fault[0] == L'1') {
    TerminateProcess(GetCurrentProcess(), 0x47484352);  // "GHCR"
    __assume(0);
  }
#endif

  try {
    fixture.canonical_executable = ProcessImagePath(fixture.process.Get());
    if (!EqualPath(fixture.canonical_executable, fixture_path)) {
      throw std::runtime_error("created-process-identity-mismatch");
    }
    fixture.creation_ticks = CreationTicks(fixture.process.Get());
    ValidateMitigations(fixture.process.Get());

    LPCSTR marker_dlls[] = {marker_path_ansi.c_str()};
    if (!DetourUpdateProcessWithDll(fixture.process.Get(), marker_dlls, 1)) {
      throw std::runtime_error("detours-preentry-update-failed");
    }
  } catch (...) {
    if (!TerminateNeverStarted(&fixture)) {
      throw std::runtime_error("never-started-child-termination-unconfirmed");
    }
    throw;
  }
  return fixture;
}

const char* LineStatusCode(LineReadStatus status, bool decision) {
  switch (status) {
    case LineReadStatus::kEof:
      return decision ? "decision-eof" : "prepare-eof";
    case LineReadStatus::kTimeout:
      return decision ? "decision-timeout" : "prepare-timeout";
    case LineReadStatus::kTooLong:
      return decision ? "decision-frame-too-long" : "prepare-frame-too-long";
    case LineReadStatus::kIoError:
      return decision ? "decision-io-error" : "prepare-io-error";
    case LineReadStatus::kLine:
      break;
  }
  return "unexpected-line-status";
}

int RunSupervisor() {
  const HANDLE input = GetStdHandle(STD_INPUT_HANDLE);
  const HANDLE output = GetStdHandle(STD_OUTPUT_HANDLE);
  if (input == nullptr || input == INVALID_HANDLE_VALUE || output == nullptr ||
      output == INVALID_HANDLE_VALUE || GetFileType(input) != FILE_TYPE_PIPE ||
      GetFileType(output) != FILE_TYPE_PIPE) {
    return 64;
  }

  PipeLineReader reader(input);
  std::string frame;
  DWORD io_error = ERROR_SUCCESS;
  const LineReadStatus prepare_status =
      reader.ReadLine(kInitialRequestTimeoutMs, &frame, &io_error);
  if (prepare_status != LineReadStatus::kLine) {
    const DWORD code =
        io_error != ERROR_SUCCESS
            ? io_error
            : (prepare_status == LineReadStatus::kTimeout ? ERROR_TIMEOUT
                                                          : ERROR_INVALID_DATA);
    (void)WriteFrame(output, ErrorFrame(kFallbackSessionId, "protocol", code,
                                        LineStatusCode(prepare_status, false)));
    return 65;
  }

  PrepareRequest request;
  std::string parse_error;
  if (!ParsePrepare(frame, &request, &parse_error)) {
    (void)WriteFrame(output, ErrorFrame(request.session_id, "protocol",
                                        ERROR_INVALID_DATA, parse_error));
    return 66;
  }

  SuspendedFixture fixture;
  std::wstring result_path;
  try {
    fixture = CreateSuspendedFixture(request, &result_path);
  } catch (const std::exception& error) {
    const DWORD last_error = GetLastError();
    (void)WriteFrame(
        output,
        ErrorFrame(request.session_id, "launch",
                   last_error == ERROR_SUCCESS ? ERROR_GEN_FAILURE : last_error,
                   error.what()));
    return 67;
  }

  if (!WriteFrame(output, IdentityFrame("suspended", request, fixture))) {
    if (!TerminateNeverStarted(&fixture)) return 74;
    return 68;
  }

  io_error = ERROR_SUCCESS;
  const LineReadStatus decision_status =
      reader.ReadLine(kDecisionTimeoutMs, &frame, &io_error);
  if (decision_status != LineReadStatus::kLine) {
    const bool terminated = TerminateNeverStarted(&fixture);
    const DWORD code = io_error != ERROR_SUCCESS
                           ? io_error
                           : (decision_status == LineReadStatus::kTimeout
                                  ? ERROR_TIMEOUT
                                  : ERROR_INVALID_DATA);
    (void)WriteFrame(
        output,
        ErrorFrame(request.session_id, "decision",
                   terminated ? code : ERROR_PROCESS_ABORTED,
                   terminated ? LineStatusCode(decision_status, true)
                              : "never-started-child-termination-unconfirmed"));
    return terminated ? 69 : 75;
  }

  DecisionRequest decision;
  if (!ParseDecision(frame, request, fixture, &decision, &parse_error)) {
    const bool terminated = TerminateNeverStarted(&fixture);
    (void)WriteFrame(
        output,
        ErrorFrame(request.session_id, "decision",
                   terminated ? ERROR_INVALID_DATA : ERROR_PROCESS_ABORTED,
                   terminated ? parse_error
                              : "never-started-child-termination-unconfirmed"));
    return terminated ? 70 : 76;
  }

  if (decision.operation == DecisionRequest::Operation::kAbort) {
    const bool terminated = TerminateNeverStarted(&fixture);
    if (!terminated) {
      (void)WriteFrame(
          output, ErrorFrame(request.session_id, "abort", ERROR_PROCESS_ABORTED,
                             "never-started-child-termination-unconfirmed"));
      return 71;
    }
    (void)WriteFrame(output, IdentityFrame("aborted", request, fixture));
    return 0;
  }

  const DWORD previous_suspend_count = ResumeThread(fixture.thread.Get());
  if (previous_suspend_count != 1) {
    const DWORD resume_error =
        previous_suspend_count == static_cast<DWORD>(-1) ? GetLastError() : 0;
    const bool terminated = TerminateNeverStarted(&fixture);
    (void)WriteFrame(
        output,
        ErrorFrame(request.session_id, "resume",
                   terminated ? resume_error : ERROR_PROCESS_ABORTED,
                   terminated ? "resume-count-invariant-failed"
                              : "running-child-termination-unconfirmed"));
    return terminated ? 72 : 77;
  }

  fixture.thread.Reset();
  if (!DisarmPrivateJob(fixture.job.Get())) {
    const DWORD disarm_error = GetLastError();
    const bool terminated = TerminateNeverStarted(&fixture);
    (void)WriteFrame(
        output,
        ErrorFrame(request.session_id, "resume",
                   terminated ? disarm_error : ERROR_PROCESS_ABORTED,
                   terminated ? "private-job-disarm-failed"
                              : "running-child-termination-unconfirmed"));
    return terminated ? 78 : 79;
  }
  (void)WriteFrame(output, IdentityFrame("resumed", request, fixture));
  fixture.process.Reset();
  fixture.job.Reset();
  return 0;
}

}  // namespace
}  // namespace gamehub::overlay::qa

int wmain(int argc, wchar_t** argv) {
  if (argc != 2 || wcscmp(argv[1], L"--stdio-json-v1") != 0) {
    const HANDLE output = GetStdHandle(STD_OUTPUT_HANDLE);
    if (output != nullptr && output != INVALID_HANDLE_VALUE &&
        GetFileType(output) == FILE_TYPE_PIPE) {
      (void)gamehub::overlay::qa::WriteFrame(
          output, gamehub::overlay::qa::ErrorFrame(
                      gamehub::overlay::qa::kFallbackSessionId, "protocol",
                      ERROR_INVALID_PARAMETER, "argv-not-allowed"));
    }
    return 64;
  }
  try {
    return gamehub::overlay::qa::RunSupervisor();
  } catch (const std::exception& error) {
    const HANDLE output = GetStdHandle(STD_OUTPUT_HANDLE);
    if (output != nullptr && output != INVALID_HANDLE_VALUE &&
        GetFileType(output) == FILE_TYPE_PIPE) {
      (void)gamehub::overlay::qa::WriteFrame(
          output, gamehub::overlay::qa::ErrorFrame(
                      gamehub::overlay::qa::kFallbackSessionId, "supervisor",
                      GetLastError() == ERROR_SUCCESS ? ERROR_GEN_FAILURE
                                                      : GetLastError(),
                      error.what()));
    }
    return 73;
  }
}
