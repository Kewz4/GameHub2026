#include "contract.hpp"

#include <sddl.h>

#include <array>
#include <cerrno>
#include <cstdint>
#include <cwchar>
#include <iostream>
#include <limits>
#include <string>
#include <vector>

namespace qa = gamehub::overlay::secure_channel_qa;

namespace {

class Handle final {
 public:
  Handle() noexcept = default;
  explicit Handle(HANDLE value) noexcept : value_(value) {}
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
    HANDLE value = value_;
    value_ = nullptr;
    return value;
  }
  void reset(HANDLE value = nullptr) noexcept {
    if (value_ != nullptr && value_ != INVALID_HANDLE_VALUE) CloseHandle(value_);
    value_ = value;
  }
  explicit operator bool() const noexcept {
    return value_ != nullptr && value_ != INVALID_HANDLE_VALUE;
  }

 private:
  HANDLE value_ = nullptr;
};

class View final {
 public:
  View() noexcept = default;
  explicit View(void* value) noexcept : value_(value) {}
  ~View() {
    if (value_ != nullptr) UnmapViewOfFile(value_);
  }
  View(const View&) = delete;
  View& operator=(const View&) = delete;
  View(View&& other) noexcept : value_(other.release()) {}
  View& operator=(View&& other) noexcept {
    if (this != &other) {
      if (value_ != nullptr) UnmapViewOfFile(value_);
      value_ = other.release();
    }
    return *this;
  }
  void* get() const noexcept { return value_; }

 private:
  void* release() noexcept {
    void* value = value_;
    value_ = nullptr;
    return value;
  }
  void* value_ = nullptr;
};

class UserSecurity final {
 public:
  UserSecurity() = default;
  ~UserSecurity() {
    if (object_descriptor_ != nullptr) LocalFree(object_descriptor_);
    if (process_descriptor_ != nullptr) LocalFree(process_descriptor_);
    if (thread_descriptor_ != nullptr) LocalFree(thread_descriptor_);
  }
  UserSecurity(const UserSecurity&) = delete;
  UserSecurity& operator=(const UserSecurity&) = delete;

  bool Initialize() {
    Handle token;
    HANDLE token_raw = nullptr;
    if (!OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &token_raw)) {
      return false;
    }
    token.reset(token_raw);
    DWORD bytes = 0;
    GetTokenInformation(token.get(), TokenUser, nullptr, 0, &bytes);
    if (bytes == 0 || GetLastError() != ERROR_INSUFFICIENT_BUFFER) return false;
    std::vector<std::uint8_t> token_user(bytes);
    if (!GetTokenInformation(token.get(), TokenUser, token_user.data(), bytes,
                             &bytes)) {
      return false;
    }
    const auto* user = reinterpret_cast<const TOKEN_USER*>(token_user.data());
    LPWSTR sid_text = nullptr;
    if (!ConvertSidToStringSidW(user->User.Sid, &sid_text)) return false;
    const std::wstring sid(sid_text);
    LocalFree(sid_text);
    const std::wstring prefix = L"O:" + sid + L"G:" + sid + L"D:P(A;;";
    if (!CreateDescriptor(prefix + L"GA;;;" + sid + L")",
                          &object_descriptor_, &object_attributes_) ||
        !CreateDescriptor(prefix + L"0x00101000;;;" + sid + L")",
                          &process_descriptor_, &process_attributes_) ||
        !CreateDescriptor(prefix + L"0x00100800;;;" + sid + L")",
                          &thread_descriptor_, &thread_attributes_)) {
      return false;
    }
    return true;
  }

  SECURITY_ATTRIBUTES* objectAttributes() noexcept {
    return &object_attributes_;
  }
  SECURITY_ATTRIBUTES* processAttributes() noexcept {
    return &process_attributes_;
  }
  SECURITY_ATTRIBUTES* threadAttributes() noexcept {
    return &thread_attributes_;
  }
  bool RestrictCurrentProcess() noexcept {
    const SECURITY_INFORMATION information =
        DACL_SECURITY_INFORMATION | PROTECTED_DACL_SECURITY_INFORMATION;
    return SetKernelObjectSecurity(GetCurrentProcess(), information,
                                   process_descriptor_) != FALSE;
  }

 private:
  static bool CreateDescriptor(const std::wstring& sddl,
                               PSECURITY_DESCRIPTOR* descriptor,
                               SECURITY_ATTRIBUTES* attributes) {
    if (!ConvertStringSecurityDescriptorToSecurityDescriptorW(
            sddl.c_str(), SDDL_REVISION_1, descriptor, nullptr)) {
      return false;
    }
    attributes->nLength = sizeof(*attributes);
    attributes->lpSecurityDescriptor = *descriptor;
    attributes->bInheritHandle = FALSE;
    return true;
  }

  PSECURITY_DESCRIPTOR object_descriptor_ = nullptr;
  PSECURITY_DESCRIPTOR process_descriptor_ = nullptr;
  PSECURITY_DESCRIPTOR thread_descriptor_ = nullptr;
  SECURITY_ATTRIBUTES object_attributes_{};
  SECURITY_ATTRIBUTES process_attributes_{};
  SECURITY_ATTRIBUTES thread_attributes_{};
};

class StartupAttributes final {
 public:
  StartupAttributes() = default;
  ~StartupAttributes() {
    if (list_ != nullptr) {
      DeleteProcThreadAttributeList(list_);
      HeapFree(GetProcessHeap(), 0, list_);
    }
  }
  StartupAttributes(const StartupAttributes&) = delete;
  StartupAttributes& operator=(const StartupAttributes&) = delete;

  bool Initialize(HANDLE inherited_pipe, HANDLE inherited_owner,
                  HANDLE inherited_ack, HANDLE job) {
    const DWORD count = job == nullptr ? 1u : 2u;
    SIZE_T bytes = 0;
    InitializeProcThreadAttributeList(nullptr, count, 0, &bytes);
    if (bytes == 0) return false;
    list_ = static_cast<LPPROC_THREAD_ATTRIBUTE_LIST>(
        HeapAlloc(GetProcessHeap(), HEAP_ZERO_MEMORY, bytes));
    if (list_ == nullptr ||
        !InitializeProcThreadAttributeList(list_, count, 0, &bytes)) {
      return false;
    }
    inherited_handles_ = {inherited_pipe, inherited_owner, inherited_ack};
    if (!UpdateProcThreadAttribute(list_, 0, PROC_THREAD_ATTRIBUTE_HANDLE_LIST,
                                   inherited_handles_.data(),
                                   sizeof(inherited_handles_),
                                   nullptr, nullptr)) {
      return false;
    }
    if (job != nullptr) {
      job_ = job;
      if (!UpdateProcThreadAttribute(list_, 0, PROC_THREAD_ATTRIBUTE_JOB_LIST,
                                     &job_, sizeof(job_), nullptr, nullptr)) {
        return false;
      }
    }
    return true;
  }

  LPPROC_THREAD_ATTRIBUTE_LIST get() const noexcept { return list_; }

  private:
  LPPROC_THREAD_ATTRIBUTE_LIST list_ = nullptr;
  std::array<HANDLE, 3> inherited_handles_{};
  HANDLE job_ = nullptr;
};

struct ChannelObjects {
  std::wstring mapName;
  std::wstring updateName;
  Handle mapping;
  Handle update;
  Handle ack;
  View view;
};

std::wstring ExecutableDirectory() {
  std::vector<wchar_t> path(32'768);
  const DWORD length = GetModuleFileNameW(nullptr, path.data(),
                                          static_cast<DWORD>(path.size()));
  if (length == 0 || length >= path.size()) return {};
  std::wstring value(path.data(), length);
  const std::wstring::size_type separator = value.find_last_of(L"\\/");
  if (separator == std::wstring::npos) return {};
  value.resize(separator);
  return value;
}

std::wstring QuoteWindowsArgument(const std::wstring& value) {
  std::wstring quoted(1, L'\"');
  std::size_t backslashes = 0;
  for (const wchar_t character : value) {
    if (character == L'\\') {
      ++backslashes;
      continue;
    }
    if (character == L'\"') {
      quoted.append(backslashes * 2u + 1u, L'\\');
      quoted.push_back(L'\"');
      backslashes = 0;
      continue;
    }
    quoted.append(backslashes, L'\\');
    backslashes = 0;
    quoted.push_back(character);
  }
  quoted.append(backslashes * 2u, L'\\');
  quoted.push_back(L'\"');
  return quoted;
}

std::wstring HandleArgument(HANDLE handle) {
  return std::to_wstring(
      static_cast<unsigned long long>(reinterpret_cast<ULONG_PTR>(handle)));
}

bool CreateChannelObjects(UserSecurity* security, const std::wstring& base,
                          ChannelObjects* channel) {
  channel->mapName = base + L"-map";
  channel->updateName = base + L"-update";
  SetLastError(ERROR_SUCCESS);
  channel->mapping.reset(CreateFileMappingW(
      INVALID_HANDLE_VALUE, security->objectAttributes(), PAGE_READWRITE, 0,
      static_cast<DWORD>(sizeof(qa::SharedRecord)), channel->mapName.c_str()));
  if (!channel->mapping || GetLastError() == ERROR_ALREADY_EXISTS) return false;
  SetLastError(ERROR_SUCCESS);
  channel->update.reset(CreateEventW(security->objectAttributes(), FALSE, FALSE,
                                    channel->updateName.c_str()));
  if (!channel->update || GetLastError() == ERROR_ALREADY_EXISTS) return false;
  SECURITY_ATTRIBUTES ack_security = *security->objectAttributes();
  ack_security.bInheritHandle = TRUE;
  channel->ack.reset(CreateEventW(&ack_security, FALSE, FALSE, nullptr));
  if (!channel->ack) return false;
  channel->view = View(MapViewOfFile(channel->mapping.get(), FILE_MAP_ALL_ACCESS,
                                     0, 0, sizeof(qa::SharedRecord)));
  if (channel->view.get() == nullptr) return false;
  SecureZeroMemory(channel->view.get(), sizeof(qa::SharedRecord));
  return true;
}

bool InitializeJob(Handle* job) {
  job->reset(CreateJobObjectW(nullptr, nullptr));
  if (!*job) return false;
  JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits{};
  limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
  return SetInformationJobObject(job->get(), JobObjectExtendedLimitInformation,
                                 &limits, sizeof(limits)) != FALSE;
}

bool WaitForAck(HANDLE ack) {
  return WaitForSingleObject(ack, 3'000) == WAIT_OBJECT_0;
}

bool PublishRetry(qa::SharedRecord* shared,
                  const qa::PublicationPayload& payload,
                  const qa::LockedSecret& key, DWORD attempts = 10'000) {
  for (DWORD attempt = 0; attempt < attempts; ++attempt) {
    if (qa::Publish(shared, payload, key.bytes())) return true;
    if ((attempt & 0x3fu) == 0x3fu) {
      Sleep(0);
    } else {
      YieldProcessor();
    }
  }
  return false;
}

qa::PublicationPayload BasePublication(const qa::BootstrapPacket& bootstrap,
                                       std::uint64_t commit,
                                       qa::PublicationState state) {
  qa::PublicationPayload payload{};
  payload.schemaVersion = qa::kSchemaVersion;
  payload.payloadBytes = qa::kCanonicalPublicationBytes;
  payload.sessionNonce = bootstrap.sessionNonce;
  payload.target = bootstrap.target;
  payload.coordinator = bootstrap.coordinator;
  payload.generation = bootstrap.generation;
  payload.topologyEpoch = bootstrap.topologyEpoch;
  payload.commit = commit;
  payload.requiredSlotBitmap = bootstrap.requiredSlotBitmap;
  payload.readySlotBitmap = bootstrap.requiredSlotBitmap;
  payload.state = state;
  return payload;
}

bool PublishAndObserve(ChannelObjects* channel,
                       const qa::PublicationPayload& payload,
                       const qa::LockedSecret& key) {
  auto* shared = static_cast<qa::SharedRecord*>(channel->view.get());
  return PublishRetry(shared, payload, key) &&
         SetEvent(channel->update.get()) != FALSE &&
         WaitForAck(channel->ack.get());
}

bool CompleteOddPublication(qa::SharedRecord* shared,
                            const qa::PublicationPayload& payload,
                            const qa::LockedSecret& key) {
  std::array<std::uint8_t, qa::kDigestBytes> mac{};
  if (!qa::HmacPublication(key.bytes(), payload, &mac)) return false;
  if ((InterlockedCompareExchange64(&shared->sequence, 0, 0) & 1) == 0) {
    SecureZeroMemory(mac.data(), mac.size());
    return false;
  }
  shared->payload = payload;
  shared->mac = mac;
  MemoryBarrier();
  const bool even = (InterlockedIncrement64(&shared->sequence) & 1) == 0;
  SecureZeroMemory(mac.data(), mac.size());
  return even;
}

bool StartAttacker(const std::wstring& attacker_path,
                   const ChannelObjects& channel, const std::wstring& mode,
                   Handle* process_handle) {
  std::wstring command_line =
      QuoteWindowsArgument(attacker_path) + L" --map " +
      QuoteWindowsArgument(channel.mapName) + L" --update " +
      QuoteWindowsArgument(channel.updateName) + L" --mode " +
      QuoteWindowsArgument(mode);
  STARTUPINFOW startup{};
  startup.cb = sizeof(startup);
  PROCESS_INFORMATION process{};
  if (!CreateProcessW(attacker_path.c_str(), command_line.data(), nullptr,
                      nullptr, FALSE,
                      CREATE_NO_WINDOW | CREATE_DEFAULT_ERROR_MODE, nullptr,
                      nullptr, &startup, &process)) {
    return false;
  }
  CloseHandle(process.hThread);
  process_handle->reset(process.hProcess);
  return true;
}

bool WaitAttacker(Handle* process_handle) {
  const DWORD wait = WaitForSingleObject(process_handle->get(), 10'000);
  DWORD exit_code = 1;
  const bool succeeded = wait == WAIT_OBJECT_0 &&
                         GetExitCodeProcess(process_handle->get(), &exit_code) &&
                         exit_code == 0;
  if (!succeeded) {
    std::wcerr << L"attacker wait failed: wait=" << wait
               << L" exit=" << exit_code << L" error=" << GetLastError()
               << L"\n";
  }
  process_handle->reset();
  return succeeded;
}

bool SpawnAttacker(const std::wstring& attacker_path,
                   const ChannelObjects& channel, const std::wstring& mode) {
  Handle process;
  return StartAttacker(attacker_path, channel, mode, &process) &&
         WaitAttacker(&process);
}

bool WritePipeExact(HANDLE pipe, const void* data, DWORD bytes) {
  const auto* cursor = static_cast<const std::uint8_t*>(data);
  DWORD total = 0;
  while (total < bytes) {
    DWORD written = 0;
    if (!WriteFile(pipe, cursor + total, bytes - total, &written, nullptr) ||
        written == 0) {
      return false;
    }
    total += written;
  }
  return true;
}

enum class CollisionKind { kMap, kUpdate, kWrongType };

bool PreexistingObjectRejected(UserSecurity* security, const std::wstring& base,
                               CollisionKind kind) {
  std::wstring collision_name = base + L"-map";
  if (kind == CollisionKind::kUpdate) collision_name = base + L"-update";
  Handle collision;
  if (kind == CollisionKind::kMap) {
    collision.reset(CreateFileMappingW(
        INVALID_HANDLE_VALUE, nullptr, PAGE_READWRITE, 0,
        static_cast<DWORD>(sizeof(qa::SharedRecord)), collision_name.c_str()));
  } else {
    collision.reset(CreateEventW(nullptr, FALSE, FALSE, collision_name.c_str()));
  }
  if (!collision) return false;
  ChannelObjects channel;
  const bool created = CreateChannelObjects(security, base, &channel);
  const DWORD error = GetLastError();
  return !created &&
         (error == ERROR_ALREADY_EXISTS ||
          (kind == CollisionKind::kWrongType && error == ERROR_INVALID_HANDLE));
}

}  // namespace

int wmain(int argument_count, wchar_t** arguments) {
  if ((argument_count != 5 && argument_count != 7) ||
      wcscmp(arguments[1], L"--result") != 0 ||
      wcscmp(arguments[3], L"--scenario") != 0 ||
      (argument_count == 7 && wcscmp(arguments[5], L"--identity") != 0)) {
    return 60;
  }
  const std::wstring result_path = arguments[2];
  const std::wstring scenario = arguments[4];
  const std::wstring identity_path = argument_count == 7 ? arguments[6] : L"";
  if (result_path.empty() || scenario.empty()) return 61;

  UserSecurity security;
  if (!security.Initialize() || !security.RestrictCurrentProcess()) return 62;
  qa::TargetIdentity coordinator_identity{};
  if (!qa::QuerySelfIdentity(&coordinator_identity)) return 63;
  const std::wstring random = qa::RandomHex(32);
  if (random.size() != 64) return 63;
  const std::wstring base = L"Local\\GameHubOverlayQa-" + random;
  if (scenario == L"precreated-map" || scenario == L"precreated-update" ||
      scenario == L"precreated-wrong-type") {
    CollisionKind kind = CollisionKind::kMap;
    if (scenario == L"precreated-update") kind = CollisionKind::kUpdate;
    if (scenario == L"precreated-wrong-type") kind = CollisionKind::kWrongType;
    if (!PreexistingObjectRejected(&security, base, kind)) return 64;
    std::wcout << L"PREEXISTING_REJECTED\n";
    return 0;
  }

  ChannelObjects channel;
  if (!CreateChannelObjects(&security, base, &channel)) return 65;
  const std::wstring directory = ExecutableDirectory();
  const std::wstring reader_path =
      directory + L"\\gamehub-overlay-qa-secure-reader.exe";
  const std::wstring attacker_path =
      directory + L"\\gamehub-overlay-qa-secure-attacker.exe";
  if (directory.empty() ||
      GetFileAttributesW(reader_path.c_str()) == INVALID_FILE_ATTRIBUTES ||
      GetFileAttributesW(attacker_path.c_str()) == INVALID_FILE_ATTRIBUTES) {
    return 66;
  }

  SECURITY_ATTRIBUTES pipe_security = *security.objectAttributes();
  pipe_security.bInheritHandle = TRUE;
  Handle pipe_read;
  Handle pipe_write;
  HANDLE pipe_read_raw = nullptr;
  HANDLE pipe_write_raw = nullptr;
  if (!CreatePipe(&pipe_read_raw, &pipe_write_raw, &pipe_security, 0)) return 67;
  pipe_read.reset(pipe_read_raw);
  pipe_write.reset(pipe_write_raw);
  if (!SetHandleInformation(pipe_write.get(), HANDLE_FLAG_INHERIT, 0)) return 68;

  std::vector<Handle> decoys;
  decoys.reserve(128);
  for (std::size_t index = 0; index < decoys.capacity(); ++index) {
    Handle decoy(CreateEventW(&pipe_security, TRUE, FALSE, nullptr));
    if (!decoy) return 69;
    decoys.push_back(std::move(decoy));
  }
  const HANDLE excluded_decoy = decoys.back().get();

  Handle owner_process(OpenProcess(
      SYNCHRONIZE | PROCESS_QUERY_LIMITED_INFORMATION, FALSE,
      GetCurrentProcessId()));
  if (!owner_process ||
      !SetHandleInformation(owner_process.get(), HANDLE_FLAG_INHERIT,
                            HANDLE_FLAG_INHERIT)) {
    return 70;
  }

  const bool owner_death = scenario == L"owner-death";
  const bool crash = scenario == L"crash";
  const bool timeout = scenario == L"timeout";
  Handle job;
  if (!owner_death && !InitializeJob(&job)) return 70;
  StartupAttributes attributes;
  if (!attributes.Initialize(pipe_read.get(), owner_process.get(),
                             channel.ack.get(), job.get())) {
    return 71;
  }

  const std::wstring child_scenario = timeout ? L"hang" : scenario;
  std::wstring command_line =
      QuoteWindowsArgument(reader_path) + L" --map " +
      QuoteWindowsArgument(channel.mapName) + L" --update " +
      QuoteWindowsArgument(channel.updateName) + L" --pipe " +
      HandleArgument(pipe_read.get()) + L" --owner " +
      HandleArgument(owner_process.get()) + L" --decoy " +
      HandleArgument(excluded_decoy) + L" --ack " +
      HandleArgument(channel.ack.get()) + L" --result " +
      QuoteWindowsArgument(result_path) + L" --scenario " +
      QuoteWindowsArgument(child_scenario);
  STARTUPINFOEXW startup{};
  startup.StartupInfo.cb = sizeof(startup);
  startup.lpAttributeList = attributes.get();
  PROCESS_INFORMATION process{};
  const DWORD creation_flags = CREATE_SUSPENDED | CREATE_NO_WINDOW |
                               CREATE_DEFAULT_ERROR_MODE |
                               EXTENDED_STARTUPINFO_PRESENT;
  if (!CreateProcessW(reader_path.c_str(), command_line.data(),
                      security.processAttributes(), security.threadAttributes(),
                      TRUE, creation_flags, nullptr, directory.c_str(),
                      &startup.StartupInfo, &process)) {
    std::wcerr << L"CreateProcessW reader failed: " << GetLastError() << L"\n";
    return 72;
  }
  Handle child_process(process.hProcess);
  Handle child_thread(process.hThread);
  pipe_read.reset();

  if (!identity_path.empty() &&
      !qa::WriteProcessIdentity(identity_path, child_process.get(),
                                process.dwProcessId)) {
    TerminateProcess(child_process.get(), 73);
    return 73;
  }

  qa::LockedSecret key;
  qa::BootstrapPacket bootstrap{};
  const bool bootstrap_locked =
      VirtualLock(&bootstrap, sizeof(bootstrap)) != FALSE;
  if (!key.locked() || !bootstrap_locked ||
      !qa::FillRandom(key.bytes().data(), key.bytes().size()) ||
      !qa::FillRandom(bootstrap.sessionNonce.data(),
                      bootstrap.sessionNonce.size()) ||
      !qa::QueryProcessIdentity(child_process.get(), reader_path,
                                &bootstrap.target)) {
    if (bootstrap_locked) VirtualUnlock(&bootstrap, sizeof(bootstrap));
    TerminateProcess(child_process.get(), 74);
    return 74;
  }
  bootstrap.magic = qa::kBootstrapMagic;
  bootstrap.schemaVersion = qa::kSchemaVersion;
  bootstrap.packetBytes = sizeof(bootstrap);
  bootstrap.key = key.bytes();
  bootstrap.coordinator = coordinator_identity;
  bootstrap.generation = qa::kGeneration;
  bootstrap.topologyEpoch = qa::kTopologyEpoch;
  bootstrap.requiredSlotBitmap = qa::kRequiredSlots;
  const qa::PublicationPayload initial =
      BasePublication(bootstrap, 1, qa::PublicationState::kBlocked);
  auto* shared = static_cast<qa::SharedRecord*>(channel.view.get());
  const bool initialized =
      PublishRetry(shared, initial, key) &&
      WritePipeExact(pipe_write.get(), &bootstrap,
                     static_cast<DWORD>(sizeof(bootstrap)));
  pipe_write.reset();
  SecureZeroMemory(bootstrap.key.data(), bootstrap.key.size());
  if (!initialized) {
    SecureZeroMemory(&bootstrap, sizeof(bootstrap));
    VirtualUnlock(&bootstrap, sizeof(bootstrap));
    TerminateProcess(child_process.get(), 75);
    return 75;
  }
  if (ResumeThread(child_thread.get()) != 1u) {
    SecureZeroMemory(&bootstrap, sizeof(bootstrap));
    VirtualUnlock(&bootstrap, sizeof(bootstrap));
    TerminateProcess(child_process.get(), 76);
    return 76;
  }
  child_thread.reset();
  if (!WaitForAck(channel.ack.get())) {
    SecureZeroMemory(&bootstrap, sizeof(bootstrap));
    VirtualUnlock(&bootstrap, sizeof(bootstrap));
    TerminateProcess(child_process.get(), 77);
    return 77;
  }

  if (crash) {
    SecureZeroMemory(&bootstrap, sizeof(bootstrap));
    VirtualUnlock(&bootstrap, sizeof(bootstrap));
    SecureZeroMemory(key.bytes().data(), key.bytes().size());
    TerminateProcess(GetCurrentProcess(), 197);
    return 197;
  }
  if (owner_death) {
    SecureZeroMemory(&bootstrap, sizeof(bootstrap));
    VirtualUnlock(&bootstrap, sizeof(bootstrap));
    SecureZeroMemory(key.bytes().data(), key.bytes().size());
    TerminateProcess(GetCurrentProcess(), 198);
    return 198;
  }
  if (timeout) {
    Sleep(200);
    const bool terminated = TerminateJobObject(job.get(), 99) != FALSE;
    const DWORD waited = WaitForSingleObject(child_process.get(), 5'000);
    SecureZeroMemory(&bootstrap, sizeof(bootstrap));
    VirtualUnlock(&bootstrap, sizeof(bootstrap));
    return terminated && waited == WAIT_OBJECT_0 ? 99 : 78;
  }

  bool scenario_ok = true;
  if (scenario == L"forged") {
    scenario_ok = SpawnAttacker(attacker_path, channel, L"forge") &&
                  WaitForAck(channel.ack.get());
  } else if (scenario == L"ack-spoof") {
    scenario_ok = SpawnAttacker(attacker_path, channel, L"ack-spoof") &&
                  WaitForAck(channel.ack.get());
  } else if (scenario == L"wrong-nonce") {
    qa::PublicationPayload invalid =
        BasePublication(bootstrap, 2, qa::PublicationState::kReleased);
    scenario_ok = qa::FillRandom(invalid.sessionNonce.data(),
                                 invalid.sessionNonce.size()) &&
                  PublishAndObserve(&channel, invalid, key);
  } else if (scenario == L"stale-pid") {
    qa::PublicationPayload invalid =
        BasePublication(bootstrap, 2, qa::PublicationState::kReleased);
    ++invalid.target.pid;
    scenario_ok = PublishAndObserve(&channel, invalid, key);
  } else if (scenario == L"stale-creation") {
    qa::PublicationPayload invalid =
        BasePublication(bootstrap, 2, qa::PublicationState::kReleased);
    ++invalid.target.creationFileTime;
    scenario_ok = PublishAndObserve(&channel, invalid, key);
  } else if (scenario == L"stale-coordinator") {
    qa::PublicationPayload invalid =
        BasePublication(bootstrap, 2, qa::PublicationState::kReleased);
    ++invalid.coordinator.creationFileTime;
    scenario_ok = PublishAndObserve(&channel, invalid, key);
  } else if (scenario == L"wrong-volume") {
    qa::PublicationPayload invalid =
        BasePublication(bootstrap, 2, qa::PublicationState::kReleased);
    ++invalid.target.volumeSerial;
    scenario_ok = PublishAndObserve(&channel, invalid, key);
  } else if (scenario == L"wrong-file-id") {
    qa::PublicationPayload invalid =
        BasePublication(bootstrap, 2, qa::PublicationState::kReleased);
    invalid.target.fileId[0] ^= 0xffu;
    scenario_ok = PublishAndObserve(&channel, invalid, key);
  } else if (scenario == L"wrong-canonical-path") {
    qa::PublicationPayload invalid =
        BasePublication(bootstrap, 2, qa::PublicationState::kReleased);
    invalid.target.canonicalPathDigest[0] ^= 0xffu;
    scenario_ok = PublishAndObserve(&channel, invalid, key);
  } else if (scenario == L"stale-generation") {
    qa::PublicationPayload invalid =
        BasePublication(bootstrap, 2, qa::PublicationState::kReleased);
    ++invalid.generation;
    scenario_ok = PublishAndObserve(&channel, invalid, key);
  } else if (scenario == L"stale-topology") {
    qa::PublicationPayload invalid =
        BasePublication(bootstrap, 2, qa::PublicationState::kReleased);
    ++invalid.topologyEpoch;
    scenario_ok = PublishAndObserve(&channel, invalid, key);
  } else if (scenario == L"blocked-release") {
    qa::PublicationPayload invalid =
        BasePublication(bootstrap, 2, qa::PublicationState::kReleased);
    invalid.readySlotBitmap |= 0x8ull;
    scenario_ok = PublishAndObserve(&channel, invalid, key);
  } else if (scenario == L"torn") {
    const LONG64 even =
        InterlockedCompareExchange64(&shared->sequence, 0, 0);
    scenario_ok =
        (even & 1) == 0 &&
        InterlockedCompareExchange64(&shared->sequence, even + 1, even) == even;
    if (scenario_ok) {
      shared->payload.commit = 2;
      MemoryBarrier();
      scenario_ok = SetEvent(channel.update.get()) != FALSE &&
                    WaitForAck(channel.ack.get()) &&
                    CompleteOddPublication(shared, initial, key);
    }
  } else if (scenario == L"replay") {
    const qa::PublicationPayload heartbeat =
        BasePublication(bootstrap, 2, qa::PublicationState::kBlocked);
    scenario_ok = PublishAndObserve(&channel, heartbeat, key) &&
                  PublishAndObserve(&channel, initial, key);
  } else if (scenario == L"race") {
    qa::PublicationPayload observed_heartbeat =
        BasePublication(bootstrap, 2, qa::PublicationState::kBlocked);
    observed_heartbeat.publicationFlags = qa::kPublicationFlagRaceHeartbeat;
    scenario_ok = PublishAndObserve(&channel, observed_heartbeat, key);
    for (std::uint64_t commit = 3; commit < 2'002 && scenario_ok; ++commit) {
      qa::PublicationPayload heartbeat =
          BasePublication(bootstrap, commit, qa::PublicationState::kBlocked);
      heartbeat.publicationFlags = qa::kPublicationFlagRaceHeartbeat;
      scenario_ok = PublishRetry(shared, heartbeat, key) &&
                    SetEvent(channel.update.get()) != FALSE;
    }
  } else if (scenario == L"two-writer") {
    Handle attacker;
    scenario_ok =
        StartAttacker(attacker_path, channel, L"contend", &attacker);
    const ULONGLONG active_deadline = GetTickCount64() + 2'000;
    while (scenario_ok &&
           InterlockedCompareExchange(&shared->hostileWriterActive, 0, 0) == 0 &&
           GetTickCount64() < active_deadline) {
      Sleep(1);
    }
    scenario_ok =
        scenario_ok &&
        InterlockedCompareExchange(&shared->hostileWriterActive, 0, 0) != 0;
    if (!scenario_ok) std::wcerr << L"two-writer did not become active\n";
    for (std::uint64_t commit = 2; commit < 202 && scenario_ok; ++commit) {
      qa::PublicationPayload heartbeat =
          BasePublication(bootstrap, commit, qa::PublicationState::kBlocked);
      heartbeat.publicationFlags = qa::kPublicationFlagRaceHeartbeat;
      scenario_ok = PublishRetry(shared, heartbeat, key) &&
                    SetEvent(channel.update.get()) != FALSE;
      if (!scenario_ok) std::wcerr << L"two-writer heartbeat failed\n";
      Sleep(1);
    }
    scenario_ok = scenario_ok && WaitAttacker(&attacker);
    if (!scenario_ok) std::wcerr << L"two-writer attacker failed\n";
    qa::PublicationPayload final_heartbeat =
        BasePublication(bootstrap, 10'000, qa::PublicationState::kBlocked);
    final_heartbeat.publicationFlags = qa::kPublicationFlagRaceHeartbeat;
    scenario_ok =
        scenario_ok && PublishAndObserve(&channel, final_heartbeat, key);
    if (!scenario_ok) std::wcerr << L"two-writer final heartbeat failed\n";
  } else if (scenario != L"normal") {
    scenario_ok = false;
  }

  std::uint64_t release_commit = 2;
  if (scenario == L"replay") release_commit = 3;
  if (scenario == L"race") release_commit = 2'002;
  if (scenario == L"two-writer") release_commit = 10'001;
  const qa::PublicationPayload release =
      BasePublication(bootstrap, release_commit,
                      qa::PublicationState::kReleased);
  if (scenario_ok) {
    scenario_ok = PublishRetry(shared, release, key) &&
                  SetEvent(channel.update.get()) != FALSE;
  }

  SecureZeroMemory(&bootstrap, sizeof(bootstrap));
  VirtualUnlock(&bootstrap, sizeof(bootstrap));
  if (!scenario_ok) {
    TerminateProcess(child_process.get(), 79);
    return 79;
  }
  const DWORD wait = WaitForSingleObject(child_process.get(), 10'000);
  DWORD exit_code = 80;
  if (wait != WAIT_OBJECT_0 ||
      !GetExitCodeProcess(child_process.get(), &exit_code)) {
    TerminateProcess(child_process.get(), 80);
    return 80;
  }
  return static_cast<int>(exit_code);
}
