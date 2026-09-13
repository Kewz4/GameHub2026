// clang-format off: Windows types must be visible before the Detours header.
#include "contract.hpp"
#include <detours.h>
// clang-format on

namespace {

using namespace gamehub::overlay::xinput_qa;

GetStateFunction g_true_get_state = nullptr;
GetStateExFunction g_true_get_state_ex = nullptr;
GetKeystrokeFunction g_true_get_keystroke = nullptr;
EnableFunction g_true_enable = nullptr;
SetStateFunction g_true_set_state = nullptr;

volatile LONG g_restore_after_with = 0;
volatile LONG g_cache_initialized = 0;
volatile LONG g_pointers_matched = 0;
volatile LONG g_attach_error = ERROR_INVALID_STATE;
volatile LONG g_attached = 0;
volatile LONG g_block_latched = 0;
volatile LONG g_readiness_valid = 0;
volatile LONG g_fence_phase = static_cast<LONG>(FencePhase::kUnarmed);
volatile LONG g_pending_buffers = 0;
volatile LONG g_neutral_samples = 0;
volatile LONG g_get_state_hook_calls = 0;
volatile LONG g_get_state_ex_hook_calls = 0;
volatile LONG g_get_keystroke_hook_calls = 0;
volatile LONG g_enable_hook_calls = 0;
volatile LONG g_set_state_hook_calls = 0;
volatile LONG g_enable_replay_count = 0;
volatile LONG g_last_requested_enable = 1;
volatile LONG g_remembered_vibration_valid = 0;
volatile LONG g_remembered_left_motor_speed = 0;
volatile LONG g_remembered_right_motor_speed = 0;
DWORD g_generation = kGeneration;
unsigned long long g_topology_epoch = kTopologyEpoch;
unsigned long long g_neutral_since_ms = 0;
unsigned long long g_last_observation_ms = 0;
bool g_neutral_since_set = false;
bool g_last_observation_set = false;
ULONG_PTR g_get_state_pointer_before_attach = 0;
ULONG_PTR g_get_state_ex_pointer_before_attach = 0;
ULONG_PTR g_get_keystroke_pointer_before_attach = 0;
ULONG_PTR g_enable_pointer_before_attach = 0;
ULONG_PTR g_set_state_pointer_before_attach = 0;

void ClearGamepad(Gamepad* gamepad) { ZeroMemory(gamepad, sizeof(*gamepad)); }

bool IdentityMatches(DWORD generation,
                     unsigned long long topology_epoch) noexcept {
  return generation == g_generation && topology_epoch == g_topology_epoch;
}

void ResetNeutralWindow() noexcept {
  InterlockedExchange(&g_neutral_samples, 0);
  g_neutral_since_ms = 0;
  g_last_observation_ms = 0;
  g_neutral_since_set = false;
  g_last_observation_set = false;
}

bool ReadProvider(ProviderSnapshot* snapshot) {
  ZeroMemory(snapshot, sizeof(*snapshot));
  return GameHubXInputQaGetProviderSnapshot(snapshot, sizeof(*snapshot)) &&
         snapshot->schemaVersion == kSchemaVersion;
}

DWORD WINAPI HookGetState(DWORD user_index, State* state) {
  InterlockedIncrement(&g_get_state_hook_calls);
  const DWORD status = g_true_get_state(user_index, state);
  if (status != ERROR_SUCCESS || state == nullptr ||
      InterlockedCompareExchange(&g_block_latched, 0, 0) == 0) {
    return status;
  }
  state->packetNumber = kBlockedStatePacket;
  ClearGamepad(&state->gamepad);
  return ERROR_SUCCESS;
}

DWORD WINAPI HookGetStateEx(DWORD user_index, State* state) {
  InterlockedIncrement(&g_get_state_ex_hook_calls);
  const DWORD status = g_true_get_state_ex(user_index, state);
  if (status != ERROR_SUCCESS || state == nullptr ||
      InterlockedCompareExchange(&g_block_latched, 0, 0) == 0) {
    return status;
  }
  state->packetNumber = kBlockedStateExPacket;
  ClearGamepad(&state->gamepad);
  return ERROR_SUCCESS;
}

DWORD WINAPI HookGetKeystroke(DWORD user_index, DWORD reserved,
                              Keystroke* keystroke) {
  InterlockedIncrement(&g_get_keystroke_hook_calls);
  if (InterlockedCompareExchange(&g_block_latched, 0, 0) == 0) {
    return g_true_get_keystroke(user_index, reserved, keystroke);
  }
  if (keystroke == nullptr || reserved != 0) {
    return g_true_get_keystroke(user_index, reserved, keystroke);
  }

  Keystroke discarded{};
  DWORD status = kErrorEmpty;
  for (DWORD index = 0; index <= 1'024u; ++index) {
    ZeroMemory(&discarded, sizeof(discarded));
    status = g_true_get_keystroke(user_index, reserved, &discarded);
    if (status != ERROR_SUCCESS) break;
  }
  ZeroMemory(keystroke, sizeof(*keystroke));
  return status;
}

VOID WINAPI HookEnable(BOOL enable) {
  InterlockedIncrement(&g_enable_hook_calls);
  if (InterlockedCompareExchange(&g_block_latched, 0, 0) != 0) {
    InterlockedExchange(&g_last_requested_enable, enable ? 1 : 0);
    return;
  }
  g_true_enable(enable);
}

DWORD WINAPI HookSetState(DWORD user_index, Vibration* vibration) {
  InterlockedIncrement(&g_set_state_hook_calls);
  if (InterlockedCompareExchange(&g_block_latched, 0, 0) == 0 ||
      vibration == nullptr) {
    return g_true_set_state(user_index, vibration);
  }

  ProviderSnapshot provider{};
  if (!ReadProvider(&provider)) return ERROR_INVALID_STATE;
  if (user_index != 0 || provider.physicalConnected == 0) {
    return ERROR_DEVICE_NOT_CONNECTED;
  }
  InterlockedExchange(&g_remembered_left_motor_speed,
                      static_cast<LONG>(vibration->leftMotorSpeed));
  InterlockedExchange(&g_remembered_right_motor_speed,
                      static_cast<LONG>(vibration->rightMotorSpeed));
  InterlockedExchange(&g_remembered_vibration_valid, 1);
  return ERROR_SUCCESS;
}

LONG AbortTransaction(LONG error) {
  DetourTransactionAbort();
  return error;
}

LONG AttachHooks() {
  CacheSnapshot cache{};
  if (!GameHubXInputQaGetCacheSnapshot(&cache, sizeof(cache))) {
    return static_cast<LONG>(GetLastError());
  }
  InterlockedExchange(&g_cache_initialized,
                      cache.initializedBeforeBootstrap == 1u ? 1 : 0);
  InterlockedExchange(&g_pointers_matched,
                      cache.allPointersMatchedProvider == 1u ? 1 : 0);
  if (cache.initializedBeforeBootstrap != 1u ||
      cache.allPointersMatchedProvider != 1u || cache.getStatePointer == 0 ||
      cache.getStateExPointer == 0 || cache.getKeystrokePointer == 0 ||
      cache.enablePointer == 0 || cache.setStatePointer == 0) {
    return ERROR_INVALID_STATE;
  }

  g_true_get_state = reinterpret_cast<GetStateFunction>(cache.getStatePointer);
  g_true_get_state_ex =
      reinterpret_cast<GetStateExFunction>(cache.getStateExPointer);
  g_true_get_keystroke =
      reinterpret_cast<GetKeystrokeFunction>(cache.getKeystrokePointer);
  g_true_enable = reinterpret_cast<EnableFunction>(cache.enablePointer);
  g_true_set_state = reinterpret_cast<SetStateFunction>(cache.setStatePointer);
  g_get_state_pointer_before_attach = cache.getStatePointer;
  g_get_state_ex_pointer_before_attach = cache.getStateExPointer;
  g_get_keystroke_pointer_before_attach = cache.getKeystrokePointer;
  g_enable_pointer_before_attach = cache.enablePointer;
  g_set_state_pointer_before_attach = cache.setStatePointer;

  LONG error = DetourTransactionBegin();
  if (error != NO_ERROR) return error;
  error = DetourUpdateThread(GetCurrentThread());
  if (error != NO_ERROR) return AbortTransaction(error);
  error = DetourAttach(reinterpret_cast<PVOID*>(&g_true_get_state),
                       reinterpret_cast<PVOID>(&HookGetState));
  if (error != NO_ERROR) return AbortTransaction(error);
  error = DetourAttach(reinterpret_cast<PVOID*>(&g_true_get_state_ex),
                       reinterpret_cast<PVOID>(&HookGetStateEx));
  if (error != NO_ERROR) return AbortTransaction(error);
  error = DetourAttach(reinterpret_cast<PVOID*>(&g_true_get_keystroke),
                       reinterpret_cast<PVOID>(&HookGetKeystroke));
  if (error != NO_ERROR) return AbortTransaction(error);
  error = DetourAttach(reinterpret_cast<PVOID*>(&g_true_enable),
                       reinterpret_cast<PVOID>(&HookEnable));
  if (error != NO_ERROR) return AbortTransaction(error);
  error = DetourAttach(reinterpret_cast<PVOID*>(&g_true_set_state),
                       reinterpret_cast<PVOID>(&HookSetState));
  if (error != NO_ERROR) return AbortTransaction(error);
  error = DetourTransactionCommit();
  if (error != NO_ERROR) return error;

  InterlockedExchange(&g_attached, 1);
  InterlockedExchange(&g_readiness_valid, 1);
  InterlockedExchange(&g_fence_phase, static_cast<LONG>(FencePhase::kArmed));
  return NO_ERROR;
}

LONG DetachHooks() {
  if (InterlockedCompareExchange(&g_attached, 0, 0) != 1 ||
      InterlockedCompareExchange(&g_block_latched, 0, 0) != 0) {
    return ERROR_INVALID_STATE;
  }
  LONG error = DetourTransactionBegin();
  if (error != NO_ERROR) return error;
  error = DetourUpdateThread(GetCurrentThread());
  if (error != NO_ERROR) return AbortTransaction(error);
  error = DetourDetach(reinterpret_cast<PVOID*>(&g_true_get_state),
                       reinterpret_cast<PVOID>(&HookGetState));
  if (error != NO_ERROR) return AbortTransaction(error);
  error = DetourDetach(reinterpret_cast<PVOID*>(&g_true_get_state_ex),
                       reinterpret_cast<PVOID>(&HookGetStateEx));
  if (error != NO_ERROR) return AbortTransaction(error);
  error = DetourDetach(reinterpret_cast<PVOID*>(&g_true_get_keystroke),
                       reinterpret_cast<PVOID>(&HookGetKeystroke));
  if (error != NO_ERROR) return AbortTransaction(error);
  error = DetourDetach(reinterpret_cast<PVOID*>(&g_true_enable),
                       reinterpret_cast<PVOID>(&HookEnable));
  if (error != NO_ERROR) return AbortTransaction(error);
  error = DetourDetach(reinterpret_cast<PVOID*>(&g_true_set_state),
                       reinterpret_cast<PVOID>(&HookSetState));
  if (error != NO_ERROR) return AbortTransaction(error);
  error = DetourTransactionCommit();
  if (error == NO_ERROR) InterlockedExchange(&g_attached, 0);
  return error;
}

bool ReplayEnableAndVibration() {
  if (InterlockedCompareExchange(&g_remembered_vibration_valid, 0, 0) != 0) {
    Vibration vibration{};
    vibration.leftMotorSpeed = static_cast<WORD>(
        InterlockedCompareExchange(&g_remembered_left_motor_speed, 0, 0));
    vibration.rightMotorSpeed = static_cast<WORD>(
        InterlockedCompareExchange(&g_remembered_right_motor_speed, 0, 0));
    if (g_true_set_state(0, &vibration) != ERROR_SUCCESS) return false;
  }
  const BOOL enable =
      InterlockedCompareExchange(&g_last_requested_enable, 0, 0) != 0;
  g_true_enable(enable);
  InterlockedIncrement(&g_enable_replay_count);
  ProviderSnapshot provider{};
  return ReadProvider(&provider) && provider.physicalConnected != 0 &&
         provider.physicalNeutral != 0 && provider.queuedKeystrokes == 0;
}

}  // namespace

extern "C" BOOL WINAPI GameHubXInputQaGetBootstrapSnapshot(
    gamehub::overlay::xinput_qa::BootstrapSnapshot* output, DWORD output_size) {
  using gamehub::overlay::xinput_qa::BootstrapSnapshot;
  if (output == nullptr || output_size != sizeof(BootstrapSnapshot)) {
    SetLastError(ERROR_INSUFFICIENT_BUFFER);
    return FALSE;
  }
  output->structSize = sizeof(BootstrapSnapshot);
  output->schemaVersion = kSchemaVersion;
  output->restoreAfterWithSucceeded = static_cast<DWORD>(
      InterlockedCompareExchange(&g_restore_after_with, 0, 0));
  output->cacheInitializedBeforeAttach = static_cast<DWORD>(
      InterlockedCompareExchange(&g_cache_initialized, 0, 0));
  output->allCachedPointersMatchedProviderBeforeAttach =
      static_cast<DWORD>(InterlockedCompareExchange(&g_pointers_matched, 0, 0));
  output->attachError = InterlockedCompareExchange(&g_attach_error, 0, 0);
  output->attachedBeforeEntry =
      static_cast<DWORD>(InterlockedCompareExchange(&g_attached, 0, 0));
  output->blockLatched =
      static_cast<DWORD>(InterlockedCompareExchange(&g_block_latched, 0, 0));
  output->readinessValid =
      static_cast<DWORD>(InterlockedCompareExchange(&g_readiness_valid, 0, 0));
  output->generation = g_generation;
  output->topologyEpoch = g_topology_epoch;
  output->fencePhase =
      static_cast<DWORD>(InterlockedCompareExchange(&g_fence_phase, 0, 0));
  output->pendingBuffers =
      static_cast<DWORD>(InterlockedCompareExchange(&g_pending_buffers, 0, 0));
  output->neutralSamples =
      static_cast<DWORD>(InterlockedCompareExchange(&g_neutral_samples, 0, 0));
  output->neutralSinceMs = g_neutral_since_ms;
  output->getStateHookCalls = static_cast<DWORD>(
      InterlockedCompareExchange(&g_get_state_hook_calls, 0, 0));
  output->getStateExHookCalls = static_cast<DWORD>(
      InterlockedCompareExchange(&g_get_state_ex_hook_calls, 0, 0));
  output->getKeystrokeHookCalls = static_cast<DWORD>(
      InterlockedCompareExchange(&g_get_keystroke_hook_calls, 0, 0));
  output->enableHookCalls = static_cast<DWORD>(
      InterlockedCompareExchange(&g_enable_hook_calls, 0, 0));
  output->setStateHookCalls = static_cast<DWORD>(
      InterlockedCompareExchange(&g_set_state_hook_calls, 0, 0));
  output->enableReplayCount = static_cast<DWORD>(
      InterlockedCompareExchange(&g_enable_replay_count, 0, 0));
  output->lastRequestedEnable = static_cast<DWORD>(
      InterlockedCompareExchange(&g_last_requested_enable, 0, 0));
  output->rememberedVibrationValid = static_cast<DWORD>(
      InterlockedCompareExchange(&g_remembered_vibration_valid, 0, 0));
  output->rememberedLeftMotorSpeed = static_cast<DWORD>(
      InterlockedCompareExchange(&g_remembered_left_motor_speed, 0, 0));
  output->rememberedRightMotorSpeed = static_cast<DWORD>(
      InterlockedCompareExchange(&g_remembered_right_motor_speed, 0, 0));
  output->getStatePointerBeforeAttach = g_get_state_pointer_before_attach;
  output->getStateExPointerBeforeAttach = g_get_state_ex_pointer_before_attach;
  output->getKeystrokePointerBeforeAttach =
      g_get_keystroke_pointer_before_attach;
  output->enablePointerBeforeAttach = g_enable_pointer_before_attach;
  output->setStatePointerBeforeAttach = g_set_state_pointer_before_attach;
  return TRUE;
}

extern "C" DWORD WINAPI
GameHubXInputQaBeginBlock(DWORD generation, unsigned long long topology_epoch) {
  if (!IdentityMatches(generation, topology_epoch)) {
    return static_cast<DWORD>(FenceEvent::kIgnoredStale);
  }
  if (InterlockedCompareExchange(&g_fence_phase, 0, 0) !=
          static_cast<LONG>(FencePhase::kArmed) ||
      InterlockedCompareExchange(&g_readiness_valid, 0, 0) != 1) {
    return static_cast<DWORD>(FenceEvent::kRejected);
  }
  ProviderSnapshot provider{};
  if (!ReadProvider(&provider)) {
    InterlockedExchange(&g_fence_phase, static_cast<LONG>(FencePhase::kFault));
    return static_cast<DWORD>(FenceEvent::kRejected);
  }
  InterlockedExchange(&g_last_requested_enable, provider.enabled ? 1 : 0);
  InterlockedExchange(&g_block_latched, 1);
  InterlockedExchange(&g_pending_buffers,
                      static_cast<LONG>(provider.queuedKeystrokes));
  ResetNeutralWindow();
  InterlockedExchange(&g_fence_phase,
                      static_cast<LONG>(provider.queuedKeystrokes == 0
                                            ? FencePhase::kBlocked
                                            : FencePhase::kDraining));
  g_true_enable(FALSE);
  return static_cast<DWORD>(FenceEvent::kApplied);
}

extern "C" DWORD WINAPI GameHubXInputQaRequestClose(
    DWORD generation, unsigned long long topology_epoch) {
  if (!IdentityMatches(generation, topology_epoch)) {
    return static_cast<DWORD>(FenceEvent::kIgnoredStale);
  }
  if (InterlockedCompareExchange(&g_block_latched, 0, 0) != 1) {
    return static_cast<DWORD>(FenceEvent::kRejected);
  }
  if (InterlockedCompareExchange(&g_fence_phase, 0, 0) ==
      static_cast<LONG>(FencePhase::kRestoreWait)) {
    return static_cast<DWORD>(FenceEvent::kApplied);
  }
  const LONG phase = InterlockedCompareExchange(&g_fence_phase, 0, 0);
  if (InterlockedCompareExchange(&g_readiness_valid, 0, 0) != 1 ||
      (phase != static_cast<LONG>(FencePhase::kBlocked) &&
       phase != static_cast<LONG>(FencePhase::kDraining))) {
    return static_cast<DWORD>(FenceEvent::kRejected);
  }
  InterlockedExchange(&g_fence_phase,
                      static_cast<LONG>(FencePhase::kRestoreWait));
  ResetNeutralWindow();
  return static_cast<DWORD>(FenceEvent::kApplied);
}

extern "C" DWORD WINAPI GameHubXInputQaObserveRelease(
    DWORD generation, unsigned long long topology_epoch,
    unsigned long long now_ms) {
  if (!IdentityMatches(generation, topology_epoch)) {
    return static_cast<DWORD>(FenceEvent::kIgnoredStale);
  }
  if (InterlockedCompareExchange(&g_fence_phase, 0, 0) !=
          static_cast<LONG>(FencePhase::kRestoreWait) ||
      InterlockedCompareExchange(&g_readiness_valid, 0, 0) != 1) {
    return static_cast<DWORD>(FenceEvent::kRejected);
  }
  ProviderSnapshot provider{};
  if (!ReadProvider(&provider))
    return static_cast<DWORD>(FenceEvent::kRejected);
  InterlockedExchange(&g_pending_buffers,
                      static_cast<LONG>(provider.queuedKeystrokes));
  if (provider.queuedKeystrokes != 0 || provider.physicalNeutral == 0 ||
      provider.physicalConnected == 0) {
    ResetNeutralWindow();
    g_last_observation_ms = now_ms;
    g_last_observation_set = true;
    return static_cast<DWORD>(FenceEvent::kApplied);
  }
  if (g_last_observation_set && now_ms < g_last_observation_ms) {
    ResetNeutralWindow();
  }
  g_last_observation_ms = now_ms;
  g_last_observation_set = true;
  if (!g_neutral_since_set) {
    g_neutral_since_ms = now_ms;
    g_neutral_since_set = true;
    InterlockedExchange(&g_neutral_samples, 1);
    return static_cast<DWORD>(FenceEvent::kApplied);
  }
  InterlockedIncrement(&g_neutral_samples);
  const DWORD samples =
      static_cast<DWORD>(InterlockedCompareExchange(&g_neutral_samples, 0, 0));
  if (samples < kRequiredNeutralSamples ||
      now_ms - g_neutral_since_ms < kRequiredNeutralMs) {
    return static_cast<DWORD>(FenceEvent::kApplied);
  }
  if (!IdentityMatches(generation, topology_epoch) ||
      provider.queuedKeystrokes != 0) {
    return static_cast<DWORD>(FenceEvent::kIgnoredStale);
  }
  if (!ReplayEnableAndVibration()) {
    InterlockedExchange(&g_readiness_valid, 0);
    InterlockedExchange(&g_fence_phase, static_cast<LONG>(FencePhase::kFault));
    return static_cast<DWORD>(FenceEvent::kRejected);
  }
  InterlockedExchange(&g_readiness_valid, 0);
  InterlockedExchange(&g_fence_phase, static_cast<LONG>(FencePhase::kReleased));
  InterlockedExchange(&g_block_latched, 0);
  return static_cast<DWORD>(FenceEvent::kReleased);
}

extern "C" DWORD WINAPI GameHubXInputQaInvalidateTopology(
    DWORD generation, unsigned long long topology_epoch) {
  if (generation != g_generation || topology_epoch <= g_topology_epoch) {
    return static_cast<DWORD>(FenceEvent::kIgnoredStale);
  }
  g_topology_epoch = topology_epoch;
  InterlockedExchange(&g_readiness_valid, 0);
  ResetNeutralWindow();
  InterlockedExchange(&g_fence_phase,
                      static_cast<LONG>(FencePhase::kInvalidated));
  return static_cast<DWORD>(FenceEvent::kApplied);
}

extern "C" DWORD WINAPI
GameHubXInputQaRevalidate(DWORD generation, unsigned long long topology_epoch) {
  if (!IdentityMatches(generation, topology_epoch)) {
    return static_cast<DWORD>(FenceEvent::kIgnoredStale);
  }
  if (InterlockedCompareExchange(&g_block_latched, 0, 0) != 1 ||
      InterlockedCompareExchange(&g_fence_phase, 0, 0) !=
          static_cast<LONG>(FencePhase::kInvalidated)) {
    return static_cast<DWORD>(FenceEvent::kRejected);
  }
  CacheSnapshot cache{};
  ProviderSnapshot provider{};
  if (!GameHubXInputQaGetCacheSnapshot(&cache, sizeof(cache)) ||
      cache.initializedBeforeBootstrap != 1u ||
      cache.allPointersMatchedProvider != 1u || !ReadProvider(&provider) ||
      provider.physicalConnected == 0) {
    InterlockedExchange(&g_fence_phase, static_cast<LONG>(FencePhase::kFault));
    return static_cast<DWORD>(FenceEvent::kRejected);
  }
  ResetNeutralWindow();
  InterlockedExchange(&g_readiness_valid, 1);
  InterlockedExchange(&g_fence_phase, static_cast<LONG>(FencePhase::kBlocked));
  return static_cast<DWORD>(FenceEvent::kApplied);
}

extern "C" DWORD WINAPI GameHubXInputQaDetach() {
  return static_cast<DWORD>(DetachHooks());
}

extern "C" DWORD WINAPI GameHubXInputQaAttachLateForNegativeControl() {
  if (InterlockedCompareExchange(&g_attached, 0, 0) != 0) {
    return ERROR_ALREADY_INITIALIZED;
  }
  const LONG error = AttachHooks();
  InterlockedExchange(&g_attach_error, error);
  return static_cast<DWORD>(error);
}

BOOL WINAPI DllMain(HINSTANCE instance, DWORD reason, LPVOID reserved) {
  if (DetourIsHelperProcess()) return TRUE;
  if (reason == DLL_PROCESS_ATTACH) {
    const BOOL restored = DetourRestoreAfterWith();
    InterlockedExchange(&g_restore_after_with, restored ? 1 : 0);
    DisableThreadLibraryCalls(instance);
    const LONG error = restored
                           ? AttachHooks()
                           : static_cast<LONG>(GetLastError() == ERROR_SUCCESS
                                                   ? ERROR_INVALID_STATE
                                                   : GetLastError());
    InterlockedExchange(&g_attach_error, error);
  }
  (void)reserved;
  return TRUE;
}
