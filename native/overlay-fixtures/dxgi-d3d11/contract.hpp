#pragma once

#include <d3d11.h>
#include <dxgi1_4.h>
#include <windows.h>

#include <cstdint>

namespace gamehub::overlay::dxgi_d3d11_qa {

constexpr DWORD kSchemaVersion = 1;
constexpr DWORD kD3d11BaseGetterVisibleStateMask = 0x0000ffffu;
constexpr UINT kQaOmRenderTargetCount = 1u;
constexpr UINT kQaOmUavStartSlot = 1u;
constexpr UINT kQaOmUavCount =
    D3D11_PS_CS_UAV_REGISTER_COUNT - kQaOmUavStartSlot;
constexpr wchar_t kBootstrapModuleName[] =
    L"gamehub-overlay-qa-dxgi-d3d11-bootstrap64.dll";

enum PipelineStateBit : DWORD {
  kStateIa = 1u << 0u,
  kStateVs = 1u << 1u,
  kStateHs = 1u << 2u,
  kStateDs = 1u << 3u,
  kStateGs = 1u << 4u,
  kStatePs = 1u << 5u,
  kStateCs = 1u << 6u,
  kStateRs = 1u << 7u,
  kStateOmTargets = 1u << 8u,
  kStateOmBlend = 1u << 9u,
  kStateOmDepth = 1u << 10u,
  kStateOmUav = 1u << 11u,
  kStateCsUav = 1u << 12u,
  kStateSo = 1u << 13u,
  kStatePredication = 1u << 14u,
  kStateClassInstances = 1u << 15u,
};

struct MethodAddressSnapshot {
  ULONG_PTR release;
  ULONG_PTR present;
  ULONG_PTR setFullscreenState;
  ULONG_PTR resizeBuffers;
  ULONG_PTR present1;
  ULONG_PTR setSourceSize;
  ULONG_PTR resizeBuffers1;
};

struct BootstrapSnapshot {
  DWORD structSize;
  DWORD schemaVersion;
  DWORD restoreAfterWithSucceeded;
  DWORD dllMainD3dCalls;
  LONG entryAttachError;
  LONG methodAttachError;
  DWORD entryHookAttached;
  DWORD methodDiscoveryBeforeApplicationEntry;
  DWORD methodHooksAttached;
  DWORD methodAttachThreadsEnlisted;
  DWORD present1Present;
  DWORD setSourceSizePresent;
  DWORD resizeBuffers1Present;
  DWORD registered;
  DWORD identityMatched;
  DWORD deviceIdentityMatched;
  DWORD immediateContextMatched;
  DWORD liveMethodBodiesMatched;
  DWORD releaseTokenBodiesMatched;
  DWORD getterVisibleStateMask;
  DWORD overlayReady;
  DWORD invalidated;
  DWORD invalidationReason;
  DWORD detachAttempted;
  LONG detachError;
  DWORD detachQuiesced;
  DWORD detachWaitingExclusive;
  DWORD detachCommitComplete;
  DWORD detachThreadsEnlisted;
  LONG inFlight;
  LONG peakInFlight;
  LONG callbackAdmissionWaiters;
  unsigned long long callbackAdmissionAttempts;
  LONG presentGate;
  unsigned long long presentCalls;
  unsigned long long present1Calls;
  unsigned long long overlayDraws;
  unsigned long long stateRestoreChecks;
  unsigned long long stateRestoreMismatches;
  DWORD lastStateRestoreDifferenceMask;
  unsigned long long postDetachPresentForwards;
  unsigned long long skippedContention;
  unsigned long long skippedUnregistered;
  unsigned long long competingChainRefusals;
  unsigned long long resizeBuffersCalls;
  unsigned long long resizeBuffersSuccesses;
  unsigned long long resizeBuffersFailures;
  unsigned long long resizeBuffers1Calls;
  unsigned long long resizeBuffers1Successes;
  unsigned long long resizeBuffers1Failures;
  unsigned long long setSourceSizeCalls;
  unsigned long long setSourceSizeSuccesses;
  unsigned long long setSourceSizeFailures;
  unsigned long long fullscreenCalls;
  unsigned long long releaseCalls;
  unsigned long long destroyedInvalidations;
  unsigned long long deviceLostInvalidations;
  unsigned long long resourceRecreations;
  unsigned long long multisampleBackbuffers;
  ULONG_PTR selectedSwapChain;
  ULONG_PTR selectedDevice;
  ULONG_PTR selectedContext;
  MethodAddressSnapshot cachedMethods;
  MethodAddressSnapshot attachedMethods;
};

using ApplicationEntryFunction = int(WINAPI *)();

} // namespace gamehub::overlay::dxgi_d3d11_qa

extern "C" __declspec(dllexport) int WINAPI
GameHubDxgiD3d11QaApplicationEntry();

extern "C" BOOL WINAPI GameHubDxgiD3d11QaGetSnapshot(
    gamehub::overlay::dxgi_d3d11_qa::BootstrapSnapshot *output,
    DWORD output_size);
extern "C" HRESULT WINAPI GameHubDxgiD3d11QaRegisterSwapChain(
    IDXGISwapChain *swap_chain, ID3D11Device *device,
    ID3D11DeviceContext *context);
extern "C" void WINAPI GameHubDxgiD3d11QaSetPresentGate(BOOL held);
extern "C" void WINAPI GameHubDxgiD3d11QaSetPauseInFlight(BOOL held);
extern "C" DWORD WINAPI GameHubDxgiD3d11QaDetach();
extern "C" BOOL WINAPI
GameHubDxgiD3d11QaApplyTerminalPresentResult(HRESULT result);
