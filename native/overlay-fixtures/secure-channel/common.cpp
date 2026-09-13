#include "contract.hpp"

#include <bcrypt.h>

#include <algorithm>
#include <array>
#include <cstring>
#include <limits>
#include <sstream>
#include <string>
#include <vector>

namespace gamehub::overlay::secure_channel_qa {
namespace {

class Algorithm final {
 public:
  Algorithm() noexcept = default;
  ~Algorithm() {
    if (value_ != nullptr) BCryptCloseAlgorithmProvider(value_, 0);
  }
  Algorithm(const Algorithm&) = delete;
  Algorithm& operator=(const Algorithm&) = delete;

  BCRYPT_ALG_HANDLE* receive() noexcept { return &value_; }
  BCRYPT_ALG_HANDLE get() const noexcept { return value_; }

 private:
  BCRYPT_ALG_HANDLE value_ = nullptr;
};

class Hash final {
 public:
  Hash() noexcept = default;
  ~Hash() {
    if (value_ != nullptr) BCryptDestroyHash(value_);
  }
  Hash(const Hash&) = delete;
  Hash& operator=(const Hash&) = delete;

  BCRYPT_HASH_HANDLE* receive() noexcept { return &value_; }
  BCRYPT_HASH_HANDLE get() const noexcept { return value_; }
  void reset() noexcept {
    if (value_ != nullptr) {
      BCryptDestroyHash(value_);
      value_ = nullptr;
    }
  }

 private:
  BCRYPT_HASH_HANDLE value_ = nullptr;
};

bool ReadProperty(BCRYPT_ALG_HANDLE algorithm, const wchar_t* property,
                  DWORD* output) noexcept {
  DWORD returned = 0;
  return BCryptGetProperty(algorithm, property,
                           reinterpret_cast<PUCHAR>(output), sizeof(*output),
                           &returned, 0) == 0 &&
         returned == sizeof(*output);
}

bool Sha256(const void* data, std::size_t bytes,
            std::array<std::uint8_t, kDigestBytes>* output) noexcept {
  if (output == nullptr || bytes > std::numeric_limits<ULONG>::max()) {
    return false;
  }
  Algorithm algorithm;
  if (BCryptOpenAlgorithmProvider(algorithm.receive(), BCRYPT_SHA256_ALGORITHM,
                                  nullptr, 0) != 0) {
    return false;
  }
  DWORD object_bytes = 0;
  DWORD digest_bytes = 0;
  if (!ReadProperty(algorithm.get(), BCRYPT_OBJECT_LENGTH, &object_bytes) ||
      !ReadProperty(algorithm.get(), BCRYPT_HASH_LENGTH, &digest_bytes) ||
      digest_bytes != output->size()) {
    return false;
  }
  std::vector<std::uint8_t> object(object_bytes);
  Hash hash;
  if (BCryptCreateHash(algorithm.get(), hash.receive(), object.data(),
                       static_cast<ULONG>(object.size()), nullptr, 0, 0) != 0) {
    hash.reset();
    SecureZeroMemory(object.data(), object.size());
    return false;
  }
  const NTSTATUS update = BCryptHashData(
      hash.get(), static_cast<PUCHAR>(const_cast<void*>(data)),
      static_cast<ULONG>(bytes), 0);
  const NTSTATUS finish =
      update == 0
          ? BCryptFinishHash(hash.get(), output->data(),
                             static_cast<ULONG>(output->size()), 0)
          : update;
  hash.reset();
  SecureZeroMemory(object.data(), object.size());
  return finish == 0;
}

template <std::size_t Size>
bool AppendBytes(std::array<std::uint8_t, Size>* output, std::size_t* cursor,
                 const void* value, std::size_t bytes) noexcept {
  if (output == nullptr || cursor == nullptr || value == nullptr ||
      *cursor > output->size() || bytes > output->size() - *cursor) {
    return false;
  }
  std::memcpy(output->data() + *cursor, value, bytes);
  *cursor += bytes;
  return true;
}

template <std::size_t Size>
bool AppendU32(std::array<std::uint8_t, Size>* output, std::size_t* cursor,
               std::uint32_t value) noexcept {
  const std::array<std::uint8_t, 4> encoded = {
      static_cast<std::uint8_t>(value),
      static_cast<std::uint8_t>(value >> 8),
      static_cast<std::uint8_t>(value >> 16),
      static_cast<std::uint8_t>(value >> 24),
  };
  return AppendBytes(output, cursor, encoded.data(), encoded.size());
}

template <std::size_t Size>
bool AppendU64(std::array<std::uint8_t, Size>* output, std::size_t* cursor,
               std::uint64_t value) noexcept {
  std::array<std::uint8_t, 8> encoded{};
  for (std::size_t index = 0; index < encoded.size(); ++index) {
    encoded[index] = static_cast<std::uint8_t>(value >> (index * 8));
  }
  return AppendBytes(output, cursor, encoded.data(), encoded.size());
}

template <std::size_t Size>
bool AppendIdentity(std::array<std::uint8_t, Size>* output,
                    std::size_t* cursor,
                    const TargetIdentity& identity) noexcept {
  return AppendU32(output, cursor, identity.pid) &&
         AppendU64(output, cursor, identity.creationFileTime) &&
         AppendU64(output, cursor, identity.volumeSerial) &&
         AppendBytes(output, cursor, identity.fileId.data(),
                     identity.fileId.size()) &&
         AppendBytes(output, cursor, identity.canonicalPathDigest.data(),
                     identity.canonicalPathDigest.size());
}

bool SerializePublication(
    const PublicationPayload& payload,
    std::array<std::uint8_t, kCanonicalPublicationBytes>* output) noexcept {
  if (output == nullptr) return false;
  output->fill(0);
  std::size_t cursor = 0;
  const bool succeeded =
      AppendU32(output, &cursor, payload.schemaVersion) &&
      AppendU32(output, &cursor, payload.payloadBytes) &&
      AppendBytes(output, &cursor, payload.sessionNonce.data(),
                  payload.sessionNonce.size()) &&
      AppendIdentity(output, &cursor, payload.target) &&
      AppendIdentity(output, &cursor, payload.coordinator) &&
      AppendU64(output, &cursor, payload.generation) &&
      AppendU64(output, &cursor, payload.topologyEpoch) &&
      AppendU64(output, &cursor, payload.commit) &&
      AppendU64(output, &cursor, payload.requiredSlotBitmap) &&
      AppendU64(output, &cursor, payload.readySlotBitmap) &&
      AppendU32(output, &cursor,
                static_cast<std::uint32_t>(payload.state)) &&
      AppendU32(output, &cursor, payload.publicationFlags);
  return succeeded && cursor == output->size();
}

bool QueryFileBinding(const std::wstring& executable_path,
                      TargetIdentity* output) noexcept {
  HANDLE file = CreateFileW(
      executable_path.c_str(), GENERIC_READ | FILE_READ_ATTRIBUTES,
      FILE_SHARE_READ, nullptr, OPEN_EXISTING,
      FILE_ATTRIBUTE_NORMAL | FILE_FLAG_OPEN_REPARSE_POINT, nullptr);
  if (file == INVALID_HANDLE_VALUE) return false;

  FILE_ID_INFO identity{};
  const bool identity_ok =
      GetFileInformationByHandleEx(file, FileIdInfo, &identity,
                                   sizeof(identity)) != FALSE;
  std::vector<wchar_t> canonical(32'768);
  const DWORD canonical_length = GetFinalPathNameByHandleW(
      file, canonical.data(), static_cast<DWORD>(canonical.size()),
      FILE_NAME_NORMALIZED | VOLUME_NAME_DOS);
  CloseHandle(file);
  if (!identity_ok || canonical_length == 0 ||
      canonical_length >= canonical.size()) {
    return false;
  }

  output->volumeSerial = identity.VolumeSerialNumber;
  std::memcpy(output->fileId.data(), identity.FileId.Identifier,
              output->fileId.size());
  return Sha256(canonical.data(),
                static_cast<std::size_t>(canonical_length) * sizeof(wchar_t),
                &output->canonicalPathDigest);
}

std::string JsonBool(bool value) { return value ? "true" : "false"; }

}  // namespace

LockedSecret::LockedSecret() noexcept {
  locked_ = VirtualLock(bytes_.data(), bytes_.size()) != FALSE;
}

LockedSecret::~LockedSecret() {
  SecureZeroMemory(bytes_.data(), bytes_.size());
  if (locked_) VirtualUnlock(bytes_.data(), bytes_.size());
}

bool FillRandom(void* output, std::size_t bytes) noexcept {
  return output != nullptr && bytes <= std::numeric_limits<ULONG>::max() &&
         BCryptGenRandom(nullptr, static_cast<PUCHAR>(output),
                         static_cast<ULONG>(bytes),
                         BCRYPT_USE_SYSTEM_PREFERRED_RNG) == 0;
}

std::wstring RandomHex(std::size_t bytes) {
  if (bytes == 0 || bytes > 64) return {};
  std::array<std::uint8_t, 64> random{};
  if (!FillRandom(random.data(), bytes)) return {};
  constexpr wchar_t digits[] = L"0123456789ABCDEF";
  std::wstring result;
  result.reserve(bytes * 2);
  for (std::size_t index = 0; index < bytes; ++index) {
    result.push_back(digits[random[index] >> 4]);
    result.push_back(digits[random[index] & 0x0f]);
  }
  SecureZeroMemory(random.data(), random.size());
  return result;
}

bool HmacPublication(
    const std::array<std::uint8_t, kSecretBytes>& key,
    const PublicationPayload& payload,
    std::array<std::uint8_t, kDigestBytes>* output) noexcept {
  if (output == nullptr) return false;
  Algorithm algorithm;
  if (BCryptOpenAlgorithmProvider(algorithm.receive(), BCRYPT_SHA256_ALGORITHM,
                                  nullptr, BCRYPT_ALG_HANDLE_HMAC_FLAG) != 0) {
    return false;
  }
  DWORD object_bytes = 0;
  DWORD digest_bytes = 0;
  if (!ReadProperty(algorithm.get(), BCRYPT_OBJECT_LENGTH, &object_bytes) ||
      !ReadProperty(algorithm.get(), BCRYPT_HASH_LENGTH, &digest_bytes) ||
      digest_bytes != output->size()) {
    return false;
  }
  std::array<std::uint8_t, kCanonicalPublicationBytes> serialized{};
  if (!SerializePublication(payload, &serialized)) return false;
  std::vector<std::uint8_t> object(object_bytes);
  Hash hash;
  if (BCryptCreateHash(algorithm.get(), hash.receive(), object.data(),
                       static_cast<ULONG>(object.size()),
                       const_cast<PUCHAR>(key.data()),
                       static_cast<ULONG>(key.size()), 0) != 0) {
    hash.reset();
    SecureZeroMemory(object.data(), object.size());
    SecureZeroMemory(serialized.data(), serialized.size());
    return false;
  }
  const NTSTATUS update = BCryptHashData(
      hash.get(), serialized.data(), static_cast<ULONG>(serialized.size()), 0);
  const NTSTATUS finish =
      update == 0
          ? BCryptFinishHash(hash.get(), output->data(),
                             static_cast<ULONG>(output->size()), 0)
          : update;
  hash.reset();
  SecureZeroMemory(object.data(), object.size());
  SecureZeroMemory(serialized.data(), serialized.size());
  return finish == 0;
}

bool ConstantTimeEqual(const std::array<std::uint8_t, kDigestBytes>& left,
                       const std::array<std::uint8_t, kDigestBytes>& right)
    noexcept {
  std::uint8_t difference = 0;
  for (std::size_t index = 0; index < left.size(); ++index) {
    difference = static_cast<std::uint8_t>(difference |
                                           (left[index] ^ right[index]));
  }
  return difference == 0;
}

bool QueryProcessIdentity(HANDLE process, const std::wstring& executable_path,
                          TargetIdentity* output) noexcept {
  if (process == nullptr || output == nullptr || executable_path.empty()) {
    return false;
  }
  FILETIME creation{};
  FILETIME exit{};
  FILETIME kernel{};
  FILETIME user{};
  if (!GetProcessTimes(process, &creation, &exit, &kernel, &user)) return false;
  ULARGE_INTEGER ticks{};
  ticks.LowPart = creation.dwLowDateTime;
  ticks.HighPart = creation.dwHighDateTime;
  output->pid = GetProcessId(process);
  output->reserved = 0;
  output->creationFileTime = ticks.QuadPart;
  return output->pid != 0 && QueryFileBinding(executable_path, output);
}

bool QuerySelfIdentity(TargetIdentity* output) noexcept {
  if (output == nullptr) return false;
  std::vector<wchar_t> path(32'768);
  const DWORD length = GetModuleFileNameW(nullptr, path.data(),
                                          static_cast<DWORD>(path.size()));
  if (length == 0 || length >= path.size()) return false;
  return QueryProcessIdentity(GetCurrentProcess(),
                              std::wstring(path.data(), length), output);
}

bool QueryProcessIdentityFromHandle(HANDLE process,
                                    TargetIdentity* output) noexcept {
  if (process == nullptr || output == nullptr) return false;
  std::vector<wchar_t> path(32'768);
  DWORD length = static_cast<DWORD>(path.size());
  if (!QueryFullProcessImageNameW(process, 0, path.data(), &length) ||
      length == 0 || length >= path.size()) {
    return false;
  }
  return QueryProcessIdentity(process, std::wstring(path.data(), length), output);
}

bool EqualIdentity(const TargetIdentity& left,
                   const TargetIdentity& right) noexcept {
  return left.pid == right.pid && left.reserved == right.reserved &&
         left.creationFileTime == right.creationFileTime &&
         left.volumeSerial == right.volumeSerial && left.fileId == right.fileId &&
         left.canonicalPathDigest == right.canonicalPathDigest;
}

bool ReadStable(const SharedRecord* shared, PublicationPayload* payload,
                std::array<std::uint8_t, kDigestBytes>* mac) noexcept {
  if (shared == nullptr || payload == nullptr || mac == nullptr) return false;
  auto* sequence = const_cast<volatile LONG64*>(&shared->sequence);
  const LONG64 before = InterlockedCompareExchange64(sequence, 0, 0);
  if ((before & 1) != 0) return false;
  MemoryBarrier();
  const PublicationPayload payload_snapshot = shared->payload;
  const auto mac_snapshot = shared->mac;
  MemoryBarrier();
  const LONG64 after = InterlockedCompareExchange64(sequence, 0, 0);
  if (before != after || (after & 1) != 0) return false;
  *payload = payload_snapshot;
  *mac = mac_snapshot;
  return true;
}

bool Publish(SharedRecord* shared, const PublicationPayload& payload,
             const std::array<std::uint8_t, kSecretBytes>& key,
             DWORD hold_odd_milliseconds) noexcept {
  if (shared == nullptr) return false;
  std::array<std::uint8_t, kDigestBytes> mac{};
  if (!HmacPublication(key, payload, &mac)) return false;
  LONG64 before = InterlockedCompareExchange64(&shared->sequence, 0, 0);
  bool acquired = false;
  LONG64 odd = 0;
  for (std::uint32_t attempt = 0; attempt < 64; ++attempt) {
    if ((before & 1) != 0 ||
        before >= std::numeric_limits<LONG64>::max() - 1) {
      InterlockedIncrement64(&shared->casContention);
      break;
    }
    odd = before + 1;
    const LONG64 observed =
        InterlockedCompareExchange64(&shared->sequence, odd, before);
    if (observed == before) {
      acquired = true;
      break;
    }
    InterlockedIncrement64(&shared->casContention);
    before = observed;
    YieldProcessor();
  }
  if (!acquired) {
    SecureZeroMemory(mac.data(), mac.size());
    return false;
  }
  if (hold_odd_milliseconds != 0) Sleep(hold_odd_milliseconds);
  MemoryBarrier();
  shared->payload = payload;
  shared->mac = mac;
  MemoryBarrier();
  const bool even = InterlockedCompareExchange64(&shared->sequence, odd + 1,
                                                  odd) == odd;
  SecureZeroMemory(mac.data(), mac.size());
  return even;
}

ValidationFailure ValidatePublication(
    const PublicationPayload& payload,
    const std::array<std::uint8_t, kDigestBytes>& mac,
    const BootstrapPacket& bootstrap, std::uint64_t last_commit,
    PublicationState expected_state) noexcept {
  if (payload.schemaVersion != kSchemaVersion ||
      payload.payloadBytes != kCanonicalPublicationBytes) {
    return ValidationFailure::kSchema;
  }
  if ((payload.publicationFlags & ~kPublicationFlagRaceHeartbeat) != 0) {
    return ValidationFailure::kSchema;
  }
  std::array<std::uint8_t, kDigestBytes> expected_mac{};
  if (!HmacPublication(bootstrap.key, payload, &expected_mac)) {
    return ValidationFailure::kMac;
  }
  const bool mac_matches = ConstantTimeEqual(mac, expected_mac);
  SecureZeroMemory(expected_mac.data(), expected_mac.size());
  if (!mac_matches) return ValidationFailure::kMac;
  if (payload.sessionNonce != bootstrap.sessionNonce) {
    return ValidationFailure::kNonce;
  }
  if (!EqualIdentity(payload.target, bootstrap.target)) {
    return ValidationFailure::kIdentity;
  }
  if (!EqualIdentity(payload.coordinator, bootstrap.coordinator)) {
    return ValidationFailure::kIdentity;
  }
  if (payload.generation != bootstrap.generation) {
    return ValidationFailure::kGeneration;
  }
  if (payload.topologyEpoch != bootstrap.topologyEpoch) {
    return ValidationFailure::kTopology;
  }
  if (payload.requiredSlotBitmap != bootstrap.requiredSlotBitmap ||
      payload.requiredSlotBitmap != kRequiredSlots ||
      payload.readySlotBitmap != payload.requiredSlotBitmap) {
    return ValidationFailure::kSlots;
  }
  if (payload.commit <= last_commit) return ValidationFailure::kReplay;
  if (payload.state != expected_state) return ValidationFailure::kState;
  return ValidationFailure::kNone;
}

bool WriteReaderReport(const std::wstring& path, const std::wstring& scenario,
                       const ReaderReport& report) noexcept {
  std::string scenario_utf8;
  if (!scenario.empty()) {
    const int required = WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS,
                                             scenario.data(),
                                             static_cast<int>(scenario.size()),
                                             nullptr, 0, nullptr, nullptr);
    if (required <= 0) return false;
    scenario_utf8.resize(static_cast<std::size_t>(required));
    if (WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, scenario.data(),
                            static_cast<int>(scenario.size()),
                            scenario_utf8.data(), required, nullptr,
                            nullptr) != required) {
      return false;
    }
  }
  if (scenario_utf8.find_first_of("\"\\\r\n") != std::string::npos) {
    return false;
  }
  std::ostringstream json;
  json << "{\n"
       << "  \"schemaVersion\": 1,\n"
       << "  \"scenario\": \"" << scenario_utf8 << "\",\n"
       << "  \"bootstrapRead\": " << JsonBool(report.bootstrapRead) << ",\n"
       << "  \"pipeAllowlisted\": " << JsonBool(report.pipeAllowlisted) << ",\n"
       << "  \"ownerHandleAllowlisted\": "
       << JsonBool(report.ownerHandleAllowlisted) << ",\n"
       << "  \"ackHandleAllowlisted\": "
       << JsonBool(report.ackHandleAllowlisted) << ",\n"
       << "  \"ownerIdentityMatched\": "
       << JsonBool(report.ownerIdentityMatched) << ",\n"
       << "  \"decoyExcluded\": " << JsonBool(report.decoyExcluded) << ",\n"
       << "  \"selfIdentityMatched\": " << JsonBool(report.selfIdentityMatched) << ",\n"
       << "  \"mapOpened\": " << JsonBool(report.mapOpened) << ",\n"
       << "  \"blockAuthenticated\": " << JsonBool(report.blockAuthenticated) << ",\n"
       << "  \"blockLatched\": " << JsonBool(report.blockLatched) << ",\n"
       << "  \"exactSlotsAccepted\": " << JsonBool(report.exactSlotsAccepted) << ",\n"
       << "  \"latchPreserved\": " << JsonBool(report.latchPreserved) << ",\n"
       << "  \"releasedAuthenticated\": " << JsonBool(report.releasedAuthenticated) << ",\n"
       << "  \"ownerDeathFailOpen\": " << JsonBool(report.ownerDeathFailOpen) << ",\n"
       << "  \"finalLatched\": " << JsonBool(report.finalLatched) << ",\n"
       << "  \"acceptedPublications\": " << report.acceptedPublications << ",\n"
       << "  \"acceptedBlockedPublications\": "
       << report.acceptedBlockedPublications << ",\n"
       << "  \"acceptedRaceHeartbeats\": "
       << report.acceptedRaceHeartbeats << ",\n"
       << "  \"acceptedConcurrentRaceHeartbeats\": "
       << report.acceptedConcurrentRaceHeartbeats << ",\n"
       << "  \"tornRejected\": " << report.tornRejected << ",\n"
       << "  \"schemaRejected\": " << report.schemaRejected << ",\n"
       << "  \"macRejected\": " << report.macRejected << ",\n"
       << "  \"nonceRejected\": " << report.nonceRejected << ",\n"
       << "  \"identityRejected\": " << report.identityRejected << ",\n"
       << "  \"generationRejected\": " << report.generationRejected << ",\n"
       << "  \"topologyRejected\": " << report.topologyRejected << ",\n"
       << "  \"slotRejected\": " << report.slotRejected << ",\n"
       << "  \"replayRejected\": " << report.replayRejected << ",\n"
       << "  \"stateRejected\": " << report.stateRejected << ",\n"
       << "  \"casContention\": " << report.casContention << ",\n"
       << "  \"attackerProbeBits\": " << report.attackerProbeBits << ",\n"
       << "  \"proofPassed\": " << JsonBool(report.proofPassed) << "\n"
       << "}\n";
  const std::string value = json.str();
  HANDLE file = CreateFileW(path.c_str(), GENERIC_WRITE, 0, nullptr, CREATE_NEW,
                            FILE_ATTRIBUTE_NORMAL | FILE_FLAG_WRITE_THROUGH,
                            nullptr);
  if (file == INVALID_HANDLE_VALUE) return false;
  DWORD written = 0;
  const bool succeeded =
      value.size() <= std::numeric_limits<DWORD>::max() &&
      WriteFile(file, value.data(), static_cast<DWORD>(value.size()), &written,
                nullptr) != FALSE &&
      written == value.size() && FlushFileBuffers(file) != FALSE;
  CloseHandle(file);
  return succeeded;
}

bool WriteProcessIdentity(const std::wstring& path, HANDLE process,
                          DWORD pid) noexcept {
  FILETIME creation{};
  FILETIME exit{};
  FILETIME kernel{};
  FILETIME user{};
  if (!GetProcessTimes(process, &creation, &exit, &kernel, &user)) return false;
  ULARGE_INTEGER ticks{};
  ticks.LowPart = creation.dwLowDateTime;
  ticks.HighPart = creation.dwHighDateTime;
  const std::string value = std::to_string(pid) + " " +
                            std::to_string(ticks.QuadPart) + "\n";
  HANDLE file = CreateFileW(path.c_str(), GENERIC_WRITE, 0, nullptr, CREATE_NEW,
                            FILE_ATTRIBUTE_NORMAL | FILE_FLAG_WRITE_THROUGH,
                            nullptr);
  if (file == INVALID_HANDLE_VALUE) return false;
  DWORD written = 0;
  const bool succeeded =
      WriteFile(file, value.data(), static_cast<DWORD>(value.size()), &written,
                nullptr) != FALSE &&
      written == value.size() && FlushFileBuffers(file) != FALSE;
  CloseHandle(file);
  return succeeded;
}

}  // namespace gamehub::overlay::secure_channel_qa
