#pragma once

#include <windows.h>

#include <cstddef>
#include <cstdint>

namespace gamehub::overlay::xinput_qa {

constexpr DWORD kSchemaVersion = 1;
constexpr DWORD kGeneration = 17;
constexpr unsigned long long kTopologyEpoch = 23;
constexpr DWORD kInitialPendingBuffers = 2;
constexpr unsigned long long kRequiredNeutralMs = 50;
constexpr DWORD kRequiredNeutralSamples = 2;
constexpr DWORD kXUserIndexAny = 0xffu;
constexpr DWORD kErrorEmpty = 4306u;
constexpr DWORD kProviderDisabledPacket = 0x758493a2u;
constexpr DWORD kBlockedStatePacket = 0xa0b0c0d0u;
constexpr DWORD kBlockedStateExPacket = kBlockedStatePacket;
constexpr DWORD kReleasedPhysicalPacket = 0xc1d2e3f4u;
constexpr wchar_t kBootstrapModuleName[] =
    L"gamehub-overlay-qa-xinput-bootstrap64.dll";

constexpr DWORD kPhysicalStatePacket = 0x10203040u;
constexpr DWORD kPhysicalStateExPacket = kPhysicalStatePacket;
constexpr WORD kPhysicalButtons = 0x9001u;
constexpr WORD kPhysicalExButtons = 0x9401u;
constexpr BYTE kPhysicalLeftTrigger = 73u;
constexpr BYTE kPhysicalRightTrigger = 149u;
constexpr SHORT kPhysicalThumbLX = 12'345;
constexpr SHORT kPhysicalThumbLY = -23'456;
constexpr SHORT kPhysicalThumbRX = 30'000;
constexpr SHORT kPhysicalThumbRY = -30'001;
constexpr WORD kPhysicalVirtualKey = 0x5810u;
constexpr WCHAR kPhysicalUnicode = L'Q';
constexpr WORD kPhysicalKeyFlags = 0x0001u;
constexpr BYTE kPhysicalHidCode = 0x2au;

struct Gamepad {
  WORD buttons;
  BYTE leftTrigger;
  BYTE rightTrigger;
  SHORT thumbLX;
  SHORT thumbLY;
  SHORT thumbRX;
  SHORT thumbRY;
};

struct State {
  DWORD packetNumber;
  Gamepad gamepad;
};

struct Keystroke {
  WORD virtualKey;
  WCHAR unicode;
  WORD flags;
  BYTE userIndex;
  BYTE hidCode;
};

struct Vibration {
  WORD leftMotorSpeed;
  WORD rightMotorSpeed;
};

static_assert(sizeof(Gamepad) == 12);
static_assert(sizeof(State) == 16);
static_assert(sizeof(Keystroke) == 8);
static_assert(sizeof(Vibration) == 4);
static_assert(offsetof(State, packetNumber) == 0);
static_assert(offsetof(State, gamepad) == 4);
static_assert(offsetof(Gamepad, buttons) == 0);
static_assert(offsetof(Gamepad, leftTrigger) == 2);
static_assert(offsetof(Gamepad, rightTrigger) == 3);
static_assert(offsetof(Gamepad, thumbLX) == 4);
static_assert(offsetof(Gamepad, thumbRY) == 10);
static_assert(offsetof(Keystroke, virtualKey) == 0);
static_assert(offsetof(Keystroke, unicode) == 2);
static_assert(offsetof(Keystroke, flags) == 4);
static_assert(offsetof(Keystroke, userIndex) == 6);
static_assert(offsetof(Keystroke, hidCode) == 7);

struct ProviderSnapshot {
  DWORD structSize;
  DWORD schemaVersion;
  DWORD getStateCalls;
  DWORD getStateExCalls;
  DWORD getKeystrokeCalls;
  DWORD enableCalls;
  DWORD setStateCalls;
  DWORD enabled;
  DWORD physicalConnected;
  DWORD physicalNeutral;
  DWORD physicalPacket;
  DWORD queuedKeystrokes;
  DWORD lastLeftMotorSpeed;
  DWORD lastRightMotorSpeed;
  DWORD currentLeftMotorSpeed;
  DWORD currentRightMotorSpeed;
};

struct CacheSnapshot {
  DWORD structSize;
  DWORD schemaVersion;
  DWORD initializedBeforeBootstrap;
  DWORD providerModuleResolved;
  DWORD allPointersMatchedProvider;
  DWORD preAttachStateStatus;
  DWORD preAttachStateExStatus;
  State preAttachState;
  State preAttachStateEx;
  ULONG_PTR getStatePointer;
  ULONG_PTR getStateExPointer;
  ULONG_PTR getKeystrokePointer;
  ULONG_PTR enablePointer;
  ULONG_PTR setStatePointer;
};

enum class FencePhase : DWORD {
  kUnarmed = 0,
  kArmed = 1,
  kDraining = 2,
  kBlocked = 3,
  kRestoreWait = 4,
  kReleased = 5,
  kInvalidated = 6,
  kFault = 7,
};

enum class FenceEvent : DWORD {
  kApplied = 1,
  kIgnoredStale = 2,
  kRejected = 3,
  kReleased = 4,
};

struct BootstrapSnapshot {
  DWORD structSize;
  DWORD schemaVersion;
  DWORD restoreAfterWithSucceeded;
  DWORD cacheInitializedBeforeAttach;
  DWORD allCachedPointersMatchedProviderBeforeAttach;
  LONG attachError;
  DWORD attachedBeforeEntry;
  DWORD blockLatched;
  DWORD readinessValid;
  DWORD generation;
  unsigned long long topologyEpoch;
  DWORD fencePhase;
  DWORD pendingBuffers;
  DWORD neutralSamples;
  unsigned long long neutralSinceMs;
  DWORD getStateHookCalls;
  DWORD getStateExHookCalls;
  DWORD getKeystrokeHookCalls;
  DWORD enableHookCalls;
  DWORD setStateHookCalls;
  DWORD enableReplayCount;
  DWORD lastRequestedEnable;
  DWORD rememberedVibrationValid;
  DWORD rememberedLeftMotorSpeed;
  DWORD rememberedRightMotorSpeed;
  ULONG_PTR getStatePointerBeforeAttach;
  ULONG_PTR getStateExPointerBeforeAttach;
  ULONG_PTR getKeystrokePointerBeforeAttach;
  ULONG_PTR enablePointerBeforeAttach;
  ULONG_PTR setStatePointerBeforeAttach;
};

using GetStateFunction = DWORD(WINAPI*)(DWORD, State*);
using GetStateExFunction = DWORD(WINAPI*)(DWORD, State*);
using GetKeystrokeFunction = DWORD(WINAPI*)(DWORD, DWORD, Keystroke*);
using EnableFunction = VOID(WINAPI*)(BOOL);
using SetStateFunction = DWORD(WINAPI*)(DWORD, Vibration*);

constexpr bool IsNeutral(const Gamepad& gamepad) noexcept {
  return gamepad.buttons == 0 && gamepad.leftTrigger == 0 &&
         gamepad.rightTrigger == 0 && gamepad.thumbLX == 0 &&
         gamepad.thumbLY == 0 && gamepad.thumbRX == 0 && gamepad.thumbRY == 0;
}

constexpr bool IsZero(const Keystroke& keystroke) noexcept {
  return keystroke.virtualKey == 0 && keystroke.unicode == 0 &&
         keystroke.flags == 0 && keystroke.userIndex == 0 &&
         keystroke.hidCode == 0;
}

constexpr bool IsPhysicalState(const State& state) noexcept {
  return state.packetNumber == kPhysicalStatePacket &&
         state.gamepad.buttons == kPhysicalButtons &&
         state.gamepad.leftTrigger == kPhysicalLeftTrigger &&
         state.gamepad.rightTrigger == kPhysicalRightTrigger &&
         state.gamepad.thumbLX == kPhysicalThumbLX &&
         state.gamepad.thumbLY == kPhysicalThumbLY &&
         state.gamepad.thumbRX == kPhysicalThumbRX &&
         state.gamepad.thumbRY == kPhysicalThumbRY;
}

constexpr bool IsPhysicalStateEx(const State& state) noexcept {
  return state.packetNumber == kPhysicalStateExPacket &&
         state.gamepad.buttons == kPhysicalExButtons &&
         state.gamepad.leftTrigger == kPhysicalLeftTrigger &&
         state.gamepad.rightTrigger == kPhysicalRightTrigger &&
         state.gamepad.thumbLX == kPhysicalThumbLX &&
         state.gamepad.thumbLY == kPhysicalThumbLY &&
         state.gamepad.thumbRX == kPhysicalThumbRX &&
         state.gamepad.thumbRY == kPhysicalThumbRY;
}

constexpr bool IsPhysicalKeystroke(const Keystroke& keystroke) noexcept {
  return keystroke.virtualKey == kPhysicalVirtualKey &&
         keystroke.unicode == kPhysicalUnicode &&
         keystroke.flags == kPhysicalKeyFlags && keystroke.userIndex == 0 &&
         keystroke.hidCode == kPhysicalHidCode;
}

}  // namespace gamehub::overlay::xinput_qa

#if defined(GAMEHUB_XINPUT_PROVIDER_EXPORTS)
#define GAMEHUB_XINPUT_PROVIDER_API __declspec(dllexport)
#elif defined(GAMEHUB_XINPUT_PROVIDER_DEFINITIONS)
#define GAMEHUB_XINPUT_PROVIDER_API
#else
#define GAMEHUB_XINPUT_PROVIDER_API __declspec(dllimport)
#endif

#if defined(GAMEHUB_XINPUT_CACHE_EXPORTS)
#define GAMEHUB_XINPUT_CACHE_API __declspec(dllexport)
#else
#define GAMEHUB_XINPUT_CACHE_API __declspec(dllimport)
#endif

extern "C" GAMEHUB_XINPUT_PROVIDER_API DWORD WINAPI
XInputGetState(DWORD user_index, gamehub::overlay::xinput_qa::State* state);
extern "C" GAMEHUB_XINPUT_PROVIDER_API DWORD WINAPI
XInputGetStateEx(DWORD user_index, gamehub::overlay::xinput_qa::State* state);
extern "C" GAMEHUB_XINPUT_PROVIDER_API DWORD WINAPI
XInputGetKeystroke(DWORD user_index, DWORD reserved,
                   gamehub::overlay::xinput_qa::Keystroke* keystroke);
extern "C" GAMEHUB_XINPUT_PROVIDER_API VOID WINAPI XInputEnable(BOOL enable);
extern "C" GAMEHUB_XINPUT_PROVIDER_API DWORD WINAPI XInputSetState(
    DWORD user_index, gamehub::overlay::xinput_qa::Vibration* vibration);
extern "C" GAMEHUB_XINPUT_PROVIDER_API BOOL WINAPI
GameHubSyntheticXInputGetProviderSnapshot(
    gamehub::overlay::xinput_qa::ProviderSnapshot* output, DWORD output_size);
extern "C" GAMEHUB_XINPUT_PROVIDER_API BOOL WINAPI
GameHubSyntheticXInputSetPhysical(BOOL connected, BOOL neutral,
                                  DWORD packet_number);
extern "C" GAMEHUB_XINPUT_PROVIDER_API BOOL WINAPI
GameHubSyntheticXInputQueueKeystrokes(DWORD count);

extern "C" GAMEHUB_XINPUT_CACHE_API BOOL WINAPI GameHubXInputQaGetCacheSnapshot(
    gamehub::overlay::xinput_qa::CacheSnapshot* output, DWORD output_size);
extern "C" GAMEHUB_XINPUT_CACHE_API BOOL WINAPI
GameHubXInputQaGetProviderSnapshot(
    gamehub::overlay::xinput_qa::ProviderSnapshot* output, DWORD output_size);
extern "C" GAMEHUB_XINPUT_CACHE_API DWORD WINAPI GameHubXInputQaCallGetState(
    DWORD user_index, gamehub::overlay::xinput_qa::State* state);
extern "C" GAMEHUB_XINPUT_CACHE_API DWORD WINAPI GameHubXInputQaCallGetStateEx(
    DWORD user_index, gamehub::overlay::xinput_qa::State* state);
extern "C" GAMEHUB_XINPUT_CACHE_API DWORD WINAPI
GameHubXInputQaCallGetKeystroke(
    DWORD user_index, DWORD reserved,
    gamehub::overlay::xinput_qa::Keystroke* keystroke);
extern "C" GAMEHUB_XINPUT_CACHE_API VOID WINAPI
GameHubXInputQaCallEnable(BOOL enable);
extern "C" GAMEHUB_XINPUT_CACHE_API DWORD WINAPI GameHubXInputQaCallSetState(
    DWORD user_index, gamehub::overlay::xinput_qa::Vibration* vibration);
extern "C" GAMEHUB_XINPUT_CACHE_API BOOL WINAPI
GameHubXInputQaSetPhysical(BOOL connected, BOOL neutral, DWORD packet_number);
extern "C" GAMEHUB_XINPUT_CACHE_API BOOL WINAPI
GameHubXInputQaQueueKeystrokes(DWORD count);

extern "C" BOOL WINAPI GameHubXInputQaGetBootstrapSnapshot(
    gamehub::overlay::xinput_qa::BootstrapSnapshot* output, DWORD output_size);
extern "C" DWORD WINAPI GameHubXInputQaRequestClose(
    DWORD generation, unsigned long long topology_epoch);
extern "C" DWORD WINAPI GameHubXInputQaObserveRelease(
    DWORD generation, unsigned long long topology_epoch,
    unsigned long long now_ms);
extern "C" DWORD WINAPI
GameHubXInputQaBeginBlock(DWORD generation, unsigned long long topology_epoch);
extern "C" DWORD WINAPI GameHubXInputQaInvalidateTopology(
    DWORD generation, unsigned long long topology_epoch);
extern "C" DWORD WINAPI
GameHubXInputQaRevalidate(DWORD generation, unsigned long long topology_epoch);
extern "C" DWORD WINAPI GameHubXInputQaDetach();
extern "C" DWORD WINAPI GameHubXInputQaAttachLateForNegativeControl();
