#pragma once

#include <windows.h>

#include <array>
#include <cstddef>
#include <cstdint>
#include <string>

namespace gamehub::overlay::supervised_evidence_qa {

constexpr std::uint32_t kSchemaVersion = 1;
constexpr std::uint32_t kBootstrapMagic = 0x45534847u;  // GHSE
constexpr std::size_t kSecretBytes = 32;
constexpr std::size_t kNonceBytes = 32;
constexpr std::size_t kDigestBytes = 32;
constexpr std::uint64_t kInputGeneration = 0x31;
constexpr std::uint64_t kRenderGeneration = 0x47;
constexpr std::uint64_t kTopologyEpoch = 0x59;
constexpr std::uint64_t kNativeCommitSequence = 0x71;
constexpr std::uint64_t kAbsenceMonitorEpoch = 0x83;
constexpr std::uint64_t kRequiredChildRoutes = 0x03;
constexpr std::uint64_t kRequiredRenderSurfaces = 0x03;
constexpr std::uint64_t kInputEvidenceFlags = 0x0f;
constexpr std::uint64_t kRenderEvidenceFlags = 0x07;
constexpr std::uint32_t kD3d11Backend = 1;
constexpr std::size_t kCanonicalPublicationBytes = 212;
constexpr DWORD kPublicationTimeoutMs = 500;
constexpr DWORD kReleaseTimeoutMs = 500;

enum class PublicationState : std::uint32_t {
  kReady = 1,
  kReleased = 2,
};

enum class TargetStage : LONG {
  kNotStarted = 0,
  kBootstrapConsumed = 1,
  kSelfIdentityValidated = 2,
  kLatePublicationDelay = 3,
  kReadyPublished = 4,
  kReleaseObserved = 5,
  kReleaseRefused = 6,
  kLateReleaseDelay = 7,
  kReleasePublished = 8,
  kAcceptanceObserved = 9,
  kGameEntryReached = 10,
};

enum class ValidationFailure : std::uint32_t {
  kNone = 0,
  kTorn,
  kSchema,
  kMac,
  kNonce,
  kIdentity,
  kInputGeneration,
  kRenderGeneration,
  kTopology,
  kCommit,
  kAbsenceMonitor,
  kChildRoutes,
  kRenderSurfaces,
  kTiming,
  kInputEvidence,
  kRenderEvidence,
  kBackend,
  kSequence,
  kState,
};

struct TargetIdentity {
  std::uint32_t pid;
  std::uint32_t reserved;
  std::uint64_t creationFileTime;
  std::uint64_t volumeSerial;
  std::array<std::uint8_t, 16> fileId;
  std::array<std::uint8_t, kDigestBytes> canonicalPathDigest;
};

struct BootstrapPacket {
  std::uint32_t magic;
  std::uint32_t schemaVersion;
  std::uint32_t packetBytes;
  std::uint32_t reserved;
  std::array<std::uint8_t, kSecretBytes> key;
  std::array<std::uint8_t, kNonceBytes> sessionNonce;
  TargetIdentity target;
  std::uint64_t inputGeneration;
  std::uint64_t renderGeneration;
  std::uint64_t topologyEpoch;
  std::uint64_t nativeCommitSequence;
  std::uint64_t absenceMonitorEpoch;
  std::uint64_t requiredChildRoutes;
  std::uint64_t requiredRenderSurfaces;
  std::uint64_t resumeQpc;
};

struct PublicationPayload {
  std::uint32_t schemaVersion;
  std::uint32_t payloadBytes;
  std::array<std::uint8_t, kNonceBytes> sessionNonce;
  TargetIdentity target;
  std::uint64_t inputGeneration;
  std::uint64_t renderGeneration;
  std::uint64_t topologyEpoch;
  std::uint64_t nativeCommitSequence;
  std::uint64_t absenceMonitorEpoch;
  std::uint64_t requiredChildRoutes;
  std::uint64_t requiredRenderSurfaces;
  std::uint64_t publicationSequence;
  std::uint64_t resumeQpc;
  std::uint64_t publicationQpc;
  std::uint64_t inputEvidenceFlags;
  std::uint64_t renderEvidenceFlags;
  std::uint32_t activeBackend;
  PublicationState state;
};

struct alignas(64) SharedRecord {
  volatile LONG64 sequence;
  volatile LONG gameEntryReached;
  volatile LONG bootstrapConsumed;
  volatile LONG targetStage;
  PublicationPayload payload;
  std::array<std::uint8_t, kDigestBytes> mac;
  std::array<std::uint8_t, 48> alignmentPadding;
};

static_assert(sizeof(TargetIdentity) == 72);
static_assert(sizeof(BootstrapPacket) < 256);
static_assert(sizeof(PublicationPayload) < 256);
static_assert(sizeof(SharedRecord) == 320);
static_assert(offsetof(SharedRecord, sequence) % alignof(LONG64) == 0);

class LockedSecret final {
 public:
  LockedSecret() noexcept;
  ~LockedSecret();
  LockedSecret(const LockedSecret&) = delete;
  LockedSecret& operator=(const LockedSecret&) = delete;

  std::array<std::uint8_t, kSecretBytes>& bytes() noexcept { return bytes_; }
  const std::array<std::uint8_t, kSecretBytes>& bytes() const noexcept {
    return bytes_;
  }
  bool locked() const noexcept { return locked_; }

 private:
  alignas(64) std::array<std::uint8_t, kSecretBytes> bytes_{};
  bool locked_ = false;
};

bool FillRandom(void* output, std::size_t bytes) noexcept;
bool QueryProcessIdentity(HANDLE process, TargetIdentity* output) noexcept;
bool QuerySelfIdentity(TargetIdentity* output) noexcept;
bool EqualIdentity(const TargetIdentity& left,
                   const TargetIdentity& right) noexcept;
bool HmacPublication(
    const std::array<std::uint8_t, kSecretBytes>& key,
    const PublicationPayload& payload,
    std::array<std::uint8_t, kDigestBytes>* output) noexcept;
bool ConstantTimeEqual(const std::array<std::uint8_t, kDigestBytes>& left,
                       const std::array<std::uint8_t, kDigestBytes>& right)
    noexcept;
bool Publish(SharedRecord* record, const PublicationPayload& payload,
             const std::array<std::uint8_t, kSecretBytes>& key) noexcept;
bool ReadStable(const SharedRecord* record, PublicationPayload* payload,
                std::array<std::uint8_t, kDigestBytes>* mac) noexcept;
ValidationFailure ValidatePublication(
    const PublicationPayload& payload,
    const std::array<std::uint8_t, kDigestBytes>& mac,
    const BootstrapPacket& bootstrap, std::uint64_t expectedSequence,
    PublicationState expectedState) noexcept;
const char* ValidationFailureName(ValidationFailure failure) noexcept;

}  // namespace gamehub::overlay::supervised_evidence_qa
