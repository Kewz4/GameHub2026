#pragma once

#ifndef DIRECTINPUT_VERSION
#define DIRECTINPUT_VERSION 0x0800
#endif
#ifndef CINTERFACE
#define CINTERFACE
#endif

#include <dinput.h>
#include <windows.h>

#include <cstddef>
#include <cstdint>

namespace gamehub::overlay::directinput_qa {

constexpr DWORD kSchemaVersion = 1;
constexpr DWORD kGeneration = 31;
constexpr unsigned long long kTopologyEpoch = 47;
constexpr DWORD kRequiredNeutralSamples = 2;
constexpr unsigned long long kRequiredNeutralMs = 50;
constexpr DWORD kMaxFormatObjects = 256;
constexpr DWORD kMaxFormatBytes = 4096;
constexpr DWORD kMaxTrackedDevices = 8;
constexpr DWORD kInitialQueuedEvents = 3;
constexpr LONG kPreAttachAxisMinimum = -3000;
constexpr LONG kPreAttachAxisMaximum = 1000;
constexpr LONG kPreAttachAxisMidpoint = -1000;
constexpr unsigned long long kRearmAuthorization = 0xd1a8c0def17e5afeull;
constexpr wchar_t kBootstrapModuleName[] =
    L"gamehub-overlay-qa-directinput-bootstrap64.dll";

enum class InterfaceKind : DWORD {
  kDeviceA = 0,
  kDeviceW = 1,
};

enum class FencePhase : DWORD {
  kUnarmed = 0,
  kBlocked = 1,
  kClosing = 2,
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

enum class FormatKind : DWORD {
  kNone = 0,
  kKeyboard = 1,
  kMouse = 2,
  kMouse2 = 3,
  kJoystick = 4,
  kJoystick2 = 5,
  kCustom = 6,
};

enum class FaultCode : DWORD {
  kNone = 0,
  kCacheInvalid = 1,
  kProviderIdentity = 2,
  kBodyTopology = 3,
  kRegistryFull = 4,
  kUnknownInterface = 5,
  kUnsupportedFormat = 6,
  kUnsupportedSurface = 7,
  kDrainFailed = 8,
  kNeutralProbeFailed = 9,
  kDetachFailed = 10,
};

struct ProviderSnapshot {
  DWORD structSize;
  DWORD schemaVersion;
  DWORD directInput8CreateCalls;
  DWORD rootCreateDeviceCallsA;
  DWORD rootCreateDeviceCallsW;
  DWORD getDeviceStateCalls;
  DWORD getDeviceDataCalls;
  DWORD nullInfiniteDrainCalls;
  DWORD pollCalls;
  DWORD acquireCalls;
  DWORD unacquireCalls;
  DWORD setDataFormatCalls;
  DWORD setCooperativeLevelCalls;
  DWORD setActionMapCalls;
  DWORD setEventNotificationCalls;
  DWORD liveRootObjects;
  DWORD liveDeviceObjects;
  DWORD totalReferences;
  DWORD queuedEvents;
  DWORD pollGeneration;
  DWORD physicalNeutral;
  HRESULT nextDataResult;
};

struct CacheSnapshot {
  DWORD structSize;
  DWORD schemaVersion;
  DWORD initializedBeforeBootstrap;
  DWORD preAttachFactoryCalls;
  DWORD preAttachRootCreateCalls;
  DWORD preAttachDeviceStateCalls;
  DWORD preAttachPhysicalObserved;
  DWORD exactProviderResolved;
  ULONG_PTR providerModule;
  ULONG_PTR factoryBody;
  ULONG_PTR rootCreateBodyA;
  ULONG_PTR rootCreateBodyW;
  ULONG_PTR deviceQueryBodyA;
  ULONG_PTR deviceQueryBodyW;
  ULONG_PTR deviceAddRefBodyA;
  ULONG_PTR deviceAddRefBodyW;
  ULONG_PTR deviceReleaseBodyA;
  ULONG_PTR deviceReleaseBodyW;
  ULONG_PTR deviceGetPropertyBodyA;
  ULONG_PTR deviceGetPropertyBodyW;
  ULONG_PTR deviceSetPropertyBodyA;
  ULONG_PTR deviceSetPropertyBodyW;
  ULONG_PTR deviceAcquireBodyA;
  ULONG_PTR deviceAcquireBodyW;
  ULONG_PTR deviceUnacquireBodyA;
  ULONG_PTR deviceUnacquireBodyW;
  ULONG_PTR deviceGetStateBodyA;
  ULONG_PTR deviceGetStateBodyW;
  ULONG_PTR deviceGetDataBodyA;
  ULONG_PTR deviceGetDataBodyW;
  ULONG_PTR deviceSetFormatBodyA;
  ULONG_PTR deviceSetFormatBodyW;
  ULONG_PTR deviceSetEventBodyA;
  ULONG_PTR deviceSetEventBodyW;
  ULONG_PTR deviceSetCoopBodyA;
  ULONG_PTR deviceSetCoopBodyW;
  ULONG_PTR devicePollBodyA;
  ULONG_PTR devicePollBodyW;
  ULONG_PTR deviceSetActionMapBodyA;
  ULONG_PTR deviceSetActionMapBodyW;
};

struct BootstrapSnapshot {
  DWORD structSize;
  DWORD schemaVersion;
  DWORD restoreAfterWithSucceeded;
  DWORD cacheInitializedBeforeAttach;
  DWORD attachedBeforeEntry;
  LONG attachError;
  DWORD exactProviderValidated;
  DWORD exactBodiesValidated;
  DWORD registeredRootInterfaces;
  DWORD registeredDeviceInterfaces;
  DWORD registeredDeviceObjects;
  DWORD queryInterfaceBalanced;
  DWORD formatRegistryValid;
  DWORD unsupportedSurfaceObserved;
  DWORD blockLatched;
  DWORD readinessValid;
  DWORD generation;
  unsigned long long topologyEpoch;
  DWORD fencePhase;
  DWORD faultCode;
  DWORD neutralSamples;
  unsigned long long neutralSinceMs;
  DWORD factoryHookCalls;
  DWORD rootCreateHookCallsA;
  DWORD rootCreateHookCallsW;
  DWORD queryHookCalls;
  DWORD addRefHookCalls;
  DWORD releaseHookCalls;
  DWORD getStateHookCalls;
  DWORD getDataHookCalls;
  DWORD pollHookCalls;
  DWORD acquireHookCalls;
  DWORD unacquireHookCalls;
  DWORD setFormatHookCalls;
  DWORD setCoopHookCalls;
  DWORD setPropertyHookCalls;
  DWORD setEventHookCalls;
  DWORD setActionMapHookCalls;
  DWORD neutralProbeCalls;
  DWORD drainedEvents;
  DWORD topologyInvalidations;
  DWORD restoreFailurePermanent;
  DWORD recoveredAxisRanges;
  DWORD rearmCalls;
  DWORD inFlightHookCalls;
  DWORD peakInFlightHookCalls;
  DWORD detachWaitLoops;
  DWORD detachQuiesced;
};

using DirectInput8CreateFunction = HRESULT(WINAPI *)(HINSTANCE, DWORD, REFIID,
                                                     LPVOID *, LPUNKNOWN);
using RootCreateAFunction = HRESULT(STDMETHODCALLTYPE *)(
    IDirectInput8A *, REFGUID, IDirectInputDevice8A **, LPUNKNOWN);
using RootCreateWFunction = HRESULT(STDMETHODCALLTYPE *)(
    IDirectInput8W *, REFGUID, IDirectInputDevice8W **, LPUNKNOWN);
using DeviceQueryAFunction =
    HRESULT(STDMETHODCALLTYPE *)(IDirectInputDevice8A *, REFIID, LPVOID *);
using DeviceQueryWFunction =
    HRESULT(STDMETHODCALLTYPE *)(IDirectInputDevice8W *, REFIID, LPVOID *);
using DeviceAddRefAFunction =
    ULONG(STDMETHODCALLTYPE *)(IDirectInputDevice8A *);
using DeviceAddRefWFunction =
    ULONG(STDMETHODCALLTYPE *)(IDirectInputDevice8W *);
using DeviceReleaseAFunction =
    ULONG(STDMETHODCALLTYPE *)(IDirectInputDevice8A *);
using DeviceReleaseWFunction =
    ULONG(STDMETHODCALLTYPE *)(IDirectInputDevice8W *);
using DeviceGetPropertyAFunction = HRESULT(STDMETHODCALLTYPE *)(
    IDirectInputDevice8A *, REFGUID, LPDIPROPHEADER);
using DeviceGetPropertyWFunction = HRESULT(STDMETHODCALLTYPE *)(
    IDirectInputDevice8W *, REFGUID, LPDIPROPHEADER);
using DeviceSetPropertyAFunction = HRESULT(STDMETHODCALLTYPE *)(
    IDirectInputDevice8A *, REFGUID, LPCDIPROPHEADER);
using DeviceSetPropertyWFunction = HRESULT(STDMETHODCALLTYPE *)(
    IDirectInputDevice8W *, REFGUID, LPCDIPROPHEADER);
using DeviceAcquireAFunction =
    HRESULT(STDMETHODCALLTYPE *)(IDirectInputDevice8A *);
using DeviceAcquireWFunction =
    HRESULT(STDMETHODCALLTYPE *)(IDirectInputDevice8W *);
using DeviceUnacquireAFunction =
    HRESULT(STDMETHODCALLTYPE *)(IDirectInputDevice8A *);
using DeviceUnacquireWFunction =
    HRESULT(STDMETHODCALLTYPE *)(IDirectInputDevice8W *);
using DeviceGetStateAFunction =
    HRESULT(STDMETHODCALLTYPE *)(IDirectInputDevice8A *, DWORD, LPVOID);
using DeviceGetStateWFunction =
    HRESULT(STDMETHODCALLTYPE *)(IDirectInputDevice8W *, DWORD, LPVOID);
using DeviceGetDataAFunction = HRESULT(STDMETHODCALLTYPE *)(
    IDirectInputDevice8A *, DWORD, LPDIDEVICEOBJECTDATA, LPDWORD, DWORD);
using DeviceGetDataWFunction = HRESULT(STDMETHODCALLTYPE *)(
    IDirectInputDevice8W *, DWORD, LPDIDEVICEOBJECTDATA, LPDWORD, DWORD);
using DeviceSetFormatAFunction =
    HRESULT(STDMETHODCALLTYPE *)(IDirectInputDevice8A *, LPCDIDATAFORMAT);
using DeviceSetFormatWFunction =
    HRESULT(STDMETHODCALLTYPE *)(IDirectInputDevice8W *, LPCDIDATAFORMAT);
using DeviceSetEventAFunction =
    HRESULT(STDMETHODCALLTYPE *)(IDirectInputDevice8A *, HANDLE);
using DeviceSetEventWFunction =
    HRESULT(STDMETHODCALLTYPE *)(IDirectInputDevice8W *, HANDLE);
using DeviceSetCoopAFunction =
    HRESULT(STDMETHODCALLTYPE *)(IDirectInputDevice8A *, HWND, DWORD);
using DeviceSetCoopWFunction =
    HRESULT(STDMETHODCALLTYPE *)(IDirectInputDevice8W *, HWND, DWORD);
using DevicePollAFunction =
    HRESULT(STDMETHODCALLTYPE *)(IDirectInputDevice8A *);
using DevicePollWFunction =
    HRESULT(STDMETHODCALLTYPE *)(IDirectInputDevice8W *);
using DeviceSetActionMapAFunction = HRESULT(STDMETHODCALLTYPE *)(
    IDirectInputDevice8A *, LPDIACTIONFORMATA, LPCSTR, DWORD);
using DeviceSetActionMapWFunction = HRESULT(STDMETHODCALLTYPE *)(
    IDirectInputDevice8W *, LPDIACTIONFORMATW, LPCWSTR, DWORD);

} // namespace gamehub::overlay::directinput_qa

#if defined(GAMEHUB_DI_PROVIDER_DEFINITIONS)
#define GAMEHUB_DI_PROVIDER_API
#else
#define GAMEHUB_DI_PROVIDER_API __declspec(dllimport)
#endif

#if defined(GAMEHUB_DI_CACHE_EXPORTS)
#define GAMEHUB_DI_CACHE_API __declspec(dllexport)
#else
#define GAMEHUB_DI_CACHE_API __declspec(dllimport)
#endif

extern "C" GAMEHUB_DI_PROVIDER_API BOOL WINAPI
GameHubSyntheticDiGetProviderSnapshot(
    gamehub::overlay::directinput_qa::ProviderSnapshot *output,
    DWORD output_size);
extern "C" GAMEHUB_DI_PROVIDER_API BOOL WINAPI GameHubSyntheticDiSetPhysical(
    BOOL neutral, DWORD queued_events, HRESULT next_data_result);
extern "C" GAMEHUB_DI_PROVIDER_API BOOL WINAPI
GameHubSyntheticDiSetActionMapResult(HRESULT result);
extern "C" GAMEHUB_DI_PROVIDER_API BOOL WINAPI GameHubSyntheticDiSetRange(
    LPUNKNOWN device, DWORD offset, LONG minimum, LONG maximum);
extern "C" GAMEHUB_DI_PROVIDER_API LPCDIDATAFORMAT WINAPI
GameHubSyntheticDiGetFormat(
    gamehub::overlay::directinput_qa::FormatKind format_kind);

extern "C" GAMEHUB_DI_CACHE_API BOOL WINAPI GameHubDiQaGetCacheSnapshot(
    gamehub::overlay::directinput_qa::CacheSnapshot *output, DWORD output_size);
extern "C" GAMEHUB_DI_CACHE_API BOOL WINAPI GameHubDiQaGetProviderSnapshot(
    gamehub::overlay::directinput_qa::ProviderSnapshot *output,
    DWORD output_size);
extern "C" GAMEHUB_DI_CACHE_API IDirectInput8A *WINAPI GameHubDiQaGetRootA();
extern "C" GAMEHUB_DI_CACHE_API IDirectInput8W *WINAPI GameHubDiQaGetRootW();
extern "C" GAMEHUB_DI_CACHE_API IDirectInputDevice8A *WINAPI
GameHubDiQaGetDeviceA();
extern "C" GAMEHUB_DI_CACHE_API IDirectInputDevice8W *WINAPI
GameHubDiQaGetDeviceW();
extern "C" GAMEHUB_DI_CACHE_API BOOL WINAPI GameHubDiQaSetPhysical(
    BOOL neutral, DWORD queued_events, HRESULT next_data_result);
extern "C" GAMEHUB_DI_CACHE_API BOOL WINAPI
GameHubDiQaSetActionMapResult(HRESULT result);
extern "C" GAMEHUB_DI_CACHE_API BOOL WINAPI
GameHubDiQaSetRange(LPUNKNOWN device, DWORD offset, LONG minimum, LONG maximum);
extern "C" GAMEHUB_DI_CACHE_API BOOL WINAPI GameHubDiQaReleaseAll();
extern "C" GAMEHUB_DI_CACHE_API BOOL WINAPI
GameHubDiQaTamperPollSlotForNegativeControl(BOOL restore);

extern "C" BOOL WINAPI GameHubDiQaGetBootstrapSnapshot(
    gamehub::overlay::directinput_qa::BootstrapSnapshot *output,
    DWORD output_size);
extern "C" DWORD WINAPI
GameHubDiQaBeginBlock(DWORD generation, unsigned long long topology_epoch);
extern "C" DWORD WINAPI
GameHubDiQaRequestClose(DWORD generation, unsigned long long topology_epoch);
extern "C" DWORD WINAPI
GameHubDiQaObserveRelease(DWORD generation, unsigned long long topology_epoch,
                          unsigned long long now_ms);
extern "C" DWORD WINAPI GameHubDiQaInvalidateTopology(
    DWORD generation, unsigned long long topology_epoch);
extern "C" DWORD WINAPI
GameHubDiQaRevalidate(DWORD generation, unsigned long long topology_epoch);
extern "C" DWORD WINAPI GameHubDiQaRearm(
    DWORD completed_generation, unsigned long long completed_topology_epoch,
    DWORD new_generation, unsigned long long new_topology_epoch,
    unsigned long long authorization);
extern "C" DWORD WINAPI GameHubDiQaDetach();
extern "C" DWORD WINAPI GameHubDiQaAttachLateForNegativeControl();
extern "C" BOOL WINAPI GameHubDiQaSetHotCallPauseForStress(BOOL pause);
