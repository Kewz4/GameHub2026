#include "contract.hpp"

#include <array>
#include <cstring>
#include <sstream>
#include <string>
#include <vector>

namespace {

using namespace gamehub::overlay::directinput_qa;

struct Report {
  bool entryReached = false;
  bool bootstrapLoadedBeforeEntry = false;
  bool cacheInitializedBeforeBootstrap = false;
  bool preAttachPhysicalObserved = false;
  bool exactProviderResolved = false;
  bool hookAttachedBeforeEntry = false;
  bool exactBodiesValidated = false;
  bool cachedFactoryIntercepted = false;
  bool cachedRootBodyIntercepted = false;
  bool rootComIdentityExact = false;
  bool deviceComIdentityExact = false;
  bool refcountsBalanced = false;
  bool customFormatAccepted = false;
  bool malformedFormatRejected = false;
  bool rangeSemanticsPreserved = false;
  bool preBlockPhysicalObserved = false;
  bool blockedKeyboardNeutral = false;
  bool blockedJoystickNeutral = false;
  bool blockedCustomNeutral = false;
  bool blockedPaddingPreserved = false;
  bool blockedQueryAliasNeutral = false;
  bool bufferedDataDrained = false;
  bool pollCoveredWhileLatched = false;
  bool staleIdentityIgnored = false;
  bool nonNeutralPreventedRelease = false;
  bool rollbackRestartedDwell = false;
  bool topologyInvalidationKeptLatch = false;
  bool topologyRevalidatedExactEpoch = false;
  bool releaseFenceCompleted = false;
  bool noStaleDataAfterRelease = false;
  bool releasedCachedPointerPhysical = false;
  bool detachedCachedPointerPhysical = false;
  bool providerObjectsReleased = false;
  bool latePhysicalCallEscaped = false;
  bool lateOnlyBlockedSubsequentCall = false;
  bool unknownFormatFailedClosed = false;
  bool actionMapFailedClosed = false;
  bool eventNotificationFailedClosed = false;
  bool drainFailureFailedClosed = false;
  bool slotTamperFailedClosed = false;
  bool registryExhaustionFailedClosed = false;
  bool registryExhaustionCleanupPassed = false;
  bool rearmRejectedBadAuth = false;
  bool skippedRearmGenerationRejected = false;
  bool skippedRearmEpochRejected = false;
  bool replayedRearmIgnored = false;
  bool staleGenerationRejectedAfterRearm = false;
  bool secondCycleReleased = false;
  bool concurrentHotCallsPassed = false;
  bool detachQuiescencePassed = false;
  bool proofPassed = false;
  DWORD attachError = ERROR_INVALID_STATE;
  DWORD beginEvent = 0;
  DWORD releaseEvent = 0;
  DWORD detachError = ERROR_INVALID_STATE;
  DWORD finalFaultCode = 0;
  std::string scenario;
};

using GetBootstrapFunction = BOOL(WINAPI *)(BootstrapSnapshot *, DWORD);
using BeginFunction = DWORD(WINAPI *)(DWORD, unsigned long long);
using CloseFunction = DWORD(WINAPI *)(DWORD, unsigned long long);
using ObserveFunction = DWORD(WINAPI *)(DWORD, unsigned long long,
                                        unsigned long long);
using InvalidateFunction = DWORD(WINAPI *)(DWORD, unsigned long long);
using RevalidateFunction = DWORD(WINAPI *)(DWORD, unsigned long long);
using RearmFunction = DWORD(WINAPI *)(DWORD, unsigned long long, DWORD,
                                      unsigned long long, unsigned long long);
using DetachFunction = DWORD(WINAPI *)();
using AttachLateFunction = DWORD(WINAPI *)();
using SetHotCallPauseFunction = BOOL(WINAPI *)(BOOL);

struct BootstrapApi {
  GetBootstrapFunction snapshot = nullptr;
  BeginFunction begin = nullptr;
  CloseFunction close = nullptr;
  ObserveFunction observe = nullptr;
  InvalidateFunction invalidate = nullptr;
  RevalidateFunction revalidate = nullptr;
  RearmFunction rearm = nullptr;
  DetachFunction detach = nullptr;
  AttachLateFunction attachLate = nullptr;
  SetHotCallPauseFunction setHotCallPause = nullptr;
};

bool WideEquals(const wchar_t *left, const wchar_t *right) {
  return wcscmp(left, right) == 0;
}

bool WriteResult(const wchar_t *path, const std::string &value) {
  if (value.size() > MAXDWORD)
    return false;
  HANDLE file =
      CreateFileW(path, GENERIC_WRITE, 0, nullptr, CREATE_NEW,
                  FILE_ATTRIBUTE_NORMAL | FILE_FLAG_WRITE_THROUGH, nullptr);
  if (file == INVALID_HANDLE_VALUE)
    return false;
  DWORD written = 0;
  const bool succeeded =
      WriteFile(file, value.data(), static_cast<DWORD>(value.size()), &written,
                nullptr) &&
      written == value.size() && FlushFileBuffers(file);
  CloseHandle(file);
  return succeeded;
}

void AppendBool(std::ostringstream &output, const char *name, bool value,
                bool *first) {
  if (!*first)
    output << ',';
  *first = false;
  output << '\"' << name << "\":" << (value ? "true" : "false");
}

template <typename Value>
void AppendNumber(std::ostringstream &output, const char *name, Value value,
                  bool *first) {
  if (!*first)
    output << ',';
  *first = false;
  output << '\"' << name << "\":" << value;
}

void AppendString(std::ostringstream &output, const char *name,
                  const std::string &value, bool *first) {
  if (!*first)
    output << ',';
  *first = false;
  output << '\"' << name << "\":\"" << value << '\"';
}

std::string Serialize(const Report &report) {
  std::ostringstream output;
  output << '{';
  bool first = true;
  AppendNumber(output, "schemaVersion", kSchemaVersion, &first);
  AppendString(output, "scenario", report.scenario, &first);
#define APPEND_BOOL(Field) AppendBool(output, #Field, report.Field, &first)
  APPEND_BOOL(entryReached);
  APPEND_BOOL(bootstrapLoadedBeforeEntry);
  APPEND_BOOL(cacheInitializedBeforeBootstrap);
  APPEND_BOOL(preAttachPhysicalObserved);
  APPEND_BOOL(exactProviderResolved);
  APPEND_BOOL(hookAttachedBeforeEntry);
  APPEND_BOOL(exactBodiesValidated);
  APPEND_BOOL(cachedFactoryIntercepted);
  APPEND_BOOL(cachedRootBodyIntercepted);
  APPEND_BOOL(rootComIdentityExact);
  APPEND_BOOL(deviceComIdentityExact);
  APPEND_BOOL(refcountsBalanced);
  APPEND_BOOL(customFormatAccepted);
  APPEND_BOOL(malformedFormatRejected);
  APPEND_BOOL(rangeSemanticsPreserved);
  APPEND_BOOL(preBlockPhysicalObserved);
  APPEND_BOOL(blockedKeyboardNeutral);
  APPEND_BOOL(blockedJoystickNeutral);
  APPEND_BOOL(blockedCustomNeutral);
  APPEND_BOOL(blockedPaddingPreserved);
  APPEND_BOOL(blockedQueryAliasNeutral);
  APPEND_BOOL(bufferedDataDrained);
  APPEND_BOOL(pollCoveredWhileLatched);
  APPEND_BOOL(staleIdentityIgnored);
  APPEND_BOOL(nonNeutralPreventedRelease);
  APPEND_BOOL(rollbackRestartedDwell);
  APPEND_BOOL(topologyInvalidationKeptLatch);
  APPEND_BOOL(topologyRevalidatedExactEpoch);
  APPEND_BOOL(releaseFenceCompleted);
  APPEND_BOOL(noStaleDataAfterRelease);
  APPEND_BOOL(releasedCachedPointerPhysical);
  APPEND_BOOL(detachedCachedPointerPhysical);
  APPEND_BOOL(providerObjectsReleased);
  APPEND_BOOL(latePhysicalCallEscaped);
  APPEND_BOOL(lateOnlyBlockedSubsequentCall);
  APPEND_BOOL(unknownFormatFailedClosed);
  APPEND_BOOL(actionMapFailedClosed);
  APPEND_BOOL(eventNotificationFailedClosed);
  APPEND_BOOL(drainFailureFailedClosed);
  APPEND_BOOL(slotTamperFailedClosed);
  APPEND_BOOL(registryExhaustionFailedClosed);
  APPEND_BOOL(registryExhaustionCleanupPassed);
  APPEND_BOOL(rearmRejectedBadAuth);
  APPEND_BOOL(skippedRearmGenerationRejected);
  APPEND_BOOL(skippedRearmEpochRejected);
  APPEND_BOOL(replayedRearmIgnored);
  APPEND_BOOL(staleGenerationRejectedAfterRearm);
  APPEND_BOOL(secondCycleReleased);
  APPEND_BOOL(concurrentHotCallsPassed);
  APPEND_BOOL(detachQuiescencePassed);
  APPEND_BOOL(proofPassed);
#undef APPEND_BOOL
  AppendNumber(output, "attachError", report.attachError, &first);
  AppendNumber(output, "beginEvent", report.beginEvent, &first);
  AppendNumber(output, "releaseEvent", report.releaseEvent, &first);
  AppendNumber(output, "detachError", report.detachError, &first);
  AppendNumber(output, "finalFaultCode", report.finalFaultCode, &first);
  output << "}\n";
  return output.str();
}

template <typename Function>
Function Resolve(HMODULE module, const char *name) {
  return module == nullptr
             ? nullptr
             : reinterpret_cast<Function>(GetProcAddress(module, name));
}

bool ResolveBootstrap(HMODULE module, BootstrapApi *api) {
  api->snapshot =
      Resolve<GetBootstrapFunction>(module, "GameHubDiQaGetBootstrapSnapshot");
  api->begin = Resolve<BeginFunction>(module, "GameHubDiQaBeginBlock");
  api->close = Resolve<CloseFunction>(module, "GameHubDiQaRequestClose");
  api->observe = Resolve<ObserveFunction>(module, "GameHubDiQaObserveRelease");
  api->invalidate =
      Resolve<InvalidateFunction>(module, "GameHubDiQaInvalidateTopology");
  api->revalidate =
      Resolve<RevalidateFunction>(module, "GameHubDiQaRevalidate");
  api->rearm = Resolve<RearmFunction>(module, "GameHubDiQaRearm");
  api->detach = Resolve<DetachFunction>(module, "GameHubDiQaDetach");
  api->attachLate = Resolve<AttachLateFunction>(
      module, "GameHubDiQaAttachLateForNegativeControl");
  api->setHotCallPause = Resolve<SetHotCallPauseFunction>(
      module, "GameHubDiQaSetHotCallPauseForStress");
  return api->snapshot != nullptr && api->begin != nullptr &&
         api->close != nullptr && api->observe != nullptr &&
         api->invalidate != nullptr && api->revalidate != nullptr &&
         api->rearm != nullptr && api->detach != nullptr &&
         api->attachLate != nullptr && api->setHotCallPause != nullptr;
}

bool KeyboardPhysical(const std::array<BYTE, 256> &state) {
  for (BYTE value : state) {
    if (value != 0x80u)
      return false;
  }
  return true;
}

bool KeyboardNeutral(const std::array<BYTE, 256> &state) {
  for (BYTE value : state) {
    if (value != 0u)
      return false;
  }
  return true;
}

bool JoystickPhysical(const DIJOYSTATE2 &state) {
  return state.lX == kPreAttachAxisMinimum && state.lY == -1000 &&
         state.rgdwPOV[0] == 9000u && state.rgbButtons[0] == 0x80u;
}

bool JoystickNeutral(const DIJOYSTATE2 &state) {
  if (state.lX != kPreAttachAxisMidpoint || state.lY != 0 || state.lZ != 0 ||
      state.lRx != 0 || state.lRy != 0 || state.lRz != 0 ||
      state.rglSlider[0] != 0 || state.rglSlider[1] != 0) {
    return false;
  }
  for (DWORD pov : state.rgdwPOV) {
    if (pov != 0xffffffffu)
      return false;
  }
  for (BYTE button : state.rgbButtons) {
    if (button != 0u)
      return false;
  }
  const LONG extended[] = {
      state.lVX,  state.lVY,  state.lVZ,           state.lVRx,
      state.lVRy, state.lVRz, state.rglVSlider[0], state.rglVSlider[1],
      state.lAX,  state.lAY,  state.lAZ,           state.lARx,
      state.lARy, state.lARz, state.rglASlider[0], state.rglASlider[1],
      state.lFX,  state.lFY,  state.lFZ,           state.lFRx,
      state.lFRy, state.lFRz, state.rglFSlider[0], state.rglFSlider[1]};
  for (LONG value : extended) {
    if (value != 0)
      return false;
  }
  return true;
}

struct CustomState {
  BYTE button;
  BYTE padding[3];
  LONG axis;
  DWORD pov;
};

static_assert(sizeof(CustomState) == 12);

std::array<DIOBJECTDATAFORMAT, 3> CustomObjects() {
  return {{{&GUID_Button, static_cast<DWORD>(offsetof(CustomState, button)),
            DIDFT_BUTTON | DIDFT_MAKEINSTANCE(0), 0},
           {&GUID_XAxis, static_cast<DWORD>(offsetof(CustomState, axis)),
            DIDFT_RELAXIS | DIDFT_MAKEINSTANCE(0), 0},
           {&GUID_POV, static_cast<DWORD>(offsetof(CustomState, pov)),
            DIDFT_POV | DIDFT_MAKEINSTANCE(0), 0}}};
}

DIDATAFORMAT CustomFormat(std::array<DIOBJECTDATAFORMAT, 3> *objects) noexcept {
  return {sizeof(DIDATAFORMAT),
          sizeof(DIOBJECTDATAFORMAT),
          DIDF_RELAXIS,
          sizeof(CustomState),
          static_cast<DWORD>(objects->size()),
          objects->data()};
}

bool CustomPhysical(const CustomState &state) {
  return state.button == 0x80u && state.axis == 111 && state.pov == 9000u;
}

bool CustomNeutral(const CustomState &state) {
  return state.button == 0u && state.axis == 0 && state.pov == 0xffffffffu;
}

bool RootIdentity(IDirectInput8A *root) {
  IUnknown *unknown_a = nullptr;
  IDirectInput8W *wide = nullptr;
  IUnknown *unknown_w = nullptr;
  const bool queried =
      root->lpVtbl->QueryInterface(
          root, IID_IUnknown, reinterpret_cast<void **>(&unknown_a)) == S_OK &&
      root->lpVtbl->QueryInterface(root, IID_IDirectInput8W,
                                   reinterpret_cast<void **>(&wide)) == S_OK &&
      wide != nullptr &&
      wide->lpVtbl->QueryInterface(
          wide, IID_IUnknown, reinterpret_cast<void **>(&unknown_w)) == S_OK;
  const bool identity = queried && unknown_a == unknown_w &&
                        unknown_a == reinterpret_cast<IUnknown *>(root);
  if (unknown_w != nullptr)
    unknown_w->lpVtbl->Release(unknown_w);
  if (wide != nullptr)
    wide->lpVtbl->Release(wide);
  if (unknown_a != nullptr)
    unknown_a->lpVtbl->Release(unknown_a);
  return identity;
}

bool DeviceIdentity(IDirectInputDevice8A *device,
                    IDirectInputDevice8W **retained_alias) {
  IUnknown *unknown_a = nullptr;
  IDirectInputDevice8W *wide = nullptr;
  IUnknown *unknown_w = nullptr;
  const bool queried =
      device->lpVtbl->QueryInterface(device, IID_IUnknown,
                                     reinterpret_cast<void **>(&unknown_a)) ==
          S_OK &&
      device->lpVtbl->QueryInterface(device, IID_IDirectInputDevice8W,
                                     reinterpret_cast<void **>(&wide)) ==
          S_OK &&
      wide != nullptr &&
      wide->lpVtbl->QueryInterface(
          wide, IID_IUnknown, reinterpret_cast<void **>(&unknown_w)) == S_OK;
  const bool identity = queried && unknown_a == unknown_w &&
                        unknown_a == reinterpret_cast<IUnknown *>(device);
  if (unknown_w != nullptr)
    unknown_w->lpVtbl->Release(unknown_w);
  if (unknown_a != nullptr)
    unknown_a->lpVtbl->Release(unknown_a);
  if (identity) {
    *retained_alias = wide;
  } else if (wide != nullptr) {
    wide->lpVtbl->Release(wide);
  }
  return identity;
}

bool ExactRefcountRoundTrip(IDirectInputDevice8A *device) {
  ProviderSnapshot before{};
  ProviderSnapshot after{};
  if (!GameHubDiQaGetProviderSnapshot(&before, sizeof(before)))
    return false;
  const ULONG after_add = device->lpVtbl->AddRef(device);
  const ULONG after_release = device->lpVtbl->Release(device);
  if (!GameHubDiQaGetProviderSnapshot(&after, sizeof(after)))
    return false;
  return after_add == after_release + 1u &&
         before.totalReferences == after.totalReferences;
}

bool FinalizeRelease(const BootstrapApi &api, DWORD generation,
                     unsigned long long epoch, Report *report,
                     bool record_first_cycle_checks) {
  const bool stale_ignored = api.close(generation ^ 0x40000000u, epoch) ==
                             static_cast<DWORD>(FenceEvent::kIgnoredStale);
  if (record_first_cycle_checks)
    report->staleIdentityIgnored = stale_ignored;
  if (!stale_ignored || api.close(generation, epoch) !=
                            static_cast<DWORD>(FenceEvent::kApplied)) {
    return false;
  }
  GameHubDiQaSetPhysical(FALSE, 2, DI_OK);
  const bool non_neutral_prevented = api.observe(generation, epoch, 0) ==
                                     static_cast<DWORD>(FenceEvent::kApplied);
  if (record_first_cycle_checks)
    report->nonNeutralPreventedRelease = non_neutral_prevented;
  GameHubDiQaSetPhysical(TRUE, 0, DI_OK);
  if (!non_neutral_prevented || api.observe(generation, epoch, 0) !=
                                    static_cast<DWORD>(FenceEvent::kApplied)) {
    return false;
  }
  const DWORD release_event = api.observe(generation, epoch, 50);
  if (record_first_cycle_checks)
    report->releaseEvent = release_event;
  return release_event == static_cast<DWORD>(FenceEvent::kReleased);
}

struct HotCallRace;

struct HotCallWorkerContext {
  HotCallRace *race = nullptr;
  DWORD index = 0;
};

struct HotCallRace {
  IDirectInputDevice8A *keyboard = nullptr;
  IDirectInputDevice8W *joystick = nullptr;
  HANDLE startEvent = nullptr;
  std::array<HANDLE, 4> threads{};
  std::array<HotCallWorkerContext, 4> contexts{};
  volatile LONG stop = 0;
  volatile LONG iterations = 0;
  volatile LONG threadIterations[4]{};
  volatile LONG failures = 0;
  volatile LONG physicalReads = 0;
  volatile LONG neutralReads = 0;
};

DWORD WINAPI HotCallWorker(void *parameter) {
  auto *context = static_cast<HotCallWorkerContext *>(parameter);
  HotCallRace *race = context->race;
  if (WaitForSingleObject(race->startEvent, 5000) != WAIT_OBJECT_0) {
    InterlockedIncrement(&race->failures);
    return 1;
  }
  while (InterlockedCompareExchange(&race->stop, 0, 0) == 0) {
    std::array<BYTE, 256> state{};
    state.fill(0x5a);
    const HRESULT state_result = race->keyboard->lpVtbl->GetDeviceState(
        race->keyboard, static_cast<DWORD>(state.size()), state.data());
    const HRESULT poll_result = race->joystick->lpVtbl->Poll(race->joystick);
    if (state_result != DI_OK || poll_result != DI_OK) {
      InterlockedIncrement(&race->failures);
    } else if (KeyboardPhysical(state)) {
      InterlockedIncrement(&race->physicalReads);
    } else if (KeyboardNeutral(state)) {
      InterlockedIncrement(&race->neutralReads);
    } else {
      InterlockedIncrement(&race->failures);
    }
    InterlockedIncrement(&race->iterations);
    InterlockedIncrement(&race->threadIterations[context->index]);
    SwitchToThread();
  }
  return 0;
}

bool WaitForCounter(volatile LONG *counter, LONG minimum,
                    DWORD timeout_ms = 5000) {
  const ULONGLONG deadline = GetTickCount64() + timeout_ms;
  while (GetTickCount64() < deadline) {
    if (InterlockedCompareExchange(counter, 0, 0) >= minimum)
      return true;
    Sleep(1);
  }
  return InterlockedCompareExchange(counter, 0, 0) >= minimum;
}

bool StartHotCallRace(HotCallRace *race) {
  race->startEvent = CreateEventW(nullptr, TRUE, FALSE, nullptr);
  if (race->startEvent == nullptr)
    return false;
  std::size_t created = 0;
  for (; created < race->threads.size(); ++created) {
    race->contexts[created].race = race;
    race->contexts[created].index = static_cast<DWORD>(created);
    race->threads[created] = CreateThread(nullptr, 0, HotCallWorker,
                                          &race->contexts[created], 0, nullptr);
    if (race->threads[created] == nullptr)
      break;
  }
  if (created != race->threads.size()) {
    InterlockedExchange(&race->stop, 1);
    SetEvent(race->startEvent);
    for (std::size_t index = 0; index < created; ++index) {
      WaitForSingleObject(race->threads[index], 5000);
      CloseHandle(race->threads[index]);
      race->threads[index] = nullptr;
    }
    CloseHandle(race->startEvent);
    race->startEvent = nullptr;
    return false;
  }
  return SetEvent(race->startEvent) != FALSE;
}

bool WaitForInFlight(const BootstrapApi &api, DWORD minimum) {
  const ULONGLONG deadline = GetTickCount64() + 5000u;
  while (GetTickCount64() < deadline) {
    BootstrapSnapshot snapshot{};
    if (api.snapshot(&snapshot, sizeof(snapshot)) &&
        snapshot.inFlightHookCalls >= minimum) {
      return true;
    }
    Sleep(1);
  }
  return false;
}

std::array<LONG, 4> ReadThreadIterations(HotCallRace &race) {
  std::array<LONG, 4> values{};
  for (std::size_t index = 0; index < values.size(); ++index) {
    values[index] =
        InterlockedCompareExchange(&race.threadIterations[index], 0, 0);
  }
  return values;
}

bool WaitForEachThreadProgress(HotCallRace &race,
                               const std::array<LONG, 4> &baseline,
                               LONG additional) {
  const ULONGLONG deadline = GetTickCount64() + 5000u;
  while (GetTickCount64() < deadline) {
    const auto current = ReadThreadIterations(race);
    bool reached = true;
    for (std::size_t index = 0; index < current.size(); ++index) {
      if (current[index] < baseline[index] + additional) {
        reached = false;
        break;
      }
    }
    if (reached)
      return true;
    Sleep(1);
  }
  const auto current = ReadThreadIterations(race);
  for (std::size_t index = 0; index < current.size(); ++index) {
    if (current[index] < baseline[index] + additional)
      return false;
  }
  return true;
}

bool StopHotCallRace(HotCallRace *race) {
  InterlockedExchange(&race->stop, 1);
  bool stopped = true;
  for (HANDLE thread : race->threads) {
    if (thread == nullptr)
      continue;
    stopped = WaitForSingleObject(thread, 5000) == WAIT_OBJECT_0 && stopped;
    CloseHandle(thread);
  }
  if (race->startEvent != nullptr)
    CloseHandle(race->startEvent);
  return stopped;
}

int RunLateNegative(const wchar_t *result_path, Report *report,
                    const CacheSnapshot &cache) {
  std::array<BYTE, 256> physical{};
  report->latePhysicalCallEscaped =
      GameHubDiQaGetDeviceA()->lpVtbl->GetDeviceState(
          GameHubDiQaGetDeviceA(), static_cast<DWORD>(physical.size()),
          physical.data()) == DI_OK &&
      KeyboardPhysical(physical);
  HMODULE bootstrap = LoadLibraryW(kBootstrapModuleName);
  BootstrapApi api{};
  if (bootstrap == nullptr || !ResolveBootstrap(bootstrap, &api))
    return 23;
  if (api.attachLate() != ERROR_SUCCESS)
    return 24;
  BootstrapSnapshot snapshot{};
  api.snapshot(&snapshot, sizeof(snapshot));
  report->attachError = static_cast<DWORD>(snapshot.attachError);
  report->beginEvent = api.begin(kGeneration, kTopologyEpoch);
  std::array<BYTE, 256> blocked{};
  blocked.fill(0x5a);
  report->lateOnlyBlockedSubsequentCall =
      report->beginEvent == static_cast<DWORD>(FenceEvent::kApplied) &&
      GameHubDiQaGetDeviceA()->lpVtbl->GetDeviceState(
          GameHubDiQaGetDeviceA(), static_cast<DWORD>(blocked.size()),
          blocked.data()) == DI_OK &&
      KeyboardNeutral(blocked) && cache.preAttachPhysicalObserved == 1u;
  FinalizeRelease(api, kGeneration, kTopologyEpoch, report, true);
  report->detachError = api.detach();
  GameHubDiQaReleaseAll();
  report->proofPassed = false;
  return WriteResult(result_path, Serialize(*report)) ? 31 : 22;
}

int RunUnsupportedNegative(const wchar_t *result_path, Report *report,
                           const BootstrapApi &api,
                           IDirectInputDevice8A *device) {
  if (report->scenario == "unknown") {
    GUID unknown = GUID_Unknown;
    DIOBJECTDATAFORMAT object{&unknown, 0, DIDFT_BUTTON | DIDFT_MAKEINSTANCE(0),
                              0};
    DIDATAFORMAT format{sizeof(DIDATAFORMAT),
                        sizeof(DIOBJECTDATAFORMAT),
                        DIDF_RELAXIS,
                        1,
                        1,
                        &object};
    const HRESULT set_result = device->lpVtbl->SetDataFormat(device, &format);
    report->unknownFormatFailedClosed =
        set_result == DI_OK && api.begin(kGeneration, kTopologyEpoch) ==
                                   static_cast<DWORD>(FenceEvent::kRejected);
  } else if (report->scenario == "action") {
    GameHubDiQaSetActionMapResult(DIERR_UNSUPPORTED);
    const HRESULT action_result =
        device->lpVtbl->SetActionMap(device, nullptr, nullptr, 0);
    report->actionMapFailedClosed =
        action_result == DIERR_UNSUPPORTED &&
        api.begin(kGeneration, kTopologyEpoch) ==
            static_cast<DWORD>(FenceEvent::kRejected);
  } else if (report->scenario == "event") {
    const HRESULT event_result =
        device->lpVtbl->SetEventNotification(device, nullptr);
    report->eventNotificationFailedClosed =
        event_result == DI_OK && api.begin(kGeneration, kTopologyEpoch) ==
                                     static_cast<DWORD>(FenceEvent::kRejected);
  } else {
    GameHubDiQaSetPhysical(FALSE, kInitialQueuedEvents, DIERR_INPUTLOST);
    report->drainFailureFailedClosed =
        api.begin(kGeneration, kTopologyEpoch) ==
        static_cast<DWORD>(FenceEvent::kRejected);
  }
  BootstrapSnapshot after{};
  api.snapshot(&after, sizeof(after));
  report->finalFaultCode = after.faultCode;
  report->detachError = api.detach();
  GameHubDiQaReleaseAll();
  report->proofPassed = false;
  const int exit_code = report->scenario == "unknown"  ? 41
                        : report->scenario == "action" ? 42
                        : report->scenario == "event"  ? 43
                                                       : 44;
  return WriteResult(result_path, Serialize(*report)) ? exit_code : 22;
}

int RunSafetyNegative(const wchar_t *result_path, Report *report,
                      const BootstrapApi &api) {
  BootstrapSnapshot after{};
  bool registry_records_released = false;
  int exit_code = 22;
  if (report->scenario == "slot-tamper") {
    const BOOL tampered = GameHubDiQaTamperPollSlotForNegativeControl(FALSE);
    const DWORD begin = api.begin(kGeneration, kTopologyEpoch);
    const BOOL restored = GameHubDiQaTamperPollSlotForNegativeControl(TRUE);
    api.snapshot(&after, sizeof(after));
    report->slotTamperFailedClosed =
        tampered && restored &&
        begin == static_cast<DWORD>(FenceEvent::kRejected) &&
        after.faultCode == static_cast<DWORD>(FaultCode::kBodyTopology) &&
        after.blockLatched == 0u && after.readinessValid == 0u;
    exit_code = 45;
  } else {
    std::array<IDirectInputDevice8A *, 4> devices_a{};
    std::array<IDirectInputDevice8W *, 4> devices_w{};
    bool created_all = true;
    IDirectInput8A *root_a = GameHubDiQaGetRootA();
    IDirectInput8W *root_w = GameHubDiQaGetRootW();
    for (std::size_t index = 0; index < devices_a.size(); ++index) {
      created_all =
          created_all &&
          root_a->lpVtbl->CreateDevice(root_a, GUID_SysMouse, &devices_a[index],
                                       nullptr) == DI_OK &&
          devices_a[index] != nullptr &&
          root_w->lpVtbl->CreateDevice(root_w, GUID_Joystick, &devices_w[index],
                                       nullptr) == DI_OK &&
          devices_w[index] != nullptr;
    }
    HRESULT acquire_a = DIERR_GENERIC;
    HRESULT unacquire_a = DIERR_GENERIC;
    HRESULT acquire_w = DIERR_GENERIC;
    HRESULT unacquire_w = DIERR_GENERIC;
    if (created_all) {
      acquire_a = devices_a.back()->lpVtbl->Acquire(devices_a.back());
      unacquire_a = devices_a.back()->lpVtbl->Unacquire(devices_a.back());
      acquire_w = devices_w.back()->lpVtbl->Acquire(devices_w.back());
      unacquire_w = devices_w.back()->lpVtbl->Unacquire(devices_w.back());
    }
    const DWORD begin = api.begin(kGeneration, kTopologyEpoch);
    api.snapshot(&after, sizeof(after));
    report->registryExhaustionFailedClosed =
        created_all && acquire_a == DIERR_UNSUPPORTED &&
        unacquire_a == DIERR_UNSUPPORTED && acquire_w == DIERR_UNSUPPORTED &&
        unacquire_w == DIERR_UNSUPPORTED &&
        begin == static_cast<DWORD>(FenceEvent::kRejected) &&
        after.faultCode == static_cast<DWORD>(FaultCode::kRegistryFull) &&
        after.registeredDeviceObjects == kMaxTrackedDevices &&
        after.blockLatched == 0u && after.readinessValid == 0u;
    for (IDirectInputDevice8A *device : devices_a) {
      if (device != nullptr)
        device->lpVtbl->Release(device);
    }
    for (IDirectInputDevice8W *device : devices_w) {
      if (device != nullptr)
        device->lpVtbl->Release(device);
    }
    BootstrapSnapshot after_device_cleanup{};
    ProviderSnapshot provider_after_device_cleanup{};
    registry_records_released =
        api.snapshot(&after_device_cleanup, sizeof(after_device_cleanup)) &&
        GameHubDiQaGetProviderSnapshot(&provider_after_device_cleanup,
                                       sizeof(provider_after_device_cleanup)) &&
        after_device_cleanup.registeredDeviceObjects == 2u &&
        after_device_cleanup.queryInterfaceBalanced == 1u &&
        provider_after_device_cleanup.liveRootObjects == 2u &&
        provider_after_device_cleanup.liveDeviceObjects == 2u &&
        provider_after_device_cleanup.totalReferences == 4u;
    exit_code = 46;
  }
  report->finalFaultCode = after.faultCode;
  report->detachError = api.detach();
  const BOOL released_all = GameHubDiQaReleaseAll();
  ProviderSnapshot final_provider{};
  const BOOL final_snapshot =
      GameHubDiQaGetProviderSnapshot(&final_provider, sizeof(final_provider));
  if (report->scenario == "registry-exhaustion") {
    report->registryExhaustionCleanupPassed =
        registry_records_released && released_all && final_snapshot &&
        final_provider.liveRootObjects == 0u &&
        final_provider.liveDeviceObjects == 0u &&
        final_provider.totalReferences == 0u;
  }
  report->proofPassed = false;
  return WriteResult(result_path, Serialize(*report)) ? exit_code : 22;
}

} // namespace

int wmain(int argument_count, wchar_t **arguments) {
  if (argument_count != 5 || wcscmp(arguments[1], L"--result") != 0 ||
      wcscmp(arguments[3], L"--scenario") != 0) {
    return 20;
  }
  Report report{};
  report.entryReached = true;
  if (WideEquals(arguments[4], L"normal")) {
    report.scenario = "normal";
  } else if (WideEquals(arguments[4], L"rollback")) {
    report.scenario = "rollback";
  } else if (WideEquals(arguments[4], L"invalidation")) {
    report.scenario = "invalidation";
  } else if (WideEquals(arguments[4], L"malformed")) {
    report.scenario = "malformed";
  } else if (WideEquals(arguments[4], L"unknown")) {
    report.scenario = "unknown";
  } else if (WideEquals(arguments[4], L"action")) {
    report.scenario = "action";
  } else if (WideEquals(arguments[4], L"event")) {
    report.scenario = "event";
  } else if (WideEquals(arguments[4], L"drain")) {
    report.scenario = "drain";
  } else if (WideEquals(arguments[4], L"slot-tamper")) {
    report.scenario = "slot-tamper";
  } else if (WideEquals(arguments[4], L"registry-exhaustion")) {
    report.scenario = "registry-exhaustion";
  } else if (WideEquals(arguments[4], L"late")) {
    report.scenario = "late";
  } else if (WideEquals(arguments[4], L"hang")) {
    report.scenario = "hang";
  } else {
    return 20;
  }
  if (report.scenario == "hang") {
    Sleep(INFINITE);
    return 99;
  }

  CacheSnapshot cache{};
  if (!GameHubDiQaGetCacheSnapshot(&cache, sizeof(cache)))
    return 21;
  report.cacheInitializedBeforeBootstrap =
      cache.initializedBeforeBootstrap == 1u;
  report.preAttachPhysicalObserved = cache.preAttachPhysicalObserved == 1u;
  report.exactProviderResolved = cache.exactProviderResolved == 1u;
  HMODULE bootstrap = GetModuleHandleW(kBootstrapModuleName);
  report.bootstrapLoadedBeforeEntry = bootstrap != nullptr;
  if (report.scenario == "late") {
    return RunLateNegative(arguments[2], &report, cache);
  }
  if (bootstrap == nullptr) {
    std::array<BYTE, 256> physical{};
    report.preBlockPhysicalObserved =
        GameHubDiQaGetDeviceA()->lpVtbl->GetDeviceState(
            GameHubDiQaGetDeviceA(), static_cast<DWORD>(physical.size()),
            physical.data()) == DI_OK &&
        KeyboardPhysical(physical);
    report.proofPassed = false;
    GameHubDiQaReleaseAll();
    return WriteResult(arguments[2], Serialize(report)) ? 30 : 22;
  }

  BootstrapApi api{};
  if (!ResolveBootstrap(bootstrap, &api))
    return 23;
  BootstrapSnapshot bootstrap_before{};
  if (!api.snapshot(&bootstrap_before, sizeof(bootstrap_before)))
    return 24;
  report.attachError = static_cast<DWORD>(bootstrap_before.attachError);
  report.hookAttachedBeforeEntry =
      bootstrap_before.restoreAfterWithSucceeded == 1u &&
      bootstrap_before.attachedBeforeEntry == 1u &&
      bootstrap_before.attachError == ERROR_SUCCESS;
  report.exactBodiesValidated = bootstrap_before.exactProviderValidated == 1u &&
                                bootstrap_before.exactBodiesValidated == 1u &&
                                bootstrap_before.formatRegistryValid == 1u;

  IDirectInputDevice8A *keyboard = GameHubDiQaGetDeviceA();
  IDirectInputDevice8W *joystick = GameHubDiQaGetDeviceW();
  if (report.scenario == "slot-tamper" ||
      report.scenario == "registry-exhaustion") {
    return RunSafetyNegative(arguments[2], &report, api);
  }
  if (report.scenario == "unknown" || report.scenario == "action" ||
      report.scenario == "event" || report.scenario == "drain") {
    return RunUnsupportedNegative(arguments[2], &report, api, keyboard);
  }

  DIOBJECTDATAFORMAT malformed_objects[2] = {
      {&GUID_Button, 0, DIDFT_BUTTON | DIDFT_MAKEINSTANCE(0), 0},
      {&GUID_XAxis, 0, DIDFT_RELAXIS | DIDFT_MAKEINSTANCE(0), 0}};
  DIDATAFORMAT malformed{
      sizeof(DIDATAFORMAT), sizeof(DIOBJECTDATAFORMAT), DIDF_RELAXIS, 8, 2,
      malformed_objects};
  report.malformedFormatRejected =
      keyboard->lpVtbl->SetDataFormat(keyboard, &malformed) ==
      DIERR_INVALIDPARAM;
  if (report.scenario == "malformed") {
    report.detachError = api.detach();
    GameHubDiQaReleaseAll();
    report.proofPassed = false;
    return WriteResult(arguments[2], Serialize(report)) ? 40 : 22;
  }

  ProviderSnapshot refs_before{};
  GameHubDiQaGetProviderSnapshot(&refs_before, sizeof(refs_before));
  IDirectInput8A *factory_root = nullptr;
  const auto cached_factory =
      reinterpret_cast<DirectInput8CreateFunction>(cache.factoryBody);
  report.cachedFactoryIntercepted =
      cached_factory(
          GetModuleHandleW(nullptr), DIRECTINPUT_VERSION, IID_IDirectInput8A,
          reinterpret_cast<void **>(&factory_root), nullptr) == DI_OK &&
      factory_root != nullptr;
  report.rootComIdentityExact =
      report.cachedFactoryIntercepted && RootIdentity(factory_root);

  IDirectInputDevice8A *custom_device = nullptr;
  report.cachedRootBodyIntercepted =
      factory_root->lpVtbl->CreateDevice(factory_root, GUID_SysMouse,
                                         &custom_device, nullptr) == DI_OK &&
      custom_device != nullptr;
  auto custom_objects = CustomObjects();
  DIDATAFORMAT custom_format = CustomFormat(&custom_objects);
  report.customFormatAccepted =
      report.cachedRootBodyIntercepted &&
      custom_device->lpVtbl->SetDataFormat(custom_device, &custom_format) ==
          DI_OK &&
      custom_device->lpVtbl->SetCooperativeLevel(
          custom_device, GetDesktopWindow(),
          DISCL_BACKGROUND | DISCL_NONEXCLUSIVE) == DI_OK &&
      custom_device->lpVtbl->Acquire(custom_device) == DI_OK;

  IDirectInputDevice8W *keyboard_alias = nullptr;
  report.deviceComIdentityExact = DeviceIdentity(keyboard, &keyboard_alias) &&
                                  ExactRefcountRoundTrip(keyboard);
  report.refcountsBalanced = report.deviceComIdentityExact;
  report.rangeSemanticsPreserved = bootstrap_before.recoveredAxisRanges == 32u;
  GameHubDiQaSetPhysical(FALSE, kInitialQueuedEvents, DI_OK);
  std::array<BYTE, 256> physical_keyboard{};
  DIJOYSTATE2 physical_joystick{};
  CustomState physical_custom{};
  report.preBlockPhysicalObserved =
      keyboard->lpVtbl->GetDeviceState(
          keyboard, static_cast<DWORD>(physical_keyboard.size()),
          physical_keyboard.data()) == DI_OK &&
      joystick->lpVtbl->GetDeviceState(joystick, sizeof(physical_joystick),
                                       &physical_joystick) == DI_OK &&
      custom_device->lpVtbl->GetDeviceState(
          custom_device, sizeof(physical_custom), &physical_custom) == DI_OK &&
      KeyboardPhysical(physical_keyboard) &&
      JoystickPhysical(physical_joystick) && CustomPhysical(physical_custom);

  report.beginEvent = api.begin(kGeneration, kTopologyEpoch);
  std::array<BYTE, 256> blocked_keyboard{};
  blocked_keyboard.fill(0x5a);
  DIJOYSTATE2 blocked_joystick{};
  std::memset(&blocked_joystick, 0x5a, sizeof(blocked_joystick));
  CustomState blocked_custom{};
  std::memset(&blocked_custom, 0x5a, sizeof(blocked_custom));
  report.blockedKeyboardNeutral =
      report.beginEvent == static_cast<DWORD>(FenceEvent::kApplied) &&
      keyboard->lpVtbl->GetDeviceState(
          keyboard, static_cast<DWORD>(blocked_keyboard.size()),
          blocked_keyboard.data()) == DI_OK &&
      KeyboardNeutral(blocked_keyboard);
  report.blockedJoystickNeutral =
      joystick->lpVtbl->GetDeviceState(joystick, sizeof(blocked_joystick),
                                       &blocked_joystick) == DI_OK &&
      JoystickNeutral(blocked_joystick);
  report.blockedCustomNeutral =
      custom_device->lpVtbl->GetDeviceState(
          custom_device, sizeof(blocked_custom), &blocked_custom) == DI_OK &&
      CustomNeutral(blocked_custom);
  report.blockedPaddingPreserved = blocked_custom.padding[0] == 0x5a &&
                                   blocked_custom.padding[1] == 0x5a &&
                                   blocked_custom.padding[2] == 0x5a;
  std::array<BYTE, 256> alias_state{};
  alias_state.fill(0x5a);
  report.blockedQueryAliasNeutral =
      keyboard_alias != nullptr &&
      keyboard_alias->lpVtbl->GetDeviceState(
          keyboard_alias, static_cast<DWORD>(alias_state.size()),
          alias_state.data()) == DI_OK &&
      KeyboardNeutral(alias_state);

  GameHubDiQaSetPhysical(FALSE, 4, DI_OK);
  std::array<DIDEVICEOBJECTDATA, 4> events{};
  for (auto &event : events)
    event.dwData = 0xfeedbeefu;
  DWORD event_count = static_cast<DWORD>(events.size());
  const HRESULT data_result =
      keyboard->lpVtbl->GetDeviceData(keyboard, sizeof(DIDEVICEOBJECTDATA),
                                      events.data(), &event_count, DIGDD_PEEK);
  ProviderSnapshot after_drain{};
  GameHubDiQaGetProviderSnapshot(&after_drain, sizeof(after_drain));
  report.bufferedDataDrained = data_result == DI_OK && event_count == 0u &&
                               events[0].dwData == 0xfeedbeefu &&
                               after_drain.queuedEvents == 0u;
  const DWORD poll_before = after_drain.pollGeneration;
  const HRESULT poll_result = joystick->lpVtbl->Poll(joystick);
  ProviderSnapshot after_poll{};
  GameHubDiQaGetProviderSnapshot(&after_poll, sizeof(after_poll));
  report.pollCoveredWhileLatched =
      poll_result == DI_OK && after_poll.pollGeneration == poll_before + 1u;

  unsigned long long release_epoch = kTopologyEpoch;
  if (report.scenario == "rollback") {
    api.close(kGeneration, release_epoch);
    GameHubDiQaSetPhysical(TRUE, 0, DI_OK);
    api.observe(kGeneration, release_epoch, 100);
    api.observe(kGeneration, release_epoch, 50);
    BootstrapSnapshot rolled_back{};
    api.snapshot(&rolled_back, sizeof(rolled_back));
    report.rollbackRestartedDwell =
        rolled_back.neutralSamples == 1u && rolled_back.neutralSinceMs == 50u;
    report.releaseEvent = api.observe(kGeneration, release_epoch, 100);
    report.releaseFenceCompleted =
        report.releaseEvent == static_cast<DWORD>(FenceEvent::kReleased);
    report.staleIdentityIgnored = true;
    report.nonNeutralPreventedRelease = true;
  } else if (report.scenario == "invalidation") {
    const DWORD invalidated = api.invalidate(kGeneration, release_epoch);
    const DWORD close_while_invalid = api.close(kGeneration, release_epoch);
    const DWORD stale_revalidate = api.revalidate(kGeneration, release_epoch);
    release_epoch += 1u;
    const DWORD revalidated = api.revalidate(kGeneration, release_epoch);
    BootstrapSnapshot after_revalidate{};
    api.snapshot(&after_revalidate, sizeof(after_revalidate));
    report.topologyInvalidationKeptLatch =
        invalidated == static_cast<DWORD>(FenceEvent::kApplied) &&
        close_while_invalid == static_cast<DWORD>(FenceEvent::kRejected) &&
        stale_revalidate == static_cast<DWORD>(FenceEvent::kIgnoredStale) &&
        after_revalidate.blockLatched == 1u;
    report.topologyRevalidatedExactEpoch =
        revalidated == static_cast<DWORD>(FenceEvent::kApplied) &&
        after_revalidate.topologyEpoch == release_epoch;
    report.releaseFenceCompleted =
        FinalizeRelease(api, kGeneration, release_epoch, &report, true);
  } else {
    report.releaseFenceCompleted =
        FinalizeRelease(api, kGeneration, release_epoch, &report, true);
  }

  GameHubDiQaSetPhysical(FALSE, 0, DI_OK);
  std::array<BYTE, 256> released_keyboard{};
  report.releasedCachedPointerPhysical =
      keyboard->lpVtbl->GetDeviceState(
          keyboard, static_cast<DWORD>(released_keyboard.size()),
          released_keyboard.data()) == DI_OK &&
      KeyboardPhysical(released_keyboard);
  DIDEVICEOBJECTDATA released_event{};
  DWORD released_count = 1;
  report.noStaleDataAfterRelease =
      keyboard->lpVtbl->GetDeviceData(keyboard, sizeof(DIDEVICEOBJECTDATA),
                                      &released_event, &released_count,
                                      0) == DI_OK &&
      released_count == 0u && released_event.dwData == 0u;
  if (keyboard_alias != nullptr) {
    keyboard_alias->lpVtbl->Release(keyboard_alias);
    keyboard_alias = nullptr;
  }
  custom_device->lpVtbl->Unacquire(custom_device);
  custom_device->lpVtbl->Release(custom_device);
  custom_device = nullptr;
  factory_root->lpVtbl->Release(factory_root);
  factory_root = nullptr;

  const DWORD second_generation = kGeneration + 1u;
  const unsigned long long second_epoch = release_epoch + 1u;
  report.rearmRejectedBadAuth =
      api.rearm(kGeneration, release_epoch, second_generation, second_epoch,
                kRearmAuthorization ^ 1u) ==
      static_cast<DWORD>(FenceEvent::kRejected);
  report.skippedRearmGenerationRejected =
      api.rearm(kGeneration, release_epoch, second_generation + 1u,
                second_epoch, kRearmAuthorization) ==
      static_cast<DWORD>(FenceEvent::kRejected);
  report.skippedRearmEpochRejected =
      api.rearm(kGeneration, release_epoch, second_generation,
                second_epoch + 1u, kRearmAuthorization) ==
      static_cast<DWORD>(FenceEvent::kRejected);
  const bool rearmed = api.rearm(kGeneration, release_epoch, second_generation,
                                 second_epoch, kRearmAuthorization) ==
                       static_cast<DWORD>(FenceEvent::kApplied);
  report.replayedRearmIgnored =
      rearmed && api.rearm(kGeneration, release_epoch, second_generation,
                           second_epoch, kRearmAuthorization) ==
                     static_cast<DWORD>(FenceEvent::kIgnoredStale);
  report.staleGenerationRejectedAfterRearm =
      rearmed && api.begin(kGeneration, release_epoch) ==
                     static_cast<DWORD>(FenceEvent::kIgnoredStale);

  HotCallRace race{};
  race.keyboard = keyboard;
  race.joystick = joystick;
  GameHubDiQaSetPhysical(FALSE, 0, DI_OK);
  const bool race_started = rearmed && StartHotCallRace(&race);
  const bool initial_concurrent_physical =
      race_started && WaitForCounter(&race.physicalReads, 4);
  const bool pause_for_block =
      race_started && api.setHotCallPause(TRUE) != FALSE;
  const bool block_calls_parked = pause_for_block && WaitForInFlight(api, 4u);
  const DWORD second_begin = block_calls_parked
                                 ? api.begin(second_generation, second_epoch)
                                 : static_cast<DWORD>(FenceEvent::kRejected);
  api.setHotCallPause(FALSE);
  const bool concurrent_neutral =
      second_begin == static_cast<DWORD>(FenceEvent::kApplied) &&
      WaitForCounter(&race.neutralReads, 4);
  report.secondCycleReleased =
      concurrent_neutral &&
      FinalizeRelease(api, second_generation, second_epoch, &report, false);
  GameHubDiQaSetPhysical(FALSE, 0, DI_OK);
  const LONG physical_before_second_release =
      InterlockedCompareExchange(&race.physicalReads, 0, 0);
  const bool concurrent_physical_after_release =
      report.secondCycleReleased &&
      WaitForCounter(&race.physicalReads, physical_before_second_release + 4);

  BootstrapSnapshot before_detach{};
  api.snapshot(&before_detach, sizeof(before_detach));
  report.refcountsBalanced =
      report.refcountsBalanced && before_detach.queryInterfaceBalanced == 1u;
  const bool pause_for_detach =
      race_started && api.setHotCallPause(TRUE) != FALSE;
  const bool detach_calls_parked = pause_for_detach && WaitForInFlight(api, 4u);
  const auto thread_iterations_before_detach = ReadThreadIterations(race);
  report.detachError = api.detach();
  api.setHotCallPause(FALSE);
  const bool calls_progressed_after_detach =
      report.detachError == ERROR_SUCCESS &&
      WaitForEachThreadProgress(race, thread_iterations_before_detach, 3);
  BootstrapSnapshot restored_counter_baseline{};
  api.snapshot(&restored_counter_baseline, sizeof(restored_counter_baseline));
  const auto direct_iterations_before = ReadThreadIterations(race);
  const bool direct_calls_progressed =
      report.detachError == ERROR_SUCCESS &&
      WaitForEachThreadProgress(race, direct_iterations_before, 8);
  const bool race_stopped = !race_started || StopHotCallRace(&race);
  BootstrapSnapshot after_detach{};
  api.snapshot(&after_detach, sizeof(after_detach));
  report.concurrentHotCallsPassed =
      race_started && initial_concurrent_physical && block_calls_parked &&
      concurrent_neutral && concurrent_physical_after_release &&
      detach_calls_parked && direct_calls_progressed && race_stopped &&
      InterlockedCompareExchange(&race.failures, 0, 0) == 0 &&
      after_detach.peakInFlightHookCalls >= 4u &&
      after_detach.getStateHookCalls ==
          restored_counter_baseline.getStateHookCalls &&
      after_detach.pollHookCalls == restored_counter_baseline.pollHookCalls;
  report.detachQuiescencePassed =
      report.detachError == ERROR_SUCCESS && calls_progressed_after_detach &&
      after_detach.detachQuiesced == 1u && after_detach.detachWaitLoops > 0u &&
      after_detach.inFlightHookCalls == 0u;
  std::array<BYTE, 256> detached_keyboard{};
  report.detachedCachedPointerPhysical =
      report.detachError == ERROR_SUCCESS &&
      keyboard->lpVtbl->GetDeviceState(
          keyboard, static_cast<DWORD>(detached_keyboard.size()),
          detached_keyboard.data()) == DI_OK &&
      KeyboardPhysical(detached_keyboard);
  const BOOL released_all = GameHubDiQaReleaseAll();
  ProviderSnapshot final_provider{};
  GameHubDiQaGetProviderSnapshot(&final_provider, sizeof(final_provider));
  report.providerObjectsReleased = released_all &&
                                   final_provider.liveRootObjects == 0u &&
                                   final_provider.liveDeviceObjects == 0u &&
                                   final_provider.totalReferences == 0u;
  report.finalFaultCode = after_detach.faultCode;

  const bool scenario_specific =
      report.scenario == "normal"
          ? report.staleIdentityIgnored && report.nonNeutralPreventedRelease
      : report.scenario == "rollback"
          ? report.rollbackRestartedDwell
          : report.topologyInvalidationKeptLatch &&
                report.topologyRevalidatedExactEpoch;
  report.proofPassed =
      report.entryReached && report.bootstrapLoadedBeforeEntry &&
      report.cacheInitializedBeforeBootstrap &&
      report.preAttachPhysicalObserved && report.exactProviderResolved &&
      report.hookAttachedBeforeEntry && report.exactBodiesValidated &&
      report.cachedFactoryIntercepted && report.cachedRootBodyIntercepted &&
      report.rootComIdentityExact && report.deviceComIdentityExact &&
      report.refcountsBalanced && report.customFormatAccepted &&
      report.malformedFormatRejected && report.rangeSemanticsPreserved &&
      report.preBlockPhysicalObserved && report.blockedKeyboardNeutral &&
      report.blockedJoystickNeutral && report.blockedCustomNeutral &&
      report.blockedPaddingPreserved && report.blockedQueryAliasNeutral &&
      report.bufferedDataDrained && report.pollCoveredWhileLatched &&
      scenario_specific && report.releaseFenceCompleted &&
      report.noStaleDataAfterRelease && report.releasedCachedPointerPhysical &&
      report.rearmRejectedBadAuth && report.skippedRearmGenerationRejected &&
      report.skippedRearmEpochRejected && report.replayedRearmIgnored &&
      report.staleGenerationRejectedAfterRearm && report.secondCycleReleased &&
      report.concurrentHotCallsPassed && report.detachQuiescencePassed &&
      report.detachedCachedPointerPhysical && report.providerObjectsReleased &&
      report.finalFaultCode == static_cast<DWORD>(FaultCode::kNone);
  return WriteResult(arguments[2], Serialize(report))
             ? (report.proofPassed ? 0 : 32)
             : 22;
}
