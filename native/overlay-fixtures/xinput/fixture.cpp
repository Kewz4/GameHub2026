#include <sstream>
#include <string>
#include <vector>

#include "contract.hpp"

namespace {

using namespace gamehub::overlay::xinput_qa;
using GetBootstrapSnapshotFunction = BOOL(WINAPI*)(BootstrapSnapshot*, DWORD);
using BeginBlockFunction = DWORD(WINAPI*)(DWORD, unsigned long long);
using RequestCloseFunction = DWORD(WINAPI*)(DWORD, unsigned long long);
using ObserveReleaseFunction = DWORD(WINAPI*)(DWORD, unsigned long long,
                                              unsigned long long);
using InvalidateTopologyFunction = DWORD(WINAPI*)(DWORD, unsigned long long);
using RevalidateFunction = DWORD(WINAPI*)(DWORD, unsigned long long);
using DetachFunction = DWORD(WINAPI*)();
using AttachLateFunction = DWORD(WINAPI*)();

constexpr WORD kVibrationALeft = 11'111u;
constexpr WORD kVibrationARight = 22'222u;
constexpr WORD kVibrationBLeft = 33'333u;
constexpr WORD kVibrationBRight = 44'444u;

struct Report {
  bool entryReached = false;
  bool bootstrapLoadedBeforeEntry = false;
  bool cacheInitializedBeforeBootstrap = false;
  bool cachedPointersMatchedProvider = false;
  bool bootstrapAttachedExactCachedBodies = false;
  bool cachedPointersStable = false;
  bool hookAttachedBeforeEntry = false;
  bool preBlockPhysicalConnected = false;
  bool absentUserStayedDisconnected = false;
  bool physicalVibrationAForwarded = false;
  bool blockStoppedVibration = false;
  bool blockedStateConnectedNeutral = false;
  bool blockedStateExConnectedNeutral = false;
  bool blockedPacketTransitioned = false;
  bool blockedPacketStableAcrossHiddenChange = false;
  bool blockedAbsentUserStayedDisconnected = false;
  bool blockedKeystrokeEmptyAndZero = false;
  bool blockedQueueDrained = false;
  bool blockedVibrationBRememberedNotForwarded = false;
  bool enableCallsSwallowedWhileBlocked = false;
  bool pendingAndNonNeutralPreventedRelease = false;
  bool staleIdentityIgnored = false;
  bool repeatedCloseWasIdempotent = false;
  bool timeRollbackRestartedDwell = false;
  bool topologyInvalidationKeptLatch = false;
  bool releaseFenceCompleted = false;
  bool releaseKeptDetoursAttached = false;
  bool requestedEnableRestored = false;
  bool rememberedVibrationRestored = false;
  bool noStaleKeystrokeAfterRelease = false;
  bool releasedCachedPointerReturnedPhysical = false;
  bool detachedCachedPointerReturnedPhysical = false;
  bool latePhysicalCallEscapedBeforeAttach = false;
  bool lateHookCouldOnlyBlockSubsequentCall = false;
  bool proofPassed = false;
  DWORD attachError = ERROR_INVALID_STATE;
  DWORD releaseEvent = 0;
  DWORD detachError = ERROR_INVALID_STATE;
  DWORD physicalPacketBeforeBlock = 0;
  DWORD blockedPacket = 0;
  DWORD providerSetStateCallsBeforeBlockedRequest = 0;
  DWORD providerSetStateCallsAfterBlockedRequest = 0;
  DWORD providerEnableCallsBeforeBlockedRequests = 0;
  DWORD providerEnableCallsAfterBlockedRequests = 0;
  DWORD finalProviderEnabled = 0;
  std::string scenario;
  std::string enableMode;
};

bool WideEquals(const wchar_t* left, const wchar_t* right) {
  return wcscmp(left, right) == 0;
}

std::wstring ExecutableDirectory() {
  std::vector<wchar_t> buffer(32'768);
  const DWORD length = GetModuleFileNameW(nullptr, buffer.data(),
                                          static_cast<DWORD>(buffer.size()));
  if (length == 0 || length >= buffer.size()) return {};
  std::wstring path(buffer.data(), length);
  const std::wstring::size_type separator = path.find_last_of(L"\\/");
  if (separator == std::wstring::npos) return {};
  path.resize(separator);
  return path;
}

bool WriteResult(const wchar_t* path, const std::string& value) {
  if (value.size() > MAXDWORD) return false;
  HANDLE file =
      CreateFileW(path, GENERIC_WRITE, 0, nullptr, CREATE_NEW,
                  FILE_ATTRIBUTE_NORMAL | FILE_FLAG_WRITE_THROUGH, nullptr);
  if (file == INVALID_HANDLE_VALUE) return false;
  DWORD written = 0;
  const bool succeeded =
      WriteFile(file, value.data(), static_cast<DWORD>(value.size()), &written,
                nullptr) &&
      written == value.size() && FlushFileBuffers(file);
  CloseHandle(file);
  return succeeded;
}

void AppendBool(std::ostringstream& output, const char* name, bool value,
                bool* first) {
  if (!*first) output << ',';
  *first = false;
  output << '\"' << name << "\":" << (value ? "true" : "false");
}

template <typename Value>
void AppendNumber(std::ostringstream& output, const char* name, Value value,
                  bool* first) {
  if (!*first) output << ',';
  *first = false;
  output << '\"' << name << "\":" << value;
}

void AppendString(std::ostringstream& output, const char* name,
                  const std::string& value, bool* first) {
  if (!*first) output << ',';
  *first = false;
  output << '\"' << name << "\":\"" << value << '\"';
}

std::string Serialize(const Report& report) {
  std::ostringstream output;
  output << '{';
  bool first = true;
  AppendNumber(output, "schemaVersion", kSchemaVersion, &first);
  AppendString(output, "scenario", report.scenario, &first);
  AppendString(output, "enableMode", report.enableMode, &first);
#define APPEND_REPORT_BOOL(field) \
  AppendBool(output, #field, report.field, &first)
  APPEND_REPORT_BOOL(entryReached);
  APPEND_REPORT_BOOL(bootstrapLoadedBeforeEntry);
  APPEND_REPORT_BOOL(cacheInitializedBeforeBootstrap);
  APPEND_REPORT_BOOL(cachedPointersMatchedProvider);
  APPEND_REPORT_BOOL(bootstrapAttachedExactCachedBodies);
  APPEND_REPORT_BOOL(cachedPointersStable);
  APPEND_REPORT_BOOL(hookAttachedBeforeEntry);
  APPEND_REPORT_BOOL(preBlockPhysicalConnected);
  APPEND_REPORT_BOOL(absentUserStayedDisconnected);
  APPEND_REPORT_BOOL(physicalVibrationAForwarded);
  APPEND_REPORT_BOOL(blockStoppedVibration);
  APPEND_REPORT_BOOL(blockedStateConnectedNeutral);
  APPEND_REPORT_BOOL(blockedStateExConnectedNeutral);
  APPEND_REPORT_BOOL(blockedPacketTransitioned);
  APPEND_REPORT_BOOL(blockedPacketStableAcrossHiddenChange);
  APPEND_REPORT_BOOL(blockedAbsentUserStayedDisconnected);
  APPEND_REPORT_BOOL(blockedKeystrokeEmptyAndZero);
  APPEND_REPORT_BOOL(blockedQueueDrained);
  APPEND_REPORT_BOOL(blockedVibrationBRememberedNotForwarded);
  APPEND_REPORT_BOOL(enableCallsSwallowedWhileBlocked);
  APPEND_REPORT_BOOL(pendingAndNonNeutralPreventedRelease);
  APPEND_REPORT_BOOL(staleIdentityIgnored);
  APPEND_REPORT_BOOL(repeatedCloseWasIdempotent);
  APPEND_REPORT_BOOL(timeRollbackRestartedDwell);
  APPEND_REPORT_BOOL(topologyInvalidationKeptLatch);
  APPEND_REPORT_BOOL(releaseFenceCompleted);
  APPEND_REPORT_BOOL(releaseKeptDetoursAttached);
  APPEND_REPORT_BOOL(requestedEnableRestored);
  APPEND_REPORT_BOOL(rememberedVibrationRestored);
  APPEND_REPORT_BOOL(noStaleKeystrokeAfterRelease);
  APPEND_REPORT_BOOL(releasedCachedPointerReturnedPhysical);
  APPEND_REPORT_BOOL(detachedCachedPointerReturnedPhysical);
  APPEND_REPORT_BOOL(latePhysicalCallEscapedBeforeAttach);
  APPEND_REPORT_BOOL(lateHookCouldOnlyBlockSubsequentCall);
  APPEND_REPORT_BOOL(proofPassed);
#undef APPEND_REPORT_BOOL
  AppendNumber(output, "attachError", report.attachError, &first);
  AppendNumber(output, "releaseEvent", report.releaseEvent, &first);
  AppendNumber(output, "detachError", report.detachError, &first);
  AppendNumber(output, "physicalPacketBeforeBlock",
               report.physicalPacketBeforeBlock, &first);
  AppendNumber(output, "blockedPacket", report.blockedPacket, &first);
  AppendNumber(output, "providerSetStateCallsBeforeBlockedRequest",
               report.providerSetStateCallsBeforeBlockedRequest, &first);
  AppendNumber(output, "providerSetStateCallsAfterBlockedRequest",
               report.providerSetStateCallsAfterBlockedRequest, &first);
  AppendNumber(output, "providerEnableCallsBeforeBlockedRequests",
               report.providerEnableCallsBeforeBlockedRequests, &first);
  AppendNumber(output, "providerEnableCallsAfterBlockedRequests",
               report.providerEnableCallsAfterBlockedRequests, &first);
  AppendNumber(output, "finalProviderEnabled", report.finalProviderEnabled,
               &first);
  output << "}\n";
  return output.str();
}

template <typename Function>
Function Resolve(HMODULE module, const char* name) {
  return module == nullptr
             ? nullptr
             : reinterpret_cast<Function>(GetProcAddress(module, name));
}

bool PhysicalStateWithPacket(const State& state, DWORD packet) {
  return state.packetNumber == packet &&
         state.gamepad.buttons == kPhysicalButtons &&
         state.gamepad.leftTrigger == kPhysicalLeftTrigger &&
         state.gamepad.rightTrigger == kPhysicalRightTrigger &&
         state.gamepad.thumbLX == kPhysicalThumbLX &&
         state.gamepad.thumbLY == kPhysicalThumbLY &&
         state.gamepad.thumbRX == kPhysicalThumbRX &&
         state.gamepad.thumbRY == kPhysicalThumbRY;
}

bool SamePointers(const CacheSnapshot& left, const CacheSnapshot& right) {
  return left.getStatePointer != 0 &&
         left.getStatePointer == right.getStatePointer &&
         left.getStateExPointer == right.getStateExPointer &&
         left.getKeystrokePointer == right.getKeystrokePointer &&
         left.enablePointer == right.enablePointer &&
         left.setStatePointer == right.setStatePointer;
}

DWORD RunLateNegative(Report* report, HMODULE* bootstrap) {
  State escaped{};
  const DWORD escaped_status = GameHubXInputQaCallGetState(0, &escaped);
  report->latePhysicalCallEscapedBeforeAttach =
      escaped_status == ERROR_SUCCESS && IsPhysicalState(escaped);

  const std::wstring directory = ExecutableDirectory();
  if (directory.empty()) return 40;
  *bootstrap = LoadLibraryW((directory + L"\\" + kBootstrapModuleName).c_str());
  if (*bootstrap == nullptr) return 41;
  const auto attach_late = Resolve<AttachLateFunction>(
      *bootstrap, "GameHubXInputQaAttachLateForNegativeControl");
  const auto begin_block =
      Resolve<BeginBlockFunction>(*bootstrap, "GameHubXInputQaBeginBlock");
  const auto request_close =
      Resolve<RequestCloseFunction>(*bootstrap, "GameHubXInputQaRequestClose");
  const auto observe_release = Resolve<ObserveReleaseFunction>(
      *bootstrap, "GameHubXInputQaObserveRelease");
  const auto detach =
      Resolve<DetachFunction>(*bootstrap, "GameHubXInputQaDetach");
  if (attach_late == nullptr || begin_block == nullptr ||
      request_close == nullptr || observe_release == nullptr ||
      detach == nullptr || attach_late() != ERROR_SUCCESS ||
      begin_block(kGeneration, kTopologyEpoch) !=
          static_cast<DWORD>(FenceEvent::kApplied)) {
    return 42;
  }

  State subsequent{};
  const DWORD subsequent_status = GameHubXInputQaCallGetState(0, &subsequent);
  report->lateHookCouldOnlyBlockSubsequentCall =
      subsequent_status == ERROR_SUCCESS &&
      subsequent.packetNumber == kBlockedStatePacket &&
      IsNeutral(subsequent.gamepad);
  GameHubXInputQaQueueKeystrokes(0);
  GameHubXInputQaSetPhysical(TRUE, TRUE, kReleasedPhysicalPacket);
  request_close(kGeneration, kTopologyEpoch);
  observe_release(kGeneration, kTopologyEpoch, 0);
  observe_release(kGeneration, kTopologyEpoch, 50);
  report->detachError = detach();
  return 31;
}

}  // namespace

int wmain(int argument_count, wchar_t** arguments) {
  if (argument_count != 7 || !WideEquals(arguments[1], L"--result") ||
      !WideEquals(arguments[3], L"--scenario") ||
      !WideEquals(arguments[5], L"--enable")) {
    return 20;
  }

  Report report;
  report.entryReached = true;
  if (WideEquals(arguments[4], L"normal")) {
    report.scenario = "normal";
  } else if (WideEquals(arguments[4], L"rollback")) {
    report.scenario = "rollback";
  } else if (WideEquals(arguments[4], L"invalidation")) {
    report.scenario = "invalidation";
  } else if (WideEquals(arguments[4], L"late")) {
    report.scenario = "late";
  } else if (WideEquals(arguments[4], L"hang")) {
    report.scenario = "hang";
  } else {
    return 20;
  }
  if (WideEquals(arguments[6], L"none")) {
    report.enableMode = "none";
  } else if (WideEquals(arguments[6], L"false")) {
    report.enableMode = "false";
  } else if (WideEquals(arguments[6], L"true")) {
    report.enableMode = "true";
  } else {
    return 20;
  }
  if (report.scenario == "hang") {
    Sleep(INFINITE);
    return 99;
  }

  CacheSnapshot cache_before{};
  if (!GameHubXInputQaGetCacheSnapshot(&cache_before, sizeof(cache_before))) {
    return 21;
  }
  report.cacheInitializedBeforeBootstrap =
      cache_before.initializedBeforeBootstrap == 1u;
  report.cachedPointersMatchedProvider =
      cache_before.allPointersMatchedProvider == 1u;

  HMODULE bootstrap = GetModuleHandleW(kBootstrapModuleName);
  report.bootstrapLoadedBeforeEntry = bootstrap != nullptr;
  if (report.scenario == "late") {
    const DWORD exit_code = RunLateNegative(&report, &bootstrap);
    report.proofPassed = false;
    const bool wrote = WriteResult(arguments[2], Serialize(report));
    return wrote ? static_cast<int>(exit_code) : 22;
  }

  if (bootstrap == nullptr) {
    State baseline{};
    report.preBlockPhysicalConnected =
        GameHubXInputQaCallGetState(0, &baseline) == ERROR_SUCCESS &&
        IsPhysicalState(baseline);
    report.proofPassed = false;
    return WriteResult(arguments[2], Serialize(report)) ? 30 : 22;
  }

  const auto get_bootstrap = Resolve<GetBootstrapSnapshotFunction>(
      bootstrap, "GameHubXInputQaGetBootstrapSnapshot");
  const auto begin_block =
      Resolve<BeginBlockFunction>(bootstrap, "GameHubXInputQaBeginBlock");
  const auto request_close =
      Resolve<RequestCloseFunction>(bootstrap, "GameHubXInputQaRequestClose");
  const auto observe_release = Resolve<ObserveReleaseFunction>(
      bootstrap, "GameHubXInputQaObserveRelease");
  const auto invalidate_topology = Resolve<InvalidateTopologyFunction>(
      bootstrap, "GameHubXInputQaInvalidateTopology");
  const auto revalidate =
      Resolve<RevalidateFunction>(bootstrap, "GameHubXInputQaRevalidate");
  const auto detach =
      Resolve<DetachFunction>(bootstrap, "GameHubXInputQaDetach");
  if (get_bootstrap == nullptr || begin_block == nullptr ||
      request_close == nullptr || observe_release == nullptr ||
      invalidate_topology == nullptr || revalidate == nullptr ||
      detach == nullptr) {
    return 23;
  }

  BootstrapSnapshot bootstrap_before{};
  if (!get_bootstrap(&bootstrap_before, sizeof(bootstrap_before))) return 24;
  report.attachError = static_cast<DWORD>(bootstrap_before.attachError);
  report.hookAttachedBeforeEntry =
      bootstrap_before.restoreAfterWithSucceeded == 1u &&
      bootstrap_before.attachedBeforeEntry == 1u &&
      bootstrap_before.attachError == ERROR_SUCCESS;
  report.bootstrapAttachedExactCachedBodies =
      bootstrap_before.getStatePointerBeforeAttach ==
          cache_before.getStatePointer &&
      bootstrap_before.getStateExPointerBeforeAttach ==
          cache_before.getStateExPointer &&
      bootstrap_before.getKeystrokePointerBeforeAttach ==
          cache_before.getKeystrokePointer &&
      bootstrap_before.enablePointerBeforeAttach ==
          cache_before.enablePointer &&
      bootstrap_before.setStatePointerBeforeAttach ==
          cache_before.setStatePointer;

  State physical_before{};
  report.preBlockPhysicalConnected =
      GameHubXInputQaCallGetState(0, &physical_before) == ERROR_SUCCESS &&
      IsPhysicalState(physical_before);
  report.physicalPacketBeforeBlock = physical_before.packetNumber;
  State absent{};
  report.absentUserStayedDisconnected =
      GameHubXInputQaCallGetState(1, &absent) == ERROR_DEVICE_NOT_CONNECTED;

  Vibration vibration_a{kVibrationALeft, kVibrationARight};
  ProviderSnapshot provider_after_a{};
  report.physicalVibrationAForwarded =
      GameHubXInputQaCallSetState(0, &vibration_a) == ERROR_SUCCESS &&
      GameHubXInputQaGetProviderSnapshot(&provider_after_a,
                                         sizeof(provider_after_a)) &&
      provider_after_a.currentLeftMotorSpeed == kVibrationALeft &&
      provider_after_a.currentRightMotorSpeed == kVibrationARight;

  const DWORD begin_event = begin_block(kGeneration, kTopologyEpoch);
  ProviderSnapshot provider_after_block{};
  GameHubXInputQaGetProviderSnapshot(&provider_after_block,
                                     sizeof(provider_after_block));
  report.blockStoppedVibration =
      begin_event == static_cast<DWORD>(FenceEvent::kApplied) &&
      provider_after_block.currentLeftMotorSpeed == 0u &&
      provider_after_block.currentRightMotorSpeed == 0u;

  report.providerSetStateCallsBeforeBlockedRequest =
      provider_after_block.setStateCalls;
  report.providerEnableCallsBeforeBlockedRequests =
      provider_after_block.enableCalls;
  Vibration vibration_b{kVibrationBLeft, kVibrationBRight};
  const DWORD blocked_set_status = GameHubXInputQaCallSetState(0, &vibration_b);
  if (report.enableMode == "false") {
    GameHubXInputQaCallEnable(FALSE);
  } else if (report.enableMode == "true") {
    GameHubXInputQaCallEnable(FALSE);
    GameHubXInputQaCallEnable(TRUE);
  }
  ProviderSnapshot provider_after_blocked_requests{};
  GameHubXInputQaGetProviderSnapshot(&provider_after_blocked_requests,
                                     sizeof(provider_after_blocked_requests));
  report.providerSetStateCallsAfterBlockedRequest =
      provider_after_blocked_requests.setStateCalls;
  report.providerEnableCallsAfterBlockedRequests =
      provider_after_blocked_requests.enableCalls;
  report.blockedVibrationBRememberedNotForwarded =
      blocked_set_status == ERROR_SUCCESS &&
      provider_after_blocked_requests.setStateCalls ==
          provider_after_block.setStateCalls &&
      provider_after_blocked_requests.lastLeftMotorSpeed == kVibrationALeft &&
      provider_after_blocked_requests.lastRightMotorSpeed == kVibrationARight;
  report.enableCallsSwallowedWhileBlocked =
      provider_after_blocked_requests.enableCalls ==
      provider_after_block.enableCalls;

  GameHubXInputQaSetPhysical(TRUE, FALSE, 0x22334455u);
  State blocked_state_1{};
  const DWORD blocked_state_status_1 =
      GameHubXInputQaCallGetState(0, &blocked_state_1);
  GameHubXInputQaSetPhysical(TRUE, FALSE, 0x66778899u);
  State blocked_state_2{};
  State blocked_state_ex{};
  const DWORD blocked_state_status_2 =
      GameHubXInputQaCallGetState(0, &blocked_state_2);
  const DWORD blocked_state_ex_status =
      GameHubXInputQaCallGetStateEx(0, &blocked_state_ex);
  report.blockedPacket = blocked_state_1.packetNumber;
  report.blockedStateConnectedNeutral =
      blocked_state_status_1 == ERROR_SUCCESS &&
      blocked_state_status_2 == ERROR_SUCCESS &&
      IsNeutral(blocked_state_1.gamepad) && IsNeutral(blocked_state_2.gamepad);
  report.blockedStateExConnectedNeutral =
      blocked_state_ex_status == ERROR_SUCCESS &&
      IsNeutral(blocked_state_ex.gamepad);
  report.blockedPacketTransitioned =
      blocked_state_1.packetNumber == kBlockedStatePacket &&
      blocked_state_1.packetNumber != physical_before.packetNumber;
  report.blockedPacketStableAcrossHiddenChange =
      blocked_state_1.packetNumber == blocked_state_2.packetNumber &&
      blocked_state_1.packetNumber == blocked_state_ex.packetNumber;
  State blocked_absent{};
  report.blockedAbsentUserStayedDisconnected =
      GameHubXInputQaCallGetState(1, &blocked_absent) ==
      ERROR_DEVICE_NOT_CONNECTED;

  Keystroke blocked_keystroke{};
  const DWORD blocked_key_status =
      GameHubXInputQaCallGetKeystroke(kXUserIndexAny, 0, &blocked_keystroke);
  ProviderSnapshot provider_after_drain{};
  GameHubXInputQaGetProviderSnapshot(&provider_after_drain,
                                     sizeof(provider_after_drain));
  report.blockedKeystrokeEmptyAndZero =
      blocked_key_status == kErrorEmpty && IsZero(blocked_keystroke);
  report.blockedQueueDrained = provider_after_drain.queuedKeystrokes == 0u;

  unsigned long long active_epoch = kTopologyEpoch;
  request_close(kGeneration, active_epoch);
  if (report.scenario == "normal") {
    GameHubXInputQaQueueKeystrokes(1);
    GameHubXInputQaSetPhysical(TRUE, FALSE, 0x8899aabbu);
    const DWORD prevented = observe_release(kGeneration, active_epoch, 0);
    BootstrapSnapshot prevented_snapshot{};
    get_bootstrap(&prevented_snapshot, sizeof(prevented_snapshot));
    report.pendingAndNonNeutralPreventedRelease =
        prevented == static_cast<DWORD>(FenceEvent::kApplied) &&
        prevented_snapshot.blockLatched == 1u;
    Keystroke discarded{};
    GameHubXInputQaCallGetKeystroke(kXUserIndexAny, 0, &discarded);
    GameHubXInputQaSetPhysical(TRUE, TRUE, kReleasedPhysicalPacket);
    report.staleIdentityIgnored =
        observe_release(kGeneration - 1u, active_epoch, 0) ==
        static_cast<DWORD>(FenceEvent::kIgnoredStale);
    const DWORD sample_one = observe_release(kGeneration, active_epoch, 0);
    const DWORD repeated_close = request_close(kGeneration, active_epoch);
    BootstrapSnapshot after_repeated_close{};
    get_bootstrap(&after_repeated_close, sizeof(after_repeated_close));
    report.repeatedCloseWasIdempotent =
        sample_one == static_cast<DWORD>(FenceEvent::kApplied) &&
        repeated_close == static_cast<DWORD>(FenceEvent::kApplied) &&
        after_repeated_close.neutralSamples == 1u &&
        after_repeated_close.neutralSinceMs == 0u;
    report.releaseEvent = observe_release(kGeneration, active_epoch, 50);
  } else if (report.scenario == "rollback") {
    GameHubXInputQaQueueKeystrokes(0);
    GameHubXInputQaSetPhysical(TRUE, TRUE, kReleasedPhysicalPacket);
    const DWORD first = observe_release(kGeneration, active_epoch, 100);
    const DWORD rollback = observe_release(kGeneration, active_epoch, 90);
    const DWORD too_soon = observe_release(kGeneration, active_epoch, 139);
    BootstrapSnapshot before_release{};
    get_bootstrap(&before_release, sizeof(before_release));
    report.timeRollbackRestartedDwell =
        first == static_cast<DWORD>(FenceEvent::kApplied) &&
        rollback == static_cast<DWORD>(FenceEvent::kApplied) &&
        too_soon == static_cast<DWORD>(FenceEvent::kApplied) &&
        before_release.blockLatched == 1u;
    report.releaseEvent = observe_release(kGeneration, active_epoch, 140);
  } else if (report.scenario == "invalidation") {
    GameHubXInputQaQueueKeystrokes(0);
    GameHubXInputQaSetPhysical(TRUE, TRUE, kReleasedPhysicalPacket);
    observe_release(kGeneration, active_epoch, 0);
    const DWORD invalidated =
        invalidate_topology(kGeneration, active_epoch + 1u);
    const DWORD old_epoch = observe_release(kGeneration, active_epoch, 50);
    ++active_epoch;
    const DWORD unvalidated_new_epoch =
        observe_release(kGeneration, active_epoch, 50);
    const DWORD close_while_invalidated =
        request_close(kGeneration, active_epoch);
    BootstrapSnapshot before_revalidation{};
    get_bootstrap(&before_revalidation, sizeof(before_revalidation));
    const DWORD revalidated = revalidate(kGeneration, active_epoch);
    const DWORD close_after_revalidation =
        request_close(kGeneration, active_epoch);
    const DWORD next_sample = observe_release(kGeneration, active_epoch, 50);
    report.topologyInvalidationKeptLatch =
        invalidated == static_cast<DWORD>(FenceEvent::kApplied) &&
        old_epoch == static_cast<DWORD>(FenceEvent::kIgnoredStale) &&
        unvalidated_new_epoch == static_cast<DWORD>(FenceEvent::kRejected) &&
        close_while_invalidated == static_cast<DWORD>(FenceEvent::kRejected) &&
        before_revalidation.blockLatched == 1u &&
        before_revalidation.readinessValid == 0u &&
        before_revalidation.fencePhase ==
            static_cast<DWORD>(FencePhase::kInvalidated) &&
        revalidated == static_cast<DWORD>(FenceEvent::kApplied) &&
        close_after_revalidation == static_cast<DWORD>(FenceEvent::kApplied) &&
        next_sample == static_cast<DWORD>(FenceEvent::kApplied) &&
        before_revalidation.topologyEpoch == active_epoch;
    report.releaseEvent = observe_release(kGeneration, active_epoch, 100);
  } else {
    return 25;
  }

  BootstrapSnapshot after_release{};
  ProviderSnapshot provider_after_release{};
  get_bootstrap(&after_release, sizeof(after_release));
  GameHubXInputQaGetProviderSnapshot(&provider_after_release,
                                     sizeof(provider_after_release));
  report.releaseFenceCompleted =
      report.releaseEvent == static_cast<DWORD>(FenceEvent::kReleased) &&
      after_release.blockLatched == 0u &&
      after_release.fencePhase == static_cast<DWORD>(FencePhase::kReleased);
  report.releaseKeptDetoursAttached = after_release.attachedBeforeEntry == 1u;
  const DWORD expected_enabled = report.enableMode == "false" ? 0u : 1u;
  report.requestedEnableRestored =
      provider_after_release.enabled == expected_enabled;
  report.rememberedVibrationRestored =
      provider_after_release.lastLeftMotorSpeed == kVibrationBLeft &&
      provider_after_release.lastRightMotorSpeed == kVibrationBRight &&
      (expected_enabled == 0u
           ? provider_after_release.currentLeftMotorSpeed == 0u &&
                 provider_after_release.currentRightMotorSpeed == 0u
           : provider_after_release.currentLeftMotorSpeed == kVibrationBLeft &&
                 provider_after_release.currentRightMotorSpeed ==
                     kVibrationBRight);
  Keystroke stale{};
  report.noStaleKeystrokeAfterRelease =
      GameHubXInputQaCallGetKeystroke(kXUserIndexAny, 0, &stale) ==
          kErrorEmpty &&
      IsZero(stale);

  if (expected_enabled == 0u) GameHubXInputQaCallEnable(TRUE);
  GameHubXInputQaSetPhysical(TRUE, FALSE, kReleasedPhysicalPacket);
  State released_state{};
  report.releasedCachedPointerReturnedPhysical =
      GameHubXInputQaCallGetState(0, &released_state) == ERROR_SUCCESS &&
      PhysicalStateWithPacket(released_state, kReleasedPhysicalPacket);
  CacheSnapshot cache_after_release{};
  GameHubXInputQaGetCacheSnapshot(&cache_after_release,
                                  sizeof(cache_after_release));
  report.cachedPointersStable = SamePointers(cache_before, cache_after_release);

  report.detachError = detach();
  State detached_state{};
  report.detachedCachedPointerReturnedPhysical =
      report.detachError == ERROR_SUCCESS &&
      GameHubXInputQaCallGetState(0, &detached_state) == ERROR_SUCCESS &&
      PhysicalStateWithPacket(detached_state, kReleasedPhysicalPacket);
  ProviderSnapshot final_provider{};
  GameHubXInputQaGetProviderSnapshot(&final_provider, sizeof(final_provider));
  report.finalProviderEnabled = final_provider.enabled;

  const bool scenario_specific =
      report.scenario == "normal"
          ? report.pendingAndNonNeutralPreventedRelease &&
                report.staleIdentityIgnored && report.repeatedCloseWasIdempotent
      : report.scenario == "rollback" ? report.timeRollbackRestartedDwell
                                      : report.topologyInvalidationKeptLatch;
  report.proofPassed =
      report.entryReached && report.bootstrapLoadedBeforeEntry &&
      report.cacheInitializedBeforeBootstrap &&
      report.cachedPointersMatchedProvider && report.cachedPointersStable &&
      report.bootstrapAttachedExactCachedBodies &&
      report.hookAttachedBeforeEntry && report.preBlockPhysicalConnected &&
      report.absentUserStayedDisconnected &&
      report.physicalVibrationAForwarded && report.blockStoppedVibration &&
      report.blockedStateConnectedNeutral &&
      report.blockedStateExConnectedNeutral &&
      report.blockedPacketTransitioned &&
      report.blockedPacketStableAcrossHiddenChange &&
      report.blockedAbsentUserStayedDisconnected &&
      report.blockedKeystrokeEmptyAndZero && report.blockedQueueDrained &&
      report.blockedVibrationBRememberedNotForwarded &&
      report.enableCallsSwallowedWhileBlocked && scenario_specific &&
      report.releaseFenceCompleted && report.releaseKeptDetoursAttached &&
      report.requestedEnableRestored && report.rememberedVibrationRestored &&
      report.noStaleKeystrokeAfterRelease &&
      report.releasedCachedPointerReturnedPhysical &&
      report.detachedCachedPointerReturnedPhysical;

  return WriteResult(arguments[2], Serialize(report))
             ? (report.proofPassed ? 0 : 32)
             : 22;
}
