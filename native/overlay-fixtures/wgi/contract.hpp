#pragma once

#include <windows.h>
#include <inspectable.h>
#include <roapi.h>
#include <windows.gaming.input.h>
#include <winstring.h>

#include <cstddef>
#include <cstdint>

namespace gamehub::overlay::wgi_qa {

namespace abi = ABI::Windows::Gaming::Input;

constexpr DWORD kSchemaVersion = 1;
constexpr DWORD kGeneration = 29;
constexpr unsigned long long kInitialEpoch = 41;
constexpr unsigned long long kRequiredNeutralMs = 50;
constexpr DWORD kRequiredNeutralSamples = 2;
constexpr DWORD kSnapshotCap = 64;
constexpr DWORD kSnapshotGenerationCap = 64;
constexpr DWORD kProjectionCount = 6;
// The synthetic Gamepad-backed Raw projection uses ten discrete buttons,
// one eight-way D-pad switch, four centered stick axes and two zero-based
// trigger axes. This is a fixture-owned schema, not a claim about every WGI
// gamepad/HID mapping.
constexpr DWORD kRawButtons = 10;
constexpr DWORD kRawSwitches = 1;
constexpr DWORD kRawAxes = 6;
constexpr wchar_t kBootstrapModuleName[] =
    L"gamehub-overlay-qa-wgi-bootstrap64.dll";

enum class Projection : DWORD {
  kGamepad = 0,
  kRaw = 1,
  kRacing = 2,
  kFlight = 3,
  kArcade = 4,
  kUi = 5,
};

enum class ProviderFault : DWORD {
  kNone = 0,
  kQueryInterface = 1,
  kNullTopologyVtable = 2,
  kBodyMismatch = 3,
  kRawSchema = 4,
  kActivation = 5,
  kNonNeutral = 6,
};

enum class FencePhase : DWORD {
  kUnarmed = 0,
  kBlocked = 1,
  kDwelling = 2,
  kReleased = 3,
  kInvalidated = 4,
  kFault = 5,
};

enum class FenceEvent : DWORD {
  kApplied = 1,
  kIgnoredStale = 2,
  kRejected = 3,
  kReleased = 4,
};

struct Topology {
  DWORD structSize;
  DWORD schemaVersion;
  DWORD generation;
  DWORD fault;
  unsigned long long epoch;
  ULONG_PTR objects[kProjectionCount];
  unsigned long long serials[kProjectionCount];
  DWORD presentMask;
  DWORD rawButtonCount;
  DWORD rawSwitchCount;
  DWORD rawAxisCount;
  double rawNeutralAxes[kRawAxes];
};

struct ProviderSnapshot {
  DWORD structSize;
  DWORD schemaVersion;
  DWORD activationCalls;
  DWORD pollingCalls[kProjectionCount];
  DWORD topologyCallbacks;
  DWORD fault;
  unsigned long long epoch;
  DWORD presentMask;
  DWORD physicalNeutral;
  DWORD transientReferences;
  DWORD addRefCalls;
  DWORD releaseCalls;
  DWORD overReleaseAttempts;
};

struct CacheSnapshot {
  DWORD structSize;
  DWORD schemaVersion;
  DWORD initializedBeforeBootstrap;
  DWORD activationCallsBeforeBootstrap;
  DWORD allObjectsHadVtables;
  DWORD exactInterfacesRoundTripped;
  DWORD controllingUnknownsValid;
  DWORD gamepadRawSharedIdentity;
  DWORD otherIdentitiesDistinct;
  DWORD exactRawSchema;
  DWORD physicalPollsBeforeBootstrap;
  ULONG_PTR roGetActivationFactory;
  ULONG_PTR objects[kProjectionCount];
  ULONG_PTR pollingBodies[kProjectionCount];
};

struct BootstrapSnapshot {
  DWORD structSize;
  DWORD schemaVersion;
  DWORD cacheInitializedBeforeAttach;
  DWORD cachedPointersMatchedBeforeAttach;
  DWORD restoreAfterWithSucceeded;
  LONG attachError;
  DWORD attachedBeforeEntry;
  DWORD blockLatched;
  DWORD readinessValid;
  DWORD fencePhase;
  DWORD snapshotCount;
  DWORD permanentFault;
  DWORD topologyInvalidations;
  DWORD revalidations;
  DWORD drainMask;
  DWORD drainedEntryCount;
  DWORD requiredDrainEntries;
  DWORD activeSnapshotGeneration;
  DWORD publishedSnapshotCount;
  DWORD neutralSamples;
  unsigned long long blockDrainEpoch;
  unsigned long long neutralSinceMs;
  unsigned long long validatedEpoch;
  unsigned long long validatedSerials[kProjectionCount];
  DWORD activationHookCalls;
  DWORD pollingHookCalls[kProjectionCount];
  ULONG_PTR roBodyBeforeAttach;
  ULONG_PTR pollingBodiesBeforeAttach[kProjectionCount];
};

using RoGetActivationFactoryFunction = HRESULT(WINAPI*)(HSTRING, REFIID,
                                                        void**);
using GamepadReadingFunction = HRESULT(STDMETHODCALLTYPE*)(
    abi::IGamepad*, abi::GamepadReading*);
using RawReadingFunction = HRESULT(STDMETHODCALLTYPE*)(
    abi::IRawGameController*, UINT32, boolean*, UINT32,
    abi::GameControllerSwitchPosition*, UINT32, DOUBLE*, UINT64*);
using RacingReadingFunction = HRESULT(STDMETHODCALLTYPE*)(
    abi::IRacingWheel*, abi::RacingWheelReading*);
using FlightReadingFunction = HRESULT(STDMETHODCALLTYPE*)(
    abi::IFlightStick*, abi::FlightStickReading*);
using ArcadeReadingFunction = HRESULT(STDMETHODCALLTYPE*)(
    abi::IArcadeStick*, abi::ArcadeStickReading*);
using UiReadingFunction = HRESULT(STDMETHODCALLTYPE*)(
    abi::IUINavigationController*, abi::UINavigationReading*);

constexpr DWORD Bit(Projection projection) noexcept {
  return 1u << static_cast<DWORD>(projection);
}

constexpr DWORD kAllProjectionMask = (1u << kProjectionCount) - 1u;

constexpr DWORD kGamepadReadingSlot = 8;
constexpr DWORD kRawReadingSlot = 13;
constexpr DWORD kRacingReadingSlot = 13;
constexpr DWORD kFlightReadingSlot = 8;
constexpr DWORD kArcadeReadingSlot = 7;
constexpr DWORD kUiReadingSlot = 6;

static_assert(sizeof(abi::GamepadReading) == 64);
static_assert(offsetof(abi::GamepadReading, Timestamp) == 0);
static_assert(offsetof(abi::GamepadReading, Buttons) == 8);
static_assert(offsetof(abi::GamepadReading, LeftTrigger) == 16);
static_assert(offsetof(abi::GamepadReading, RightThumbstickY) == 56);
static_assert(sizeof(abi::RacingWheelReading) == 56);
static_assert(offsetof(abi::RacingWheelReading, Timestamp) == 0);
static_assert(offsetof(abi::RacingWheelReading, Wheel) == 16);
static_assert(sizeof(abi::FlightStickReading) == 48);
static_assert(offsetof(abi::FlightStickReading, HatSwitch) == 12);
static_assert(offsetof(abi::FlightStickReading, Roll) == 16);
static_assert(sizeof(abi::ArcadeStickReading) == 16);
static_assert(sizeof(abi::UINavigationReading) == 16);

}  // namespace gamehub::overlay::wgi_qa

#if defined(GAMEHUB_WGI_PROVIDER_EXPORTS)
#define GAMEHUB_WGI_PROVIDER_API __declspec(dllexport)
#elif defined(GAMEHUB_WGI_PROVIDER_DEFINITIONS)
#define GAMEHUB_WGI_PROVIDER_API
#else
#define GAMEHUB_WGI_PROVIDER_API __declspec(dllimport)
#endif

#if defined(GAMEHUB_WGI_CACHE_EXPORTS)
#define GAMEHUB_WGI_CACHE_API __declspec(dllexport)
#else
#define GAMEHUB_WGI_CACHE_API __declspec(dllimport)
#endif

extern "C" GAMEHUB_WGI_PROVIDER_API HRESULT WINAPI
GameHubSyntheticRoGetActivationFactory(HSTRING class_id, REFIID iid,
                                       void** factory);
extern "C" GAMEHUB_WGI_PROVIDER_API BOOL WINAPI
GameHubSyntheticWgiGetTopology(gamehub::overlay::wgi_qa::Topology* output,
                               DWORD output_size);
extern "C" GAMEHUB_WGI_PROVIDER_API BOOL WINAPI
GameHubSyntheticWgiGetProviderSnapshot(
    gamehub::overlay::wgi_qa::ProviderSnapshot* output, DWORD output_size);
extern "C" GAMEHUB_WGI_PROVIDER_API BOOL WINAPI
GameHubSyntheticWgiSetFault(DWORD fault);
extern "C" GAMEHUB_WGI_PROVIDER_API BOOL WINAPI
GameHubSyntheticWgiMutateTopology(DWORD operation);
extern "C" GAMEHUB_WGI_PROVIDER_API BOOL WINAPI
GameHubSyntheticWgiSetNeutral(BOOL neutral);
extern "C" GAMEHUB_WGI_PROVIDER_API BOOL WINAPI
GameHubSyntheticWgiExerciseOverRelease();

extern "C" GAMEHUB_WGI_CACHE_API BOOL WINAPI GameHubWgiQaGetCacheSnapshot(
    gamehub::overlay::wgi_qa::CacheSnapshot* output, DWORD output_size);
extern "C" GAMEHUB_WGI_CACHE_API BOOL WINAPI GameHubWgiQaGetTopology(
    gamehub::overlay::wgi_qa::Topology* output, DWORD output_size);
extern "C" GAMEHUB_WGI_CACHE_API BOOL WINAPI GameHubWgiQaGetProviderSnapshot(
    gamehub::overlay::wgi_qa::ProviderSnapshot* output, DWORD output_size);
extern "C" GAMEHUB_WGI_CACHE_API BOOL WINAPI GameHubWgiQaSetFault(DWORD fault);
extern "C" GAMEHUB_WGI_CACHE_API BOOL WINAPI
GameHubWgiQaMutateTopology(DWORD operation);
extern "C" GAMEHUB_WGI_CACHE_API BOOL WINAPI
GameHubWgiQaSetNeutral(BOOL neutral);
extern "C" GAMEHUB_WGI_CACHE_API BOOL WINAPI
GameHubWgiQaExerciseOverRelease();
extern "C" GAMEHUB_WGI_CACHE_API HRESULT WINAPI GameHubWgiQaActivate(
    DWORD projection, void** factory);
extern "C" GAMEHUB_WGI_CACHE_API HRESULT WINAPI GameHubWgiQaPoll(
    DWORD projection, void* reading_or_buttons, void* switches, void* axes,
    UINT64* timestamp);

extern "C" BOOL WINAPI GameHubWgiQaGetBootstrapSnapshot(
    gamehub::overlay::wgi_qa::BootstrapSnapshot* output, DWORD output_size);
extern "C" DWORD WINAPI GameHubWgiQaBeginBlock(
    DWORD generation, unsigned long long epoch);
extern "C" DWORD WINAPI GameHubWgiQaExplicitRevalidate(
    DWORD generation, unsigned long long epoch);
extern "C" DWORD WINAPI GameHubWgiQaObserveRelease(
    DWORD generation, unsigned long long epoch, unsigned long long now_ms);
extern "C" DWORD WINAPI GameHubWgiQaDetach();
extern "C" DWORD WINAPI GameHubWgiQaAttachLateForNegativeControl();
extern "C" BOOL WINAPI GameHubWgiQaArmPausedReader(
    DWORD projection, HANDLE entered_event, HANDLE resume_event);
extern "C" void WINAPI
GameHubWgiQaTopologyChanged(unsigned long long epoch);
