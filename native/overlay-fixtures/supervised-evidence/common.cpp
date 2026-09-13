#include "contract.hpp"

#include <bcrypt.h>

#include <algorithm>
#include <array>
#include <cstring>
#include <limits>
#include <vector>

namespace gamehub::overlay::supervised_evidence_qa {
namespace {

class Algorithm final {
 public:
  ~Algorithm() {
    if (value_ != nullptr) BCryptCloseAlgorithmProvider(value_, 0);
  }
  BCRYPT_ALG_HANDLE* receive() noexcept { return &value_; }
  BCRYPT_ALG_HANDLE get() const noexcept { return value_; }

 private:
  BCRYPT_ALG_HANDLE value_ = nullptr;
};

class Hash final {
 public:
  ~Hash() {
    if (value_ != nullptr) BCryptDestroyHash(value_);
  }
  BCRYPT_HASH_HANDLE* receive() noexcept { return &value_; }
  BCRYPT_HASH_HANDLE get() const noexcept { return value_; }

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
  if (data == nullptr || output == nullptr ||
      bytes > std::numeric_limits<ULONG>::max()) {
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
  SecureZeroMemory(object.data(), object.size());
  return finish == 0;
}

template <std::size_t Size>
bool Append(std::array<std::uint8_t, Size>* output, std::size_t* cursor,
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
  return Append(output, cursor, encoded.data(), encoded.size());
}

template <std::size_t Size>
bool AppendU64(std::array<std::uint8_t, Size>* output, std::size_t* cursor,
               std::uint64_t value) noexcept {
  std::array<std::uint8_t, 8> encoded{};
  for (std::size_t index = 0; index < encoded.size(); ++index) {
    encoded[index] = static_cast<std::uint8_t>(value >> (index * 8));
  }
  return Append(output, cursor, encoded.data(), encoded.size());
}

template <std::size_t Size>
bool AppendIdentity(std::array<std::uint8_t, Size>* output,
                    std::size_t* cursor,
                    const TargetIdentity& identity) noexcept {
  return AppendU32(output, cursor, identity.pid) &&
         AppendU64(output, cursor, identity.creationFileTime) &&
         AppendU64(output, cursor, identity.volumeSerial) &&
         Append(output, cursor, identity.fileId.data(), identity.fileId.size()) &&
         Append(output, cursor, identity.canonicalPathDigest.data(),
                identity.canonicalPathDigest.size());
}

bool SerializePublication(
    const PublicationPayload& payload,
    std::array<std::uint8_t, kCanonicalPublicationBytes>* output) noexcept {
  output->fill(0);
  std::size_t cursor = 0;
  const bool result =
      AppendU32(output, &cursor, payload.schemaVersion) &&
      AppendU32(output, &cursor, payload.payloadBytes) &&
      Append(output, &cursor, payload.sessionNonce.data(),
             payload.sessionNonce.size()) &&
      AppendIdentity(output, &cursor, payload.target) &&
      AppendU64(output, &cursor, payload.inputGeneration) &&
      AppendU64(output, &cursor, payload.renderGeneration) &&
      AppendU64(output, &cursor, payload.topologyEpoch) &&
      AppendU64(output, &cursor, payload.nativeCommitSequence) &&
      AppendU64(output, &cursor, payload.absenceMonitorEpoch) &&
      AppendU64(output, &cursor, payload.requiredChildRoutes) &&
      AppendU64(output, &cursor, payload.requiredRenderSurfaces) &&
      AppendU64(output, &cursor, payload.publicationSequence) &&
      AppendU64(output, &cursor, payload.resumeQpc) &&
      AppendU64(output, &cursor, payload.publicationQpc) &&
      AppendU64(output, &cursor, payload.inputEvidenceFlags) &&
      AppendU64(output, &cursor, payload.renderEvidenceFlags) &&
      AppendU32(output, &cursor, payload.activeBackend) &&
      AppendU32(output, &cursor,
                static_cast<std::uint32_t>(payload.state));
  return result && cursor == output->size();
}

bool QueryFileBinding(const std::wstring& path,
                      TargetIdentity* output) noexcept {
  HANDLE file = CreateFileW(path.c_str(), GENERIC_READ | FILE_READ_ATTRIBUTES,
                            FILE_SHARE_READ, nullptr, OPEN_EXISTING,
                            FILE_ATTRIBUTE_NORMAL, nullptr);
  if (file == INVALID_HANDLE_VALUE) return false;
  FILE_ID_INFO file_identity{};
  std::vector<wchar_t> canonical(32'768);
  const bool identity_ok =
      GetFileInformationByHandleEx(file, FileIdInfo, &file_identity,
                                   sizeof(file_identity)) != FALSE;
  const DWORD canonical_length = GetFinalPathNameByHandleW(
      file, canonical.data(), static_cast<DWORD>(canonical.size()),
      FILE_NAME_NORMALIZED | VOLUME_NAME_DOS);
  CloseHandle(file);
  if (!identity_ok || canonical_length == 0 ||
      canonical_length >= canonical.size()) {
    return false;
  }
  output->volumeSerial = file_identity.VolumeSerialNumber;
  std::memcpy(output->fileId.data(), file_identity.FileId.Identifier,
              output->fileId.size());
  return output->volumeSerial != 0 &&
         Sha256(canonical.data(), canonical_length * sizeof(wchar_t),
                &output->canonicalPathDigest);
}

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

bool QueryProcessIdentity(HANDLE process, TargetIdentity* output) noexcept {
  if (process == nullptr || output == nullptr) return false;
  std::vector<wchar_t> path(32'768);
  DWORD path_length = static_cast<DWORD>(path.size());
  FILETIME creation{};
  FILETIME exit{};
  FILETIME kernel{};
  FILETIME user{};
  if (!QueryFullProcessImageNameW(process, 0, path.data(), &path_length) ||
      path_length == 0 || path_length >= path.size() ||
      !GetProcessTimes(process, &creation, &exit, &kernel, &user)) {
    return false;
  }
  ULARGE_INTEGER ticks{};
  ticks.LowPart = creation.dwLowDateTime;
  ticks.HighPart = creation.dwHighDateTime;
  *output = {};
  output->pid = GetProcessId(process);
  output->creationFileTime = ticks.QuadPart;
  return output->pid > 4 && output->creationFileTime != 0 &&
         QueryFileBinding(std::wstring(path.data(), path_length), output);
}

bool QuerySelfIdentity(TargetIdentity* output) noexcept {
  return QueryProcessIdentity(GetCurrentProcess(), output);
}

bool EqualIdentity(const TargetIdentity& left,
                   const TargetIdentity& right) noexcept {
  return left.pid == right.pid && left.reserved == right.reserved &&
         left.creationFileTime == right.creationFileTime &&
         left.volumeSerial == right.volumeSerial && left.fileId == right.fileId &&
         left.canonicalPathDigest == right.canonicalPathDigest;
}

bool HmacPublication(
    const std::array<std::uint8_t, kSecretBytes>& key,
    const PublicationPayload& payload,
    std::array<std::uint8_t, kDigestBytes>* output) noexcept {
  if (output == nullptr) return false;
  std::array<std::uint8_t, kCanonicalPublicationBytes> serialized{};
  if (!SerializePublication(payload, &serialized)) return false;
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
  std::vector<std::uint8_t> object(object_bytes);
  Hash hash;
  if (BCryptCreateHash(algorithm.get(), hash.receive(), object.data(),
                       static_cast<ULONG>(object.size()),
                       const_cast<PUCHAR>(key.data()),
                       static_cast<ULONG>(key.size()), 0) != 0) {
    SecureZeroMemory(serialized.data(), serialized.size());
    SecureZeroMemory(object.data(), object.size());
    return false;
  }
  const NTSTATUS update = BCryptHashData(
      hash.get(), serialized.data(), static_cast<ULONG>(serialized.size()), 0);
  const NTSTATUS finish =
      update == 0
          ? BCryptFinishHash(hash.get(), output->data(),
                             static_cast<ULONG>(output->size()), 0)
          : update;
  SecureZeroMemory(serialized.data(), serialized.size());
  SecureZeroMemory(object.data(), object.size());
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

bool Publish(SharedRecord* record, const PublicationPayload& payload,
             const std::array<std::uint8_t, kSecretBytes>& key) noexcept {
  if (record == nullptr) return false;
  std::array<std::uint8_t, kDigestBytes> mac{};
  if (!HmacPublication(key, payload, &mac)) return false;
  InterlockedIncrement64(&record->sequence);
  MemoryBarrier();
  record->payload = payload;
  record->mac = mac;
  MemoryBarrier();
  InterlockedIncrement64(&record->sequence);
  SecureZeroMemory(mac.data(), mac.size());
  return true;
}

bool ReadStable(const SharedRecord* record, PublicationPayload* payload,
                std::array<std::uint8_t, kDigestBytes>* mac) noexcept {
  if (record == nullptr || payload == nullptr || mac == nullptr) return false;
  for (std::size_t attempt = 0; attempt < 128; ++attempt) {
    const LONG64 before = InterlockedCompareExchange64(
        const_cast<volatile LONG64*>(&record->sequence), 0, 0);
    if ((before & 1) != 0 || before == 0) {
      YieldProcessor();
      continue;
    }
    MemoryBarrier();
    *payload = record->payload;
    *mac = record->mac;
    MemoryBarrier();
    const LONG64 after = InterlockedCompareExchange64(
        const_cast<volatile LONG64*>(&record->sequence), 0, 0);
    if (before == after && (after & 1) == 0) return true;
  }
  return false;
}

ValidationFailure ValidatePublication(
    const PublicationPayload& payload,
    const std::array<std::uint8_t, kDigestBytes>& mac,
    const BootstrapPacket& bootstrap, std::uint64_t expected_sequence,
    PublicationState expected_state) noexcept {
  if (payload.schemaVersion != kSchemaVersion ||
      payload.payloadBytes != sizeof(PublicationPayload)) {
    return ValidationFailure::kSchema;
  }
  std::array<std::uint8_t, kDigestBytes> expected_mac{};
  if (!HmacPublication(bootstrap.key, payload, &expected_mac) ||
      !ConstantTimeEqual(mac, expected_mac)) {
    SecureZeroMemory(expected_mac.data(), expected_mac.size());
    return ValidationFailure::kMac;
  }
  SecureZeroMemory(expected_mac.data(), expected_mac.size());
  if (payload.sessionNonce != bootstrap.sessionNonce)
    return ValidationFailure::kNonce;
  if (!EqualIdentity(payload.target, bootstrap.target))
    return ValidationFailure::kIdentity;
  if (payload.inputGeneration != bootstrap.inputGeneration)
    return ValidationFailure::kInputGeneration;
  if (payload.renderGeneration != bootstrap.renderGeneration)
    return ValidationFailure::kRenderGeneration;
  if (payload.topologyEpoch != bootstrap.topologyEpoch)
    return ValidationFailure::kTopology;
  if (payload.nativeCommitSequence != bootstrap.nativeCommitSequence)
    return ValidationFailure::kCommit;
  if (payload.absenceMonitorEpoch != bootstrap.absenceMonitorEpoch)
    return ValidationFailure::kAbsenceMonitor;
  if (payload.requiredChildRoutes != bootstrap.requiredChildRoutes)
    return ValidationFailure::kChildRoutes;
  if (payload.requiredRenderSurfaces != bootstrap.requiredRenderSurfaces)
    return ValidationFailure::kRenderSurfaces;
  if (payload.resumeQpc != bootstrap.resumeQpc ||
      payload.publicationQpc <= bootstrap.resumeQpc)
    return ValidationFailure::kTiming;
  if (payload.inputEvidenceFlags != kInputEvidenceFlags)
    return ValidationFailure::kInputEvidence;
  if (payload.renderEvidenceFlags != kRenderEvidenceFlags)
    return ValidationFailure::kRenderEvidence;
  if (payload.activeBackend != kD3d11Backend)
    return ValidationFailure::kBackend;
  if (payload.publicationSequence != expected_sequence)
    return ValidationFailure::kSequence;
  if (payload.state != expected_state) return ValidationFailure::kState;
  return ValidationFailure::kNone;
}

const char* ValidationFailureName(ValidationFailure failure) noexcept {
  switch (failure) {
    case ValidationFailure::kNone:
      return "none";
    case ValidationFailure::kTorn:
      return "torn";
    case ValidationFailure::kSchema:
      return "schema";
    case ValidationFailure::kMac:
      return "mac";
    case ValidationFailure::kNonce:
      return "nonce";
    case ValidationFailure::kIdentity:
      return "identity";
    case ValidationFailure::kInputGeneration:
      return "input-generation";
    case ValidationFailure::kRenderGeneration:
      return "render-generation";
    case ValidationFailure::kTopology:
      return "topology";
    case ValidationFailure::kCommit:
      return "commit";
    case ValidationFailure::kAbsenceMonitor:
      return "absence-monitor";
    case ValidationFailure::kChildRoutes:
      return "child-routes";
    case ValidationFailure::kRenderSurfaces:
      return "render-surfaces";
    case ValidationFailure::kTiming:
      return "timing";
    case ValidationFailure::kInputEvidence:
      return "input-evidence";
    case ValidationFailure::kRenderEvidence:
      return "render-evidence";
    case ValidationFailure::kBackend:
      return "backend";
    case ValidationFailure::kSequence:
      return "sequence";
    case ValidationFailure::kState:
      return "state";
  }
  return "unknown";
}

}  // namespace gamehub::overlay::supervised_evidence_qa
