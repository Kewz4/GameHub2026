#include "contract.hpp"

#include <atomic>
#include <cstdint>
#include <cstring>
#include <shellapi.h>
#include <sstream>
#include <string>
#include <thread>

#include "host_state.hpp"
#include "pipeline_state.hpp"

namespace {

using namespace gamehub::overlay::dxgi_d3d11_qa;

using GetSnapshotFunction = BOOL(WINAPI *)(BootstrapSnapshot *, DWORD);
using RegisterFunction = HRESULT(WINAPI *)(IDXGISwapChain *, ID3D11Device *,
                                           ID3D11DeviceContext *);
using SetFlagFunction = void(WINAPI *)(BOOL);
using DetachFunction = DWORD(WINAPI *)();
using TerminalResultFunction = BOOL(WINAPI *)(HRESULT);
using CachedPresentFunction = HRESULT(STDMETHODCALLTYPE *)(IDXGISwapChain *,
                                                           UINT, UINT);

struct BootstrapApi {
  HMODULE module = nullptr;
  GetSnapshotFunction snapshot = nullptr;
  RegisterFunction registerChain = nullptr;
  SetFlagFunction setGate = nullptr;
  SetFlagFunction setPause = nullptr;
  DetachFunction detach = nullptr;
  TerminalResultFunction applyTerminalResult = nullptr;
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
      GetProcAddress(api.module, "GameHubDxgiD3d11QaGetSnapshot"));
  api.registerChain = reinterpret_cast<RegisterFunction>(
      GetProcAddress(api.module, "GameHubDxgiD3d11QaRegisterSwapChain"));
  api.setGate = reinterpret_cast<SetFlagFunction>(
      GetProcAddress(api.module, "GameHubDxgiD3D11QaSetPresentGate"));
  if (api.setGate == nullptr) {
    api.setGate = reinterpret_cast<SetFlagFunction>(
        GetProcAddress(api.module, "GameHubDxgiD3d11QaSetPresentGate"));
  }
  api.setPause = reinterpret_cast<SetFlagFunction>(
      GetProcAddress(api.module, "GameHubDxgiD3d11QaSetPauseInFlight"));
  api.detach = reinterpret_cast<DetachFunction>(
      GetProcAddress(api.module, "GameHubDxgiD3d11QaDetach"));
  api.applyTerminalResult =
      reinterpret_cast<TerminalResultFunction>(GetProcAddress(
          api.module, "GameHubDxgiD3d11QaApplyTerminalPresentResult"));
  return api;
}

struct ChainSet {
  HWND primaryWindow = nullptr;
  HWND competingWindow = nullptr;
  ID3D11Device *device = nullptr;
  ID3D11DeviceContext *context = nullptr;
  IDXGISwapChain *primary = nullptr;
  IDXGISwapChain *competing = nullptr;

  void Release() noexcept {
    if (primary != nullptr)
      primary->SetFullscreenState(FALSE, nullptr);
    if (competing != nullptr)
      competing->SetFullscreenState(FALSE, nullptr);
    SafeRelease(competing);
    SafeRelease(primary);
    SafeRelease(context);
    SafeRelease(device);
    if (competingWindow != nullptr)
      DestroyWindow(competingWindow);
    if (primaryWindow != nullptr)
      DestroyWindow(primaryWindow);
    competingWindow = nullptr;
    primaryWindow = nullptr;
  }
};

HWND CreateFixtureWindow(const wchar_t *title) noexcept {
  return CreateWindowExW(0, L"STATIC", title, WS_OVERLAPPED, 0, 0, 128, 128,
                         nullptr, nullptr, GetModuleHandleW(nullptr), nullptr);
}

HRESULT CreateChains(bool multisample, ChainSet *output) noexcept {
  output->primaryWindow = CreateFixtureWindow(L"GameHub DXGI QA primary");
  output->competingWindow = CreateFixtureWindow(L"GameHub DXGI QA competing");
  if (output->primaryWindow == nullptr || output->competingWindow == nullptr) {
    return HRESULT_FROM_WIN32(GetLastError());
  }
  if (!multisample) {
    D3D_FEATURE_LEVEL level{};
    HRESULT result = D3D11CreateDevice(
        nullptr, D3D_DRIVER_TYPE_WARP, nullptr, 0, nullptr, 0,
        D3D11_SDK_VERSION, &output->device, &level, &output->context);
    IDXGIDevice *dxgi_device = nullptr;
    IDXGIAdapter *adapter = nullptr;
    IDXGIFactory2 *factory = nullptr;
    if (SUCCEEDED(result)) {
      result = output->device->QueryInterface(IID_PPV_ARGS(&dxgi_device));
    }
    if (SUCCEEDED(result))
      result = dxgi_device->GetAdapter(&adapter);
    if (SUCCEEDED(result)) {
      result = adapter->GetParent(IID_PPV_ARGS(&factory));
    }
    DXGI_SWAP_CHAIN_DESC1 description{};
    description.Width = 128;
    description.Height = 128;
    description.Format = DXGI_FORMAT_B8G8R8A8_UNORM;
    description.SampleDesc.Count = 1;
    description.BufferUsage = DXGI_USAGE_RENDER_TARGET_OUTPUT;
    description.BufferCount = 2;
    description.SwapEffect = DXGI_SWAP_EFFECT_FLIP_SEQUENTIAL;
    description.Scaling = DXGI_SCALING_STRETCH;
    description.AlphaMode = DXGI_ALPHA_MODE_IGNORE;
    DXGI_SWAP_CHAIN_FULLSCREEN_DESC fullscreen{};
    fullscreen.Windowed = TRUE;
    IDXGISwapChain1 *primary1 = nullptr;
    IDXGISwapChain1 *competing1 = nullptr;
    if (SUCCEEDED(result)) {
      result = factory->CreateSwapChainForHwnd(
          output->device, output->primaryWindow, &description, &fullscreen,
          nullptr, &primary1);
    }
    if (SUCCEEDED(result)) {
      result = factory->CreateSwapChainForHwnd(
          output->device, output->competingWindow, &description, &fullscreen,
          nullptr, &competing1);
    }
    if (SUCCEEDED(result)) {
      result = primary1->QueryInterface(IID_PPV_ARGS(&output->primary));
    }
    if (SUCCEEDED(result)) {
      result = competing1->QueryInterface(IID_PPV_ARGS(&output->competing));
    }
    SafeRelease(competing1);
    SafeRelease(primary1);
    SafeRelease(factory);
    SafeRelease(adapter);
    SafeRelease(dxgi_device);
    return result;
  }

  DXGI_SWAP_CHAIN_DESC description{};
  description.BufferDesc.Width = 128;
  description.BufferDesc.Height = 128;
  description.BufferDesc.Format = DXGI_FORMAT_B8G8R8A8_UNORM;
  description.SampleDesc.Count = 4;
  description.BufferUsage = DXGI_USAGE_RENDER_TARGET_OUTPUT;
  description.BufferCount = 1;
  description.OutputWindow = output->primaryWindow;
  description.Windowed = TRUE;
  description.SwapEffect = DXGI_SWAP_EFFECT_DISCARD;
  D3D_FEATURE_LEVEL level{};
  HRESULT result = D3D11CreateDeviceAndSwapChain(
      nullptr, D3D_DRIVER_TYPE_WARP, nullptr, 0, nullptr, 0, D3D11_SDK_VERSION,
      &description, &output->primary, &output->device, &level,
      &output->context);
  if (FAILED(result))
    return result;

  IDXGIDevice *dxgi_device = nullptr;
  IDXGIAdapter *adapter = nullptr;
  IDXGIFactory *factory = nullptr;
  result = output->device->QueryInterface(IID_PPV_ARGS(&dxgi_device));
  if (SUCCEEDED(result))
    result = dxgi_device->GetAdapter(&adapter);
  if (SUCCEEDED(result))
    result = adapter->GetParent(IID_PPV_ARGS(&factory));
  description.OutputWindow = output->competingWindow;
  if (SUCCEEDED(result)) {
    result = factory->CreateSwapChain(output->device, &description,
                                      &output->competing);
  }
  SafeRelease(factory);
  SafeRelease(adapter);
  SafeRelease(dxgi_device);
  return result;
}

MethodAddressSnapshot MethodsFor(IDXGISwapChain *chain) noexcept {
  MethodAddressSnapshot methods{};
  auto **table = *reinterpret_cast<void ***>(chain);
  methods.release = reinterpret_cast<ULONG_PTR>(table[2]);
  methods.present = reinterpret_cast<ULONG_PTR>(table[8]);
  methods.setFullscreenState = reinterpret_cast<ULONG_PTR>(table[10]);
  methods.resizeBuffers = reinterpret_cast<ULONG_PTR>(table[13]);
  IDXGISwapChain1 *chain1 = nullptr;
  if (SUCCEEDED(chain->QueryInterface(IID_PPV_ARGS(&chain1)))) {
    table = *reinterpret_cast<void ***>(chain1);
    methods.present1 = reinterpret_cast<ULONG_PTR>(table[22]);
  }
  IDXGISwapChain2 *chain2 = nullptr;
  if (SUCCEEDED(chain->QueryInterface(IID_PPV_ARGS(&chain2)))) {
    table = *reinterpret_cast<void ***>(chain2);
    methods.setSourceSize = reinterpret_cast<ULONG_PTR>(table[29]);
  }
  IDXGISwapChain3 *chain3 = nullptr;
  if (SUCCEEDED(chain->QueryInterface(IID_PPV_ARGS(&chain3)))) {
    table = *reinterpret_cast<void ***>(chain3);
    methods.resizeBuffers1 = reinterpret_cast<ULONG_PTR>(table[39]);
  }
  SafeRelease(chain3);
  SafeRelease(chain2);
  SafeRelease(chain1);
  return methods;
}

bool SameMethods(const MethodAddressSnapshot &left,
                 const MethodAddressSnapshot &right) noexcept {
  return std::memcmp(&left, &right, sizeof(left)) == 0;
}

template <typename T> bool BytesEqual(const T &left, const T &right) noexcept {
  return std::memcmp(&left, &right, sizeof(T)) == 0;
}

template <typename Shader>
DWORD StageDifference(const ShaderStageState<Shader> &left,
                      const ShaderStageState<Shader> &right) noexcept {
  DWORD mask = 0;
  if (left.shader != right.shader)
    mask |= 1u;
  if (!BytesEqual(left.classes, right.classes))
    mask |= 2u;
  if (left.classCount != right.classCount)
    mask |= 4u;
  if (!BytesEqual(left.constantBuffers, right.constantBuffers))
    mask |= 8u;
  if (!BytesEqual(left.resources, right.resources))
    mask |= 16u;
  if (!BytesEqual(left.samplers, right.samplers))
    mask |= 32u;
  return mask;
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

int RunFixture() {
  std::wstring result_path;
  std::wstring scenario;
  if (!ParseArguments(&result_path, &scenario))
    return 20;
  const bool multisample = scenario == L"multisample";
  const bool late_attach = scenario == L"late-attach";
  const bool destruction = scenario == L"destruction";
  const bool device_lost = scenario == L"device-lost";
  const bool detach_barrier = scenario == L"detach-barrier";
  ChainSet chains;
  const HRESULT create_result = CreateChains(multisample, &chains);
  if (FAILED(create_result))
    return 21;
  const MethodAddressSnapshot application_methods = MethodsFor(chains.primary);
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
  HRESULT deferred_context_result = E_NOINTERFACE;
  HRESULT deferred_register_result = E_NOINTERFACE;
  HRESULT register_result = E_NOINTERFACE;
  if (!late_attach && api.registerChain != nullptr) {
    ID3D11DeviceContext *deferred_context = nullptr;
    deferred_context_result =
        chains.device->CreateDeferredContext(0, &deferred_context);
    if (SUCCEEDED(deferred_context_result)) {
      deferred_register_result =
          api.registerChain(chains.primary, chains.device, deferred_context);
    }
    SafeRelease(deferred_context);
    register_result =
        api.registerChain(chains.primary, chains.device, chains.context);
  }
  BootstrapSnapshot registered_snapshot{};
  const bool snapshot_registered =
      api.snapshot != nullptr &&
      api.snapshot(&registered_snapshot, sizeof(registered_snapshot));
  const bool registered_object_pointers_matched =
      snapshot_registered && SUCCEEDED(register_result) &&
      registered_snapshot.selectedSwapChain ==
          reinterpret_cast<ULONG_PTR>(chains.primary) &&
      registered_snapshot.selectedDevice ==
          reinterpret_cast<ULONG_PTR>(chains.device) &&
      registered_snapshot.selectedContext ==
          reinterpret_cast<ULONG_PTR>(chains.context);

  SeededHostState seeded_state{};
  HRESULT seed_result = E_NOINTERFACE;
  if (SUCCEEDED(register_result)) {
    seed_result = SeedNonNullHostState(chains.device, chains.context,
                                       chains.primary, &seeded_state);
  }
  const DWORD seeded_getter_visible_mask =
      seeded_state.getterVisibleNonNullMask;

  PipelineState state_before_capture{};
  PipelineState state_after_capture{};
  CapturePipelineState(chains.context, &state_before_capture);
  HRESULT primary_present = cached_present(chains.primary, 0, 0);
  CapturePipelineState(chains.context, &state_after_capture);
  const DWORD state_difference =
      PipelineDifferenceMask(state_before_capture, state_after_capture);
  const DWORD vs_difference =
      StageDifference(state_before_capture.vs, state_after_capture.vs);
  const DWORD hs_difference =
      StageDifference(state_before_capture.hs, state_after_capture.hs);
  const DWORD ds_difference =
      StageDifference(state_before_capture.ds, state_after_capture.ds);
  const DWORD gs_difference =
      StageDifference(state_before_capture.gs, state_after_capture.gs);
  const DWORD ps_difference =
      StageDifference(state_before_capture.ps, state_after_capture.ps);
  const DWORD cs_difference =
      StageDifference(state_before_capture.cs, state_after_capture.cs);
  ReleasePipelineState(&state_after_capture);
  ReleasePipelineState(&state_before_capture);
  ReleaseSeededHostState(chains.context, &seeded_state);
  const HRESULT competing_present = chains.competing->Present(0, 0);

  HRESULT contention_present = E_NOTIMPL;
  if (api.setGate != nullptr && SUCCEEDED(register_result)) {
    api.setGate(TRUE);
    contention_present = chains.primary->Present(0, 0);
    api.setGate(FALSE);
  }

  const HRESULT fullscreen_result =
      chains.primary->SetFullscreenState(FALSE, nullptr);

  HRESULT resize_failure = E_NOTIMPL;
  HRESULT resize_success = E_NOTIMPL;
  if (!multisample && SUCCEEDED(register_result)) {
    ID3D11Texture2D *held_backbuffer = nullptr;
    if (SUCCEEDED(
            chains.primary->GetBuffer(0, IID_PPV_ARGS(&held_backbuffer)))) {
      resize_failure = chains.primary->ResizeBuffers(
          2, 144, 144, DXGI_FORMAT_B8G8R8A8_UNORM, 0);
    }
    SafeRelease(held_backbuffer);
    resize_success = chains.primary->ResizeBuffers(
        2, 160, 160, DXGI_FORMAT_B8G8R8A8_UNORM, 0);
    if (SUCCEEDED(resize_success))
      primary_present = chains.primary->Present(0, 0);
  }

  HRESULT present1_result = E_NOINTERFACE;
  HRESULT source_success = E_NOINTERFACE;
  HRESULT source_failure = E_NOINTERFACE;
  HRESULT resize1_failure = E_NOINTERFACE;
  HRESULT resize1_result = E_NOINTERFACE;
  IDXGISwapChain1 *chain1 = nullptr;
  if (SUCCEEDED(chains.primary->QueryInterface(IID_PPV_ARGS(&chain1)))) {
    DXGI_PRESENT_PARAMETERS parameters{};
    present1_result = chain1->Present1(0, 0, &parameters);
  }
  IDXGISwapChain2 *chain2 = nullptr;
  if (SUCCEEDED(chains.primary->QueryInterface(IID_PPV_ARGS(&chain2)))) {
    source_success = chain2->SetSourceSize(96, 96);
    source_failure = chain2->SetSourceSize(100'000, 100'000);
  }
  IDXGISwapChain3 *chain3 = nullptr;
  if (!multisample &&
      SUCCEEDED(chains.primary->QueryInterface(IID_PPV_ARGS(&chain3)))) {
    ID3D11Texture2D *held_backbuffer = nullptr;
    if (SUCCEEDED(
            chains.primary->GetBuffer(0, IID_PPV_ARGS(&held_backbuffer)))) {
      resize1_failure = chain3->ResizeBuffers1(0, 176, 176, DXGI_FORMAT_UNKNOWN,
                                               0, nullptr, nullptr);
    }
    SafeRelease(held_backbuffer);
    resize1_result = chain3->ResizeBuffers1(0, 176, 176, DXGI_FORMAT_UNKNOWN, 0,
                                            nullptr, nullptr);
    if (SUCCEEDED(resize1_result))
      chain3->Present(0, 0);
  }
  SafeRelease(chain3);
  SafeRelease(chain2);
  SafeRelease(chain1);

  bool destruction_proof = false;
  bool terminal_result_seam_accepted = false;
  bool nonterminal_result_seam_rejected = false;
  bool detach_observed_in_flight = false;
  bool detach_blocked_for_reader = false;
  bool detach_waiting_exclusive_observed = false;
  bool late_entrant_admission_attempted = false;
  bool late_entrant_waiting_for_admission = false;
  bool late_entrant_blocked_before_admission = false;
  bool late_entrant_forwarded_after_detach = false;
  HRESULT late_entrant_present_result = E_FAIL;
  DWORD barrier_detach_result = ERROR_INVALID_STATE;
  bool detached_in_scenario = false;
  HRESULT destruction_identity_result = E_NOINTERFACE;
  ULONG destruction_base_release_remaining = 0xffffffffu;
  ULONG destruction_identity_release_remaining = 0xffffffffu;
  bool destruction_via_controlling_unknown = false;
  if (destruction && SUCCEEDED(register_result)) {
    SafeRelease(chains.competing);
    IUnknown *destruction_identity = nullptr;
    destruction_identity_result =
        chains.primary->QueryInterface(IID_PPV_ARGS(&destruction_identity));
    if (SUCCEEDED(destruction_identity_result)) {
      destruction_base_release_remaining = chains.primary->Release();
      chains.primary = nullptr;
      if (destruction_base_release_remaining != 0u) {
        destruction_identity_release_remaining =
            destruction_identity->Release();
        destruction_identity = nullptr;
      }
      destruction_via_controlling_unknown =
          destruction_base_release_remaining != 0u &&
          destruction_identity_release_remaining == 0u;
    }
    BootstrapSnapshot destroyed{};
    destruction_proof =
        destruction_via_controlling_unknown && api.snapshot != nullptr &&
        api.snapshot(&destroyed, sizeof(destroyed)) &&
        destroyed.registered == 0u && destroyed.destroyedInvalidations == 1u;
  } else if (device_lost && SUCCEEDED(register_result)) {
    nonterminal_result_seam_rejected = api.applyTerminalResult != nullptr &&
                                       api.applyTerminalResult(S_OK) == FALSE;
    terminal_result_seam_accepted =
        api.applyTerminalResult != nullptr &&
        api.applyTerminalResult(DXGI_ERROR_DEVICE_REMOVED) == TRUE;
  } else if (detach_barrier && SUCCEEDED(register_result) &&
             api.setPause != nullptr && api.detach != nullptr) {
    api.setPause(TRUE);
    std::atomic<bool> present_done{false};
    std::atomic<bool> detach_done{false};
    std::atomic<bool> late_present_done{false};
    std::thread present_thread([&]() {
      chains.primary->Present(0, 0);
      present_done.store(true, std::memory_order_release);
    });
    BootstrapSnapshot barrier_snapshot{};
    for (DWORD attempt = 0; attempt < 100'000u; ++attempt) {
      if (api.snapshot(&barrier_snapshot, sizeof(barrier_snapshot)) &&
          barrier_snapshot.inFlight > 0) {
        detach_observed_in_flight = true;
        break;
      }
      SwitchToThread();
    }
    std::thread detach_thread([&]() {
      barrier_detach_result = api.detach();
      detach_done.store(true, std::memory_order_release);
    });
    for (DWORD attempt = 0; attempt < 100'000u; ++attempt) {
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
      const ULONGLONG admission_deadline = GetTickCount64() + 2'000u;
      while (GetTickCount64() < admission_deadline) {
        if (api.snapshot(&barrier_snapshot, sizeof(barrier_snapshot)) &&
            barrier_snapshot.callbackAdmissionAttempts > attempts_before_late) {
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
    detached_in_scenario = true;
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
      snapshot_before &&
      SameMethods(before.cachedMethods, before.attachedMethods);
  const bool injected = snapshot_before && before.methodHooksAttached == 1u;
  const bool late_negative = late_attach && snapshot_before && snapshot_after &&
                             before.methodHooksAttached == 0u &&
                             after.presentCalls == 0u;
  const DWORD expected_post_dxgi_present_difference =
      multisample ? 0u : kStateOmTargets;
  const bool stage_differences_clear =
      vs_difference == 0u && hs_difference == 0u && ds_difference == 0u &&
      gs_difference == 0u && ps_difference == 0u && cs_difference == 0u;
  const bool normal_pass =
      !late_attach && injected && SUCCEEDED(register_result) &&
      SUCCEEDED(deferred_context_result) &&
      deferred_register_result == E_NOINTERFACE && SUCCEEDED(seed_result) &&
      seeded_getter_visible_mask == kD3d11BaseGetterVisibleStateMask &&
      SUCCEEDED(primary_present) && SUCCEEDED(competing_present) &&
      method_identity && attached_method_identity &&
      registered_object_pointers_matched && after.deviceIdentityMatched == 1u &&
      after.immediateContextMatched == 1u &&
      after.liveMethodBodiesMatched == 1u && after.stateRestoreChecks >= 2u &&
      after.stateRestoreMismatches == 0u &&
      after.lastStateRestoreDifferenceMask == 0u &&
      state_difference == expected_post_dxgi_present_difference &&
      stage_differences_clear && after.overlayDraws >= 2u &&
      after.competingChainRefusals >= 1u && after.skippedContention >= 1u &&
      after.getterVisibleStateMask == kD3d11BaseGetterVisibleStateMask;
  const bool device_lost_proof =
      device_lost && nonterminal_result_seam_rejected &&
      terminal_result_seam_accepted && after.registered == 0u &&
      after.deviceLostInvalidations == 1u;
  const bool detach_barrier_proof =
      detach_barrier && detach_observed_in_flight &&
      detach_blocked_for_reader && detach_waiting_exclusive_observed &&
      late_entrant_admission_attempted && late_entrant_waiting_for_admission &&
      late_entrant_blocked_before_admission &&
      late_entrant_forwarded_after_detach &&
      barrier_detach_result == NO_ERROR && after.detachQuiesced == 1u &&
      after.inFlight == 0 && after.callbackAdmissionWaiters == 0 &&
      after.detachThreadsEnlisted >= 1u;
  const bool launch_payload_restored =
      snapshot_before && before.restoreAfterWithSucceeded == 1u;
  const bool proof_passed =
      late_attach
          ? late_negative
          : launch_payload_restored && (destruction      ? destruction_proof
                                        : device_lost    ? device_lost_proof
                                        : detach_barrier ? detach_barrier_proof
                                                         : normal_pass);

  std::ostringstream json;
  json << "{\"schemaVersion\":1,\"scenario\":\""
       << (multisample      ? "multisample"
           : late_attach    ? "late-attach"
           : destruction    ? "destruction"
           : device_lost    ? "device-lost"
           : detach_barrier ? "detach-barrier"
                            : "normal")
       << "\",\"bootstrapLoaded\":"
       << (api.module != nullptr ? "true" : "false")
       << ",\"snapshotBefore\":" << (snapshot_before ? "true" : "false")
       << ",\"snapshotAfter\":" << (snapshot_after ? "true" : "false")
       << ",\"restoreAfterWithSucceeded\":" << before.restoreAfterWithSucceeded
       << ",\"dllMainD3dCalls\":" << after.dllMainD3dCalls
       << ",\"entryAttachError\":" << before.entryAttachError
       << ",\"methodAttachError\":" << before.methodAttachError
       << ",\"entryHookAttached\":" << before.entryHookAttached
       << ",\"methodDiscoveryBeforeApplicationEntry\":"
       << before.methodDiscoveryBeforeApplicationEntry
       << ",\"methodHooksAttached\":" << before.methodHooksAttached
       << ",\"methodAttachThreadsEnlisted\":"
       << before.methodAttachThreadsEnlisted
       << ",\"methodIdentity\":" << (method_identity ? "true" : "false")
       << ",\"attachedMethodIdentity\":"
       << (attached_method_identity ? "true" : "false")
       << ",\"registeredObjectPointersMatched\":"
       << (registered_object_pointers_matched ? "true" : "false")
       << ",\"registerResult\":" << static_cast<std::uint32_t>(register_result)
       << ",\"identityMatched\":" << after.identityMatched
       << ",\"deviceIdentityMatched\":" << after.deviceIdentityMatched
       << ",\"immediateContextMatched\":" << after.immediateContextMatched
       << ",\"liveMethodBodiesMatched\":" << after.liveMethodBodiesMatched
       << ",\"releaseTokenBodiesMatched\":" << after.releaseTokenBodiesMatched
       << ",\"deferredContextCreateResult\":"
       << static_cast<std::uint32_t>(deferred_context_result)
       << ",\"deferredContextRegisterResult\":"
       << static_cast<std::uint32_t>(deferred_register_result)
       << ",\"seedResult\":" << static_cast<std::uint32_t>(seed_result)
       << ",\"seededD3d11BaseGetterVisibleMask\":" << seeded_getter_visible_mask
       << ",\"postDxgiPresentGetterVisibleEqual\":"
       << (state_difference == 0u ? "true" : "false")
       << ",\"postDxgiPresentDifferenceMask\":" << state_difference
       << ",\"postDxgiPresentDifferenceCategory\":\""
       << (state_difference == 0u ? "none" : "omTargetsAfterRealFlipPresent")
       << '\"' << ",\"stageDifferenceMasks\":[" << vs_difference << ','
       << hs_difference << ',' << ds_difference << ',' << gs_difference << ','
       << ps_difference << ',' << cs_difference << ']'
       << ",\"d3d11BaseGetterVisibleStateMask\":"
       << after.getterVisibleStateMask
       << ",\"stateRestoreChecks\":" << after.stateRestoreChecks
       << ",\"stateRestoreMismatches\":" << after.stateRestoreMismatches
       << ",\"lastStateRestoreDifferenceMask\":"
       << after.lastStateRestoreDifferenceMask
       << ",\"presentCalls\":" << after.presentCalls
       << ",\"present1Calls\":" << after.present1Calls
       << ",\"overlayDraws\":" << after.overlayDraws
       << ",\"competingChainRefusals\":" << after.competingChainRefusals
       << ",\"skippedContention\":" << after.skippedContention
       << ",\"resizeFailure\":" << static_cast<std::uint32_t>(resize_failure)
       << ",\"resizeSuccess\":" << static_cast<std::uint32_t>(resize_success)
       << ",\"resizeBuffersCalls\":" << after.resizeBuffersCalls
       << ",\"resizeBuffersSuccesses\":" << after.resizeBuffersSuccesses
       << ",\"resizeBuffersFailures\":" << after.resizeBuffersFailures
       << ",\"present1Present\":" << after.present1Present
       << ",\"present1Result\":" << static_cast<std::uint32_t>(present1_result)
       << ",\"setSourceSizePresent\":" << after.setSourceSizePresent
       << ",\"sourceSizeSuccessResult\":"
       << static_cast<std::uint32_t>(source_success)
       << ",\"sourceSizeFailureResult\":"
       << static_cast<std::uint32_t>(source_failure)
       << ",\"setSourceSizeCalls\":" << after.setSourceSizeCalls
       << ",\"setSourceSizeSuccesses\":" << after.setSourceSizeSuccesses
       << ",\"setSourceSizeFailures\":" << after.setSourceSizeFailures
       << ",\"resizeBuffers1Present\":" << after.resizeBuffers1Present
       << ",\"resizeBuffers1FailureResult\":"
       << static_cast<std::uint32_t>(resize1_failure)
       << ",\"resizeBuffers1Result\":"
       << static_cast<std::uint32_t>(resize1_result)
       << ",\"resizeBuffers1Calls\":" << after.resizeBuffers1Calls
       << ",\"resizeBuffers1Successes\":" << after.resizeBuffers1Successes
       << ",\"resizeBuffers1Failures\":" << after.resizeBuffers1Failures
       << ",\"fullscreenResult\":"
       << static_cast<std::uint32_t>(fullscreen_result)
       << ",\"fullscreenCalls\":" << after.fullscreenCalls
       << ",\"releaseCalls\":" << after.releaseCalls
       << ",\"registeredAfterScenario\":" << after.registered
       << ",\"invalidatedAfterScenario\":" << after.invalidated
       << ",\"invalidationReason\":" << after.invalidationReason
       << ",\"resourceRecreations\":" << after.resourceRecreations
       << ",\"multisampleBackbuffers\":" << after.multisampleBackbuffers
       << ",\"destroyedInvalidations\":" << after.destroyedInvalidations
       << ",\"destructionIdentityResult\":"
       << static_cast<std::uint32_t>(destruction_identity_result)
       << ",\"destructionBaseReleaseRemaining\":"
       << destruction_base_release_remaining
       << ",\"destructionIdentityReleaseRemaining\":"
       << destruction_identity_release_remaining
       << ",\"destructionViaControllingUnknown\":"
       << (destruction_via_controlling_unknown ? "true" : "false")
       << ",\"destructionProof\":" << (destruction_proof ? "true" : "false")
       << ",\"terminalPresentResultSeamAccepted\":"
       << (terminal_result_seam_accepted ? "true" : "false")
       << ",\"nonterminalPresentResultSeamRejected\":"
       << (nonterminal_result_seam_rejected ? "true" : "false")
       << ",\"deviceLostInvalidations\":" << after.deviceLostInvalidations
       << ",\"detachObservedInFlight\":"
       << (detach_observed_in_flight ? "true" : "false")
       << ",\"detachBlockedForReader\":"
       << (detach_blocked_for_reader ? "true" : "false")
       << ",\"detachWaitingExclusiveObserved\":"
       << (detach_waiting_exclusive_observed ? "true" : "false")
       << ",\"lateEntrantWaitingForAdmission\":"
       << (late_entrant_waiting_for_admission ? "true" : "false")
       << ",\"lateEntrantAdmissionAttempted\":"
       << (late_entrant_admission_attempted ? "true" : "false")
       << ",\"lateEntrantBlockedBeforeAdmission\":"
       << (late_entrant_blocked_before_admission ? "true" : "false")
       << ",\"lateEntrantPresentResult\":"
       << static_cast<std::uint32_t>(late_entrant_present_result)
       << ",\"lateEntrantForwardedAfterDetach\":"
       << (late_entrant_forwarded_after_detach ? "true" : "false")
       << ",\"postDetachPresentForwards\":" << after.postDetachPresentForwards
       << ",\"barrierDetachResult\":" << barrier_detach_result
       << ",\"detachQuiesced\":" << after.detachQuiesced
       << ",\"detachCommitComplete\":" << after.detachCommitComplete
       << ",\"detachThreadsEnlisted\":" << after.detachThreadsEnlisted
       << ",\"lateAttachNegative\":" << (late_negative ? "true" : "false")
       << ",\"proofPassed\":" << (proof_passed ? "true" : "false") << "}\n";

  if (api.detach != nullptr && !detached_in_scenario)
    api.detach();
  chains.Release();
  if (!WriteResult(result_path.c_str(), json.str()))
    return 22;
  return proof_passed ? 0 : 30;
}

} // namespace

extern "C" __declspec(noinline) int WINAPI
GameHubDxgiD3d11QaApplicationEntry() {
  return RunFixture();
}

int wmain() { return GameHubDxgiD3d11QaApplicationEntry(); }
