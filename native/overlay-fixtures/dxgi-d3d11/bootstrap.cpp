// clang-format off: Windows types must be visible before the Detours header.
#include "contract.hpp"
#include <detours.h>
// clang-format on

#include <d3dcompiler.h>
#include <tlhelp32.h>

#include <array>
#include <cstring>

#include "pipeline_state.hpp"

namespace {

using namespace gamehub::overlay::dxgi_d3d11_qa;

using ReleaseFunction = ULONG(STDMETHODCALLTYPE *)(IUnknown *);
using PresentFunction = HRESULT(STDMETHODCALLTYPE *)(IDXGISwapChain *, UINT,
                                                     UINT);
using SetFullscreenStateFunction =
    HRESULT(STDMETHODCALLTYPE *)(IDXGISwapChain *, BOOL, IDXGIOutput *);
using ResizeBuffersFunction = HRESULT(STDMETHODCALLTYPE *)(IDXGISwapChain *,
                                                           UINT, UINT, UINT,
                                                           DXGI_FORMAT, UINT);
using Present1Function = HRESULT(STDMETHODCALLTYPE *)(
    IDXGISwapChain1 *, UINT, UINT, const DXGI_PRESENT_PARAMETERS *);
using SetSourceSizeFunction = HRESULT(STDMETHODCALLTYPE *)(IDXGISwapChain2 *,
                                                           UINT, UINT);
using ResizeBuffers1Function = HRESULT(STDMETHODCALLTYPE *)(IDXGISwapChain3 *,
                                                            UINT, UINT, UINT,
                                                            DXGI_FORMAT, UINT,
                                                            const UINT *,
                                                            IUnknown *const *);

ApplicationEntryFunction g_true_entry = nullptr;
ReleaseFunction g_true_release = nullptr;
PresentFunction g_true_present = nullptr;
SetFullscreenStateFunction g_true_fullscreen = nullptr;
ResizeBuffersFunction g_true_resize = nullptr;
Present1Function g_true_present1 = nullptr;
SetSourceSizeFunction g_true_source_size = nullptr;
ResizeBuffers1Function g_true_resize1 = nullptr;

volatile LONG g_restore_after_with = 0;
volatile LONG g_dllmain_d3d_calls = 0;
volatile LONG g_inside_dllmain = 0;
volatile LONG g_entry_attached = 0;
volatile LONG g_entry_attach_error = ERROR_INVALID_STATE;
volatile LONG g_method_discovered_before_entry = 0;
volatile LONG g_methods_attached = 0;
volatile LONG g_method_attach_threads = 0;
volatile LONG g_method_attach_error = ERROR_INVALID_STATE;
volatile LONG g_present1_present = 0;
volatile LONG g_source_size_present = 0;
volatile LONG g_resize1_present = 0;
volatile LONG g_registered = 0;
volatile LONG g_identity_matched = 0;
volatile LONG g_device_identity_matched = 0;
volatile LONG g_immediate_context_matched = 0;
volatile LONG g_live_method_bodies_matched = 0;
volatile LONG g_release_token_bodies_matched = 0;
volatile LONG g_pipeline_mask = 0;
volatile LONG g_overlay_ready = 0;
volatile LONG g_invalidated = 0;
volatile LONG g_invalidation_reason = 0;
volatile LONG g_detaching = 0;
volatile LONG g_detach_attempted = 0;
volatile LONG g_detach_error = ERROR_INVALID_STATE;
volatile LONG g_detach_quiesced = 0;
volatile LONG g_detach_waiting_exclusive = 0;
volatile LONG g_detach_commit_complete = 0;
volatile LONG g_detach_threads = 0;
volatile LONG g_in_flight = 0;
volatile LONG g_peak_in_flight = 0;
volatile LONG g_callback_admission_waiters = 0;
volatile LONG64 g_callback_admission_attempts = 0;
volatile LONG g_callback_admission_closed = 0;
volatile LONG g_present_gate = 0;
volatile LONG g_pause_in_flight = 0;
thread_local LONG g_callback_admission_depth = 0;
SRWLOCK g_callback_lifetime_lock = SRWLOCK_INIT;
SRWLOCK g_resource_lifetime_lock = SRWLOCK_INIT;
SRWLOCK g_resize_call_lock = SRWLOCK_INIT;
SRWLOCK g_command_lock = SRWLOCK_INIT;

volatile LONG64 g_present_calls = 0;
volatile LONG64 g_present1_calls = 0;
volatile LONG64 g_overlay_draws = 0;
volatile LONG64 g_state_restore_checks = 0;
volatile LONG64 g_state_restore_mismatches = 0;
volatile LONG g_last_state_restore_difference = 0;
volatile LONG64 g_post_detach_present_forwards = 0;
volatile LONG64 g_skipped_contention = 0;
volatile LONG64 g_skipped_unregistered = 0;
volatile LONG64 g_competing_refusals = 0;
volatile LONG64 g_resize_calls = 0;
volatile LONG64 g_resize_successes = 0;
volatile LONG64 g_resize_failures = 0;
volatile LONG64 g_resize1_calls = 0;
volatile LONG64 g_resize1_successes = 0;
volatile LONG64 g_resize1_failures = 0;
volatile LONG64 g_source_size_calls = 0;
volatile LONG64 g_source_size_successes = 0;
volatile LONG64 g_source_size_failures = 0;
volatile LONG64 g_fullscreen_calls = 0;
volatile LONG64 g_release_calls = 0;
volatile LONG64 g_destroyed_invalidations = 0;
volatile LONG64 g_device_lost_invalidations = 0;
volatile LONG64 g_resource_recreations = 0;
volatile LONG64 g_multisample_backbuffers = 0;

IDXGISwapChain *g_selected_chain = nullptr;
IUnknown *g_selected_identity = nullptr;
IDXGISwapChain1 *g_selected_chain1 = nullptr;
IDXGISwapChain2 *g_selected_chain2 = nullptr;
IDXGISwapChain3 *g_selected_chain3 = nullptr;
PVOID volatile g_selected_release_tokens[5]{};
ID3D11Device *g_device = nullptr;
ID3D11DeviceContext *g_context = nullptr;
ID3D11RenderTargetView *g_overlay_rtv = nullptr;
ID3D11VertexShader *g_overlay_vs = nullptr;
ID3D11PixelShader *g_overlay_ps = nullptr;
UINT g_backbuffer_width = 0;
UINT g_backbuffer_height = 0;

MethodAddressSnapshot g_cached_methods{};
MethodAddressSnapshot g_attached_methods{};

class DetourThreadSet {
public:
  static constexpr std::size_t kCapacity = 256;

  ~DetourThreadSet() {
    for (std::size_t index = 0; index < count_; ++index) {
      CloseHandle(handles_[index]);
    }
  }

  LONG EnlistProcessThreads() noexcept {
    HANDLE snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPTHREAD, 0);
    if (snapshot == INVALID_HANDLE_VALUE)
      return GetLastError();
    THREADENTRY32 entry{};
    entry.dwSize = sizeof(entry);
    BOOL available = Thread32First(snapshot, &entry);
    while (available) {
      if (entry.th32OwnerProcessID == GetCurrentProcessId() &&
          entry.th32ThreadID != GetCurrentThreadId()) {
        if (count_ == handles_.size()) {
          CloseHandle(snapshot);
          return ERROR_TOO_MANY_TCBS;
        }
        HANDLE thread = OpenThread(THREAD_SUSPEND_RESUME | THREAD_GET_CONTEXT |
                                       THREAD_SET_CONTEXT,
                                   FALSE, entry.th32ThreadID);
        if (thread == nullptr) {
          const LONG error = GetLastError();
          if (error == ERROR_INVALID_PARAMETER || error == ERROR_NOT_FOUND) {
            available = Thread32Next(snapshot, &entry);
            continue;
          }
          CloseHandle(snapshot);
          return error;
        }
        const LONG error = DetourUpdateThread(thread);
        if (error != NO_ERROR) {
          CloseHandle(thread);
          if (error == ERROR_INVALID_HANDLE || error == ERROR_NOT_FOUND) {
            available = Thread32Next(snapshot, &entry);
            continue;
          }
          CloseHandle(snapshot);
          return error;
        }
        handles_[count_++] = thread;
      }
      available = Thread32Next(snapshot, &entry);
    }
    const LONG enumeration_error = GetLastError();
    CloseHandle(snapshot);
    return enumeration_error == ERROR_NO_MORE_FILES ? NO_ERROR
                                                    : enumeration_error;
  }

  LONG count() const noexcept { return static_cast<LONG>(count_); }

private:
  std::array<HANDLE, kCapacity> handles_{};
  std::size_t count_ = 0;
};

template <typename T> void SafeRelease(T *&value) noexcept {
  if (value != nullptr) {
    value->Release();
    value = nullptr;
  }
}

LONG Read(volatile LONG *value) noexcept {
  return InterlockedCompareExchange(value, 0, 0);
}

LONG64 Read64(volatile LONG64 *value) noexcept {
  return InterlockedCompareExchange64(value, 0, 0);
}

void UpdatePeak(LONG current) noexcept {
  LONG peak = Read(&g_peak_in_flight);
  while (current > peak) {
    const LONG prior =
        InterlockedCompareExchange(&g_peak_in_flight, current, peak);
    if (prior == peak)
      return;
    peak = prior;
  }
}

class CallbackLifetimeGuard {
public:
  CallbackLifetimeGuard() noexcept {
    if (g_callback_admission_depth != 0) {
      ++g_callback_admission_depth;
      return;
    }
    InterlockedIncrement64(&g_callback_admission_attempts);
    for (;;) {
      if (Read(&g_callback_admission_closed) != 0) {
        InterlockedIncrement(&g_callback_admission_waiters);
        while (Read(&g_callback_admission_closed) != 0) {
          LONG closed = 1;
          WaitOnAddress(&g_callback_admission_closed, &closed, sizeof(closed),
                        INFINITE);
        }
        InterlockedDecrement(&g_callback_admission_waiters);
      }
      AcquireSRWLockShared(&g_callback_lifetime_lock);
      if (Read(&g_callback_admission_closed) == 0)
        break;
      ReleaseSRWLockShared(&g_callback_lifetime_lock);
    }
    g_callback_admission_depth = 1;
    owns_lock_ = true;
    const LONG current = InterlockedIncrement(&g_in_flight);
    UpdatePeak(current);
  }

  ~CallbackLifetimeGuard() {
    --g_callback_admission_depth;
    if (owns_lock_) {
      InterlockedDecrement(&g_in_flight);
      ReleaseSRWLockShared(&g_callback_lifetime_lock);
    }
  }

  bool detaching() const noexcept { return Read(&g_detaching) != 0; }

  CallbackLifetimeGuard(const CallbackLifetimeGuard &) = delete;
  CallbackLifetimeGuard &operator=(const CallbackLifetimeGuard &) = delete;

private:
  bool owns_lock_ = false;
};

class ResourceExclusiveGuard {
public:
  ResourceExclusiveGuard() noexcept {
    AcquireSRWLockExclusive(&g_resource_lifetime_lock);
  }
  ~ResourceExclusiveGuard() {
    ReleaseSRWLockExclusive(&g_resource_lifetime_lock);
  }
  ResourceExclusiveGuard(const ResourceExclusiveGuard &) = delete;
  ResourceExclusiveGuard &operator=(const ResourceExclusiveGuard &) = delete;
};

class ResourceSharedGuard {
public:
  ResourceSharedGuard() noexcept {
    AcquireSRWLockShared(&g_resource_lifetime_lock);
  }
  ~ResourceSharedGuard() { ReleaseSRWLockShared(&g_resource_lifetime_lock); }
  ResourceSharedGuard(const ResourceSharedGuard &) = delete;
  ResourceSharedGuard &operator=(const ResourceSharedGuard &) = delete;
};

class ResizeExclusiveGuard {
public:
  ResizeExclusiveGuard() noexcept {
    AcquireSRWLockExclusive(&g_resize_call_lock);
  }
  ~ResizeExclusiveGuard() { ReleaseSRWLockExclusive(&g_resize_call_lock); }
  ResizeExclusiveGuard(const ResizeExclusiveGuard &) = delete;
  ResizeExclusiveGuard &operator=(const ResizeExclusiveGuard &) = delete;
};

class CallbackExclusiveGuard {
public:
  CallbackExclusiveGuard() noexcept {
    AcquireSRWLockExclusive(&g_callback_lifetime_lock);
  }
  ~CallbackExclusiveGuard() {
    ReleaseSRWLockExclusive(&g_callback_lifetime_lock);
  }
  CallbackExclusiveGuard(const CallbackExclusiveGuard &) = delete;
  CallbackExclusiveGuard &operator=(const CallbackExclusiveGuard &) = delete;
};

class CommandExclusiveGuard {
public:
  CommandExclusiveGuard() noexcept { AcquireSRWLockExclusive(&g_command_lock); }
  ~CommandExclusiveGuard() { ReleaseSRWLockExclusive(&g_command_lock); }
  CommandExclusiveGuard(const CommandExclusiveGuard &) = delete;
  CommandExclusiveGuard &operator=(const CommandExclusiveGuard &) = delete;
};

bool ExactIdentity(IUnknown *left, IUnknown *right) noexcept {
  if (left == nullptr || right == nullptr)
    return false;
  IUnknown *left_identity = nullptr;
  IUnknown *right_identity = nullptr;
  const HRESULT left_result =
      left->QueryInterface(IID_PPV_ARGS(&left_identity));
  const HRESULT right_result =
      right->QueryInterface(IID_PPV_ARGS(&right_identity));
  const bool equal = SUCCEEDED(left_result) && SUCCEEDED(right_result) &&
                     left_identity == right_identity;
  SafeRelease(left_identity);
  SafeRelease(right_identity);
  return equal;
}

void ReleaseBackbuffer() noexcept {
  SafeRelease(g_overlay_rtv);
  g_backbuffer_width = 0;
  g_backbuffer_height = 0;
  InterlockedExchange(&g_overlay_ready, 0);
}

void ReleaseRegistration() noexcept {
  InterlockedExchange(&g_registered, 0);
  for (PVOID volatile &token : g_selected_release_tokens)
    InterlockedExchangePointer(&token, nullptr);
  ReleaseBackbuffer();
  SafeRelease(g_overlay_vs);
  SafeRelease(g_overlay_ps);
  SafeRelease(g_context);
  SafeRelease(g_device);
  g_selected_chain = nullptr;
  g_selected_identity = nullptr;
  g_selected_chain1 = nullptr;
  g_selected_chain2 = nullptr;
  g_selected_chain3 = nullptr;
}

HRESULT CompileShader(const char *source, const char *target,
                      ID3DBlob **bytecode) noexcept {
  ID3DBlob *errors = nullptr;
  const HRESULT result = D3DCompile(
      source, std::strlen(source), "gamehub-dxgi-d3d11-qa", nullptr, nullptr,
      "main", target, D3DCOMPILE_OPTIMIZATION_LEVEL3, 0, bytecode, &errors);
  SafeRelease(errors);
  return result;
}

HRESULT CreateOverlayShaders() noexcept {
  static constexpr char kVertexShader[] =
      "float4 main(uint id:SV_VertexID):SV_Position{"
      "float2 p[3]={float2(-0.95,0.95),float2(-0.55,0.95),"
      "float2(-0.95,0.55)};return float4(p[id],0,1);}";
  static constexpr char kPixelShader[] =
      "float4 main():SV_Target{return float4(0.125,0.75,0.25,1.0);}";
  ID3DBlob *vertex_bytecode = nullptr;
  ID3DBlob *pixel_bytecode = nullptr;
  HRESULT result = CompileShader(kVertexShader, "vs_5_0", &vertex_bytecode);
  if (SUCCEEDED(result)) {
    result = CompileShader(kPixelShader, "ps_5_0", &pixel_bytecode);
  }
  if (SUCCEEDED(result)) {
    result = g_device->CreateVertexShader(vertex_bytecode->GetBufferPointer(),
                                          vertex_bytecode->GetBufferSize(),
                                          nullptr, &g_overlay_vs);
  }
  if (SUCCEEDED(result)) {
    result = g_device->CreatePixelShader(pixel_bytecode->GetBufferPointer(),
                                         pixel_bytecode->GetBufferSize(),
                                         nullptr, &g_overlay_ps);
  }
  SafeRelease(pixel_bytecode);
  SafeRelease(vertex_bytecode);
  return result;
}

HRESULT RecreateBackbuffer() noexcept {
  ReleaseBackbuffer();
  if (g_selected_chain == nullptr || g_device == nullptr) {
    return DXGI_ERROR_INVALID_CALL;
  }
  ID3D11Texture2D *backbuffer = nullptr;
  HRESULT result = g_selected_chain->GetBuffer(0, IID_PPV_ARGS(&backbuffer));
  D3D11_TEXTURE2D_DESC description{};
  if (SUCCEEDED(result))
    backbuffer->GetDesc(&description);
  if (SUCCEEDED(result)) {
    result =
        g_device->CreateRenderTargetView(backbuffer, nullptr, &g_overlay_rtv);
  }
  SafeRelease(backbuffer);
  if (SUCCEEDED(result)) {
    g_backbuffer_width = description.Width;
    g_backbuffer_height = description.Height;
    if (description.SampleDesc.Count > 1u) {
      InterlockedIncrement64(&g_multisample_backbuffers);
    }
    InterlockedIncrement64(&g_resource_recreations);
    InterlockedExchange(&g_overlay_ready, 1);
  }
  return result;
}

void InvalidateLocked(DWORD reason) noexcept {
  if (Read(&g_registered) == 0)
    return;
  if (InterlockedExchange(&g_invalidated, 1) == 0) {
    InterlockedExchange(&g_invalidation_reason, static_cast<LONG>(reason));
    if (reason == 1u)
      InterlockedIncrement64(&g_destroyed_invalidations);
    if (reason == 2u)
      InterlockedIncrement64(&g_device_lost_invalidations);
  }
  ReleaseRegistration();
}

void Invalidate(DWORD reason) noexcept {
  ResourceExclusiveGuard resource_guard;
  InvalidateLocked(reason);
}

bool HandleTerminalPresentResult(HRESULT result) noexcept {
  if (result != DXGI_ERROR_DEVICE_REMOVED &&
      result != DXGI_ERROR_DEVICE_RESET && result != DXGI_ERROR_DEVICE_HUNG) {
    return false;
  }
  Invalidate(2u);
  return true;
}

void DrawOverlay() noexcept {
  PipelineState state{};
  const DWORD mask = CapturePipelineState(g_context, &state);
  if (!QaOmLayoutSupported(state)) {
    ReleasePipelineState(&state);
    return;
  }

  ID3D11Buffer *null_so[D3D11_SO_BUFFER_SLOT_COUNT]{};
  UINT zero_offsets[D3D11_SO_BUFFER_SLOT_COUNT]{};
  g_context->SOSetTargets(D3D11_SO_BUFFER_SLOT_COUNT, null_so, zero_offsets);
  g_context->SetPredication(nullptr, FALSE);
  g_context->IASetInputLayout(nullptr);
  g_context->IASetPrimitiveTopology(D3D11_PRIMITIVE_TOPOLOGY_TRIANGLELIST);
  g_context->VSSetShader(g_overlay_vs, nullptr, 0);
  g_context->HSSetShader(nullptr, nullptr, 0);
  g_context->DSSetShader(nullptr, nullptr, 0);
  g_context->GSSetShader(nullptr, nullptr, 0);
  g_context->PSSetShader(g_overlay_ps, nullptr, 0);
  g_context->CSSetShader(nullptr, nullptr, 0);
  g_context->OMSetRenderTargets(1, &g_overlay_rtv, nullptr);
  g_context->OMSetBlendState(nullptr, nullptr, 0xffffffffu);
  g_context->OMSetDepthStencilState(nullptr, 0);
  D3D11_VIEWPORT viewport{};
  viewport.Width = static_cast<FLOAT>(g_backbuffer_width);
  viewport.Height = static_cast<FLOAT>(g_backbuffer_height);
  viewport.MaxDepth = 1.0f;
  g_context->RSSetState(nullptr);
  g_context->RSSetViewports(1, &viewport);
  g_context->Draw(3, 0);

  RestorePipelineState(g_context, state);
  PipelineState restored{};
  CapturePipelineState(g_context, &restored);
  const DWORD difference = PipelineDifferenceMask(state, restored);
  ReleasePipelineState(&restored);
  ReleasePipelineState(&state);
  InterlockedExchange(&g_pipeline_mask, static_cast<LONG>(mask));
  InterlockedExchange(&g_last_state_restore_difference,
                      static_cast<LONG>(difference));
  InterlockedIncrement64(&g_state_restore_checks);
  if (difference != 0u)
    InterlockedIncrement64(&g_state_restore_mismatches);
  InterlockedIncrement64(&g_overlay_draws);
}

bool IsSelectedLocked(IUnknown *chain) noexcept {
  if (Read(&g_registered) == 0)
    return false;
  return chain == g_selected_identity ||
         chain == reinterpret_cast<IUnknown *>(g_selected_chain) ||
         chain == reinterpret_cast<IUnknown *>(g_selected_chain1) ||
         chain == reinterpret_cast<IUnknown *>(g_selected_chain2) ||
         chain == reinterpret_cast<IUnknown *>(g_selected_chain3);
}

bool IsSelectedReleaseToken(IUnknown *object) noexcept {
  if (Read(&g_registered) == 0)
    return false;
  for (PVOID volatile &token : g_selected_release_tokens) {
    if (InterlockedCompareExchangePointer(&token, nullptr, nullptr) == object)
      return true;
  }
  return false;
}

template <typename Chain, typename Original, typename... Args>
HRESULT PresentCommon(const CallbackLifetimeGuard &callback, Chain *chain,
                      Original original, volatile LONG64 *calls,
                      Args... args) noexcept {
  InterlockedIncrement64(calls);
  if (callback.detaching()) {
    if (Read(&g_detach_commit_complete) != 0)
      InterlockedIncrement64(&g_post_detach_present_forwards);
    return original(chain, args...);
  }
  if (!TryAcquireSRWLockShared(&g_resource_lifetime_lock)) {
    InterlockedIncrement64(&g_skipped_contention);
    return original(chain, args...);
  }
  const bool selected = IsSelectedLocked(chain);
  if (!selected) {
    if (Read(&g_registered) != 0) {
      InterlockedIncrement64(&g_competing_refusals);
    } else {
      InterlockedIncrement64(&g_skipped_unregistered);
    }
    ReleaseSRWLockShared(&g_resource_lifetime_lock);
    return original(chain, args...);
  }
  if (InterlockedCompareExchange(&g_present_gate, 1, 0) != 0) {
    InterlockedIncrement64(&g_skipped_contention);
    ReleaseSRWLockShared(&g_resource_lifetime_lock);
    return original(chain, args...);
  }
  // This pause exists only for the lifetime-race acceptance case. Normal
  // render callbacks do not wait on a GameHub test flag.
  while (Read(&g_pause_in_flight) != 0)
    SwitchToThread();
  if (Read(&g_overlay_ready) != 0 && g_context != nullptr &&
      g_overlay_rtv != nullptr && g_overlay_vs != nullptr &&
      g_overlay_ps != nullptr) {
    DrawOverlay();
  }
  InterlockedExchange(&g_present_gate, 0);
  ReleaseSRWLockShared(&g_resource_lifetime_lock);
  const HRESULT result = original(chain, args...);
  HandleTerminalPresentResult(result);
  return result;
}

ULONG STDMETHODCALLTYPE HookRelease(IUnknown *self) noexcept {
  CallbackLifetimeGuard callback;
  const bool reentrant = g_callback_admission_depth > 1;
  const ReleaseFunction original = g_true_release;
  if (reentrant)
    return original(self);
  if (callback.detaching())
    return original(self);
  if (!IsSelectedReleaseToken(self))
    return original(self);
  bool selected = false;
  ULONG result = 0;
  {
    ResourceExclusiveGuard resource_guard;
    selected = IsSelectedLocked(self);
    if (selected) {
      InterlockedIncrement64(&g_release_calls);
      result = original(self);
      if (result == 0u) {
        InvalidateLocked(1u);
      }
    }
  }
  return selected ? result : original(self);
}

HRESULT STDMETHODCALLTYPE HookPresent(IDXGISwapChain *chain, UINT interval,
                                      UINT flags) noexcept {
  CallbackLifetimeGuard callback;
  const PresentFunction original = g_true_present;
  return PresentCommon(callback, chain, original, &g_present_calls, interval,
                       flags);
}

HRESULT STDMETHODCALLTYPE
HookPresent1(IDXGISwapChain1 *chain, UINT interval, UINT flags,
             const DXGI_PRESENT_PARAMETERS *parameters) noexcept {
  CallbackLifetimeGuard callback;
  const Present1Function original = g_true_present1;
  return PresentCommon(callback, chain, original, &g_present1_calls, interval,
                       flags, parameters);
}

HRESULT STDMETHODCALLTYPE HookSetFullscreenState(IDXGISwapChain *chain,
                                                 BOOL fullscreen,
                                                 IDXGIOutput *output) noexcept {
  CallbackLifetimeGuard callback;
  const SetFullscreenStateFunction original = g_true_fullscreen;
  if (callback.detaching())
    return original(chain, fullscreen, output);
  bool selected = false;
  HRESULT result = E_FAIL;
  {
    ResourceExclusiveGuard resource_guard;
    selected = IsSelectedLocked(chain);
    if (selected) {
      InterlockedIncrement64(&g_fullscreen_calls);
      result = original(chain, fullscreen, output);
    }
  }
  return selected ? result : original(chain, fullscreen, output);
}

HRESULT STDMETHODCALLTYPE HookResizeBuffers(IDXGISwapChain *chain, UINT count,
                                            UINT width, UINT height,
                                            DXGI_FORMAT format,
                                            UINT flags) noexcept {
  CallbackLifetimeGuard callback;
  const ResizeBuffersFunction original = g_true_resize;
  if (callback.detaching())
    return original(chain, count, width, height, format, flags);
  ResizeExclusiveGuard resize_guard;
  bool selected = false;
  HRESULT result = E_FAIL;
  {
    ResourceExclusiveGuard resource_guard;
    selected = IsSelectedLocked(chain);
    if (selected)
      ReleaseBackbuffer();
  }
  if (!selected)
    return original(chain, count, width, height, format, flags);
  InterlockedIncrement64(&g_resize_calls);
  result = original(chain, count, width, height, format, flags);
  {
    ResourceExclusiveGuard resource_guard;
    if (IsSelectedLocked(chain)) {
      InterlockedIncrement64(SUCCEEDED(result) ? &g_resize_successes
                                               : &g_resize_failures);
      if (result == DXGI_ERROR_DEVICE_REMOVED ||
          result == DXGI_ERROR_DEVICE_RESET ||
          result == DXGI_ERROR_DEVICE_HUNG) {
        InvalidateLocked(2u);
      } else if (FAILED(RecreateBackbuffer())) {
        InvalidateLocked(3u);
      }
    }
  }
  return result;
}

HRESULT STDMETHODCALLTYPE HookResizeBuffers1(IDXGISwapChain3 *chain, UINT count,
                                             UINT width, UINT height,
                                             DXGI_FORMAT format, UINT flags,
                                             const UINT *masks,
                                             IUnknown *const *queues) noexcept {
  CallbackLifetimeGuard callback;
  const ResizeBuffers1Function original = g_true_resize1;
  if (callback.detaching()) {
    return original(chain, count, width, height, format, flags, masks, queues);
  }
  ResizeExclusiveGuard resize_guard;
  bool selected = false;
  HRESULT result = E_FAIL;
  {
    ResourceExclusiveGuard resource_guard;
    selected = IsSelectedLocked(chain);
    if (selected)
      ReleaseBackbuffer();
  }
  if (!selected) {
    return original(chain, count, width, height, format, flags, masks, queues);
  }
  InterlockedIncrement64(&g_resize1_calls);
  result = original(chain, count, width, height, format, flags, masks, queues);
  {
    ResourceExclusiveGuard resource_guard;
    if (IsSelectedLocked(chain)) {
      InterlockedIncrement64(SUCCEEDED(result) ? &g_resize1_successes
                                               : &g_resize1_failures);
      if (result == DXGI_ERROR_DEVICE_REMOVED ||
          result == DXGI_ERROR_DEVICE_RESET ||
          result == DXGI_ERROR_DEVICE_HUNG) {
        InvalidateLocked(2u);
      } else if (FAILED(RecreateBackbuffer())) {
        InvalidateLocked(3u);
      }
    }
  }
  return result;
}

HRESULT STDMETHODCALLTYPE HookSetSourceSize(IDXGISwapChain2 *chain, UINT width,
                                            UINT height) noexcept {
  CallbackLifetimeGuard callback;
  const SetSourceSizeFunction original = g_true_source_size;
  if (callback.detaching())
    return original(chain, width, height);
  ResourceSharedGuard resource_guard;
  const bool selected = IsSelectedLocked(chain);
  const HRESULT result = original(chain, width, height);
  if (selected) {
    InterlockedIncrement64(&g_source_size_calls);
    InterlockedIncrement64(SUCCEEDED(result) ? &g_source_size_successes
                                             : &g_source_size_failures);
  }
  return result;
}

template <typename T>
T VtableMethod(IUnknown *object, std::size_t index) noexcept {
  if (object == nullptr)
    return nullptr;
  auto **table = *reinterpret_cast<void ***>(object);
  return reinterpret_cast<T>(table[index]);
}

bool InspectChainMethods(IDXGISwapChain *chain, MethodAddressSnapshot *methods,
                         IUnknown **identity_pointer,
                         IDXGISwapChain1 **chain1_pointer,
                         IDXGISwapChain2 **chain2_pointer,
                         IDXGISwapChain3 **chain3_pointer) noexcept {
  if (chain == nullptr || methods == nullptr || identity_pointer == nullptr ||
      chain1_pointer == nullptr || chain2_pointer == nullptr ||
      chain3_pointer == nullptr) {
    return false;
  }
  *methods = {};
  IUnknown *identity = nullptr;
  IDXGISwapChain1 *chain1 = nullptr;
  IDXGISwapChain2 *chain2 = nullptr;
  IDXGISwapChain3 *chain3 = nullptr;
  bool valid = SUCCEEDED(chain->QueryInterface(IID_PPV_ARGS(&identity))) &&
               identity != nullptr;
  methods->release =
      reinterpret_cast<ULONG_PTR>(VtableMethod<ReleaseFunction>(chain, 2));
  methods->present =
      reinterpret_cast<ULONG_PTR>(VtableMethod<PresentFunction>(chain, 8));
  methods->setFullscreenState = reinterpret_cast<ULONG_PTR>(
      VtableMethod<SetFullscreenStateFunction>(chain, 10));
  methods->resizeBuffers = reinterpret_cast<ULONG_PTR>(
      VtableMethod<ResizeBuffersFunction>(chain, 13));
  if (SUCCEEDED(chain->QueryInterface(IID_PPV_ARGS(&chain1)))) {
    valid = valid && ExactIdentity(chain1, identity);
    methods->present1 =
        reinterpret_cast<ULONG_PTR>(VtableMethod<Present1Function>(chain1, 22));
  }
  if (SUCCEEDED(chain->QueryInterface(IID_PPV_ARGS(&chain2)))) {
    valid = valid && ExactIdentity(chain2, identity);
    methods->setSourceSize = reinterpret_cast<ULONG_PTR>(
        VtableMethod<SetSourceSizeFunction>(chain2, 29));
  }
  if (SUCCEEDED(chain->QueryInterface(IID_PPV_ARGS(&chain3)))) {
    valid = valid && ExactIdentity(chain3, identity);
    methods->resizeBuffers1 = reinterpret_cast<ULONG_PTR>(
        VtableMethod<ResizeBuffers1Function>(chain3, 39));
  }
  valid = valid && methods->release != 0u && methods->present != 0u &&
          methods->setFullscreenState != 0u && methods->resizeBuffers != 0u;
  *identity_pointer = identity;
  *chain1_pointer = chain1;
  *chain2_pointer = chain2;
  *chain3_pointer = chain3;
  SafeRelease(chain3);
  SafeRelease(chain2);
  SafeRelease(chain1);
  SafeRelease(identity);
  return valid;
}

HWND CreateProbeWindow() noexcept {
  return CreateWindowExW(0, L"STATIC", L"GameHub DXGI D3D11 QA probe",
                         WS_OVERLAPPED, 0, 0, 64, 64, nullptr, nullptr,
                         GetModuleHandleW(nullptr), nullptr);
}

HRESULT DiscoverMethods(MethodAddressSnapshot *methods) noexcept {
  if (Read(&g_inside_dllmain) != 0) {
    InterlockedIncrement(&g_dllmain_d3d_calls);
    return E_UNEXPECTED;
  }
  HWND window = CreateProbeWindow();
  if (window == nullptr)
    return HRESULT_FROM_WIN32(GetLastError());
  IDXGISwapChain *chain = nullptr;
  ID3D11Device *device = nullptr;
  ID3D11DeviceContext *context = nullptr;
  D3D_FEATURE_LEVEL level{};
  HRESULT result =
      D3D11CreateDevice(nullptr, D3D_DRIVER_TYPE_WARP, nullptr, 0, nullptr, 0,
                        D3D11_SDK_VERSION, &device, &level, &context);
  IDXGIDevice *dxgi_device = nullptr;
  IDXGIAdapter *adapter = nullptr;
  IDXGIFactory2 *factory = nullptr;
  IDXGISwapChain1 *created_chain = nullptr;
  if (SUCCEEDED(result)) {
    result = device->QueryInterface(IID_PPV_ARGS(&dxgi_device));
  }
  if (SUCCEEDED(result))
    result = dxgi_device->GetAdapter(&adapter);
  if (SUCCEEDED(result))
    result = adapter->GetParent(IID_PPV_ARGS(&factory));
  DXGI_SWAP_CHAIN_DESC1 description{};
  description.Width = 64;
  description.Height = 64;
  description.Format = DXGI_FORMAT_B8G8R8A8_UNORM;
  description.SampleDesc.Count = 1;
  description.BufferUsage = DXGI_USAGE_RENDER_TARGET_OUTPUT;
  description.BufferCount = 2;
  description.SwapEffect = DXGI_SWAP_EFFECT_FLIP_SEQUENTIAL;
  description.Scaling = DXGI_SCALING_STRETCH;
  description.AlphaMode = DXGI_ALPHA_MODE_IGNORE;
  DXGI_SWAP_CHAIN_FULLSCREEN_DESC fullscreen{};
  fullscreen.Windowed = TRUE;
  if (SUCCEEDED(result)) {
    result = factory->CreateSwapChainForHwnd(
        device, window, &description, &fullscreen, nullptr, &created_chain);
  }
  if (SUCCEEDED(result)) {
    result = created_chain->QueryInterface(IID_PPV_ARGS(&chain));
  }
  if (SUCCEEDED(result)) {
    methods->release =
        reinterpret_cast<ULONG_PTR>(VtableMethod<ReleaseFunction>(chain, 2));
    methods->present =
        reinterpret_cast<ULONG_PTR>(VtableMethod<PresentFunction>(chain, 8));
    methods->setFullscreenState = reinterpret_cast<ULONG_PTR>(
        VtableMethod<SetFullscreenStateFunction>(chain, 10));
    methods->resizeBuffers = reinterpret_cast<ULONG_PTR>(
        VtableMethod<ResizeBuffersFunction>(chain, 13));
    IDXGISwapChain1 *chain1 = nullptr;
    if (SUCCEEDED(chain->QueryInterface(IID_PPV_ARGS(&chain1)))) {
      methods->present1 = reinterpret_cast<ULONG_PTR>(
          VtableMethod<Present1Function>(chain1, 22));
      InterlockedExchange(&g_present1_present, 1);
    }
    IDXGISwapChain2 *chain2 = nullptr;
    if (SUCCEEDED(chain->QueryInterface(IID_PPV_ARGS(&chain2)))) {
      methods->setSourceSize = reinterpret_cast<ULONG_PTR>(
          VtableMethod<SetSourceSizeFunction>(chain2, 29));
      InterlockedExchange(&g_source_size_present, 1);
    }
    IDXGISwapChain3 *chain3 = nullptr;
    if (SUCCEEDED(chain->QueryInterface(IID_PPV_ARGS(&chain3)))) {
      methods->resizeBuffers1 = reinterpret_cast<ULONG_PTR>(
          VtableMethod<ResizeBuffers1Function>(chain3, 39));
      InterlockedExchange(&g_resize1_present, 1);
    }
    SafeRelease(chain3);
    SafeRelease(chain2);
    SafeRelease(chain1);
  }
  SafeRelease(created_chain);
  SafeRelease(factory);
  SafeRelease(adapter);
  SafeRelease(dxgi_device);
  SafeRelease(context);
  SafeRelease(device);
  SafeRelease(chain);
  DestroyWindow(window);
  return result;
}

LONG AttachMethods(const MethodAddressSnapshot &methods) noexcept {
  g_true_release = reinterpret_cast<ReleaseFunction>(methods.release);
  g_true_present = reinterpret_cast<PresentFunction>(methods.present);
  g_true_fullscreen =
      reinterpret_cast<SetFullscreenStateFunction>(methods.setFullscreenState);
  g_true_resize =
      reinterpret_cast<ResizeBuffersFunction>(methods.resizeBuffers);
  g_true_present1 = reinterpret_cast<Present1Function>(methods.present1);
  g_true_source_size =
      reinterpret_cast<SetSourceSizeFunction>(methods.setSourceSize);
  g_true_resize1 =
      reinterpret_cast<ResizeBuffers1Function>(methods.resizeBuffers1);
  if (g_true_release == nullptr || g_true_present == nullptr ||
      g_true_fullscreen == nullptr || g_true_resize == nullptr) {
    return ERROR_PROC_NOT_FOUND;
  }
  LONG error = DetourTransactionBegin();
  LONG enlisted = 0;
  if (error == NO_ERROR)
    error = DetourUpdateThread(GetCurrentThread());
  DetourThreadSet thread_set;
  if (error == NO_ERROR)
    error = thread_set.EnlistProcessThreads();
  if (error == NO_ERROR)
    enlisted = thread_set.count() + 1;
#define GAMEHUB_ATTACH_IF_PRESENT(pointer, hook)                               \
  if (error == NO_ERROR && pointer != nullptr) {                               \
    error = DetourAttach(reinterpret_cast<PVOID *>(&pointer),                  \
                         reinterpret_cast<PVOID>(hook));                       \
  }
  GAMEHUB_ATTACH_IF_PRESENT(g_true_release, HookRelease);
  GAMEHUB_ATTACH_IF_PRESENT(g_true_present, HookPresent);
  GAMEHUB_ATTACH_IF_PRESENT(g_true_fullscreen, HookSetFullscreenState);
  GAMEHUB_ATTACH_IF_PRESENT(g_true_resize, HookResizeBuffers);
  GAMEHUB_ATTACH_IF_PRESENT(g_true_present1, HookPresent1);
  GAMEHUB_ATTACH_IF_PRESENT(g_true_source_size, HookSetSourceSize);
  GAMEHUB_ATTACH_IF_PRESENT(g_true_resize1, HookResizeBuffers1);
#undef GAMEHUB_ATTACH_IF_PRESENT
  if (error == NO_ERROR) {
    error = DetourTransactionCommit();
  } else {
    DetourTransactionAbort();
  }
  if (error == NO_ERROR) {
    g_attached_methods = methods;
    InterlockedExchange(&g_method_attach_threads, enlisted);
    InterlockedExchange(&g_methods_attached, 1);
  }
  return error;
}

int WINAPI HookApplicationEntry() {
  MethodAddressSnapshot methods{};
  const HRESULT discovery = DiscoverMethods(&methods);
  g_cached_methods = methods;
  if (SUCCEEDED(discovery)) {
    InterlockedExchange(&g_method_discovered_before_entry, 1);
    InterlockedExchange(&g_method_attach_error, AttachMethods(methods));
  } else {
    InterlockedExchange(&g_method_attach_error, discovery);
  }
  return g_true_entry == nullptr ? 80 : g_true_entry();
}

LONG DetachMethods() noexcept {
  LONG error = DetourTransactionBegin();
  LONG enlisted = 0;
  if (error == NO_ERROR)
    error = DetourUpdateThread(GetCurrentThread());
  DetourThreadSet thread_set;
  if (error == NO_ERROR)
    error = thread_set.EnlistProcessThreads();
  if (error == NO_ERROR)
    enlisted = thread_set.count() + 1;
#define GAMEHUB_DETACH_IF_PRESENT(pointer, hook)                               \
  if (error == NO_ERROR && pointer != nullptr) {                               \
    error = DetourDetach(reinterpret_cast<PVOID *>(&pointer),                  \
                         reinterpret_cast<PVOID>(hook));                       \
  }
  GAMEHUB_DETACH_IF_PRESENT(g_true_release, HookRelease);
  GAMEHUB_DETACH_IF_PRESENT(g_true_present, HookPresent);
  GAMEHUB_DETACH_IF_PRESENT(g_true_fullscreen, HookSetFullscreenState);
  GAMEHUB_DETACH_IF_PRESENT(g_true_resize, HookResizeBuffers);
  GAMEHUB_DETACH_IF_PRESENT(g_true_present1, HookPresent1);
  GAMEHUB_DETACH_IF_PRESENT(g_true_source_size, HookSetSourceSize);
  GAMEHUB_DETACH_IF_PRESENT(g_true_resize1, HookResizeBuffers1);
  if (error == NO_ERROR && g_true_entry != nullptr) {
    error = DetourDetach(reinterpret_cast<PVOID *>(&g_true_entry),
                         reinterpret_cast<PVOID>(HookApplicationEntry));
  }
#undef GAMEHUB_DETACH_IF_PRESENT
  if (error == NO_ERROR) {
    error = DetourTransactionCommit();
  } else {
    DetourTransactionAbort();
  }
  if (error == NO_ERROR)
    InterlockedExchange(&g_detach_threads, enlisted);
  return error;
}

} // namespace

extern "C" BOOL WINAPI GameHubDxgiD3d11QaGetSnapshot(BootstrapSnapshot *output,
                                                     DWORD output_size) {
  if (output == nullptr || output_size != sizeof(*output))
    return FALSE;
  BootstrapSnapshot snapshot{};
  snapshot.structSize = sizeof(snapshot);
  snapshot.schemaVersion = kSchemaVersion;
  snapshot.restoreAfterWithSucceeded =
      static_cast<DWORD>(Read(&g_restore_after_with));
  snapshot.dllMainD3dCalls = static_cast<DWORD>(Read(&g_dllmain_d3d_calls));
  snapshot.entryAttachError = Read(&g_entry_attach_error);
  snapshot.methodAttachError = Read(&g_method_attach_error);
  snapshot.entryHookAttached = static_cast<DWORD>(Read(&g_entry_attached));
  snapshot.methodDiscoveryBeforeApplicationEntry =
      static_cast<DWORD>(Read(&g_method_discovered_before_entry));
  snapshot.methodHooksAttached = static_cast<DWORD>(Read(&g_methods_attached));
  snapshot.methodAttachThreadsEnlisted =
      static_cast<DWORD>(Read(&g_method_attach_threads));
  snapshot.present1Present = static_cast<DWORD>(Read(&g_present1_present));
  snapshot.setSourceSizePresent =
      static_cast<DWORD>(Read(&g_source_size_present));
  snapshot.resizeBuffers1Present = static_cast<DWORD>(Read(&g_resize1_present));
  snapshot.registered = static_cast<DWORD>(Read(&g_registered));
  snapshot.identityMatched = static_cast<DWORD>(Read(&g_identity_matched));
  snapshot.deviceIdentityMatched =
      static_cast<DWORD>(Read(&g_device_identity_matched));
  snapshot.immediateContextMatched =
      static_cast<DWORD>(Read(&g_immediate_context_matched));
  snapshot.liveMethodBodiesMatched =
      static_cast<DWORD>(Read(&g_live_method_bodies_matched));
  snapshot.releaseTokenBodiesMatched =
      static_cast<DWORD>(Read(&g_release_token_bodies_matched));
  snapshot.getterVisibleStateMask = static_cast<DWORD>(Read(&g_pipeline_mask));
  snapshot.overlayReady = static_cast<DWORD>(Read(&g_overlay_ready));
  snapshot.invalidated = static_cast<DWORD>(Read(&g_invalidated));
  snapshot.invalidationReason =
      static_cast<DWORD>(Read(&g_invalidation_reason));
  snapshot.detachAttempted = static_cast<DWORD>(Read(&g_detach_attempted));
  snapshot.detachError = Read(&g_detach_error);
  snapshot.detachQuiesced = static_cast<DWORD>(Read(&g_detach_quiesced));
  snapshot.detachWaitingExclusive =
      static_cast<DWORD>(Read(&g_detach_waiting_exclusive));
  snapshot.detachCommitComplete =
      static_cast<DWORD>(Read(&g_detach_commit_complete));
  snapshot.detachThreadsEnlisted = static_cast<DWORD>(Read(&g_detach_threads));
  snapshot.inFlight = Read(&g_in_flight);
  snapshot.peakInFlight = Read(&g_peak_in_flight);
  snapshot.callbackAdmissionWaiters = Read(&g_callback_admission_waiters);
  snapshot.callbackAdmissionAttempts =
      static_cast<unsigned long long>(Read64(&g_callback_admission_attempts));
  snapshot.presentGate = Read(&g_present_gate);
#define GAMEHUB_READ_COUNTER(field, global)                                    \
  snapshot.field = static_cast<unsigned long long>(Read64(&global))
  GAMEHUB_READ_COUNTER(presentCalls, g_present_calls);
  GAMEHUB_READ_COUNTER(present1Calls, g_present1_calls);
  GAMEHUB_READ_COUNTER(overlayDraws, g_overlay_draws);
  GAMEHUB_READ_COUNTER(stateRestoreChecks, g_state_restore_checks);
  GAMEHUB_READ_COUNTER(stateRestoreMismatches, g_state_restore_mismatches);
  snapshot.lastStateRestoreDifferenceMask =
      static_cast<DWORD>(Read(&g_last_state_restore_difference));
  GAMEHUB_READ_COUNTER(postDetachPresentForwards,
                       g_post_detach_present_forwards);
  GAMEHUB_READ_COUNTER(skippedContention, g_skipped_contention);
  GAMEHUB_READ_COUNTER(skippedUnregistered, g_skipped_unregistered);
  GAMEHUB_READ_COUNTER(competingChainRefusals, g_competing_refusals);
  GAMEHUB_READ_COUNTER(resizeBuffersCalls, g_resize_calls);
  GAMEHUB_READ_COUNTER(resizeBuffersSuccesses, g_resize_successes);
  GAMEHUB_READ_COUNTER(resizeBuffersFailures, g_resize_failures);
  GAMEHUB_READ_COUNTER(resizeBuffers1Calls, g_resize1_calls);
  GAMEHUB_READ_COUNTER(resizeBuffers1Successes, g_resize1_successes);
  GAMEHUB_READ_COUNTER(resizeBuffers1Failures, g_resize1_failures);
  GAMEHUB_READ_COUNTER(setSourceSizeCalls, g_source_size_calls);
  GAMEHUB_READ_COUNTER(setSourceSizeSuccesses, g_source_size_successes);
  GAMEHUB_READ_COUNTER(setSourceSizeFailures, g_source_size_failures);
  GAMEHUB_READ_COUNTER(fullscreenCalls, g_fullscreen_calls);
  GAMEHUB_READ_COUNTER(releaseCalls, g_release_calls);
  GAMEHUB_READ_COUNTER(destroyedInvalidations, g_destroyed_invalidations);
  GAMEHUB_READ_COUNTER(deviceLostInvalidations, g_device_lost_invalidations);
  GAMEHUB_READ_COUNTER(resourceRecreations, g_resource_recreations);
  GAMEHUB_READ_COUNTER(multisampleBackbuffers, g_multisample_backbuffers);
#undef GAMEHUB_READ_COUNTER
  if (TryAcquireSRWLockShared(&g_resource_lifetime_lock)) {
    snapshot.selectedSwapChain = reinterpret_cast<ULONG_PTR>(g_selected_chain);
    snapshot.selectedDevice = reinterpret_cast<ULONG_PTR>(g_device);
    snapshot.selectedContext = reinterpret_cast<ULONG_PTR>(g_context);
    ReleaseSRWLockShared(&g_resource_lifetime_lock);
  }
  snapshot.cachedMethods = g_cached_methods;
  snapshot.attachedMethods = g_attached_methods;
  *output = snapshot;
  return TRUE;
}

extern "C" HRESULT WINAPI GameHubDxgiD3d11QaRegisterSwapChain(
    IDXGISwapChain *swap_chain, ID3D11Device *device,
    ID3D11DeviceContext *context) {
  if (swap_chain == nullptr || device == nullptr || context == nullptr ||
      Read(&g_methods_attached) == 0 || Read(&g_registered) != 0 ||
      Read(&g_detaching) != 0) {
    return E_INVALIDARG;
  }
  ID3D11Device *chain_device = nullptr;
  ID3D11Device *context_device = nullptr;
  ID3D11DeviceContext *immediate_context = nullptr;
  HRESULT result = swap_chain->GetDevice(IID_PPV_ARGS(&chain_device));
  context->GetDevice(&context_device);
  device->GetImmediateContext(&immediate_context);
  MethodAddressSnapshot live_methods{};
  IUnknown *live_identity = nullptr;
  IDXGISwapChain1 *live_chain1 = nullptr;
  IDXGISwapChain2 *live_chain2 = nullptr;
  IDXGISwapChain3 *live_chain3 = nullptr;
  const bool methods_valid =
      InspectChainMethods(swap_chain, &live_methods, &live_identity,
                          &live_chain1, &live_chain2, &live_chain3) &&
      std::memcmp(&live_methods, &g_cached_methods, sizeof(live_methods)) == 0;
  IUnknown *release_tokens[]{live_identity, swap_chain,
                             reinterpret_cast<IUnknown *>(live_chain1),
                             reinterpret_cast<IUnknown *>(live_chain2),
                             reinterpret_cast<IUnknown *>(live_chain3)};
  bool release_token_bodies = g_cached_methods.release != 0u;
  for (IUnknown *token : release_tokens) {
    if (token != nullptr &&
        reinterpret_cast<ULONG_PTR>(VtableMethod<ReleaseFunction>(token, 2)) !=
            g_cached_methods.release) {
      release_token_bodies = false;
    }
  }
  const bool device_identity = SUCCEEDED(result) &&
                               ExactIdentity(chain_device, device) &&
                               ExactIdentity(context_device, device);
  const bool immediate_context_identity =
      context->GetType() == D3D11_DEVICE_CONTEXT_IMMEDIATE &&
      ExactIdentity(immediate_context, context);
  InterlockedExchange(&g_device_identity_matched, device_identity ? 1 : 0);
  InterlockedExchange(&g_immediate_context_matched,
                      immediate_context_identity ? 1 : 0);
  InterlockedExchange(&g_live_method_bodies_matched, methods_valid ? 1 : 0);
  InterlockedExchange(&g_release_token_bodies_matched,
                      release_token_bodies ? 1 : 0);
  const bool identity = device_identity && immediate_context_identity &&
                        methods_valid && release_token_bodies;
  SafeRelease(immediate_context);
  SafeRelease(context_device);
  SafeRelease(chain_device);
  if (!identity)
    return E_NOINTERFACE;

  CommandExclusiveGuard command_guard;
  ResourceExclusiveGuard resource_guard;
  if (Read(&g_methods_attached) == 0 || Read(&g_registered) != 0 ||
      Read(&g_detaching) != 0) {
    return E_INVALIDARG;
  }
  g_selected_chain = swap_chain;
  g_selected_identity = live_identity;
  g_selected_chain1 = live_chain1;
  g_selected_chain2 = live_chain2;
  g_selected_chain3 = live_chain3;
  for (std::size_t index = 0; index < ARRAYSIZE(release_tokens); ++index) {
    InterlockedExchangePointer(&g_selected_release_tokens[index],
                               release_tokens[index]);
  }
  g_device = device;
  g_context = context;
  g_device->AddRef();
  g_context->AddRef();
  result = CreateOverlayShaders();
  if (SUCCEEDED(result))
    result = RecreateBackbuffer();
  if (FAILED(result)) {
    ReleaseRegistration();
    return result;
  }
  InterlockedExchange(&g_identity_matched, 1);
  InterlockedExchange(&g_invalidated, 0);
  InterlockedExchange(&g_invalidation_reason, 0);
  InterlockedExchange(&g_registered, 1);
  return S_OK;
}

extern "C" void WINAPI GameHubDxgiD3d11QaSetPresentGate(BOOL held) {
  InterlockedExchange(&g_present_gate, held ? 1 : 0);
}

extern "C" void WINAPI GameHubDxgiD3d11QaSetPauseInFlight(BOOL held) {
  InterlockedExchange(&g_pause_in_flight, held ? 1 : 0);
}

extern "C" DWORD WINAPI GameHubDxgiD3d11QaDetach() {
  if (InterlockedExchange(&g_detach_attempted, 1) != 0) {
    return static_cast<DWORD>(Read(&g_detach_error));
  }
  CommandExclusiveGuard command_guard;
  InterlockedExchange(&g_callback_admission_closed, 1);
  InterlockedExchange(&g_detaching, 1);
  const ULONGLONG deadline = GetTickCount64() + 5'000u;
  if (!TryAcquireSRWLockExclusive(&g_callback_lifetime_lock)) {
    InterlockedExchange(&g_detach_waiting_exclusive, 1);
    while (!TryAcquireSRWLockExclusive(&g_callback_lifetime_lock)) {
      if (GetTickCount64() >= deadline) {
        InterlockedExchange(&g_detach_waiting_exclusive, 0);
        InterlockedExchange(&g_detaching, 0);
        InterlockedExchange(&g_callback_admission_closed, 0);
        WakeByAddressAll(const_cast<LONG *>(&g_callback_admission_closed));
        InterlockedExchange(&g_detach_error, WAIT_TIMEOUT);
        return WAIT_TIMEOUT;
      }
      SwitchToThread();
    }
    InterlockedExchange(&g_detach_waiting_exclusive, 0);
  }
  InterlockedExchange(&g_detach_quiesced, Read(&g_in_flight) == 0 ? 1 : 0);
  const LONG error = DetachMethods();
  if (error == NO_ERROR)
    InterlockedExchange(&g_detach_commit_complete, 1);
  {
    ResourceExclusiveGuard resource_guard;
    ReleaseRegistration();
  }
  InterlockedExchange(&g_detach_error, error);
  if (error == NO_ERROR) {
    InterlockedExchange(&g_methods_attached, 0);
    InterlockedExchange(&g_entry_attached, 0);
  }
  ReleaseSRWLockExclusive(&g_callback_lifetime_lock);
  InterlockedExchange(&g_callback_admission_closed, 0);
  WakeByAddressAll(const_cast<LONG *>(&g_callback_admission_closed));
  return static_cast<DWORD>(error);
}

extern "C" BOOL WINAPI
GameHubDxgiD3d11QaApplyTerminalPresentResult(HRESULT result) {
  CallbackLifetimeGuard callback;
  if (callback.detaching())
    return FALSE;
  return HandleTerminalPresentResult(result) ? TRUE : FALSE;
}

BOOL WINAPI DllMain(HINSTANCE instance, DWORD reason, LPVOID) {
  if (reason != DLL_PROCESS_ATTACH)
    return TRUE;
  InterlockedExchange(&g_inside_dllmain, 1);
  DisableThreadLibraryCalls(instance);
  InterlockedExchange(&g_restore_after_with, DetourRestoreAfterWith() ? 1 : 0);
  HMODULE executable = GetModuleHandleW(nullptr);
  g_true_entry = reinterpret_cast<ApplicationEntryFunction>(
      GetProcAddress(executable, "GameHubDxgiD3d11QaApplicationEntry"));
  LONG error =
      g_true_entry == nullptr ? ERROR_PROC_NOT_FOUND : DetourTransactionBegin();
  if (error == NO_ERROR)
    error = DetourUpdateThread(GetCurrentThread());
  if (error == NO_ERROR) {
    error = DetourAttach(reinterpret_cast<PVOID *>(&g_true_entry),
                         reinterpret_cast<PVOID>(HookApplicationEntry));
  }
  if (error == NO_ERROR) {
    error = DetourTransactionCommit();
  } else {
    DetourTransactionAbort();
  }
  InterlockedExchange(&g_entry_attach_error, error);
  InterlockedExchange(&g_entry_attached, error == NO_ERROR ? 1 : 0);
  InterlockedExchange(&g_inside_dllmain, 0);
  return TRUE;
}
