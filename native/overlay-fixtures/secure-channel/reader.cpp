#include "contract.hpp"

#include <array>
#include <cerrno>
#include <cwchar>
#include <iostream>
#include <string>

namespace qa = gamehub::overlay::secure_channel_qa;

namespace {

class LockedBootstrap final {
 public:
  LockedBootstrap() noexcept {
    locked_ = VirtualLock(&value, sizeof(value)) != FALSE;
  }
  ~LockedBootstrap() {
    SecureZeroMemory(&value, sizeof(value));
    if (locked_) VirtualUnlock(&value, sizeof(value));
  }
  LockedBootstrap(const LockedBootstrap&) = delete;
  LockedBootstrap& operator=(const LockedBootstrap&) = delete;

  qa::BootstrapPacket value{};
  bool locked() const noexcept { return locked_; }

 private:
  bool locked_ = false;
};

class Handle final {
 public:
  explicit Handle(HANDLE value = nullptr) noexcept : value_(value) {}
  ~Handle() {
    if (value_ != nullptr && value_ != INVALID_HANDLE_VALUE) CloseHandle(value_);
  }
  Handle(const Handle&) = delete;
  Handle& operator=(const Handle&) = delete;
  HANDLE get() const noexcept { return value_; }
  void reset(HANDLE value = nullptr) noexcept {
    if (value_ != nullptr && value_ != INVALID_HANDLE_VALUE) CloseHandle(value_);
    value_ = value;
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
  View(const View&) = delete;
  View& operator=(const View&) = delete;
  void* get() const noexcept { return value_; }

 private:
  void* value_;
};

bool ParseHandle(const wchar_t* text, HANDLE* output) {
  if (text == nullptr || output == nullptr || *text == L'\0') return false;
  errno = 0;
  wchar_t* end = nullptr;
  const unsigned long long raw = wcstoull(text, &end, 0);
  if (errno != 0 || end == text || *end != L'\0' || raw == 0) return false;
  *output = reinterpret_cast<HANDLE>(static_cast<ULONG_PTR>(raw));
  return true;
}

bool ReadExact(HANDLE pipe, void* output, DWORD bytes) {
  auto* cursor = static_cast<std::uint8_t*>(output);
  DWORD total = 0;
  while (total < bytes) {
    DWORD read = 0;
    if (!ReadFile(pipe, cursor + total, bytes - total, &read, nullptr) ||
        read == 0) {
      return false;
    }
    total += read;
  }
  return true;
}

void CountFailure(qa::ValidationFailure failure, qa::ReaderReport* report) {
  switch (failure) {
    case qa::ValidationFailure::kTorn:
      ++report->tornRejected;
      break;
    case qa::ValidationFailure::kSchema:
      ++report->schemaRejected;
      break;
    case qa::ValidationFailure::kMac:
      ++report->macRejected;
      break;
    case qa::ValidationFailure::kNonce:
      ++report->nonceRejected;
      break;
    case qa::ValidationFailure::kIdentity:
      ++report->identityRejected;
      break;
    case qa::ValidationFailure::kGeneration:
      ++report->generationRejected;
      break;
    case qa::ValidationFailure::kTopology:
      ++report->topologyRejected;
      break;
    case qa::ValidationFailure::kSlots:
      ++report->slotRejected;
      break;
    case qa::ValidationFailure::kReplay:
      ++report->replayRejected;
      break;
    case qa::ValidationFailure::kState:
      ++report->stateRejected;
      break;
    case qa::ValidationFailure::kNone:
      break;
  }
}

bool ScenarioExpectation(const std::wstring& scenario,
                         const qa::ReaderReport& report) {
  if (scenario == L"forged" || scenario == L"ack-spoof") {
    return report.macRejected > 0 &&
           report.attackerProbeBits ==
               static_cast<std::uint32_t>(qa::kExpectedReducedThreatProbe);
  }
  if (scenario == L"wrong-nonce") return report.nonceRejected > 0;
  if (scenario == L"stale-pid" || scenario == L"stale-creation" ||
      scenario == L"wrong-volume" || scenario == L"wrong-file-id" ||
      scenario == L"wrong-canonical-path" ||
      scenario == L"stale-coordinator") {
    return report.identityRejected > 0;
  }
  if (scenario == L"stale-generation") return report.generationRejected > 0;
  if (scenario == L"stale-topology") return report.topologyRejected > 0;
  if (scenario == L"torn") return report.tornRejected > 0;
  if (scenario == L"replay") return report.replayRejected > 0;
  if (scenario == L"blocked-release") return report.slotRejected > 0;
  if (scenario == L"race") {
    return report.acceptedRaceHeartbeats > 0 &&
           report.acceptedBlockedPublications >= 2;
  }
  if (scenario == L"two-writer") {
    return report.acceptedConcurrentRaceHeartbeats > 0 &&
           report.casContention > 0 && report.latchPreserved &&
           (report.macRejected > 0 || report.tornRejected > 0) &&
           report.attackerProbeBits ==
               static_cast<std::uint32_t>(qa::kExpectedReducedThreatProbe);
  }
  if (scenario == L"owner-death") return report.ownerDeathFailOpen;
  return scenario == L"normal";
}

}  // namespace

int wmain(int argument_count, wchar_t** arguments) {
  if (argument_count != 17 || wcscmp(arguments[1], L"--map") != 0 ||
      wcscmp(arguments[3], L"--update") != 0 ||
      wcscmp(arguments[5], L"--pipe") != 0 ||
      wcscmp(arguments[7], L"--owner") != 0 ||
      wcscmp(arguments[9], L"--decoy") != 0 ||
      wcscmp(arguments[11], L"--ack") != 0 ||
      wcscmp(arguments[13], L"--result") != 0 ||
      wcscmp(arguments[15], L"--scenario") != 0) {
    return 80;
  }

  const std::wstring map_name = arguments[2];
  const std::wstring update_name = arguments[4];
  const std::wstring result_path = arguments[14];
  const std::wstring scenario = arguments[16];
  HANDLE pipe_raw = nullptr;
  HANDLE owner_raw = nullptr;
  HANDLE decoy_raw = nullptr;
  HANDLE ack_raw = nullptr;
  if (map_name.empty() || update_name.empty() || result_path.empty() ||
      !ParseHandle(arguments[6], &pipe_raw) ||
      !ParseHandle(arguments[8], &owner_raw) ||
      !ParseHandle(arguments[10], &decoy_raw) ||
      !ParseHandle(arguments[12], &ack_raw)) {
    return 81;
  }

  Handle pipe(pipe_raw);
  Handle owner(owner_raw);
  Handle ack(ack_raw);
  qa::ReaderReport report;
  DWORD pipe_flags = 0;
  report.pipeAllowlisted =
      GetHandleInformation(pipe.get(), &pipe_flags) != FALSE;
  DWORD owner_flags = 0;
  report.ownerHandleAllowlisted =
      GetHandleInformation(owner.get(), &owner_flags) != FALSE;
  DWORD ack_flags = 0;
  report.ackHandleAllowlisted =
      GetHandleInformation(ack.get(), &ack_flags) != FALSE;
  DWORD decoy_flags = 0;
  SetLastError(ERROR_SUCCESS);
  report.decoyExcluded =
      GetHandleInformation(decoy_raw, &decoy_flags) == FALSE &&
      GetLastError() == ERROR_INVALID_HANDLE;

  LockedBootstrap locked_bootstrap;
  if (!locked_bootstrap.locked() ||
      !ReadExact(pipe.get(), &locked_bootstrap.value,
                 static_cast<DWORD>(sizeof(locked_bootstrap.value)))) {
    return 82;
  }
  qa::BootstrapPacket& bootstrap = locked_bootstrap.value;
  report.bootstrapRead =
      bootstrap.magic == qa::kBootstrapMagic &&
      bootstrap.schemaVersion == qa::kSchemaVersion &&
      bootstrap.packetBytes == sizeof(bootstrap) &&
      bootstrap.generation == qa::kGeneration &&
      bootstrap.topologyEpoch == qa::kTopologyEpoch &&
      bootstrap.requiredSlotBitmap == qa::kRequiredSlots;
  qa::TargetIdentity self{};
  report.selfIdentityMatched =
      qa::QuerySelfIdentity(&self) && qa::EqualIdentity(self, bootstrap.target);
  qa::TargetIdentity owner_identity{};
  report.ownerIdentityMatched =
      qa::QueryProcessIdentityFromHandle(owner.get(), &owner_identity) &&
      qa::EqualIdentity(owner_identity, bootstrap.coordinator);
  if (!report.bootstrapRead || !report.pipeAllowlisted ||
      !report.ackHandleAllowlisted || !report.decoyExcluded ||
      !report.selfIdentityMatched || !report.ownerIdentityMatched) {
    return 83;
  }
  if (!report.ownerHandleAllowlisted) return 83;
  pipe.reset();

  Handle mapping(OpenFileMappingW(FILE_MAP_READ | FILE_MAP_WRITE, FALSE,
                                  map_name.c_str()));
  Handle update(OpenEventW(SYNCHRONIZE, FALSE, update_name.c_str()));
  if (mapping.get() == nullptr || update.get() == nullptr) {
    return 84;
  }
  View view(MapViewOfFile(mapping.get(), FILE_MAP_READ | FILE_MAP_WRITE, 0, 0,
                          sizeof(qa::SharedRecord)));
  if (view.get() == nullptr) return 85;
  report.mapOpened = true;
  auto* shared = static_cast<qa::SharedRecord*>(view.get());

  qa::PublicationPayload payload{};
  std::array<std::uint8_t, qa::kDigestBytes> mac{};
  if (!qa::ReadStable(shared, &payload, &mac)) return 86;
  const qa::ValidationFailure initial = qa::ValidatePublication(
      payload, mac, bootstrap, 0, qa::PublicationState::kBlocked);
  SecureZeroMemory(mac.data(), mac.size());
  if (initial != qa::ValidationFailure::kNone) return 87;
  report.blockAuthenticated = true;
  report.blockLatched = true;
  report.finalLatched = true;
  report.exactSlotsAccepted =
      payload.requiredSlotBitmap == qa::kRequiredSlots &&
      payload.readySlotBitmap == qa::kRequiredSlots;
  report.acceptedPublications = 1;
  report.acceptedBlockedPublications = 1;
  std::uint64_t last_commit = payload.commit;
  if (!SetEvent(ack.get())) return 88;

  if (scenario == L"hang") Sleep(INFINITE);

  const HANDLE waits[] = {update.get(), owner.get()};
  const ULONGLONG deadline = GetTickCount64() + qa::kDefaultTimeoutMs;
  while (report.finalLatched && GetTickCount64() < deadline) {
    const ULONGLONG remaining = deadline - GetTickCount64();
    const DWORD wait_ms = static_cast<DWORD>(
        remaining > qa::kDefaultTimeoutMs ? qa::kDefaultTimeoutMs : remaining);
    const DWORD wait = WaitForMultipleObjects(2, waits, FALSE, wait_ms);
    if (wait == WAIT_OBJECT_0 + 1) {
      report.ownerDeathFailOpen = true;
      report.finalLatched = false;
      break;
    }
    if (wait != WAIT_OBJECT_0) break;

    qa::PublicationPayload observed{};
    std::array<std::uint8_t, qa::kDigestBytes> observed_mac{};
    if (!qa::ReadStable(shared, &observed, &observed_mac)) {
      CountFailure(qa::ValidationFailure::kTorn, &report);
      report.latchPreserved = report.finalLatched;
      SetEvent(ack.get());
      continue;
    }
    qa::PublicationState expected = qa::PublicationState::kReleased;
    if (observed.state == qa::PublicationState::kBlocked) {
      expected = qa::PublicationState::kBlocked;
    }
    const qa::ValidationFailure validation = qa::ValidatePublication(
        observed, observed_mac, bootstrap, last_commit, expected);
    SecureZeroMemory(observed_mac.data(), observed_mac.size());
    if (validation != qa::ValidationFailure::kNone) {
      CountFailure(validation, &report);
      report.latchPreserved = report.finalLatched;
      SetEvent(ack.get());
      continue;
    }

    last_commit = observed.commit;
    ++report.acceptedPublications;
    if (observed.state == qa::PublicationState::kBlocked) {
      ++report.acceptedBlockedPublications;
      if ((observed.publicationFlags & qa::kPublicationFlagRaceHeartbeat) != 0) {
        ++report.acceptedRaceHeartbeats;
        if (InterlockedCompareExchange(&shared->hostileWriterActive, 0, 0) !=
            0) {
          ++report.acceptedConcurrentRaceHeartbeats;
        }
      }
    }
    if (observed.state == qa::PublicationState::kReleased) {
      report.releasedAuthenticated = true;
      report.finalLatched = false;
    }
    if (!SetEvent(ack.get())) return 89;
  }

  report.casContention = static_cast<std::uint64_t>(
      InterlockedCompareExchange64(&shared->casContention, 0, 0));
  report.attackerProbeBits = static_cast<std::uint32_t>(
      InterlockedCompareExchange(&shared->attackerProbeBits, 0, 0));
  const bool base = report.bootstrapRead && report.pipeAllowlisted &&
                    report.ownerHandleAllowlisted &&
                    report.ackHandleAllowlisted &&
                    report.ownerIdentityMatched && report.decoyExcluded &&
                    report.selfIdentityMatched && report.mapOpened &&
                    report.blockAuthenticated && report.blockLatched &&
                    report.exactSlotsAccepted && !report.finalLatched &&
                    (report.releasedAuthenticated ||
                     report.ownerDeathFailOpen);
  report.proofPassed = base && ScenarioExpectation(scenario, report);
  if (!qa::WriteReaderReport(result_path, scenario, report)) return 90;
  return report.proofPassed ? 0 : 91;
}
