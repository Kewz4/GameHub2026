#include "contract.hpp"

#include <atomic>
#include <cstdint>
#include <cstring>
#include <shellapi.h>
#include <sstream>
#include <string>
#include <thread>

namespace {

using namespace gamehub::overlay::dxgi_d3d12_qa;

using GetSnapshotFunction = BOOL(WINAPI *)(BootstrapSnapshot *, DWORD);
using RegisterFunction = HRESULT(WINAPI *)(IDXGISwapChain *, ID3D12Device *,
                                           ID3D12CommandQueue *);
using SetFlagFunction = void(WINAPI *)(BOOL);
using ArmFaultFunction = BOOL(WINAPI *)(DWORD);
using DetachFunction = DWORD(WINAPI *)();
using CachedPresentFunction = HRESULT(STDMETHODCALLTYPE *)(IDXGISwapChain *,
                                                           UINT, UINT);
using CreateSwapChainForHwndFunction = HRESULT(STDMETHODCALLTYPE *)(
    IDXGIFactory2 *, IUnknown *, HWND, const DXGI_SWAP_CHAIN_DESC1 *,
    const DXGI_SWAP_CHAIN_FULLSCREEN_DESC *, IDXGIOutput *, IDXGISwapChain1 **);

struct BootstrapApi {
  HMODULE module = nullptr;
  GetSnapshotFunction snapshot = nullptr;
  RegisterFunction registerChain = nullptr;
  SetFlagFunction setGate = nullptr;
  SetFlagFunction setPause = nullptr;
  ArmFaultFunction armFault = nullptr;
  DetachFunction detach = nullptr;
};

template <typename T> void SafeRelease(T *&value) noexcept {
  if (value != nullptr) {
    value->Release();
    value = nullptr;
  }
}

BootstrapApi ResolveBootstrap() noexcept {
  BootstrapApi api{};
  api.module = GetModuleHandleW(kBootstrapModuleName);
  if (api.module == nullptr)
    return api;
  api.snapshot = reinterpret_cast<GetSnapshotFunction>(
      GetProcAddress(api.module, "GameHubDxgiD3d12QaGetSnapshot"));
  api.registerChain = reinterpret_cast<RegisterFunction>(
      GetProcAddress(api.module, "GameHubDxgiD3d12QaRegisterSwapChain"));
  api.setGate = reinterpret_cast<SetFlagFunction>(
      GetProcAddress(api.module, "GameHubDxgiD3d12QaSetPresentGate"));
  api.setPause = reinterpret_cast<SetFlagFunction>(
      GetProcAddress(api.module, "GameHubDxgiD3d12QaSetPauseInFlight"));
  api.armFault = reinterpret_cast<ArmFaultFunction>(
      GetProcAddress(api.module, "GameHubDxgiD3d12QaArmFault"));
  api.detach = reinterpret_cast<DetachFunction>(
      GetProcAddress(api.module, "GameHubDxgiD3d12QaDetach"));
  return api;
}

HWND CreateFixtureWindow(const wchar_t *title) noexcept {
  return CreateWindowExW(0, L"STATIC", title, WS_OVERLAPPED, 0, 0, 128, 128,
                         nullptr, nullptr, GetModuleHandleW(nullptr), nullptr);
}

HRESULT LastErrorOrFailure() noexcept {
  const DWORD error = GetLastError();
  return error == NO_ERROR ? E_FAIL : HRESULT_FROM_WIN32(error);
}

HRESULT CreateQueue(ID3D12Device *device,
                    ID3D12CommandQueue **output) noexcept {
  D3D12_COMMAND_QUEUE_DESC description{};
  description.Type = D3D12_COMMAND_LIST_TYPE_DIRECT;
  return device->CreateCommandQueue(&description, IID_PPV_ARGS(output));
}

struct ChainSet {
  HWND primaryWindow = nullptr;
  HWND competingWindow = nullptr;
  IDXGIFactory4 *factory = nullptr;
  ID3D12Device *device = nullptr;
  ID3D12CommandQueue *primaryQueue = nullptr;
  ID3D12CommandQueue *competingQueue = nullptr;
  ID3D12CommandQueue *unassociatedQueue = nullptr;
  IDXGISwapChain *primary = nullptr;
  IDXGISwapChain *competing = nullptr;

  bool Release() noexcept {
    const HWND primary_window = primaryWindow;
    const HWND competing_window = competingWindow;
    if (primary != nullptr)
      primary->SetFullscreenState(FALSE, nullptr);
    if (competing != nullptr)
      competing->SetFullscreenState(FALSE, nullptr);
    SafeRelease(competing);
    SafeRelease(primary);
    SafeRelease(unassociatedQueue);
    SafeRelease(competingQueue);
    SafeRelease(primaryQueue);
    SafeRelease(device);
    SafeRelease(factory);
    if (competingWindow != nullptr)
      DestroyWindow(competingWindow);
    if (primaryWindow != nullptr)
      DestroyWindow(primaryWindow);
    competingWindow = nullptr;
    primaryWindow = nullptr;
    return IsWindow(primary_window) == FALSE &&
           IsWindow(competing_window) == FALSE;
  }
};

HRESULT CreateChains(ChainSet *output, const char **stage) noexcept {
  *stage = "primary-window";
  output->primaryWindow =
      CreateFixtureWindow(L"GameHub DXGI D3D12 QA primary");
  if (output->primaryWindow == nullptr)
    return LastErrorOrFailure();
  *stage = "competing-window";
  output->competingWindow =
      CreateFixtureWindow(L"GameHub DXGI D3D12 QA competing");
  if (output->competingWindow == nullptr)
    return LastErrorOrFailure();
  *stage = "dxgi-factory";
  HRESULT result = CreateDXGIFactory2(0, IID_PPV_ARGS(&output->factory));
  IDXGIAdapter *adapter = nullptr;
  if (SUCCEEDED(result)) {
    *stage = "warp-adapter";
    result = output->factory->EnumWarpAdapter(IID_PPV_ARGS(&adapter));
  }
  if (SUCCEEDED(result)) {
    *stage = "d3d12-device";
    result = D3D12CreateDevice(adapter, D3D_FEATURE_LEVEL_11_0,
                               IID_PPV_ARGS(&output->device));
  }
  SafeRelease(adapter);
  if (SUCCEEDED(result)) {
    *stage = "primary-command-queue";
    result = CreateQueue(output->device, &output->primaryQueue);
  }
  if (SUCCEEDED(result)) {
    *stage = "competing-command-queue";
    result = CreateQueue(output->device, &output->competingQueue);
  }
  if (SUCCEEDED(result)) {
    *stage = "unassociated-command-queue";
    result = CreateQueue(output->device, &output->unassociatedQueue);
  }

  DXGI_SWAP_CHAIN_DESC1 description{};
  description.Width = 128;
  description.Height = 128;
  description.Format = DXGI_FORMAT_B8G8R8A8_UNORM;
  description.SampleDesc.Count = 1;
  description.BufferUsage = DXGI_USAGE_RENDER_TARGET_OUTPUT;
  description.BufferCount = 2;
  description.SwapEffect = DXGI_SWAP_EFFECT_FLIP_DISCARD;
  description.Scaling = DXGI_SCALING_STRETCH;
  description.AlphaMode = DXGI_ALPHA_MODE_IGNORE;
  DXGI_SWAP_CHAIN_FULLSCREEN_DESC fullscreen{};
  fullscreen.Windowed = TRUE;
  IDXGISwapChain1 *primary1 = nullptr;
  IDXGISwapChain1 *competing1 = nullptr;
  if (SUCCEEDED(result)) {
    *stage = "primary-swap-chain";
    result = output->factory->CreateSwapChainForHwnd(
        output->primaryQueue, output->primaryWindow, &description, &fullscreen,
        nullptr, &primary1);
  }
  if (SUCCEEDED(result)) {
    *stage = "competing-swap-chain";
    result = output->factory->CreateSwapChainForHwnd(
        output->competingQueue, output->competingWindow, &description,
        &fullscreen, nullptr, &competing1);
  }
  if (SUCCEEDED(result)) {
    *stage = "primary-swap-chain-interface";
    result = primary1->QueryInterface(IID_PPV_ARGS(&output->primary));
  }
  if (SUCCEEDED(result)) {
    *stage = "competing-swap-chain-interface";
    result = competing1->QueryInterface(IID_PPV_ARGS(&output->competing));
  }
  SafeRelease(competing1);
  SafeRelease(primary1);
  if (SUCCEEDED(result)) {
    SetWindowPos(output->primaryWindow, nullptr, 0, 0, 160, 144,
                 SWP_NOMOVE | SWP_NOACTIVATE | SWP_NOZORDER);
    *stage = "complete";
  }
  return result;
}

MethodAddressSnapshot MethodsFor(IDXGISwapChain *chain,
                                 IDXGIFactory2 *factory) noexcept {
  MethodAddressSnapshot methods{};
  auto **table = *reinterpret_cast<void ***>(chain);
  methods.present = reinterpret_cast<ULONG_PTR>(table[8]);
  methods.setFullscreenState = reinterpret_cast<ULONG_PTR>(table[10]);
  methods.resizeBuffers = reinterpret_cast<ULONG_PTR>(table[13]);
  IDXGISwapChain1 *chain1 = nullptr;
  if (SUCCEEDED(chain->QueryInterface(IID_PPV_ARGS(&chain1)))) {
    table = *reinterpret_cast<void ***>(chain1);
    methods.present1 = reinterpret_cast<ULONG_PTR>(table[22]);
  }
  SafeRelease(chain1);
  methods.createSwapChainForHwnd = reinterpret_cast<ULONG_PTR>(
      (*reinterpret_cast<void ***>(factory))[15]);
  return methods;
}

bool SameMethods(const MethodAddressSnapshot &left,
                 const MethodAddressSnapshot &right) noexcept {
  return std::memcmp(&left, &right, sizeof(left)) == 0;
}

bool WriteResult(const wchar_t *path, const std::string &data) noexcept {
  HANDLE file =
      CreateFileW(path, GENERIC_WRITE, 0, nullptr, CREATE_NEW,
                  FILE_ATTRIBUTE_NORMAL | FILE_FLAG_WRITE_THROUGH, nullptr);
  if (file == INVALID_HANDLE_VALUE)
    return false;
  DWORD written = 0;
  const bool ok = data.size() <= MAXDWORD &&
                  WriteFile(file, data.data(), static_cast<DWORD>(data.size()),
                            &written, nullptr) &&
                  written == data.size() && FlushFileBuffers(file);
  CloseHandle(file);
  return ok;
}

std::wstring AdjacentBootstrapPath() {
  wchar_t module_path[32768]{};
  const DWORD length =
      GetModuleFileNameW(nullptr, module_path, ARRAYSIZE(module_path));
  if (length == 0 || length >= ARRAYSIZE(module_path))
    return {};
  std::wstring path(module_path, length);
  const std::size_t separator = path.find_last_of(L"\\/");
  if (separator == std::wstring::npos)
    return {};
  path.resize(separator + 1);
  path.append(kBootstrapModuleName);
  return path;
}

bool ParseArguments(std::wstring *result_path, std::wstring *scenario) {
  int count = 0;
  wchar_t **values = CommandLineToArgvW(GetCommandLineW(), &count);
  if (values == nullptr || count != 5 || wcscmp(values[1], L"--result") != 0 ||
      wcscmp(values[3], L"--scenario") != 0) {
    if (values != nullptr)
      LocalFree(values);
    return false;
  }
  *result_path = values[2];
  *scenario = values[4];
  LocalFree(values);
  return !result_path->empty() && !scenario->empty();
}

bool IsGenuineEnvironmentUnsupported(const char *stage,
                                     HRESULT result) noexcept {
  const bool dxgi_factory_stage = std::strcmp(stage, "dxgi-factory") == 0;
  const bool warp_adapter_stage = std::strcmp(stage, "warp-adapter") == 0;
  const bool d3d12_device_stage = std::strcmp(stage, "d3d12-device") == 0;
  if (!dxgi_factory_stage && !warp_adapter_stage && !d3d12_device_stage)
    return false;
  if (result == DXGI_ERROR_UNSUPPORTED)
    return true;
  if (warp_adapter_stage && result == DXGI_ERROR_NOT_FOUND)
    return true;
  if ((dxgi_factory_stage || d3d12_device_stage) &&
      (result == E_NOINTERFACE || result == E_NOTIMPL ||
       result == HRESULT_FROM_WIN32(ERROR_NOT_SUPPORTED))) {
    return true;
  }
  return false;
}

int WriteSetupFailure(const std::wstring &path, const char *stage,
                      HRESULT result) {
  const bool unsupported = IsGenuineEnvironmentUnsupported(stage, result);
  std::ostringstream json;
  json << "{\"schemaVersion\":1,\"unsupported\":"
       << (unsupported ? "true" : "false")
       << ",\"setupFailed\":true,\"createStage\":\"" << stage
       << "\",\"createResult\":"
       << static_cast<std::uint32_t>(result)
       << ",\"proofPassed\":false}\n";
  return WriteResult(path.c_str(), json.str()) ? (unsupported ? 77 : 21) : 22;
}

int RunFixture() {
  std::wstring result_path;
  std::wstring scenario;
  if (!ParseArguments(&result_path, &scenario))
    return 20;
  const bool late_attach = scenario == L"late-attach";
  const bool detach_barrier = scenario == L"detach-barrier";
  const bool signal_fault = scenario == L"signal-fault";
  const bool stale_wait_fault = scenario == L"idle-stale-timeout";
  const bool simulated_unsupported = scenario == L"setup-unsupported";
  const bool simulated_hard_failure = scenario == L"setup-hard-failure";
  if (!late_attach && !detach_barrier && !signal_fault && !stale_wait_fault &&
      !simulated_unsupported && !simulated_hard_failure &&
      scenario != L"normal") {
    return 20;
  }
  if (simulated_unsupported) {
    return WriteSetupFailure(result_path, "d3d12-device",
                             DXGI_ERROR_UNSUPPORTED);
  }
  if (simulated_hard_failure) {
    return WriteSetupFailure(result_path, "primary-command-queue",
                             E_OUTOFMEMORY);
  }

  ChainSet chains;
  const char *create_stage = "not-started";
  const HRESULT create_result = CreateChains(&chains, &create_stage);
  if (FAILED(create_result)) {
    chains.Release();
    return WriteSetupFailure(result_path, create_stage, create_result);
  }
  const bool windows_created = IsWindow(chains.primaryWindow) != FALSE &&
                               IsWindow(chains.competingWindow) != FALSE;
  RECT resized_window{};
  const bool window_rect_read =
      GetWindowRect(chains.primaryWindow, &resized_window) != FALSE;
  const MethodAddressSnapshot application_methods =
      MethodsFor(chains.primary, chains.factory);
  const auto cached_present =
      reinterpret_cast<CachedPresentFunction>(application_methods.present);

  BootstrapApi api = ResolveBootstrap();
  if (late_attach && api.module == nullptr) {
    const std::wstring path = AdjacentBootstrapPath();
    LoadLibraryW(path.c_str());
    api = ResolveBootstrap();
  }
  BootstrapSnapshot before{};
  const bool snapshot_before =
      api.snapshot != nullptr && api.snapshot(&before, sizeof(before));

  HRESULT wrong_queue_register_result = E_NOINTERFACE;
  HRESULT register_result = E_NOINTERFACE;
  if (!late_attach && api.registerChain != nullptr) {
    wrong_queue_register_result = api.registerChain(
        chains.primary, chains.device, chains.unassociatedQueue);
    register_result =
        api.registerChain(chains.primary, chains.device, chains.primaryQueue);
  }
  BootstrapSnapshot registered{};
  const bool snapshot_registered =
      api.snapshot != nullptr && api.snapshot(&registered, sizeof(registered));
  const bool registered_pointers_match =
      snapshot_registered && SUCCEEDED(register_result) &&
      registered.selectedSwapChain ==
          reinterpret_cast<ULONG_PTR>(chains.primary) &&
      registered.selectedDevice == reinterpret_cast<ULONG_PTR>(chains.device) &&
      registered.selectedCommandQueue ==
          reinterpret_cast<ULONG_PTR>(chains.primaryQueue);

  BOOL fault_arm_result = FALSE;
  if (SUCCEEDED(register_result) && api.armFault != nullptr) {
    if (signal_fault) {
      fault_arm_result = api.armFault(kQaFaultNextSubmissionSignal);
    } else if (stale_wait_fault) {
      fault_arm_result =
          api.armFault(kQaFaultNextIdleWaitStaleTimeout);
    }
  }
  HRESULT primary_present = cached_present(chains.primary, 0, 0);
  BootstrapSnapshot first_fault{};
  const bool snapshot_first_fault =
      signal_fault && api.snapshot != nullptr &&
      api.snapshot(&first_fault, sizeof(first_fault));
  HRESULT fault_repeat_present = E_NOTIMPL;
  BootstrapSnapshot repeated_fault{};
  bool snapshot_repeated_fault = false;
  if (signal_fault) {
    fault_repeat_present = chains.primary->Present(0, 0);
    snapshot_repeated_fault =
        api.snapshot != nullptr &&
        api.snapshot(&repeated_fault, sizeof(repeated_fault));
  }
  const HRESULT competing_present = chains.competing->Present(0, 0);
  HRESULT contention_present = E_NOTIMPL;
  if (api.setGate != nullptr && SUCCEEDED(register_result)) {
    api.setGate(TRUE);
    contention_present = chains.primary->Present(0, 0);
    api.setGate(FALSE);
  }

  HRESULT present1_result = E_NOINTERFACE;
  IDXGISwapChain1 *chain1 = nullptr;
  if (SUCCEEDED(chains.primary->QueryInterface(IID_PPV_ARGS(&chain1)))) {
    DXGI_PRESENT_PARAMETERS parameters{};
    present1_result = chain1->Present1(0, 0, &parameters);
  }
  SafeRelease(chain1);

  const HRESULT fullscreen_result =
      chains.primary->SetFullscreenState(FALSE, nullptr);
  BOOL fullscreen_state = TRUE;
  IDXGIOutput *fullscreen_output = nullptr;
  const HRESULT fullscreen_query_result =
      chains.primary->GetFullscreenState(&fullscreen_state, &fullscreen_output);
  SafeRelease(fullscreen_output);

  HRESULT resize_failure = E_NOTIMPL;
  HRESULT resize_success = E_NOTIMPL;
  BootstrapSnapshot first_idle_fault{};
  bool snapshot_first_idle_fault = false;
  if (SUCCEEDED(register_result)) {
    ID3D12Resource *held_backbuffer = nullptr;
    if (SUCCEEDED(chains.primary->GetBuffer(
            0, IID_PPV_ARGS(&held_backbuffer)))) {
      resize_failure = chains.primary->ResizeBuffers(
          2, 144, 144, DXGI_FORMAT_B8G8R8A8_UNORM, 0);
    }
    if (stale_wait_fault) {
      snapshot_first_idle_fault =
          api.snapshot != nullptr &&
          api.snapshot(&first_idle_fault, sizeof(first_idle_fault));
    }
    SafeRelease(held_backbuffer);
    resize_success = chains.primary->ResizeBuffers(
        2, 160, 160, DXGI_FORMAT_B8G8R8A8_UNORM, 0);
    if (SUCCEEDED(resize_success))
      primary_present = chains.primary->Present(0, 0);
  }

  bool detach_observed_in_flight = false;
  bool detach_blocked_for_reader = false;
  bool detach_waiting_exclusive_observed = false;
  bool late_entrant_admission_attempted = false;
  bool late_entrant_waiting_for_admission = false;
  bool late_entrant_blocked_before_admission = false;
  bool late_entrant_forwarded_after_detach = false;
  HRESULT late_entrant_present_result = E_FAIL;
  DWORD detach_result = ERROR_INVALID_STATE;
  bool detached = false;

  if (detach_barrier && SUCCEEDED(register_result) && api.setPause != nullptr &&
      api.detach != nullptr) {
    api.setPause(TRUE);
    std::atomic<bool> present_done{false};
    std::atomic<bool> detach_done{false};
    std::atomic<bool> late_present_done{false};
    std::thread present_thread([&]() {
      chains.primary->Present(0, 0);
      present_done.store(true, std::memory_order_release);
    });
    BootstrapSnapshot barrier_snapshot{};
    for (DWORD attempt = 0; attempt < 100000u; ++attempt) {
      if (api.snapshot(&barrier_snapshot, sizeof(barrier_snapshot)) &&
          barrier_snapshot.inFlight > 0) {
        detach_observed_in_flight = true;
        break;
      }
      SwitchToThread();
    }
    std::thread detach_thread([&]() {
      detach_result = api.detach();
      detach_done.store(true, std::memory_order_release);
    });
    for (DWORD attempt = 0; attempt < 100000u; ++attempt) {
      if (api.snapshot(&barrier_snapshot, sizeof(barrier_snapshot)) &&
          barrier_snapshot.detachWaitingExclusive == 1u) {
        detach_waiting_exclusive_observed = true;
        break;
      }
      SwitchToThread();
    }
    detach_blocked_for_reader = !detach_done.load(std::memory_order_acquire) &&
                                !present_done.load(std::memory_order_acquire);
    std::thread late_present_thread;
    if (detach_waiting_exclusive_observed) {
      const unsigned long long attempts_before_late =
          barrier_snapshot.callbackAdmissionAttempts;
      late_present_thread = std::thread([&]() {
        late_entrant_present_result = chains.primary->Present(0, 0);
        late_present_done.store(true, std::memory_order_release);
      });
      const ULONGLONG deadline = GetTickCount64() + 2000u;
      while (GetTickCount64() < deadline) {
        if (api.snapshot(&barrier_snapshot, sizeof(barrier_snapshot)) &&
            barrier_snapshot.callbackAdmissionAttempts >
                attempts_before_late) {
          late_entrant_admission_attempted = true;
          if (barrier_snapshot.callbackAdmissionWaiters > 0) {
            late_entrant_waiting_for_admission = true;
            break;
          }
        }
        Sleep(1);
      }
      late_entrant_blocked_before_admission =
          late_entrant_waiting_for_admission &&
          !late_present_done.load(std::memory_order_acquire) &&
          !detach_done.load(std::memory_order_acquire);
    }
    api.setPause(FALSE);
    present_thread.join();
    detach_thread.join();
    if (late_present_thread.joinable())
      late_present_thread.join();
    detached = true;
  }

  BootstrapSnapshot pre_detach{};
  const bool snapshot_pre_detach =
      api.snapshot != nullptr && api.snapshot(&pre_detach, sizeof(pre_detach));
  if (!detached && api.detach != nullptr) {
    detach_result = api.detach();
    detached = true;
  }
  BootstrapSnapshot after{};
  const bool snapshot_after =
      api.snapshot != nullptr && api.snapshot(&after, sizeof(after));
  late_entrant_forwarded_after_detach =
      detach_barrier && SUCCEEDED(late_entrant_present_result) &&
      after.postDetachPresentForwards >= 1u;

  const bool method_identity =
      snapshot_before && SameMethods(application_methods, before.cachedMethods);
  const bool attached_method_identity =
      snapshot_before && SameMethods(before.cachedMethods, before.attachedMethods);
  const bool injected = snapshot_before && before.methodHooksAttached == 1u;
  const bool late_negative = late_attach && snapshot_before && snapshot_after &&
                             before.methodHooksAttached == 0u &&
                             pre_detach.presentCalls == 0u;
  const bool base_injected_proof =
      injected && before.restoreAfterWithSucceeded == 1u &&
      before.dllMainGraphicsCalls == 0u &&
      before.methodDiscoveryBeforeApplicationEntry == 1u &&
      before.methodAttachThreadsEnlisted >= 1u && method_identity &&
      attached_method_identity &&
      wrong_queue_register_result == E_NOINTERFACE &&
      SUCCEEDED(register_result) && registered_pointers_match &&
      registered.identityMatched == 1u &&
      registered.deviceIdentityMatched == 1u &&
      registered.commandQueueIdentityMatched == 1u &&
      registered.creationRecordMatched == 1u &&
      registered.liveMethodBodiesMatched == 1u &&
      registered.preallocatedHotPathResources == 1u &&
      registered.separateCommandListSubmission == 1u &&
      SUCCEEDED(primary_present) && SUCCEEDED(competing_present) &&
      SUCCEEDED(contention_present) && SUCCEEDED(present1_result) &&
      SUCCEEDED(fullscreen_result) && SUCCEEDED(fullscreen_query_result) &&
      fullscreen_state == FALSE && pre_detach.presentBlockingWaitCalls == 0u &&
      pre_detach.skippedContention >= 1u &&
      pre_detach.competingChainRefusals >= 1u &&
      pre_detach.fullscreenCalls == 1u &&
      pre_detach.creationRecords >= 2u &&
      pre_detach.creationRecordOverflows == 0u;
  const bool normal_resize_proof =
      !stale_wait_fault && resize_failure == DXGI_ERROR_INVALID_CALL &&
      SUCCEEDED(resize_success) && pre_detach.resizeBuffersCalls == 2u &&
      pre_detach.resizeBuffersSuccesses == 1u &&
      pre_detach.resizeBuffersFailures == 1u;
  const bool stale_resize_proof =
      stale_wait_fault && resize_failure == DXGI_ERROR_DEVICE_REMOVED &&
      resize_success == DXGI_ERROR_DEVICE_REMOVED &&
      pre_detach.resizeBuffersCalls == 2u &&
      pre_detach.resizeBuffersSuccesses == 0u &&
      pre_detach.resizeBuffersFailures == 2u;
  const bool clean_idle_proof =
      !stale_wait_fault &&
      pre_detach.overlaySubmissions >= (signal_fault ? 1u : 2u) &&
      pre_detach.commandListsExecuted ==
          pre_detach.overlaySubmissions +
              pre_detach.submissionSignalFailures &&
      pre_detach.commandQueueSignals >= pre_detach.overlaySubmissions &&
      pre_detach.resourceIdleSignals >= 2u &&
      pre_detach.resourceIdleCompletions == pre_detach.resourceIdleSignals &&
      pre_detach.resourceIdleFailures == 0u &&
      pre_detach.resourceIdleTimeouts == 0u &&
      pre_detach.staleWakeRejections == 0u &&
      pre_detach.retiredWaitEvents == 0u &&
      pre_detach.idleWaitPoisoned == 0u &&
      pre_detach.registeredResourcesRetired == 0u;
  const bool signal_fault_proof =
      !signal_fault ||
      (fault_arm_result == TRUE && snapshot_first_fault &&
       snapshot_repeated_fault && SUCCEEDED(fault_repeat_present) &&
       first_fault.commandListsExecuted == 1u &&
       first_fault.overlaySubmissions == 0u &&
       first_fault.submissionSignalFailures == 1u &&
       first_fault.submissionSlotRetirements == 1u &&
       first_fault.untrackedSubmission == 1u &&
       first_fault.retiredSubmissionSlots == 1u &&
       first_fault.registeredResourcesRetired == 1u &&
       first_fault.overlayReady == 0u &&
       repeated_fault.commandListsExecuted ==
           first_fault.commandListsExecuted &&
       repeated_fault.untrackedSubmission == 1u &&
       pre_detach.submissionSignalFailures == 1u &&
       pre_detach.submissionSlotRetirements == 1u &&
       pre_detach.independentIdleRecoveries == 1u &&
       pre_detach.untrackedSubmission == 0u &&
       pre_detach.retiredSubmissionSlots == 0u);
  const bool stale_wait_fault_proof =
      !stale_wait_fault ||
      (fault_arm_result == TRUE && snapshot_first_idle_fault &&
       first_idle_fault.idleWaitPoisoned == 1u &&
       first_idle_fault.registeredResourcesRetired == 1u &&
       first_idle_fault.overlayReady == 0u &&
       first_idle_fault.resourceIdleSignals == 1u &&
       first_idle_fault.resourceIdleCompletions == 0u &&
       first_idle_fault.resourceIdleFailures == 1u &&
       first_idle_fault.resourceIdleTimeouts == 1u &&
       first_idle_fault.staleWakeRejections == 1u &&
       first_idle_fault.retiredWaitEvents == 1u &&
       pre_detach.idleWaitPoisoned == 1u &&
       pre_detach.registeredResourcesRetired == 1u &&
       pre_detach.resourceIdleFailures >= 2u &&
       pre_detach.resourceRecreations == 1u);
  const bool common_proof =
      base_injected_proof &&
      (stale_wait_fault ? stale_resize_proof : normal_resize_proof) &&
      (stale_wait_fault ? stale_wait_fault_proof : clean_idle_proof) &&
      signal_fault_proof;
  const bool detach_barrier_proof =
      detach_barrier && detach_observed_in_flight &&
      detach_blocked_for_reader && detach_waiting_exclusive_observed &&
      late_entrant_admission_attempted && late_entrant_waiting_for_admission &&
      late_entrant_blocked_before_admission &&
      late_entrant_forwarded_after_detach;
  const bool detach_commit_proof =
      detached && after.detachQuiesced == 1u &&
      after.detachCommitComplete == 1u && after.detachThreadsEnlisted >= 1u &&
      after.inFlight == 0 && after.callbackAdmissionWaiters == 0u &&
      after.methodHooksAttached == 0u;
  const bool detach_proof =
      detach_commit_proof &&
      (stale_wait_fault
           ? detach_result == ERROR_BUSY && after.registered == 1u &&
                 after.idleWaitPoisoned == 1u &&
                 after.registeredResourcesRetired == 1u &&
                 after.resourceIdleFailures > pre_detach.resourceIdleFailures
           : detach_result == NO_ERROR && after.registered == 0u);
  bool proof_passed = late_attach
                          ? late_negative && detach_proof
                          : common_proof && detach_proof &&
                                (!detach_barrier || detach_barrier_proof);

  const bool windows_destroyed = chains.Release();
  proof_passed = proof_passed && windows_created && window_rect_read &&
                 resized_window.right > resized_window.left &&
                 resized_window.bottom > resized_window.top &&
                 windows_destroyed;

  std::ostringstream json;
  json << "{\"schemaVersion\":1,\"unsupported\":false,\"scenario\":\""
       << (late_attach        ? "late-attach"
           : detach_barrier   ? "detach-barrier"
           : signal_fault     ? "signal-fault"
           : stale_wait_fault ? "idle-stale-timeout"
                              : "normal")
       << "\",\"setupFailed\":false,\"createStage\":\"" << create_stage
       << "\",\"createResult\":"
       << static_cast<std::uint32_t>(create_result)
       << ",\"bootstrapLoaded\":"
       << (api.module != nullptr ? "true" : "false")
       << ",\"snapshotBefore\":" << (snapshot_before ? "true" : "false")
       << ",\"snapshotPreDetach\":"
       << (snapshot_pre_detach ? "true" : "false")
       << ",\"snapshotAfter\":" << (snapshot_after ? "true" : "false")
       << ",\"restoreAfterWithSucceeded\":"
       << before.restoreAfterWithSucceeded
       << ",\"dllMainGraphicsCalls\":" << before.dllMainGraphicsCalls
       << ",\"entryAttachError\":" << before.entryAttachError
       << ",\"methodAttachError\":" << before.methodAttachError
       << ",\"entryHookAttached\":" << before.entryHookAttached
       << ",\"methodDiscoveryBeforeApplicationEntry\":"
       << before.methodDiscoveryBeforeApplicationEntry
       << ",\"methodHooksAttached\":" << before.methodHooksAttached
       << ",\"methodAttachThreadsEnlisted\":"
       << before.methodAttachThreadsEnlisted
       << ",\"present1Present\":" << before.present1Present
       << ",\"createSwapChainHookPresent\":"
       << before.createSwapChainHookPresent
       << ",\"methodIdentity\":" << (method_identity ? "true" : "false")
       << ",\"attachedMethodIdentity\":"
       << (attached_method_identity ? "true" : "false")
       << ",\"wrongQueueRegisterResult\":"
       << static_cast<std::uint32_t>(wrong_queue_register_result)
       << ",\"registerResult\":" << static_cast<std::uint32_t>(register_result)
       << ",\"registeredPointersMatch\":"
       << (registered_pointers_match ? "true" : "false")
       << ",\"identityMatched\":" << registered.identityMatched
       << ",\"deviceIdentityMatched\":"
       << registered.deviceIdentityMatched
       << ",\"commandQueueIdentityMatched\":"
       << registered.commandQueueIdentityMatched
       << ",\"creationRecordMatched\":"
       << registered.creationRecordMatched
       << ",\"liveMethodBodiesMatched\":"
       << registered.liveMethodBodiesMatched
       << ",\"preallocatedHotPathResources\":"
       << registered.preallocatedHotPathResources
       << ",\"separateCommandListSubmission\":"
       << registered.separateCommandListSubmission
       << ",\"faultArmResult\":"
       << (fault_arm_result != FALSE ? "true" : "false")
       << ",\"snapshotFirstFault\":"
       << (snapshot_first_fault ? "true" : "false")
       << ",\"snapshotRepeatedFault\":"
       << (snapshot_repeated_fault ? "true" : "false")
       << ",\"snapshotFirstIdleFault\":"
       << (snapshot_first_idle_fault ? "true" : "false")
       << ",\"faultRepeatPresentResult\":"
       << static_cast<std::uint32_t>(fault_repeat_present)
       << ",\"firstFaultCommandListsExecuted\":"
       << first_fault.commandListsExecuted
       << ",\"repeatedFaultCommandListsExecuted\":"
       << repeated_fault.commandListsExecuted
       << ",\"firstFaultOverlaySubmissions\":"
       << first_fault.overlaySubmissions
       << ",\"firstFaultUntrackedSubmission\":"
       << first_fault.untrackedSubmission
       << ",\"firstFaultRetiredSubmissionSlots\":"
       << first_fault.retiredSubmissionSlots
       << ",\"firstFaultRegisteredResourcesRetired\":"
       << first_fault.registeredResourcesRetired
       << ",\"firstFaultOverlayReady\":" << first_fault.overlayReady
       << ",\"firstIdleFaultOverlayReady\":"
       << first_idle_fault.overlayReady
       << ",\"firstIdleFaultResourceIdleFailures\":"
       << first_idle_fault.resourceIdleFailures
       << ",\"firstIdleFaultResourceIdleTimeouts\":"
       << first_idle_fault.resourceIdleTimeouts
       << ",\"firstIdleFaultStaleWakeRejections\":"
       << first_idle_fault.staleWakeRejections
       << ",\"firstIdleFaultRetiredWaitEvents\":"
       << first_idle_fault.retiredWaitEvents
       << ",\"primaryPresentResult\":"
       << static_cast<std::uint32_t>(primary_present)
       << ",\"competingPresentResult\":"
       << static_cast<std::uint32_t>(competing_present)
       << ",\"contentionPresentResult\":"
       << static_cast<std::uint32_t>(contention_present)
       << ",\"present1Result\":"
       << static_cast<std::uint32_t>(present1_result)
       << ",\"presentCalls\":" << pre_detach.presentCalls
       << ",\"present1Calls\":" << pre_detach.present1Calls
       << ",\"commandListsExecuted\":"
       << pre_detach.commandListsExecuted
       << ",\"overlaySubmissions\":" << pre_detach.overlaySubmissions
       << ",\"submissionSignalFailures\":"
       << pre_detach.submissionSignalFailures
       << ",\"submissionSlotRetirements\":"
       << pre_detach.submissionSlotRetirements
       << ",\"independentIdleRecoveries\":"
       << pre_detach.independentIdleRecoveries
       << ",\"untrackedSubmission\":"
       << pre_detach.untrackedSubmission
       << ",\"retiredSubmissionSlots\":"
       << pre_detach.retiredSubmissionSlots
       << ",\"registeredResourcesRetired\":"
       << pre_detach.registeredResourcesRetired
       << ",\"commandQueueSignals\":" << pre_detach.commandQueueSignals
       << ",\"resourceIdleSignals\":" << pre_detach.resourceIdleSignals
       << ",\"resourceIdleCompletions\":"
       << pre_detach.resourceIdleCompletions
       << ",\"resourceIdleFailures\":" << after.resourceIdleFailures
       << ",\"resourceIdleWaitsOutsidePresent\":"
       << pre_detach.resourceIdleWaitsOutsidePresent
       << ",\"resourceIdleTimeouts\":"
       << pre_detach.resourceIdleTimeouts
       << ",\"staleWakeRejections\":"
       << pre_detach.staleWakeRejections
       << ",\"retiredWaitEvents\":" << pre_detach.retiredWaitEvents
       << ",\"idleWaitPoisoned\":" << pre_detach.idleWaitPoisoned
       << ",\"presentBlockingWaitCalls\":"
       << pre_detach.presentBlockingWaitCalls
       << ",\"skippedContention\":" << pre_detach.skippedContention
       << ",\"skippedGpuBusy\":" << pre_detach.skippedGpuBusy
       << ",\"competingChainRefusals\":"
       << pre_detach.competingChainRefusals
       << ",\"resizeFailure\":" << static_cast<std::uint32_t>(resize_failure)
       << ",\"resizeSuccess\":" << static_cast<std::uint32_t>(resize_success)
       << ",\"resizeBuffersCalls\":" << pre_detach.resizeBuffersCalls
       << ",\"resizeBuffersSuccesses\":"
       << pre_detach.resizeBuffersSuccesses
       << ",\"resizeBuffersFailures\":"
       << pre_detach.resizeBuffersFailures
       << ",\"fullscreenResult\":"
       << static_cast<std::uint32_t>(fullscreen_result)
       << ",\"fullscreenQueryResult\":"
       << static_cast<std::uint32_t>(fullscreen_query_result)
       << ",\"fullscreenState\":"
       << (fullscreen_state != FALSE ? "true" : "false")
       << ",\"fullscreenCalls\":" << pre_detach.fullscreenCalls
       << ",\"creationRecords\":" << pre_detach.creationRecords
       << ",\"creationRecordOverflows\":"
       << pre_detach.creationRecordOverflows
       << ",\"resourceRecreations\":"
       << pre_detach.resourceRecreations
       << ",\"windowsCreated\":" << (windows_created ? "true" : "false")
       << ",\"windowRectRead\":" << (window_rect_read ? "true" : "false")
       << ",\"windowWidth\":"
       << (resized_window.right - resized_window.left)
       << ",\"windowHeight\":"
       << (resized_window.bottom - resized_window.top)
       << ",\"windowsDestroyed\":"
       << (windows_destroyed ? "true" : "false")
       << ",\"detachObservedInFlight\":"
       << (detach_observed_in_flight ? "true" : "false")
       << ",\"detachBlockedForReader\":"
       << (detach_blocked_for_reader ? "true" : "false")
       << ",\"detachWaitingExclusiveObserved\":"
       << (detach_waiting_exclusive_observed ? "true" : "false")
       << ",\"lateEntrantAdmissionAttempted\":"
       << (late_entrant_admission_attempted ? "true" : "false")
       << ",\"lateEntrantWaitingForAdmission\":"
       << (late_entrant_waiting_for_admission ? "true" : "false")
       << ",\"lateEntrantBlockedBeforeAdmission\":"
       << (late_entrant_blocked_before_admission ? "true" : "false")
       << ",\"lateEntrantPresentResult\":"
       << static_cast<std::uint32_t>(late_entrant_present_result)
       << ",\"lateEntrantForwardedAfterDetach\":"
       << (late_entrant_forwarded_after_detach ? "true" : "false")
       << ",\"postDetachPresentForwards\":"
       << after.postDetachPresentForwards
       << ",\"detachResult\":" << detach_result
       << ",\"detachQuiesced\":" << after.detachQuiesced
       << ",\"detachCommitComplete\":" << after.detachCommitComplete
       << ",\"detachThreadsEnlisted\":" << after.detachThreadsEnlisted
       << ",\"registeredAfterDetach\":" << after.registered
       << ",\"idleWaitPoisonedAfterDetach\":"
       << after.idleWaitPoisoned
       << ",\"registeredResourcesRetiredAfterDetach\":"
       << after.registeredResourcesRetired
       << ",\"lateAttachNegative\":"
       << (late_negative ? "true" : "false")
       << ",\"proofPassed\":" << (proof_passed ? "true" : "false")
       << "}\n";
  if (!WriteResult(result_path.c_str(), json.str()))
    return 22;
  return proof_passed ? 0 : 30;
}

} // namespace

extern "C" __declspec(noinline) int WINAPI
GameHubDxgiD3d12QaApplicationEntry() {
  return RunFixture();
}

int wmain() { return GameHubDxgiD3d12QaApplicationEntry(); }
