#include "contract.hpp"

#include <array>
#include <cwchar>
#include <vector>

namespace qa = gamehub::overlay::secure_channel_qa;

namespace {

bool CreationMatches(HANDLE process, const qa::TargetIdentity& expected) {
  FILETIME creation{};
  FILETIME exit{};
  FILETIME kernel{};
  FILETIME user{};
  if (GetProcessId(process) != expected.pid ||
      !GetProcessTimes(process, &creation, &exit, &kernel, &user)) {
    return false;
  }
  ULARGE_INTEGER ticks{};
  ticks.LowPart = creation.dwLowDateTime;
  ticks.HighPart = creation.dwHighDateTime;
  return ticks.QuadPart == expected.creationFileTime;
}

LONG ProbeCoordinator(const qa::PublicationPayload& payload,
                      const std::wstring& map_name) {
  LONG bits = 0;
  HANDLE query = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION | SYNCHRONIZE,
                             FALSE, payload.coordinator.pid);
  const bool coordinator_matches =
      query != nullptr && CreationMatches(query, payload.coordinator);
  if (coordinator_matches) {
    bits |= qa::kProbeQueryIdentityMatched;
  }

  SetLastError(ERROR_SUCCESS);
  HANDLE vm_read =
      OpenProcess(PROCESS_VM_READ, FALSE, payload.coordinator.pid);
  if (vm_read == nullptr && GetLastError() == ERROR_ACCESS_DENIED) {
    bits |= qa::kProbeVmReadDenied;
  }
  if (vm_read != nullptr) CloseHandle(vm_read);

  SetLastError(ERROR_SUCCESS);
  HANDLE duplicate =
      OpenProcess(PROCESS_DUP_HANDLE, FALSE, payload.coordinator.pid);
  if (duplicate == nullptr && GetLastError() == ERROR_ACCESS_DENIED) {
    bits |= qa::kProbeDuplicateDenied;
  }
  if (duplicate != nullptr) CloseHandle(duplicate);

  if (query != nullptr) {
    HANDLE privileged = nullptr;
    SetLastError(ERROR_SUCCESS);
    const BOOL duplicated = DuplicateHandle(
        query, GetCurrentProcess(), GetCurrentProcess(), &privileged,
        PROCESS_VM_READ | PROCESS_DUP_HANDLE, FALSE, 0);
    if (!duplicated && GetLastError() == ERROR_ACCESS_DENIED) {
      bits |= qa::kProbePrivilegedDuplicateDenied;
    }
    if (privileged != nullptr) CloseHandle(privileged);
    CloseHandle(query);
  }

  HANDLE write_dac = OpenProcess(READ_CONTROL | WRITE_DAC, FALSE,
                                 payload.coordinator.pid);
  if (write_dac != nullptr && coordinator_matches) {
    bits |= qa::kProbeWriteDacAvailable;
    DWORD descriptor_bytes = 0;
    GetKernelObjectSecurity(write_dac, DACL_SECURITY_INFORMATION, nullptr, 0,
                            &descriptor_bytes);
    if (descriptor_bytes != 0 && GetLastError() == ERROR_INSUFFICIENT_BUFFER) {
      std::vector<std::uint8_t> descriptor(descriptor_bytes);
      if (GetKernelObjectSecurity(
              write_dac, DACL_SECURITY_INFORMATION,
              reinterpret_cast<PSECURITY_DESCRIPTOR>(descriptor.data()),
              descriptor_bytes, &descriptor_bytes) &&
          SetKernelObjectSecurity(
              write_dac,
              DACL_SECURITY_INFORMATION | PROTECTED_DACL_SECURITY_INFORMATION,
              reinterpret_cast<PSECURITY_DESCRIPTOR>(descriptor.data()))) {
        bits |= qa::kProbeReAclAvailable;
      }
    }
    CloseHandle(write_dac);
  }

  std::wstring guessed_ack = map_name;
  constexpr wchar_t map_suffix[] = L"-map";
  if (guessed_ack.size() >= 4 &&
      guessed_ack.compare(guessed_ack.size() - 4, 4, map_suffix) == 0) {
    guessed_ack.replace(guessed_ack.size() - 4, 4, L"-ack");
    SetLastError(ERROR_SUCCESS);
    HANDLE ack = OpenEventW(EVENT_MODIFY_STATE, FALSE, guessed_ack.c_str());
    if (ack == nullptr && GetLastError() == ERROR_FILE_NOT_FOUND) {
      bits |= qa::kProbeNamedAckAbsent;
    }
    if (ack != nullptr) CloseHandle(ack);
  }
  return bits;
}

}  // namespace

int wmain(int argument_count, wchar_t** arguments) {
  if (argument_count != 7 || wcscmp(arguments[1], L"--map") != 0 ||
      wcscmp(arguments[3], L"--update") != 0 ||
      wcscmp(arguments[5], L"--mode") != 0 || arguments[2][0] == L'\0' ||
      arguments[4][0] == L'\0' || arguments[6][0] == L'\0') {
    return 70;
  }
  const std::wstring map_name = arguments[2];
  const std::wstring mode = arguments[6];
  if (mode != L"forge" && mode != L"ack-spoof" && mode != L"contend") {
    return 70;
  }
  HANDLE mapping = OpenFileMappingW(FILE_MAP_READ | FILE_MAP_WRITE, FALSE,
                                    map_name.c_str());
  HANDLE update = OpenEventW(EVENT_MODIFY_STATE, FALSE, arguments[4]);
  if (mapping == nullptr || update == nullptr) {
    if (mapping != nullptr) CloseHandle(mapping);
    if (update != nullptr) CloseHandle(update);
    return 71;
  }
  auto* shared = static_cast<qa::SharedRecord*>(
      MapViewOfFile(mapping, FILE_MAP_READ | FILE_MAP_WRITE, 0, 0,
                    sizeof(qa::SharedRecord)));
  if (shared == nullptr) {
    CloseHandle(update);
    CloseHandle(mapping);
    return 72;
  }
  qa::PublicationPayload payload{};
  std::array<std::uint8_t, qa::kDigestBytes> prior_mac{};
  qa::LockedSecret wrong_key;
  const bool ready = wrong_key.locked() &&
                     qa::FillRandom(wrong_key.bytes().data(),
                                    wrong_key.bytes().size()) &&
                     qa::ReadStable(shared, &payload, &prior_mac);
  SecureZeroMemory(prior_mac.data(), prior_mac.size());
  if (!ready) {
    UnmapViewOfFile(shared);
    CloseHandle(update);
    CloseHandle(mapping);
    return 73;
  }

  const LONG probe = ProbeCoordinator(payload, map_name);
  InterlockedExchange(&shared->attackerProbeBits, probe);
  if (probe != qa::kExpectedReducedThreatProbe) {
    UnmapViewOfFile(shared);
    CloseHandle(update);
    CloseHandle(mapping);
    return 75;
  }

  bool succeeded = true;
  if (mode == L"contend") {
    InterlockedExchange(&shared->hostileWriterActive, 1);
    for (std::uint64_t attempt = 0; attempt < 100; ++attempt) {
      qa::PublicationPayload hostile{};
      std::array<std::uint8_t, qa::kDigestBytes> ignored_mac{};
      if (qa::ReadStable(shared, &hostile, &ignored_mac)) {
        SecureZeroMemory(ignored_mac.data(), ignored_mac.size());
        hostile.commit += 20'000 + attempt;
        hostile.state = qa::PublicationState::kBlocked;
        hostile.publicationFlags = qa::kPublicationFlagRaceHeartbeat;
        if (qa::Publish(shared, hostile, wrong_key.bytes(), 1)) {
          SetEvent(update);
        }
      } else {
        SecureZeroMemory(ignored_mac.data(), ignored_mac.size());
      }
      Sleep(1);
    }
    InterlockedExchange(&shared->hostileWriterActive, 0);
  } else {
    ++payload.commit;
    payload.state = qa::PublicationState::kReleased;
    succeeded = qa::Publish(shared, payload, wrong_key.bytes()) &&
                SetEvent(update) != FALSE;
  }

  UnmapViewOfFile(shared);
  CloseHandle(update);
  CloseHandle(mapping);
  return succeeded ? 0 : 74;
}
