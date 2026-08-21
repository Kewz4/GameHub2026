#include <array>
#include <atomic>
#include <iterator>
#include <sstream>
#include <string>
#include <thread>
#include <vector>

#include "contract.hpp"

namespace {

using namespace gamehub::overlay::wgi_qa;
using GetBootstrapSnapshotFunction = BOOL(WINAPI*)(BootstrapSnapshot*, DWORD);
using BeginBlockFunction = DWORD(WINAPI*)(DWORD, unsigned long long);
using RevalidateFunction = DWORD(WINAPI*)(DWORD, unsigned long long);
using ObserveReleaseFunction = DWORD(WINAPI*)(DWORD, unsigned long long,
                                              unsigned long long);
using DetachFunction = DWORD(WINAPI*)();
using AttachLateFunction = DWORD(WINAPI*)();
using ArmPausedReaderFunction = BOOL(WINAPI*)(DWORD, HANDLE, HANDLE);

struct Readings {
  HRESULT results[kProjectionCount]{};
  abi::GamepadReading gamepad{};
  boolean rawButtons[kRawButtons]{};
  abi::GameControllerSwitchPosition rawSwitches[kRawSwitches]{};
  DOUBLE rawAxes[kRawAxes]{};
  UINT64 rawTimestamp = 0;
  abi::RacingWheelReading racing{};
  abi::FlightStickReading flight{};
  abi::ArcadeStickReading arcade{};
  abi::UINavigationReading ui{};
};

struct Report {
  bool entryReached = false;
  bool bootstrapLoadedBeforeEntry = false;
  bool cacheInitializedBeforeBootstrap = false;
  bool cacheIdentityValidated = false;
  bool cachedBodiesStable = false;
  bool hookAttachedBeforeEntry = false;
  bool activationBodyIntercepted = false;
  bool blockedActivationIntercepted = false;
  bool allSixPollBodiesIntercepted = false;
  bool preBlockPhysical = false;
  bool blockedAllNeutral = false;
  bool drainMaskComplete = false;
  bool nonNeutralPreventedRelease = false;
  bool staleIdentityIgnored = false;
  bool timeRollbackRestartedDwell = false;
  bool topologyInvalidationKeptLatch = false;
  bool serialRevalidationRequired = false;
  bool replacementRetainedOldAndNewIdentities = false;
  bool unregisteredSameBodyRejected = false;
  bool immutableGenerationRacePassed = false;
  bool eightThreadStressPassed = false;
  bool capacityExhaustionRejectedLatched = false;
  bool comOverReleaseDetected = false;
  bool malformedRejectedLatched = false;
  bool recoveryRequiredExplicitRevalidation = false;
  bool unknownInputsRejected = false;
  bool releaseFenceCompleted = false;
  bool releaseKeptHooks = false;
  bool releasedCachedPointersReturnedPhysical = false;
  bool detachedCachedPointersReturnedPhysical = false;
  bool comReferencesBalanced = false;
  bool latePhysicalCallEscapedBeforeAttach = false;
  bool lateHookCouldOnlyBlockSubsequentCalls = false;
  bool proofPassed = false;
  DWORD attachError = ERROR_INVALID_STATE;
  DWORD releaseEvent = 0;
  DWORD detachError = ERROR_INVALID_STATE;
  DWORD snapshotCount = 0;
  DWORD activeSnapshotGeneration = 0;
  DWORD publishedSnapshotCount = 0;
  unsigned long long initialEpoch = 0;
  unsigned long long finalEpoch = 0;
  std::string scenario;
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
#define APPEND_BOOL(Field) AppendBool(output, #Field, report.Field, &first)
  APPEND_BOOL(entryReached);
  APPEND_BOOL(bootstrapLoadedBeforeEntry);
  APPEND_BOOL(cacheInitializedBeforeBootstrap);
  APPEND_BOOL(cacheIdentityValidated);
  APPEND_BOOL(cachedBodiesStable);
  APPEND_BOOL(hookAttachedBeforeEntry);
  APPEND_BOOL(activationBodyIntercepted);
  APPEND_BOOL(blockedActivationIntercepted);
  APPEND_BOOL(allSixPollBodiesIntercepted);
  APPEND_BOOL(preBlockPhysical);
  APPEND_BOOL(blockedAllNeutral);
  APPEND_BOOL(drainMaskComplete);
  APPEND_BOOL(nonNeutralPreventedRelease);
  APPEND_BOOL(staleIdentityIgnored);
  APPEND_BOOL(timeRollbackRestartedDwell);
  APPEND_BOOL(topologyInvalidationKeptLatch);
  APPEND_BOOL(serialRevalidationRequired);
  APPEND_BOOL(replacementRetainedOldAndNewIdentities);
  APPEND_BOOL(unregisteredSameBodyRejected);
  APPEND_BOOL(immutableGenerationRacePassed);
  APPEND_BOOL(eightThreadStressPassed);
  APPEND_BOOL(capacityExhaustionRejectedLatched);
  APPEND_BOOL(comOverReleaseDetected);
  APPEND_BOOL(malformedRejectedLatched);
  APPEND_BOOL(recoveryRequiredExplicitRevalidation);
  APPEND_BOOL(unknownInputsRejected);
  APPEND_BOOL(releaseFenceCompleted);
  APPEND_BOOL(releaseKeptHooks);
  APPEND_BOOL(releasedCachedPointersReturnedPhysical);
  APPEND_BOOL(detachedCachedPointersReturnedPhysical);
  APPEND_BOOL(comReferencesBalanced);
  APPEND_BOOL(latePhysicalCallEscapedBeforeAttach);
  APPEND_BOOL(lateHookCouldOnlyBlockSubsequentCalls);
  APPEND_BOOL(proofPassed);
#undef APPEND_BOOL
  AppendNumber(output, "attachError", report.attachError, &first);
  AppendNumber(output, "releaseEvent", report.releaseEvent, &first);
  AppendNumber(output, "detachError", report.detachError, &first);
  AppendNumber(output, "snapshotCount", report.snapshotCount, &first);
  AppendNumber(output, "activeSnapshotGeneration",
               report.activeSnapshotGeneration, &first);
  AppendNumber(output, "publishedSnapshotCount",
               report.publishedSnapshotCount, &first);
  AppendNumber(output, "initialEpoch", report.initialEpoch, &first);
  AppendNumber(output, "finalEpoch", report.finalEpoch, &first);
  output << "}\n";
  return output.str();
}

template <typename Function>
Function Resolve(HMODULE module, const char* name) {
  return module == nullptr
             ? nullptr
             : reinterpret_cast<Function>(GetProcAddress(module, name));
}

Readings PollAll() {
  Readings readings{};
  readings.results[0] =
      GameHubWgiQaPoll(0, &readings.gamepad, nullptr, nullptr, nullptr);
  readings.results[1] =
      GameHubWgiQaPoll(1, readings.rawButtons, readings.rawSwitches,
                       readings.rawAxes, &readings.rawTimestamp);
  readings.results[2] =
      GameHubWgiQaPoll(2, &readings.racing, nullptr, nullptr, nullptr);
  readings.results[3] =
      GameHubWgiQaPoll(3, &readings.flight, nullptr, nullptr, nullptr);
  readings.results[4] =
      GameHubWgiQaPoll(4, &readings.arcade, nullptr, nullptr, nullptr);
  readings.results[5] =
      GameHubWgiQaPoll(5, &readings.ui, nullptr, nullptr, nullptr);
  return readings;
}

bool AllSucceeded(const Readings& readings) {
  for (HRESULT result : readings.results) {
    if (FAILED(result)) return false;
  }
  return true;
}

bool IsPhysical(const Readings& value) {
  return AllSucceeded(value) && value.gamepad.Timestamp == 1'001 &&
         static_cast<DWORD>(value.gamepad.Buttons) == 0x1001u &&
         value.gamepad.LeftTrigger == 0.75 &&
         value.gamepad.RightTrigger == 0.25 &&
         value.gamepad.LeftThumbstickX == -0.5 &&
         value.gamepad.LeftThumbstickY == 0.6 &&
         value.gamepad.RightThumbstickX == 0.7 &&
         value.gamepad.RightThumbstickY == -0.8 &&
         value.rawTimestamp == 2'002 && value.rawButtons[0] &&
         value.rawButtons[4] &&
         static_cast<DWORD>(value.rawSwitches[0]) == 1u &&
         value.rawAxes[0] == 0.25 && value.rawAxes[1] == 0.8 &&
         value.rawAxes[2] == 0.85 && value.rawAxes[3] == 0.1 &&
         value.rawAxes[4] == 0.75 && value.rawAxes[5] == 0.25 &&
         value.racing.Buttons != 0 && value.flight.Buttons != 0 &&
         value.arcade.Buttons != 0 && value.ui.RequiredButtons != 0;
}

bool IsNeutral(const Readings& value) {
  if (!AllSucceeded(value) || value.gamepad.Buttons != 0 ||
      value.gamepad.LeftTrigger != 0 || value.gamepad.RightTrigger != 0 ||
      value.gamepad.LeftThumbstickX != 0 ||
      value.gamepad.LeftThumbstickY != 0 ||
      value.gamepad.RightThumbstickX != 0 ||
      value.gamepad.RightThumbstickY != 0 || value.rawTimestamp != 2'002 ||
      value.rawSwitches[0] !=
          static_cast<abi::GameControllerSwitchPosition>(0) ||
      value.racing.Buttons != 0 || value.racing.Wheel != 0 ||
      value.flight.Buttons != 0 || value.flight.Roll != 0 ||
      value.arcade.Buttons != 0 || value.ui.RequiredButtons != 0 ||
      value.ui.OptionalButtons != 0) {
    return false;
  }
  for (boolean button : value.rawButtons) {
    if (button) return false;
  }
  constexpr DOUBLE neutral[kRawAxes] = {0.5, 0.5, 0.5, 0.5, 0.0, 0.0};
  for (DWORD index = 0; index < kRawAxes; ++index) {
    if (value.rawAxes[index] != neutral[index]) return false;
  }
  return true;
}

bool SameCacheBodies(const CacheSnapshot& left, const CacheSnapshot& right) {
  if (left.roGetActivationFactory == 0 ||
      left.roGetActivationFactory != right.roGetActivationFactory) {
    return false;
  }
  for (DWORD index = 0; index < kProjectionCount; ++index) {
    if (left.objects[index] == 0 || left.pollingBodies[index] == 0 ||
        left.objects[index] != right.objects[index] ||
        left.pollingBodies[index] != right.pollingBodies[index]) {
      return false;
    }
  }
  return true;
}

bool ActivateAll() {
  for (DWORD index = 0; index < kProjectionCount; ++index) {
    IInspectable* factory = nullptr;
    if (FAILED(GameHubWgiQaActivate(index,
                                    reinterpret_cast<void**>(&factory))) ||
        factory == nullptr) {
      return false;
    }
    factory->Release();
  }
  return true;
}

bool PollArcadeObject(ULONG_PTR object, bool expect_neutral) {
  if (object == 0) return false;
  CacheSnapshot cache{};
  if (!GameHubWgiQaGetCacheSnapshot(&cache, sizeof(cache))) return false;
  const auto function =
      reinterpret_cast<ArcadeReadingFunction>(cache.pollingBodies[4]);
  abi::ArcadeStickReading reading{};
  if (FAILED(function(reinterpret_cast<abi::IArcadeStick*>(object), &reading))) {
    return false;
  }
  return expect_neutral ? reading.Buttons == 0 : reading.Buttons != 0;
}

bool RejectsUnregisteredArcadeObject(ULONG_PTR object) {
  if (object == 0) return false;
  CacheSnapshot cache{};
  ProviderSnapshot before{};
  ProviderSnapshot after{};
  if (!GameHubWgiQaGetCacheSnapshot(&cache, sizeof(cache)) ||
      !GameHubWgiQaGetProviderSnapshot(&before, sizeof(before))) {
    return false;
  }
  const auto function =
      reinterpret_cast<ArcadeReadingFunction>(cache.pollingBodies[4]);
  abi::ArcadeStickReading reading{};
  reading.Buttons = static_cast<abi::ArcadeStickButtons>(1);
  const HRESULT result =
      function(reinterpret_cast<abi::IArcadeStick*>(object), &reading);
  return GameHubWgiQaGetProviderSnapshot(&after, sizeof(after)) &&
         result == E_ACCESSDENIED && reading.Buttons == 0 &&
         after.pollingCalls[4] == before.pollingCalls[4];
}

bool UnknownInputsRejected(const CacheSnapshot& cache) {
  Topology topology{};
  void* invalid_projection_factory = reinterpret_cast<void*>(1);
  const bool surface_rejected =
      !GameHubWgiQaSetFault(999u) && !GameHubWgiQaMutateTopology(999u) &&
      GameHubWgiQaActivate(kProjectionCount, nullptr) == E_POINTER &&
      GameHubWgiQaActivate(kProjectionCount, &invalid_projection_factory) ==
          E_INVALIDARG &&
      invalid_projection_factory == nullptr &&
      GameHubWgiQaPoll(kProjectionCount, nullptr, nullptr, nullptr, nullptr) ==
          E_INVALIDARG &&
      !GameHubWgiQaGetTopology(&topology, sizeof(topology) - 1u);

  HMODULE provider = GetModuleHandleW(L"gamehub-wgi-qa-provider64.dll");
  const auto ro = Resolve<RoGetActivationFactoryFunction>(
      provider, "RoGetActivationFactory");
  if (!surface_rejected || ro == nullptr) return false;

  HSTRING_HEADER unknown_header{};
  HSTRING unknown_class = nullptr;
  constexpr wchar_t kUnknown[] = L"GameHub.Unknown.Input";
  if (FAILED(WindowsCreateStringReference(
          kUnknown, static_cast<UINT32>(std::size(kUnknown) - 1u),
          &unknown_header, &unknown_class))) {
    return false;
  }
  void* output = reinterpret_cast<void*>(1);
  const HRESULT unknown_class_result =
      ro(unknown_class, __uuidof(IInspectable), &output);
  const bool unknown_class_cleared_output = output == nullptr;

  HSTRING_HEADER gamepad_header{};
  HSTRING gamepad_class = nullptr;
  constexpr wchar_t kGamepad[] = L"Windows.Gaming.Input.Gamepad";
  if (FAILED(WindowsCreateStringReference(
          kGamepad, static_cast<UINT32>(std::size(kGamepad) - 1u),
          &gamepad_header, &gamepad_class))) {
    return false;
  }
  output = reinterpret_cast<void*>(1);
  const HRESULT unknown_iid_result =
      ro(gamepad_class, __uuidof(IClassFactory), &output);

  boolean buttons[kRawButtons]{};
  abi::GameControllerSwitchPosition switches[kRawSwitches]{};
  DOUBLE axes[kRawAxes]{};
  UINT64 timestamp = 0;
  const auto raw = reinterpret_cast<RawReadingFunction>(cache.pollingBodies[1]);
  const HRESULT malformed_raw = raw(
      reinterpret_cast<abi::IRawGameController*>(cache.objects[1]),
      kRawButtons - 1u, buttons, kRawSwitches, switches, kRawAxes, axes,
      &timestamp);
  return unknown_class_result == REGDB_E_CLASSNOTREG &&
         unknown_class_cleared_output && unknown_iid_result == E_NOINTERFACE &&
         output == nullptr && malformed_raw == E_INVALIDARG;
}

DWORD RunLateNegative(Report* report, HMODULE* bootstrap) {
  report->latePhysicalCallEscapedBeforeAttach = IsPhysical(PollAll());
  const std::wstring directory = ExecutableDirectory();
  if (directory.empty()) return 40;
  *bootstrap = LoadLibraryW((directory + L"\\" + kBootstrapModuleName).c_str());
  if (*bootstrap == nullptr) return 41;
  const auto attach_late = Resolve<AttachLateFunction>(
      *bootstrap, "GameHubWgiQaAttachLateForNegativeControl");
  const auto begin =
      Resolve<BeginBlockFunction>(*bootstrap, "GameHubWgiQaBeginBlock");
  const auto observe = Resolve<ObserveReleaseFunction>(
      *bootstrap, "GameHubWgiQaObserveRelease");
  const auto detach =
      Resolve<DetachFunction>(*bootstrap, "GameHubWgiQaDetach");
  if (attach_late == nullptr || begin == nullptr || observe == nullptr ||
      detach == nullptr || attach_late() != ERROR_SUCCESS ||
      begin(kGeneration, kInitialEpoch) !=
          static_cast<DWORD>(FenceEvent::kApplied)) {
    return 42;
  }
  report->lateHookCouldOnlyBlockSubsequentCalls = IsNeutral(PollAll());
  GameHubWgiQaSetNeutral(TRUE);
  PollAll();
  observe(kGeneration, kInitialEpoch, 0);
  observe(kGeneration, kInitialEpoch, 50);
  report->detachError = detach();
  return 31;
}

ProviderFault ScenarioFault(const std::string& scenario) {
  if (scenario == "fault-qi") return ProviderFault::kQueryInterface;
  if (scenario == "fault-vtable") return ProviderFault::kNullTopologyVtable;
  if (scenario == "fault-body") return ProviderFault::kBodyMismatch;
  if (scenario == "fault-raw") return ProviderFault::kRawSchema;
  if (scenario == "fault-activation") return ProviderFault::kActivation;
  if (scenario == "fault-nonneutral") return ProviderFault::kNonNeutral;
  return ProviderFault::kNone;
}

bool IsFaultScenario(const std::string& scenario) {
  return ScenarioFault(scenario) != ProviderFault::kNone;
}

}  // namespace

int wmain(int argument_count, wchar_t** arguments) {
  if (argument_count != 7 || !WideEquals(arguments[1], L"--result") ||
      !WideEquals(arguments[3], L"--scenario") ||
      !WideEquals(arguments[5], L"--enable")) {
    return 20;
  }

  Report report{};
  report.entryReached = true;
  const std::wstring scenario_wide = arguments[4];
  for (const wchar_t character : scenario_wide) {
    if (character < 0 || character > 0x7f) return 20;
    report.scenario.push_back(static_cast<char>(character));
  }
  if (report.scenario == "hang") Sleep(INFINITE);

  CacheSnapshot cache_before{};
  CacheSnapshot cache_after{};
  if (!GameHubWgiQaGetCacheSnapshot(&cache_before, sizeof(cache_before))) {
    return 21;
  }
  report.cacheInitializedBeforeBootstrap =
      cache_before.initializedBeforeBootstrap != 0;
  report.cacheIdentityValidated =
      cache_before.allObjectsHadVtables != 0 &&
      cache_before.exactInterfacesRoundTripped != 0 &&
      cache_before.controllingUnknownsValid != 0 &&
      cache_before.gamepadRawSharedIdentity != 0 &&
      cache_before.otherIdentitiesDistinct != 0 &&
      cache_before.exactRawSchema != 0;

  HMODULE bootstrap = GetModuleHandleW(kBootstrapModuleName);
  report.bootstrapLoadedBeforeEntry = bootstrap != nullptr;
  if (report.scenario == "overrelease") {
    ProviderSnapshot before{};
    ProviderSnapshot after{};
    const bool read_before =
        GameHubWgiQaGetProviderSnapshot(&before, sizeof(before)) != FALSE;
    const bool exercised = GameHubWgiQaExerciseOverRelease() != FALSE;
    const bool read_after =
        GameHubWgiQaGetProviderSnapshot(&after, sizeof(after)) != FALSE;
    report.comOverReleaseDetected =
        read_before && exercised && read_after &&
        after.transientReferences == 0 &&
        after.addRefCalls == before.addRefCalls &&
        after.releaseCalls == before.releaseCalls + 1u &&
        after.overReleaseAttempts == before.overReleaseAttempts + 1u;
    report.proofPassed = false;
    if (!WriteResult(arguments[2], Serialize(report))) return 22;
    return report.comOverReleaseDetected ? 33 : 26;
  }
  DWORD exit_code = 0;
  if (report.scenario == "late") {
    exit_code = RunLateNegative(&report, &bootstrap);
    report.proofPassed = false;
    if (!WriteResult(arguments[2], Serialize(report))) return 22;
    return static_cast<int>(exit_code);
  }
  if (bootstrap == nullptr) {
    report.preBlockPhysical = IsPhysical(PollAll());
    report.proofPassed = false;
    if (!WriteResult(arguments[2], Serialize(report))) return 22;
    return 30;
  }

  const auto snapshot = Resolve<GetBootstrapSnapshotFunction>(
      bootstrap, "GameHubWgiQaGetBootstrapSnapshot");
  const auto begin =
      Resolve<BeginBlockFunction>(bootstrap, "GameHubWgiQaBeginBlock");
  const auto revalidate = Resolve<RevalidateFunction>(
      bootstrap, "GameHubWgiQaExplicitRevalidate");
  const auto observe = Resolve<ObserveReleaseFunction>(
      bootstrap, "GameHubWgiQaObserveRelease");
  const auto detach =
      Resolve<DetachFunction>(bootstrap, "GameHubWgiQaDetach");
  const auto arm_paused_reader = Resolve<ArmPausedReaderFunction>(
      bootstrap, "GameHubWgiQaArmPausedReader");
  if (snapshot == nullptr || begin == nullptr || revalidate == nullptr ||
      observe == nullptr || detach == nullptr || arm_paused_reader == nullptr) {
    return 23;
  }

  BootstrapSnapshot bootstrap_before{};
  if (!snapshot(&bootstrap_before, sizeof(bootstrap_before))) return 24;
  report.attachError = static_cast<DWORD>(bootstrap_before.attachError);
  report.hookAttachedBeforeEntry =
      bootstrap_before.attachedBeforeEntry != 0 &&
      bootstrap_before.attachError == ERROR_SUCCESS;
  report.snapshotCount = bootstrap_before.snapshotCount;
  report.activeSnapshotGeneration =
      bootstrap_before.activeSnapshotGeneration;
  report.publishedSnapshotCount = bootstrap_before.publishedSnapshotCount;
  report.initialEpoch = bootstrap_before.validatedEpoch;
  report.preBlockPhysical = IsPhysical(PollAll());
  const bool activated = ActivateAll();

  BootstrapSnapshot after_preblock{};
  snapshot(&after_preblock, sizeof(after_preblock));
  report.activationBodyIntercepted =
      activated && after_preblock.activationHookCalls >= kProjectionCount;
  report.allSixPollBodiesIntercepted = true;
  for (DWORD index = 0; index < kProjectionCount; ++index) {
    report.allSixPollBodiesIntercepted =
        report.allSixPollBodiesIntercepted &&
        after_preblock.pollingHookCalls[index] >= 1u;
  }
  GameHubWgiQaGetCacheSnapshot(&cache_after, sizeof(cache_after));
  report.cachedBodiesStable = SameCacheBodies(cache_before, cache_after);

  const DWORD begin_event = begin(kGeneration, report.initialEpoch);
  report.staleIdentityIgnored =
      begin(kGeneration + 1u, report.initialEpoch) ==
      static_cast<DWORD>(FenceEvent::kIgnoredStale);
  report.blockedAllNeutral =
      begin_event == static_cast<DWORD>(FenceEvent::kApplied) &&
      IsNeutral(PollAll());
  BootstrapSnapshot blocked{};
  snapshot(&blocked, sizeof(blocked));
  report.drainMaskComplete =
      blocked.drainMask == kAllProjectionMask &&
      blocked.drainedEntryCount == blocked.requiredDrainEntries &&
      blocked.requiredDrainEntries == kProjectionCount;
  const DWORD activation_calls_before_blocked_activation =
      blocked.activationHookCalls;
  const bool blocked_activation = ActivateAll();
  BootstrapSnapshot after_blocked_activation{};
  snapshot(&after_blocked_activation, sizeof(after_blocked_activation));
  report.blockedActivationIntercepted =
      blocked_activation &&
      after_blocked_activation.activationHookCalls ==
          activation_calls_before_blocked_activation + kProjectionCount;

  if (report.scenario == "capacity") {
    bool publications_succeeded = true;
    Topology current{};
    for (DWORD publication = 1; publication < kSnapshotGenerationCap;
         ++publication) {
      publications_succeeded =
          publications_succeeded && GameHubWgiQaMutateTopology(3) != FALSE &&
          GameHubWgiQaGetTopology(&current, sizeof(current)) != FALSE &&
          revalidate(kGeneration, current.epoch) ==
              static_cast<DWORD>(FenceEvent::kApplied);
    }
    const bool sixty_fifth_mutated =
        GameHubWgiQaMutateTopology(3) != FALSE &&
        GameHubWgiQaGetTopology(&current, sizeof(current)) != FALSE;
    const DWORD sixty_fifth = revalidate(kGeneration, current.epoch);
    BootstrapSnapshot exhausted{};
    snapshot(&exhausted, sizeof(exhausted));
    report.activeSnapshotGeneration = exhausted.activeSnapshotGeneration;
    report.publishedSnapshotCount = exhausted.publishedSnapshotCount;
    report.capacityExhaustionRejectedLatched =
        publications_succeeded && sixty_fifth_mutated &&
        sixty_fifth == static_cast<DWORD>(FenceEvent::kRejected) &&
        exhausted.publishedSnapshotCount == kSnapshotGenerationCap &&
        exhausted.activeSnapshotGeneration == kSnapshotGenerationCap &&
        exhausted.blockLatched != 0 && exhausted.readinessValid == 0 &&
        exhausted.fencePhase ==
            static_cast<DWORD>(FencePhase::kInvalidated);
    report.proofPassed = false;
    if (!WriteResult(arguments[2], Serialize(report))) return 22;
    return report.capacityExhaustionRejectedLatched ? 32 : 27;
  }

  if (report.scenario == "thread-stress") {
    std::atomic<bool> all_neutral{true};
    std::array<std::thread, 8> readers;
    for (std::thread& reader : readers) {
      reader = std::thread([&all_neutral]() {
        for (DWORD iteration = 0; iteration < 128; ++iteration) {
          if (!IsNeutral(PollAll())) {
            all_neutral.store(false, std::memory_order_release);
            return;
          }
        }
      });
    }
    for (std::thread& reader : readers) reader.join();
    BootstrapSnapshot stressed{};
    snapshot(&stressed, sizeof(stressed));
    report.eightThreadStressPassed =
        all_neutral.load(std::memory_order_acquire) &&
        stressed.drainMask == kAllProjectionMask &&
        stressed.drainedEntryCount == stressed.requiredDrainEntries &&
        stressed.requiredDrainEntries == kProjectionCount;
  }

  unsigned long long release_epoch = report.initialEpoch;
  ULONG_PTR replacement_arcade = 0;
  if (report.scenario == "reader-race") {
    HANDLE entered = CreateEventW(nullptr, TRUE, FALSE, nullptr);
    HANDLE resume = CreateEventW(nullptr, TRUE, FALSE, nullptr);
    const bool armed = entered != nullptr && resume != nullptr &&
                       arm_paused_reader(
                           static_cast<DWORD>(Projection::kArcade), entered,
                           resume) != FALSE;
    std::atomic<HRESULT> paused_result{E_PENDING};
    std::atomic<bool> paused_neutral{false};
    const auto arcade =
        reinterpret_cast<ArcadeReadingFunction>(cache_before.pollingBodies[4]);
    std::thread paused_reader([&]() {
      abi::ArcadeStickReading reading{};
      const HRESULT result = arcade(
          reinterpret_cast<abi::IArcadeStick*>(cache_before.objects[4]),
          &reading);
      paused_neutral.store(SUCCEEDED(result) && reading.Buttons == 0,
                           std::memory_order_release);
      paused_result.store(result, std::memory_order_release);
    });
    const DWORD entered_wait =
        entered == nullptr ? WAIT_FAILED : WaitForSingleObject(entered, 5'000);
    Topology first{};
    Topology second{};
    const bool first_publication =
        entered_wait == WAIT_OBJECT_0 &&
        GameHubWgiQaMutateTopology(4) != FALSE &&
        GameHubWgiQaGetTopology(&first, sizeof(first)) != FALSE &&
        revalidate(kGeneration, first.epoch) ==
            static_cast<DWORD>(FenceEvent::kApplied);
    const bool second_publication =
        first_publication && GameHubWgiQaMutateTopology(4) != FALSE &&
        GameHubWgiQaGetTopology(&second, sizeof(second)) != FALSE &&
        revalidate(kGeneration, second.epoch) ==
            static_cast<DWORD>(FenceEvent::kApplied);
    BootstrapSnapshot before_resume{};
    snapshot(&before_resume, sizeof(before_resume));
    if (resume != nullptr) SetEvent(resume);
    paused_reader.join();
    BootstrapSnapshot after_resume{};
    snapshot(&after_resume, sizeof(after_resume));
    report.immutableGenerationRacePassed =
        armed && first_publication && second_publication &&
        before_resume.activeSnapshotGeneration ==
            bootstrap_before.activeSnapshotGeneration + 2u &&
        before_resume.publishedSnapshotCount ==
            bootstrap_before.publishedSnapshotCount + 2u &&
        before_resume.drainedEntryCount == 0 &&
        after_resume.activeSnapshotGeneration ==
            before_resume.activeSnapshotGeneration &&
        after_resume.drainedEntryCount == 0 &&
        paused_result.load(std::memory_order_acquire) == S_OK &&
        paused_neutral.load(std::memory_order_acquire);
    if (entered != nullptr) CloseHandle(entered);
    if (resume != nullptr) CloseHandle(resume);
    release_epoch = second.epoch;
    report.blockedAllNeutral =
        report.blockedAllNeutral && IsNeutral(PollAll()) &&
        PollArcadeObject(first.objects[4], true);
    BootstrapSnapshot fully_drained{};
    snapshot(&fully_drained, sizeof(fully_drained));
    report.immutableGenerationRacePassed =
        report.immutableGenerationRacePassed &&
        fully_drained.snapshotCount == kProjectionCount + 1u &&
        fully_drained.drainedEntryCount == fully_drained.requiredDrainEntries;
  } else if (report.scenario == "invalidation" ||
             report.scenario == "replacement") {
    Topology before{};
    Topology after{};
    GameHubWgiQaGetTopology(&before, sizeof(before));
    const bool replacement = report.scenario == "replacement";
    const bool mutated = GameHubWgiQaMutateTopology(replacement ? 4u : 3u);
    GameHubWgiQaGetTopology(&after, sizeof(after));
    if (replacement) {
      report.unregisteredSameBodyRejected =
          RejectsUnregisteredArcadeObject(after.objects[4]);
    }
    BootstrapSnapshot invalidated{};
    snapshot(&invalidated, sizeof(invalidated));
    const DWORD old_revalidate = revalidate(kGeneration, before.epoch);
    const DWORD new_revalidate = revalidate(kGeneration, after.epoch);
    report.topologyInvalidationKeptLatch =
        mutated && invalidated.blockLatched != 0 &&
        invalidated.readinessValid == 0 &&
        invalidated.fencePhase ==
            static_cast<DWORD>(FencePhase::kInvalidated);
    const bool serial_changed =
        replacement ? after.serials[4] != before.serials[4]
                    : after.serials[0] != before.serials[0] &&
                          after.serials[1] != before.serials[1];
    report.serialRevalidationRequired =
        old_revalidate == static_cast<DWORD>(FenceEvent::kRejected) &&
        new_revalidate == static_cast<DWORD>(FenceEvent::kApplied) &&
        serial_changed;
    release_epoch = after.epoch;
    report.blockedAllNeutral = report.blockedAllNeutral && IsNeutral(PollAll());
    if (replacement) {
      replacement_arcade = after.objects[4];
      const bool old_neutral = PollArcadeObject(before.objects[4], true);
      const bool new_neutral = PollArcadeObject(after.objects[4], true);
      BootstrapSnapshot retained{};
      snapshot(&retained, sizeof(retained));
      report.replacementRetainedOldAndNewIdentities =
          after.objects[4] != before.objects[4] &&
          retained.snapshotCount == kProjectionCount + 1u &&
          retained.drainedEntryCount == retained.requiredDrainEntries &&
          retained.requiredDrainEntries == kProjectionCount + 1u &&
          old_neutral && new_neutral;
    }
  } else if (IsFaultScenario(report.scenario)) {
    const ProviderFault fault = ScenarioFault(report.scenario);
    const bool fault_set =
        GameHubWgiQaSetFault(static_cast<DWORD>(fault)) != FALSE;
    Topology malformed{};
    GameHubWgiQaGetTopology(&malformed, sizeof(malformed));
    const DWORD rejected = revalidate(kGeneration, malformed.epoch);
    BootstrapSnapshot failed{};
    snapshot(&failed, sizeof(failed));
    bool activation_failed = true;
    if (fault == ProviderFault::kActivation) {
      void* factory = nullptr;
      activation_failed = FAILED(GameHubWgiQaActivate(0, &factory)) &&
                          factory == nullptr;
    }
    report.malformedRejectedLatched =
        fault_set && activation_failed &&
        rejected == static_cast<DWORD>(FenceEvent::kRejected) &&
        failed.blockLatched != 0 && failed.readinessValid == 0;
    const bool fault_cleared = GameHubWgiQaSetFault(
                                   static_cast<DWORD>(ProviderFault::kNone)) !=
                               FALSE;
    Topology recovered{};
    GameHubWgiQaGetTopology(&recovered, sizeof(recovered));
    report.unknownInputsRejected = UnknownInputsRejected(cache_before);
    report.recoveryRequiredExplicitRevalidation =
        fault_cleared &&
        revalidate(kGeneration, recovered.epoch) ==
            static_cast<DWORD>(FenceEvent::kApplied);
    release_epoch = recovered.epoch;
    report.blockedAllNeutral = report.blockedAllNeutral && IsNeutral(PollAll());
  }

  report.nonNeutralPreventedRelease =
      observe(kGeneration, release_epoch, 0) ==
          static_cast<DWORD>(FenceEvent::kApplied);
  GameHubWgiQaSetNeutral(TRUE);
  report.blockedAllNeutral = report.blockedAllNeutral && IsNeutral(PollAll());
  if (report.scenario == "rollback") {
    const DWORD first = observe(kGeneration, release_epoch, 100);
    const DWORD backwards = observe(kGeneration, release_epoch, 90);
    const DWORD too_soon = observe(kGeneration, release_epoch, 139);
    BootstrapSnapshot before_release{};
    snapshot(&before_release, sizeof(before_release));
    report.releaseEvent = observe(kGeneration, release_epoch, 140);
    report.timeRollbackRestartedDwell =
        first == static_cast<DWORD>(FenceEvent::kApplied) &&
        backwards == static_cast<DWORD>(FenceEvent::kApplied) &&
        too_soon == static_cast<DWORD>(FenceEvent::kApplied) &&
        before_release.blockLatched != 0;
  } else {
    const DWORD first = observe(kGeneration, release_epoch, 100);
    report.releaseEvent = observe(kGeneration, release_epoch, 150);
    report.releaseFenceCompleted =
        first == static_cast<DWORD>(FenceEvent::kApplied);
  }
  report.releaseFenceCompleted =
      report.releaseFenceCompleted || report.timeRollbackRestartedDwell;
  report.releaseFenceCompleted =
      report.releaseFenceCompleted &&
      report.releaseEvent == static_cast<DWORD>(FenceEvent::kReleased);

  BootstrapSnapshot released{};
  snapshot(&released, sizeof(released));
  report.activeSnapshotGeneration = released.activeSnapshotGeneration;
  report.publishedSnapshotCount = released.publishedSnapshotCount;
  report.releaseKeptHooks = released.attachedBeforeEntry != 0 &&
                            released.blockLatched == 0 &&
                            released.fencePhase ==
                                static_cast<DWORD>(FencePhase::kReleased);
  GameHubWgiQaSetNeutral(FALSE);
  report.releasedCachedPointersReturnedPhysical = IsPhysical(PollAll());
  if (replacement_arcade != 0) {
    report.replacementRetainedOldAndNewIdentities =
        report.replacementRetainedOldAndNewIdentities &&
        PollArcadeObject(replacement_arcade, false);
  }
  report.detachError = detach();
  report.detachedCachedPointersReturnedPhysical = IsPhysical(PollAll());
  ProviderSnapshot final_provider{};
  report.comReferencesBalanced =
      GameHubWgiQaGetProviderSnapshot(&final_provider,
                                      sizeof(final_provider)) != FALSE &&
      final_provider.transientReferences == 0 &&
      final_provider.addRefCalls == final_provider.releaseCalls &&
      final_provider.addRefCalls != 0 &&
      final_provider.overReleaseAttempts == 0;

  Topology final_topology{};
  GameHubWgiQaGetTopology(&final_topology, sizeof(final_topology));
  report.finalEpoch = final_topology.epoch;
  const bool scenario_specific =
      report.scenario == "normal" ||
      (report.scenario == "rollback" && report.timeRollbackRestartedDwell) ||
      (report.scenario == "invalidation" &&
       report.topologyInvalidationKeptLatch &&
       report.serialRevalidationRequired) ||
      (report.scenario == "replacement" &&
       report.topologyInvalidationKeptLatch &&
       report.serialRevalidationRequired &&
       report.replacementRetainedOldAndNewIdentities &&
       report.unregisteredSameBodyRejected) ||
      (report.scenario == "reader-race" &&
       report.immutableGenerationRacePassed) ||
      (report.scenario == "thread-stress" &&
       report.eightThreadStressPassed) ||
      (IsFaultScenario(report.scenario) &&
       report.malformedRejectedLatched &&
       report.recoveryRequiredExplicitRevalidation &&
       report.unknownInputsRejected);
  report.proofPassed =
      report.bootstrapLoadedBeforeEntry &&
      report.cacheInitializedBeforeBootstrap && report.cacheIdentityValidated &&
      report.cachedBodiesStable && report.hookAttachedBeforeEntry &&
      report.activationBodyIntercepted && report.allSixPollBodiesIntercepted &&
      report.blockedActivationIntercepted &&
      report.preBlockPhysical && report.blockedAllNeutral &&
      report.drainMaskComplete && report.nonNeutralPreventedRelease &&
      report.staleIdentityIgnored && report.releaseFenceCompleted &&
      report.releaseKeptHooks && report.releasedCachedPointersReturnedPhysical &&
      report.detachedCachedPointersReturnedPhysical &&
      report.detachError == ERROR_SUCCESS && report.snapshotCount ==
                                                     kProjectionCount &&
      report.comReferencesBalanced &&
      scenario_specific;
  if (!WriteResult(arguments[2], Serialize(report))) return 22;
  return report.proofPassed ? 0 : 25;
}
