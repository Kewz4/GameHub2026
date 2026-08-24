#pragma once

#include <d3d12.h>
#include <dxgi1_4.h>
#include <windows.h>

namespace gamehub::overlay::dxgi_d3d12_qa {

constexpr DWORD kSchemaVersion = 1;
constexpr UINT kMaximumBackBuffers = 4;
constexpr wchar_t kBootstrapModuleName[] =
    L"gamehub-overlay-qa-dxgi-d3d12-bootstrap64.dll";

enum QaFaultMode : DWORD {
  kQaFaultNone = 0,
  kQaFaultNextSubmissionSignal = 1,
  kQaFaultNextIdleWaitStaleTimeout = 2,
};

struct MethodAddressSnapshot {
  ULONG_PTR present;
  ULONG_PTR setFullscreenState;
  ULONG_PTR resizeBuffers;
  ULONG_PTR present1;
  ULONG_PTR createSwapChainForHwnd;
};

struct BootstrapSnapshot {
  DWORD structSize;
  DWORD schemaVersion;
  DWORD restoreAfterWithSucceeded;
  DWORD dllMainGraphicsCalls;
  LONG entryAttachError;
  LONG methodAttachError;
  DWORD entryHookAttached;
  DWORD methodDiscoveryBeforeApplicationEntry;
  DWORD methodHooksAttached;
  DWORD methodAttachThreadsEnlisted;
  DWORD present1Present;
  DWORD createSwapChainHookPresent;
  DWORD registered;
  DWORD identityMatched;
  DWORD deviceIdentityMatched;
  DWORD commandQueueIdentityMatched;
  DWORD creationRecordMatched;
  DWORD liveMethodBodiesMatched;
  DWORD overlayReady;
  DWORD preallocatedHotPathResources;
  DWORD separateCommandListSubmission;
  DWORD armedFaultMode;
  DWORD untrackedSubmission;
  DWORD retiredSubmissionSlots;
  DWORD idleWaitPoisoned;
  DWORD registeredResourcesRetired;
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
  unsigned long long presentCalls;
  unsigned long long present1Calls;
  unsigned long long commandListsExecuted;
  unsigned long long overlaySubmissions;
  unsigned long long submissionSignalFailures;
  unsigned long long submissionSlotRetirements;
  unsigned long long independentIdleRecoveries;
  unsigned long long commandQueueSignals;
  unsigned long long resourceIdleSignals;
  unsigned long long resourceIdleCompletions;
  unsigned long long resourceIdleFailures;
  unsigned long long resourceIdleWaitsOutsidePresent;
  unsigned long long resourceIdleTimeouts;
  unsigned long long staleWakeRejections;
  unsigned long long retiredWaitEvents;
  unsigned long long presentBlockingWaitCalls;
  unsigned long long skippedContention;
  unsigned long long skippedGpuBusy;
  unsigned long long skippedUnregistered;
  unsigned long long competingChainRefusals;
  unsigned long long resizeBuffersCalls;
  unsigned long long resizeBuffersSuccesses;
  unsigned long long resizeBuffersFailures;
  unsigned long long fullscreenCalls;
  unsigned long long creationRecords;
  unsigned long long creationRecordOverflows;
  unsigned long long resourceRecreations;
  unsigned long long postDetachPresentForwards;
  ULONG_PTR selectedSwapChain;
  ULONG_PTR selectedDevice;
  ULONG_PTR selectedCommandQueue;
  MethodAddressSnapshot cachedMethods;
  MethodAddressSnapshot attachedMethods;
};

using ApplicationEntryFunction = int(WINAPI *)();

} // namespace gamehub::overlay::dxgi_d3d12_qa

extern "C" __declspec(dllexport) int WINAPI
GameHubDxgiD3d12QaApplicationEntry();

extern "C" BOOL WINAPI GameHubDxgiD3d12QaGetSnapshot(
    gamehub::overlay::dxgi_d3d12_qa::BootstrapSnapshot *output,
    DWORD output_size);
extern "C" HRESULT WINAPI GameHubDxgiD3d12QaRegisterSwapChain(
    IDXGISwapChain *swap_chain, ID3D12Device *device,
    ID3D12CommandQueue *command_queue);
extern "C" void WINAPI GameHubDxgiD3d12QaSetPresentGate(BOOL held);
extern "C" void WINAPI GameHubDxgiD3d12QaSetPauseInFlight(BOOL held);
extern "C" BOOL WINAPI GameHubDxgiD3d12QaArmFault(DWORD fault_mode);
extern "C" DWORD WINAPI GameHubDxgiD3d12QaDetach();
