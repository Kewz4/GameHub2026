#include "contract.hpp"

#include <array>
#include <cerrno>
#include <cstdint>
#include <cwchar>
#include <string>

namespace qa = gamehub::overlay::supervised_evidence_qa;

namespace {

class Handle final {
 public:
  explicit Handle(HANDLE value = nullptr) noexcept : value_(value) {}
  ~Handle() {
    if (value_ != nullptr && value_ != INVALID_HANDLE_VALUE) CloseHandle(value_);
  }
  Handle(const Handle&) = delete;
  Handle& operator=(const Handle&) = delete;
  HANDLE get() const noexcept { return value_; }

 private:
  HANDLE value_;
};

class View final {
 public:
  explicit View(void* value) noexcept : value_(value) {}
  ~View() {
    if (value_ != nullptr) UnmapViewOfFile(value_);
  }
  void* get() const noexcept { return value_; }

 private:
  void* value_;
};

bool ParseHandle(const wchar_t* text, HANDLE* output) {
  if (text == nullptr || text[0] == L'\0' || output == nullptr) return false;
  wchar_t* end = nullptr;
  errno = 0;
  const unsigned long long value = _wcstoui64(text, &end, 10);
  if (errno != 0 || end == text || *end != L'\0' || value == 0) return false;
  *output = reinterpret_cast<HANDLE>(static_cast<ULONG_PTR>(value));
  return true;
}

bool ReadExactOneShot(HANDLE pipe, qa::BootstrapPacket* bootstrap) {
  auto* output = reinterpret_cast<std::uint8_t*>(bootstrap);
  DWORD total = 0;
  while (total < sizeof(*bootstrap)) {
    DWORD read = 0;
    if (!ReadFile(pipe, output + total,
                  static_cast<DWORD>(sizeof(*bootstrap) - total), &read,
                  nullptr) ||
        read == 0) {
      return false;
    }
    total += read;
  }
  std::uint8_t extra = 0;
  DWORD extra_read = 0;
  SetLastError(ERROR_SUCCESS);
  const BOOL result = ReadFile(pipe, &extra, sizeof(extra), &extra_read, nullptr);
  return (result != FALSE && extra_read == 0) ||
         (result == FALSE && GetLastError() == ERROR_BROKEN_PIPE);
}

qa::PublicationPayload BasePublication(const qa::BootstrapPacket& bootstrap,
                                       qa::PublicationState state,
                                       std::uint64_t sequence) {
  qa::PublicationPayload payload{};
  payload.schemaVersion = qa::kSchemaVersion;
  payload.payloadBytes = sizeof(payload);
  payload.sessionNonce = bootstrap.sessionNonce;
  payload.target = bootstrap.target;
  payload.inputGeneration = bootstrap.inputGeneration;
  payload.renderGeneration = bootstrap.renderGeneration;
  payload.topologyEpoch = bootstrap.topologyEpoch;
  payload.nativeCommitSequence = bootstrap.nativeCommitSequence;
  payload.absenceMonitorEpoch = bootstrap.absenceMonitorEpoch;
  payload.requiredChildRoutes = bootstrap.requiredChildRoutes;
  payload.requiredRenderSurfaces = bootstrap.requiredRenderSurfaces;
  payload.publicationSequence = sequence;
  payload.resumeQpc = bootstrap.resumeQpc;
  LARGE_INTEGER now{};
  QueryPerformanceCounter(&now);
  payload.publicationQpc = static_cast<std::uint64_t>(now.QuadPart);
  payload.inputEvidenceFlags = qa::kInputEvidenceFlags;
  payload.renderEvidenceFlags = qa::kRenderEvidenceFlags;
  payload.activeBackend = qa::kD3d11Backend;
  payload.state = state;
  return payload;
}

bool IsScenario(const std::wstring& scenario, const wchar_t* expected) {
  return scenario == expected;
}

void SetStage(qa::SharedRecord* shared, qa::TargetStage stage) {
  InterlockedExchange(&shared->targetStage, static_cast<LONG>(stage));
}

}  // namespace

int wmain(int argument_count, wchar_t** arguments) {
  if (argument_count != 15 || wcscmp(arguments[1], L"--bootstrap") != 0 ||
      wcscmp(arguments[3], L"--mapping") != 0 ||
      wcscmp(arguments[5], L"--publication") != 0 ||
      wcscmp(arguments[7], L"--release") != 0 ||
      wcscmp(arguments[9], L"--accept") != 0 ||
      wcscmp(arguments[11], L"--owner") != 0 ||
      wcscmp(arguments[13], L"--scenario") != 0) {
    return 20;
  }

  HANDLE bootstrap_raw = nullptr;
  HANDLE mapping_raw = nullptr;
  HANDLE publication_raw = nullptr;
  HANDLE release_raw = nullptr;
  HANDLE accept_raw = nullptr;
  HANDLE owner_raw = nullptr;
  if (!ParseHandle(arguments[2], &bootstrap_raw) ||
      !ParseHandle(arguments[4], &mapping_raw) ||
      !ParseHandle(arguments[6], &publication_raw) ||
      !ParseHandle(arguments[8], &release_raw) ||
      !ParseHandle(arguments[10], &accept_raw) ||
      !ParseHandle(arguments[12], &owner_raw)) {
    return 21;
  }
  const std::wstring scenario(arguments[14]);

  Handle bootstrap_pipe(bootstrap_raw);
  Handle mapping(mapping_raw);
  Handle publication(publication_raw);
  Handle release(release_raw);
  Handle accept(accept_raw);
  Handle owner(owner_raw);
  View view(MapViewOfFile(mapping.get(), FILE_MAP_READ | FILE_MAP_WRITE, 0, 0,
                          sizeof(qa::SharedRecord)));
  if (view.get() == nullptr) return 22;
  auto* shared = static_cast<qa::SharedRecord*>(view.get());

  qa::BootstrapPacket bootstrap{};
  const bool bootstrap_locked =
      VirtualLock(&bootstrap, sizeof(bootstrap)) != FALSE;
  if (!bootstrap_locked || !ReadExactOneShot(bootstrap_pipe.get(), &bootstrap)) {
    if (bootstrap_locked) VirtualUnlock(&bootstrap, sizeof(bootstrap));
    return 23;
  }
  InterlockedExchange(&shared->bootstrapConsumed, 1);
  SetStage(shared, qa::TargetStage::kBootstrapConsumed);

  qa::TargetIdentity self{};
  const bool bootstrap_valid =
      bootstrap.magic == qa::kBootstrapMagic &&
      bootstrap.schemaVersion == qa::kSchemaVersion &&
      bootstrap.packetBytes == sizeof(bootstrap) &&
      qa::QuerySelfIdentity(&self) && qa::EqualIdentity(self, bootstrap.target);
  if (!bootstrap_valid) {
    SecureZeroMemory(&bootstrap, sizeof(bootstrap));
    VirtualUnlock(&bootstrap, sizeof(bootstrap));
    return 24;
  }
  SetStage(shared, qa::TargetStage::kSelfIdentityValidated);

  if (IsScenario(scenario, L"early-exit")) {
    SecureZeroMemory(&bootstrap, sizeof(bootstrap));
    VirtualUnlock(&bootstrap, sizeof(bootstrap));
    return 90;
  }

  if (IsScenario(scenario, L"late")) {
    SetStage(shared, qa::TargetStage::kLatePublicationDelay);
    Sleep(1'500);
  }

  qa::PublicationPayload ready =
      BasePublication(bootstrap, qa::PublicationState::kReady, 1);
  if (IsScenario(scenario, L"wrong-nonce")) {
    qa::FillRandom(ready.sessionNonce.data(), ready.sessionNonce.size());
  } else if (IsScenario(scenario, L"wrong-identity")) {
    ++ready.target.creationFileTime;
  } else if (IsScenario(scenario, L"stale-generation")) {
    --ready.inputGeneration;
  } else if (IsScenario(scenario, L"stale-topology")) {
    --ready.topologyEpoch;
  } else if (IsScenario(scenario, L"wrong-commit")) {
    ++ready.nativeCommitSequence;
  } else if (IsScenario(scenario, L"early-timing")) {
    ready.publicationQpc = ready.resumeQpc;
  }

  std::array<std::uint8_t, qa::kSecretBytes> signing_key = bootstrap.key;
  if (IsScenario(scenario, L"forged")) {
    qa::FillRandom(signing_key.data(), signing_key.size());
  }
  const bool record_published = qa::Publish(shared, ready, signing_key);
  if (record_published) SetStage(shared, qa::TargetStage::kReadyPublished);
  const bool published =
      record_published && SetEvent(publication.get()) != FALSE;
  SecureZeroMemory(signing_key.data(), signing_key.size());
  if (!published) {
    SecureZeroMemory(&bootstrap, sizeof(bootstrap));
    VirtualUnlock(&bootstrap, sizeof(bootstrap));
    return 25;
  }

  const HANDLE release_wait[] = {release.get(), owner.get()};
  const DWORD released = WaitForMultipleObjects(2, release_wait, FALSE, 5'000);
  if (released != WAIT_OBJECT_0) {
    SecureZeroMemory(&bootstrap, sizeof(bootstrap));
    VirtualUnlock(&bootstrap, sizeof(bootstrap));
    return released == WAIT_OBJECT_0 + 1 ? 26 : 27;
  }
  SetStage(shared, qa::TargetStage::kReleaseObserved);

  if (IsScenario(scenario, L"release-early-exit")) {
    SecureZeroMemory(&bootstrap, sizeof(bootstrap));
    VirtualUnlock(&bootstrap, sizeof(bootstrap));
    return 91;
  }

  if (IsScenario(scenario, L"release-refused")) {
    SetStage(shared, qa::TargetStage::kReleaseRefused);
    WaitForSingleObject(owner.get(), INFINITE);
    return 28;
  }
  if (IsScenario(scenario, L"late-release")) {
    SetStage(shared, qa::TargetStage::kLateReleaseDelay);
    Sleep(1'500);
  }

  qa::PublicationPayload released_payload =
      BasePublication(bootstrap, qa::PublicationState::kReleased, 2);
  if (IsScenario(scenario, L"release-replay")) released_payload = ready;
  const bool release_record_published =
      qa::Publish(shared, released_payload, bootstrap.key);
  if (release_record_published)
    SetStage(shared, qa::TargetStage::kReleasePublished);
  const bool release_published =
      release_record_published && SetEvent(publication.get()) != FALSE;
  const HANDLE acceptance_wait[] = {accept.get(), owner.get()};
  const DWORD accepted =
      release_published
          ? WaitForMultipleObjects(2, acceptance_wait, FALSE, 5'000)
          : WAIT_FAILED;
  if (accepted == WAIT_OBJECT_0 &&
      !IsScenario(scenario, L"release-replay")) {
    SetStage(shared, qa::TargetStage::kAcceptanceObserved);
    InterlockedExchange(&shared->gameEntryReached, 1);
    SetStage(shared, qa::TargetStage::kGameEntryReached);
  }

  SecureZeroMemory(&bootstrap, sizeof(bootstrap));
  VirtualUnlock(&bootstrap, sizeof(bootstrap));
  return release_published && accepted == WAIT_OBJECT_0 ? 0 : 29;
}
