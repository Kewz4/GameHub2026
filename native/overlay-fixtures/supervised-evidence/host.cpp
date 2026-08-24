#include "contract.hpp"

#include <array>
#include <cstdint>
#include <cwchar>
#include <string>
#include <utility>
#include <vector>

namespace qa = gamehub::overlay::supervised_evidence_qa;

namespace {

class Handle final {
 public:
  explicit Handle(HANDLE value = nullptr) noexcept : value_(value) {}
  ~Handle() { reset(); }
  Handle(const Handle&) = delete;
  Handle& operator=(const Handle&) = delete;
  Handle(Handle&& other) noexcept : value_(other.release()) {}
  Handle& operator=(Handle&& other) noexcept {
    if (this != &other) reset(other.release());
    return *this;
  }
  HANDLE get() const noexcept { return value_; }
  HANDLE release() noexcept {
    return std::exchange(value_, nullptr);
  }
  void reset(HANDLE value = nullptr) noexcept {
    if (value_ != nullptr && value_ != INVALID_HANDLE_VALUE) CloseHandle(value_);
    value_ = value;
  }
  explicit operator bool() const noexcept {
    return value_ != nullptr && value_ != INVALID_HANDLE_VALUE;
  }

 private:
  HANDLE value_;
};

class View final {
 public:
  explicit View(void* value = nullptr) noexcept : value_(value) {}
  ~View() {
    if (value_ != nullptr) UnmapViewOfFile(value_);
  }
  void* get() const noexcept { return value_; }

 private:
  void* value_;
};

class StartupAttributes final {
 public:
  ~StartupAttributes() {
    if (list_ != nullptr) {
      DeleteProcThreadAttributeList(list_);
      HeapFree(GetProcessHeap(), 0, list_);
    }
  }
  bool Initialize(const std::array<HANDLE, 6>& inherited, HANDLE job) {
    SIZE_T bytes = 0;
    InitializeProcThreadAttributeList(nullptr, 2, 0, &bytes);
    if (bytes == 0) return false;
    list_ = static_cast<LPPROC_THREAD_ATTRIBUTE_LIST>(
        HeapAlloc(GetProcessHeap(), HEAP_ZERO_MEMORY, bytes));
    if (list_ == nullptr ||
        !InitializeProcThreadAttributeList(list_, 2, 0, &bytes)) {
      return false;
    }
    inherited_ = inherited;
    job_ = job;
    return UpdateProcThreadAttribute(
               list_, 0, PROC_THREAD_ATTRIBUTE_HANDLE_LIST,
               inherited_.data(), sizeof(inherited_), nullptr, nullptr) !=
               FALSE &&
           UpdateProcThreadAttribute(list_, 0, PROC_THREAD_ATTRIBUTE_JOB_LIST,
                                     &job_, sizeof(job_), nullptr, nullptr) !=
               FALSE;
  }
  LPPROC_THREAD_ATTRIBUTE_LIST get() const noexcept { return list_; }

 private:
  LPPROC_THREAD_ATTRIBUTE_LIST list_ = nullptr;
  std::array<HANDLE, 6> inherited_{};
  HANDLE job_ = nullptr;
};

struct Report {
  std::wstring scenario;
  std::string rejection = "internal";
  bool targetCreatedSuspended = false;
  bool bootstrapProvisionedWhileSuspended = false;
  bool oneShotBootstrapConsumed = false;
  bool selfIdentityValidated = false;
  bool exactIdentityMatched = false;
  bool resumedExactlyOnce = false;
  bool readyPublicationObserved = false;
  bool readyMacAuthenticated = false;
  bool bindingAccepted = false;
  bool publishedAfterResume = false;
  bool inputEvidenceAccepted = false;
  bool renderEvidenceAccepted = false;
  bool releaseRequested = false;
  bool releaseAuthenticated = false;
  bool gameEntryReachedAfterRelease = false;
  bool intendedStageReached = false;
  bool targetAliveAtExpectedTimeout = false;
  bool targetExited = false;
  bool exactTargetContained = false;
  bool proofPassed = false;
  DWORD pid = 0;
  std::uint64_t creationTicks = 0;
  LONG targetStage = 0;
};

std::wstring ExecutableDirectory() {
  std::vector<wchar_t> path(32'768);
  const DWORD length = GetModuleFileNameW(nullptr, path.data(),
                                          static_cast<DWORD>(path.size()));
  if (length == 0 || length >= path.size()) return {};
  std::wstring value(path.data(), length);
  const std::size_t separator = value.find_last_of(L"\\/");
  if (separator == std::wstring::npos) return {};
  value.resize(separator);
  return value;
}

std::wstring JoinPath(const std::wstring& parent, const wchar_t* child) {
  return parent + (parent.ends_with(L"\\") ? L"" : L"\\") + child;
}

std::wstring QuoteArgument(const std::wstring& value) {
  std::wstring result(1, L'"');
  std::size_t backslashes = 0;
  for (const wchar_t character : value) {
    if (character == L'\\') {
      ++backslashes;
    } else if (character == L'"') {
      result.append(backslashes * 2 + 1, L'\\');
      result.push_back(L'"');
      backslashes = 0;
    } else {
      result.append(backslashes, L'\\');
      backslashes = 0;
      result.push_back(character);
    }
  }
  result.append(backslashes * 2, L'\\');
  result.push_back(L'"');
  return result;
}

std::wstring HandleArgument(HANDLE value) {
  return std::to_wstring(
      static_cast<unsigned long long>(reinterpret_cast<ULONG_PTR>(value)));
}

bool SetInheritable(HANDLE handle, bool inheritable) {
  return SetHandleInformation(handle, HANDLE_FLAG_INHERIT,
                              inheritable ? HANDLE_FLAG_INHERIT : 0) != FALSE;
}

bool InitializeKillJob(Handle* job) {
  job->reset(CreateJobObjectW(nullptr, nullptr));
  if (!*job) return false;
  JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits{};
  limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
  return SetInformationJobObject(job->get(), JobObjectExtendedLimitInformation,
                                 &limits, sizeof(limits)) != FALSE;
}

bool WriteExact(HANDLE file, const void* data, DWORD bytes) {
  const auto* cursor = static_cast<const std::uint8_t*>(data);
  DWORD total = 0;
  while (total < bytes) {
    DWORD written = 0;
    if (!WriteFile(file, cursor + total, bytes - total, &written, nullptr) ||
        written == 0) {
      return false;
    }
    total += written;
  }
  return true;
}

std::string NarrowAscii(const std::wstring& value) {
  std::string output;
  output.reserve(value.size());
  for (const wchar_t character : value) {
    if (character < 0x20 || character > 0x7e || character == L'"' ||
        character == L'\\') {
      return {};
    }
    output.push_back(static_cast<char>(character));
  }
  return output;
}

const char* JsonBool(bool value) { return value ? "true" : "false"; }

bool WriteReport(const std::wstring& path, const Report& report) {
  const std::string scenario = NarrowAscii(report.scenario);
  if (scenario.empty()) return false;
  std::string json =
      "{\"schemaVersion\":1,\"scenario\":\"" + scenario +
      "\",\"rejection\":\"" + report.rejection +
      "\",\"targetCreatedSuspended\":" +
      JsonBool(report.targetCreatedSuspended) +
      ",\"bootstrapProvisionedWhileSuspended\":" +
      JsonBool(report.bootstrapProvisionedWhileSuspended) +
      ",\"oneShotBootstrapConsumed\":" +
      JsonBool(report.oneShotBootstrapConsumed) +
      ",\"selfIdentityValidated\":" +
      JsonBool(report.selfIdentityValidated) +
      ",\"exactIdentityMatched\":" + JsonBool(report.exactIdentityMatched) +
      ",\"resumedExactlyOnce\":" + JsonBool(report.resumedExactlyOnce) +
      ",\"readyPublicationObserved\":" +
      JsonBool(report.readyPublicationObserved) +
      ",\"readyMacAuthenticated\":" +
      JsonBool(report.readyMacAuthenticated) +
      ",\"bindingAccepted\":" + JsonBool(report.bindingAccepted) +
      ",\"publishedAfterResume\":" +
      JsonBool(report.publishedAfterResume) +
      ",\"inputEvidenceAccepted\":" +
      JsonBool(report.inputEvidenceAccepted) +
      ",\"renderEvidenceAccepted\":" +
      JsonBool(report.renderEvidenceAccepted) +
      ",\"releaseRequested\":" + JsonBool(report.releaseRequested) +
      ",\"releaseAuthenticated\":" +
      JsonBool(report.releaseAuthenticated) +
      ",\"gameEntryReachedAfterRelease\":" +
      JsonBool(report.gameEntryReachedAfterRelease) +
      ",\"intendedStageReached\":" +
      JsonBool(report.intendedStageReached) +
      ",\"targetAliveAtExpectedTimeout\":" +
      JsonBool(report.targetAliveAtExpectedTimeout) +
      ",\"targetExited\":" + JsonBool(report.targetExited) +
      ",\"exactTargetContained\":" +
      JsonBool(report.exactTargetContained) +
      ",\"proofPassed\":" + JsonBool(report.proofPassed) +
      ",\"pid\":" + std::to_string(report.pid) +
      ",\"creationTicks\":\"" + std::to_string(report.creationTicks) +
      "\",\"targetStage\":" + std::to_string(report.targetStage) + "}\n";
  Handle output(CreateFileW(path.c_str(), GENERIC_WRITE, 0, nullptr, CREATE_NEW,
                            FILE_ATTRIBUTE_NORMAL | FILE_FLAG_WRITE_THROUGH,
                            nullptr));
  return output && json.size() <= MAXDWORD &&
         WriteExact(output.get(), json.data(), static_cast<DWORD>(json.size())) &&
         FlushFileBuffers(output.get()) != FALSE;
}

bool AllowedScenario(const std::wstring& scenario) {
  static constexpr std::array<const wchar_t*, 13> allowed = {
      L"normal",          L"forged",          L"wrong-nonce",
      L"wrong-identity",  L"stale-generation", L"stale-topology",
      L"wrong-commit",    L"early-timing",     L"late",
      L"early-exit",      L"release-refused",  L"late-release",
      L"release-early-exit",
  };
  if (scenario == L"release-replay") return true;
  for (const wchar_t* value : allowed) {
    if (scenario == value) return true;
  }
  return false;
}

std::string ExpectedRejection(const std::wstring& scenario) {
  if (scenario == L"normal") return "none";
  if (scenario == L"forged") return "mac";
  if (scenario == L"wrong-nonce") return "nonce";
  if (scenario == L"wrong-identity") return "identity";
  if (scenario == L"stale-generation") return "input-generation";
  if (scenario == L"stale-topology") return "topology";
  if (scenario == L"wrong-commit") return "commit";
  if (scenario == L"early-timing") return "timing";
  if (scenario == L"late") return "publication-timeout";
  if (scenario == L"early-exit") return "publication-premature-exit";
  if (scenario == L"release-replay") return "release-sequence";
  if (scenario == L"release-early-exit") return "release-premature-exit";
  return "release-timeout";
}

qa::TargetStage ReadTargetStage(const qa::SharedRecord* shared) {
  const LONG value = InterlockedCompareExchange(
      const_cast<volatile LONG*>(&shared->targetStage), 0, 0);
  return static_cast<qa::TargetStage>(value);
}

bool MacValid(const qa::PublicationPayload& payload,
              const std::array<std::uint8_t, qa::kDigestBytes>& mac,
              const qa::BootstrapPacket& bootstrap) {
  std::array<std::uint8_t, qa::kDigestBytes> expected{};
  const bool valid = qa::HmacPublication(bootstrap.key, payload, &expected) &&
                     qa::ConstantTimeEqual(mac, expected);
  SecureZeroMemory(expected.data(), expected.size());
  return valid;
}

int Run(const std::wstring& result_path, const std::wstring& scenario) {
  Report report{};
  report.scenario = scenario;
  const std::string expected_rejection = ExpectedRejection(scenario);
  const std::wstring directory = ExecutableDirectory();
  const std::wstring target_path =
      JoinPath(directory, L"gamehub-overlay-qa-supervised-evidence-target.exe");
  Handle pinned_target(CreateFileW(
      target_path.c_str(), GENERIC_READ | FILE_READ_ATTRIBUTES, FILE_SHARE_READ,
      nullptr, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, nullptr));
  if (directory.empty() || !pinned_target) return 31;

  SECURITY_ATTRIBUTES inherited{};
  inherited.nLength = sizeof(inherited);
  inherited.bInheritHandle = TRUE;

  HANDLE pipe_read_raw = nullptr;
  HANDLE pipe_write_raw = nullptr;
  if (!CreatePipe(&pipe_read_raw, &pipe_write_raw, &inherited, 0)) return 32;
  Handle pipe_read(pipe_read_raw);
  Handle pipe_write(pipe_write_raw);
  if (!SetInheritable(pipe_write.get(), false)) return 33;

  Handle mapping(CreateFileMappingW(INVALID_HANDLE_VALUE, &inherited,
                                    PAGE_READWRITE, 0,
                                    sizeof(qa::SharedRecord), nullptr));
  Handle publication(CreateEventW(&inherited, FALSE, FALSE, nullptr));
  Handle release(CreateEventW(&inherited, TRUE, FALSE, nullptr));
  Handle accept(CreateEventW(&inherited, TRUE, FALSE, nullptr));
  Handle owner(OpenProcess(SYNCHRONIZE | PROCESS_QUERY_LIMITED_INFORMATION,
                           FALSE, GetCurrentProcessId()));
  if (!mapping || !publication || !release || !accept || !owner ||
      !SetInheritable(owner.get(), true)) {
    return 34;
  }
  View view(MapViewOfFile(mapping.get(), FILE_MAP_READ | FILE_MAP_WRITE, 0, 0,
                          sizeof(qa::SharedRecord)));
  if (view.get() == nullptr) return 35;
  auto* shared = static_cast<qa::SharedRecord*>(view.get());
  SecureZeroMemory(shared, sizeof(*shared));

  Handle job;
  if (!InitializeKillJob(&job)) return 36;
  StartupAttributes attributes;
  const std::array<HANDLE, 6> inherited_handles = {
      pipe_read.get(), mapping.get(), publication.get(), release.get(),
      accept.get(), owner.get()};
  if (!attributes.Initialize(inherited_handles, job.get())) return 37;

  std::wstring command_line =
      QuoteArgument(target_path) + L" --bootstrap " +
      HandleArgument(pipe_read.get()) + L" --mapping " +
      HandleArgument(mapping.get()) + L" --publication " +
      HandleArgument(publication.get()) + L" --release " +
      HandleArgument(release.get()) + L" --accept " +
      HandleArgument(accept.get()) + L" --owner " +
      HandleArgument(owner.get()) + L" --scenario " + QuoteArgument(scenario);
  STARTUPINFOEXW startup{};
  startup.StartupInfo.cb = sizeof(startup);
  startup.lpAttributeList = attributes.get();
  PROCESS_INFORMATION process{};
  const DWORD flags = CREATE_SUSPENDED | CREATE_NO_WINDOW |
                      CREATE_DEFAULT_ERROR_MODE | EXTENDED_STARTUPINFO_PRESENT;
  if (!CreateProcessW(target_path.c_str(), command_line.data(), nullptr, nullptr,
                      TRUE, flags, nullptr, directory.c_str(),
                      &startup.StartupInfo, &process)) {
    return 38;
  }
  Handle child_process(process.hProcess);
  Handle child_thread(process.hThread);
  report.targetCreatedSuspended = true;
  report.pid = process.dwProcessId;
  pipe_read.reset();

  qa::BootstrapPacket bootstrap{};
  const bool bootstrap_locked =
      VirtualLock(&bootstrap, sizeof(bootstrap)) != FALSE;
  qa::LockedSecret secret;
  LARGE_INTEGER resume_qpc{};
  const bool prepared =
      bootstrap_locked && secret.locked() &&
      qa::FillRandom(secret.bytes().data(), secret.bytes().size()) &&
      qa::FillRandom(bootstrap.sessionNonce.data(),
                     bootstrap.sessionNonce.size()) &&
      qa::QueryProcessIdentity(child_process.get(), &bootstrap.target) &&
      QueryPerformanceCounter(&resume_qpc) != FALSE;
  if (!prepared) {
    if (bootstrap_locked) VirtualUnlock(&bootstrap, sizeof(bootstrap));
    TerminateJobObject(job.get(), 39);
    WaitForSingleObject(child_process.get(), 2'000);
    return 39;
  }
  report.creationTicks = bootstrap.target.creationFileTime;
  const bool host_identity_matched =
      bootstrap.target.pid == process.dwProcessId;
  bootstrap.magic = qa::kBootstrapMagic;
  bootstrap.schemaVersion = qa::kSchemaVersion;
  bootstrap.packetBytes = sizeof(bootstrap);
  bootstrap.key = secret.bytes();
  bootstrap.inputGeneration = qa::kInputGeneration;
  bootstrap.renderGeneration = qa::kRenderGeneration;
  bootstrap.topologyEpoch = qa::kTopologyEpoch;
  bootstrap.nativeCommitSequence = qa::kNativeCommitSequence;
  bootstrap.absenceMonitorEpoch = qa::kAbsenceMonitorEpoch;
  bootstrap.requiredChildRoutes = qa::kRequiredChildRoutes;
  bootstrap.requiredRenderSurfaces = qa::kRequiredRenderSurfaces;
  bootstrap.resumeQpc = static_cast<std::uint64_t>(resume_qpc.QuadPart);

  const bool wrote_bootstrap =
      WriteExact(pipe_write.get(), &bootstrap, sizeof(bootstrap));
  pipe_write.reset();
  report.bootstrapProvisionedWhileSuspended =
      wrote_bootstrap && WaitForSingleObject(child_process.get(), 0) == WAIT_TIMEOUT &&
      InterlockedCompareExchange(&shared->bootstrapConsumed, 0, 0) == 0 &&
      InterlockedCompareExchange64(&shared->sequence, 0, 0) == 0;
  if (!report.bootstrapProvisionedWhileSuspended ||
      ResumeThread(child_thread.get()) != 1u) {
    TerminateJobObject(job.get(), 40);
    WaitForSingleObject(child_process.get(), 2'000);
    SecureZeroMemory(&bootstrap, sizeof(bootstrap));
    VirtualUnlock(&bootstrap, sizeof(bootstrap));
    return 40;
  }
  report.resumedExactlyOnce = true;
  child_thread.reset();

  const DWORD first_wait =
      WaitForSingleObject(publication.get(), qa::kPublicationTimeoutMs);
  qa::TargetStage observed_stage = ReadTargetStage(shared);
  report.selfIdentityValidated =
      observed_stage >= qa::TargetStage::kSelfIdentityValidated;
  report.exactIdentityMatched =
      host_identity_matched && report.selfIdentityValidated;
  qa::PublicationPayload ready{};
  std::array<std::uint8_t, qa::kDigestBytes> ready_mac{};
  qa::ValidationFailure ready_failure = qa::ValidationFailure::kNone;
  if (first_wait == WAIT_TIMEOUT) {
    report.targetAliveAtExpectedTimeout =
        WaitForSingleObject(child_process.get(), 0) == WAIT_TIMEOUT;
    report.intendedStageReached =
        scenario == L"late" &&
        observed_stage == qa::TargetStage::kLatePublicationDelay;
    if (!report.targetAliveAtExpectedTimeout) {
      report.rejection = "publication-premature-exit";
    } else if (report.intendedStageReached) {
      report.rejection = "publication-timeout";
    } else {
      report.rejection = "publication-unexpected-timeout";
    }
  } else if (first_wait != WAIT_OBJECT_0) {
    report.rejection = "publication-wait-failed";
  } else if (!qa::ReadStable(shared, &ready, &ready_mac)) {
    report.rejection = "torn";
  } else {
    report.readyPublicationObserved = true;
    report.readyMacAuthenticated = MacValid(ready, ready_mac, bootstrap);
    ready_failure = qa::ValidatePublication(
        ready, ready_mac, bootstrap, 1, qa::PublicationState::kReady);
    report.rejection = qa::ValidationFailureName(ready_failure);
    report.bindingAccepted = ready_failure == qa::ValidationFailure::kNone;
    report.publishedAfterResume =
        report.bindingAccepted && ready.publicationQpc > bootstrap.resumeQpc;
    report.inputEvidenceAccepted =
        report.bindingAccepted &&
        ready.inputEvidenceFlags == qa::kInputEvidenceFlags;
    report.renderEvidenceAccepted =
        report.bindingAccepted &&
        ready.renderEvidenceFlags == qa::kRenderEvidenceFlags &&
        ready.activeBackend == qa::kD3d11Backend;
  }
  SecureZeroMemory(ready_mac.data(), ready_mac.size());
  report.oneShotBootstrapConsumed =
      InterlockedCompareExchange(&shared->bootstrapConsumed, 0, 0) == 1;

  if (report.bindingAccepted) {
    report.releaseRequested = SetEvent(release.get()) != FALSE;
    if (!report.releaseRequested) {
      report.rejection = "release-signal-failed";
    } else {
      const DWORD release_wait =
          WaitForSingleObject(publication.get(), qa::kReleaseTimeoutMs);
      observed_stage = ReadTargetStage(shared);
      if (release_wait == WAIT_TIMEOUT) {
        report.targetAliveAtExpectedTimeout =
            WaitForSingleObject(child_process.get(), 0) == WAIT_TIMEOUT;
        report.intendedStageReached =
            (scenario == L"release-refused" &&
             observed_stage == qa::TargetStage::kReleaseRefused) ||
            (scenario == L"late-release" &&
             observed_stage == qa::TargetStage::kLateReleaseDelay);
        if (!report.targetAliveAtExpectedTimeout) {
          report.rejection = "release-premature-exit";
        } else if (report.intendedStageReached) {
          report.rejection = "release-timeout";
        } else {
          report.rejection = "release-unexpected-timeout";
        }
      } else if (release_wait != WAIT_OBJECT_0) {
        report.rejection = "release-wait-failed";
      } else {
        qa::PublicationPayload released{};
        std::array<std::uint8_t, qa::kDigestBytes> released_mac{};
        if (!qa::ReadStable(shared, &released, &released_mac)) {
          report.rejection = "release-torn";
        } else {
          const qa::ValidationFailure release_failure =
              qa::ValidatePublication(released, released_mac, bootstrap, 2,
                                      qa::PublicationState::kReleased);
          report.releaseAuthenticated =
              release_failure == qa::ValidationFailure::kNone;
          report.rejection =
              report.releaseAuthenticated
                  ? "none"
                  : std::string("release-") +
                        qa::ValidationFailureName(release_failure);
          if (report.releaseAuthenticated && !SetEvent(accept.get())) {
            report.releaseAuthenticated = false;
            report.rejection = "accept-signal";
          }
        }
        SecureZeroMemory(released_mac.data(), released_mac.size());
      }
    }
  }

  if (report.rejection != "none") {
    TerminateJobObject(job.get(), 41);
  }
  report.targetExited =
      WaitForSingleObject(child_process.get(), 2'000) == WAIT_OBJECT_0;
  report.gameEntryReachedAfterRelease =
      report.releaseAuthenticated &&
      InterlockedCompareExchange(&shared->gameEntryReached, 0, 0) == 1;
  report.targetStage = static_cast<LONG>(ReadTargetStage(shared));
  report.exactTargetContained = report.targetExited;
  const bool expected_late_publication = scenario == L"late";
  const bool expected_release_timeout =
      scenario == L"release-refused" || scenario == L"late-release";
  const bool expected_publication_exit = scenario == L"early-exit";
  const bool expected_release_exit = scenario == L"release-early-exit";
  const bool timeout_or_exit_proof =
      expected_late_publication
          ? report.intendedStageReached &&
                report.targetAliveAtExpectedTimeout &&
                !report.readyPublicationObserved
      : expected_release_timeout
          ? report.bindingAccepted && report.releaseRequested &&
                report.intendedStageReached &&
                report.targetAliveAtExpectedTimeout
      : expected_publication_exit
          ? !report.readyPublicationObserved &&
                !report.targetAliveAtExpectedTimeout &&
                report.targetStage == static_cast<LONG>(
                                          qa::TargetStage::kSelfIdentityValidated)
      : expected_release_exit
          ? report.bindingAccepted && report.releaseRequested &&
                !report.targetAliveAtExpectedTimeout &&
                report.targetStage ==
                    static_cast<LONG>(qa::TargetStage::kReleaseObserved)
          : true;
  report.proofPassed =
      report.targetCreatedSuspended &&
      report.bootstrapProvisionedWhileSuspended &&
      report.exactIdentityMatched && report.resumedExactlyOnce &&
      report.oneShotBootstrapConsumed && report.exactTargetContained &&
      report.rejection == expected_rejection && timeout_or_exit_proof &&
      (scenario == L"normal"
           ? report.readyMacAuthenticated && report.bindingAccepted &&
                 report.publishedAfterResume &&
                 report.inputEvidenceAccepted &&
                 report.renderEvidenceAccepted && report.releaseRequested &&
                 report.releaseAuthenticated &&
                 report.gameEntryReachedAfterRelease
           : !report.gameEntryReachedAfterRelease);

  SecureZeroMemory(&bootstrap, sizeof(bootstrap));
  VirtualUnlock(&bootstrap, sizeof(bootstrap));
  const bool written = WriteReport(result_path, report);
  return written && report.proofPassed ? 0 : 42;
}

}  // namespace

int wmain(int argument_count, wchar_t** arguments) {
  if (argument_count != 5 || wcscmp(arguments[1], L"--result") != 0 ||
      wcscmp(arguments[3], L"--scenario") != 0 || arguments[2][0] == L'\0' ||
      arguments[4][0] == L'\0') {
    return 30;
  }
  const std::wstring scenario(arguments[4]);
  if (!AllowedScenario(scenario)) return 30;
  return Run(arguments[2], scenario);
}
