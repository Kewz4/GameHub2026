#pragma once

#include <windows.h>

#include <array>
#include <cstddef>
#include <cstdint>
#include <string>

namespace gamehub::overlay::secure_channel_qa {

constexpr std::uint32_t kSchemaVersion = 1;
constexpr std::uint32_t kBootstrapMagic = 0x43485347u;  // GSHC
constexpr std::uint64_t kGeneration = 0x0000'0000'0000'0011ull;
constexpr std::uint64_t kTopologyEpoch = 0x0000'0000'0000'0017ull;
constexpr std::uint64_t kRequiredSlots = 0x0000'0000'0000'0007ull;
constexpr std::size_t kSecretBytes = 32;
constexpr std::size_t kNonceBytes = 32;
constexpr std::size_t kDigestBytes = 32;
constexpr std::uint32_t kCanonicalPublicationBytes = 224;
constexpr DWORD kDefaultTimeoutMs = 10'000;
constexpr std::uint32_t kPublicationFlagRaceHeartbeat = 0x0000'0001u;

constexpr LONG kProbeQueryIdentityMatched = 0x0000'0001L;
constexpr LONG kProbeVmReadDenied = 0x0000'0002L;
constexpr LONG kProbeDuplicateDenied = 0x0000'0004L;
constexpr LONG kProbeWriteDacAvailable = 0x0000'0008L;
constexpr LONG kProbeReAclAvailable = 0x0000'0010L;
constexpr LONG kProbeNamedAckAbsent = 0x0000'0020L;
constexpr LONG kProbePrivilegedDuplicateDenied = 0x0000'0040L;
constexpr LONG kExpectedReducedThreatProbe =
    kProbeQueryIdentityMatched | kProbeVmReadDenied | kProbeDuplicateDenied |
    kProbeWriteDacAvailable | kProbeReAclAvailable | kProbeNamedAckAbsent |
    kProbePrivilegedDuplicateDenied;

enum class PublicationState : std::uint32_t {
  kBlocked = 1,
  kReleased = 2,
};

enum class ValidationFailure : std::uint32_t {
  kNone = 0,
  kTorn = 1,
  kSchema = 2,
  kMac = 3,
  kNonce = 4,
  kIdentity = 5,
  kGeneration = 6,
  kTopology = 7,
  kSlots = 8,
  kReplay = 9,
  kState = 10,
};

struct TargetIdentity {
  std::uint32_t pid;
  std::uint32_t reserved;
  std::uint64_t creationFileTime;
  std::uint64_t volumeSerial;
  std::array<std::uint8_t, 16> fileId;
  std::array<std::uint8_t, kDigestBytes> canonicalPathDigest;
};

struct PublicationPayload {
  std::uint32_t schemaVersion;
  std::uint32_t payloadBytes;
  std::array<std::uint8_t, kNonceBytes> sessionNonce;
  TargetIdentity target;
  TargetIdentity coordinator;
  std::uint64_t generation;
  std::uint64_t topologyEpoch;
  std::uint64_t commit;
  std::uint64_t requiredSlotBitmap;
  std::uint64_t readySlotBitmap;
  PublicationState state;
  std::uint32_t publicationFlags;
};

struct alignas(64) SharedRecord {
  volatile LONG64 sequence;
  volatile LONG64 casContention;
  volatile LONG attackerProbeBits;
  volatile LONG hostileWriterActive;
  PublicationPayload payload;
  std::array<std::uint8_t, kDigestBytes> mac;
  std::array<std::uint8_t, 32> alignmentPadding;
};

struct BootstrapPacket {
  std::uint32_t magic;
  std::uint32_t schemaVersion;
  std::uint32_t packetBytes;
  std::uint32_t reserved;
  std::array<std::uint8_t, kSecretBytes> key;
  std::array<std::uint8_t, kNonceBytes> sessionNonce;
  TargetIdentity target;
  TargetIdentity coordinator;
  std::uint64_t generation;
  std::uint64_t topologyEpoch;
  std::uint64_t requiredSlotBitmap;
};

static_assert(alignof(SharedRecord) >= 8);
static_assert(offsetof(SharedRecord, sequence) % alignof(LONG64) == 0);
static_assert(offsetof(SharedRecord, casContention) % alignof(LONG64) == 0);
static_assert(sizeof(SharedRecord) == 320);
static_assert(sizeof(PublicationState) == sizeof(std::uint32_t));
static_assert(sizeof(PublicationPayload) < 512);
static_assert(sizeof(SharedRecord) < 1024);
static_assert(sizeof(BootstrapPacket) < 512);

struct ReaderReport {
  bool bootstrapRead = false;
  bool pipeAllowlisted = false;
  bool ownerHandleAllowlisted = false;
  bool ackHandleAllowlisted = false;
  bool ownerIdentityMatched = false;
  bool decoyExcluded = false;
  bool selfIdentityMatched = false;
  bool mapOpened = false;
  bool blockAuthenticated = false;
  bool blockLatched = false;
  bool exactSlotsAccepted = false;
  bool latchPreserved = false;
  bool releasedAuthenticated = false;
  bool ownerDeathFailOpen = false;
  bool finalLatched = true;
  bool proofPassed = false;
  std::uint32_t acceptedPublications = 0;
  std::uint32_t acceptedBlockedPublications = 0;
  std::uint32_t acceptedRaceHeartbeats = 0;
  std::uint32_t acceptedConcurrentRaceHeartbeats = 0;
  std::uint32_t tornRejected = 0;
  std::uint32_t schemaRejected = 0;
  std::uint32_t macRejected = 0;
  std::uint32_t nonceRejected = 0;
  std::uint32_t identityRejected = 0;
  std::uint32_t generationRejected = 0;
  std::uint32_t topologyRejected = 0;
  std::uint32_t slotRejected = 0;
  std::uint32_t replayRejected = 0;
  std::uint32_t stateRejected = 0;
  std::uint64_t casContention = 0;
  std::uint32_t attackerProbeBits = 0;
};

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
std::wstring RandomHex(std::size_t bytes);
bool HmacPublication(
    const std::array<std::uint8_t, kSecretBytes>& key,
    const PublicationPayload& payload,
    std::array<std::uint8_t, kDigestBytes>* output) noexcept;
bool ConstantTimeEqual(const std::array<std::uint8_t, kDigestBytes>& left,
                       const std::array<std::uint8_t, kDigestBytes>& right)
    noexcept;
bool QueryProcessIdentity(HANDLE process, const std::wstring& executablePath,
                          TargetIdentity* output) noexcept;
bool QueryProcessIdentityFromHandle(HANDLE process,
                                    TargetIdentity* output) noexcept;
bool QuerySelfIdentity(TargetIdentity* output) noexcept;
bool EqualIdentity(const TargetIdentity& left,
                   const TargetIdentity& right) noexcept;
bool ReadStable(const SharedRecord* shared, PublicationPayload* payload,
                std::array<std::uint8_t, kDigestBytes>* mac) noexcept;
bool Publish(SharedRecord* shared, const PublicationPayload& payload,
             const std::array<std::uint8_t, kSecretBytes>& key,
             DWORD holdOddMilliseconds = 0) noexcept;
ValidationFailure ValidatePublication(
    const PublicationPayload& payload,
    const std::array<std::uint8_t, kDigestBytes>& mac,
    const BootstrapPacket& bootstrap, std::uint64_t lastCommit,
    PublicationState expectedState) noexcept;
bool WriteReaderReport(const std::wstring& path, const std::wstring& scenario,
                       const ReaderReport& report) noexcept;
bool WriteProcessIdentity(const std::wstring& path, HANDLE process,
                          DWORD pid) noexcept;

}  // namespace gamehub::overlay::secure_channel_qa
