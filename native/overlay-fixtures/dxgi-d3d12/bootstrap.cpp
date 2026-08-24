// clang-format off: Windows types must be visible before the Detours header.
#include "contract.hpp"
#include <detours.h>
// clang-format on

#include <tlhelp32.h>

#include <array>
#include <cstring>

namespace {

using namespace gamehub::overlay::dxgi_d3d12_qa;

using PresentFunction = HRESULT(STDMETHODCALLTYPE *)(IDXGISwapChain *, UINT,
                                                     UINT);
using SetFullscreenStateFunction =
    HRESULT(STDMETHODCALLTYPE *)(IDXGISwapChain *, BOOL, IDXGIOutput *);
using ResizeBuffersFunction = HRESULT(STDMETHODCALLTYPE *)(IDXGISwapChain *,
                                                           UINT, UINT, UINT,
                                                           DXGI_FORMAT, UINT);
using Present1Function = HRESULT(STDMETHODCALLTYPE *)(
    IDXGISwapChain1 *, UINT, UINT, const DXGI_PRESENT_PARAMETERS *);
using CreateSwapChainForHwndFunction = HRESULT(STDMETHODCALLTYPE *)(
    IDXGIFactory2 *, IUnknown *, HWND, const DXGI_SWAP_CHAIN_DESC1 *,
    const DXGI_SWAP_CHAIN_FULLSCREEN_DESC *, IDXGIOutput *, IDXGISwapChain1 **);

ApplicationEntryFunction g_true_entry = nullptr;
PresentFunction g_true_present = nullptr;
SetFullscreenStateFunction g_true_fullscreen = nullptr;
ResizeBuffersFunction g_true_resize = nullptr;
Present1Function g_true_present1 = nullptr;
CreateSwapChainForHwndFunction g_true_create_swap_chain = nullptr;

volatile LONG g_restore_after_with = 0;
volatile LONG g_dllmain_graphics_calls = 0;
volatile LONG g_inside_dllmain = 0;
volatile LONG g_entry_attached = 0;
volatile LONG g_entry_attach_error = ERROR_INVALID_STATE;
volatile LONG g_method_discovered_before_entry = 0;
volatile LONG g_methods_attached = 0;
volatile LONG g_method_attach_threads = 0;
volatile LONG g_method_attach_error = ERROR_INVALID_STATE;
volatile LONG g_present1_present = 0;
volatile LONG g_create_swap_chain_hook_present = 0;
volatile LONG g_registered = 0;
volatile LONG g_identity_matched = 0;
volatile LONG g_device_identity_matched = 0;
volatile LONG g_command_queue_identity_matched = 0;
volatile LONG g_creation_record_matched = 0;
volatile LONG g_live_method_bodies_matched = 0;
volatile LONG g_overlay_ready = 0;
volatile LONG g_preallocated_resources = 0;
volatile LONG g_separate_command_list = 0;
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
volatile LONG g_forced_present_gate = 0;
volatile LONG g_submit_active = 0;
volatile LONG g_pause_in_flight = 0;
volatile LONG g_armed_fault_mode = kQaFaultNone;
volatile LONG g_untracked_submission = 0;
volatile LONG g_idle_wait_poisoned = 0;
volatile LONG g_registered_resources_retired = 0;
volatile LONG g_retired_submission_slots[kMaximumBackBuffers]{};
thread_local LONG g_callback_admission_depth = 0;
thread_local bool g_inside_present_hot_path = false;

volatile LONG64 g_present_calls = 0;
volatile LONG64 g_present1_calls = 0;
volatile LONG64 g_command_lists_executed = 0;
volatile LONG64 g_overlay_submissions = 0;
volatile LONG64 g_submission_signal_failures = 0;
volatile LONG64 g_submission_slot_retirements = 0;
volatile LONG64 g_independent_idle_recoveries = 0;
volatile LONG64 g_command_queue_signals = 0;
volatile LONG64 g_resource_idle_signals = 0;
volatile LONG64 g_resource_idle_completions = 0;
volatile LONG64 g_resource_idle_failures = 0;
volatile LONG64 g_resource_idle_waits = 0;
volatile LONG64 g_resource_idle_timeouts = 0;
volatile LONG64 g_stale_wake_rejections = 0;
volatile LONG64 g_retired_wait_event_count = 0;
volatile LONG64 g_present_blocking_wait_calls = 0;
volatile LONG64 g_skipped_contention = 0;
volatile LONG64 g_skipped_gpu_busy = 0;
volatile LONG64 g_skipped_unregistered = 0;
volatile LONG64 g_competing_refusals = 0;
volatile LONG64 g_resize_calls = 0;
volatile LONG64 g_resize_successes = 0;
volatile LONG64 g_resize_failures = 0;
volatile LONG64 g_fullscreen_calls = 0;
volatile LONG64 g_creation_records = 0;
volatile LONG64 g_creation_record_overflows = 0;
volatile LONG64 g_resource_recreations = 0;
volatile LONG64 g_post_detach_present_forwards = 0;

SRWLOCK g_callback_lifetime_lock = SRWLOCK_INIT;
SRWLOCK g_resource_lifetime_lock = SRWLOCK_INIT;
SRWLOCK g_resize_call_lock = SRWLOCK_INIT;
SRWLOCK g_control_lock = SRWLOCK_INIT;
SRWLOCK g_creation_lock = SRWLOCK_INIT;

IDXGISwapChain *g_selected_chain = nullptr;
IUnknown *g_selected_identity = nullptr;
IDXGISwapChain1 *g_selected_chain1 = nullptr;
IDXGISwapChain3 *g_selected_chain3 = nullptr;
ID3D12Device *g_device = nullptr;
ID3D12CommandQueue *g_command_queue = nullptr;
ID3D12DescriptorHeap *g_rtv_heap = nullptr;
ID3D12GraphicsCommandList *g_command_list = nullptr;
ID3D12Fence *g_fence = nullptr;
std::array<ID3D12CommandAllocator *, kMaximumBackBuffers> g_allocators{};
std::array<ID3D12Resource *, kMaximumBackBuffers> g_backbuffers{};
std::array<UINT64, kMaximumBackBuffers> g_pending_fences{};
UINT g_backbuffer_count = 0;
UINT g_rtv_stride = 0;
UINT64 g_next_fence = 1;
std::array<HANDLE, 8> g_retired_wait_event_handles{};

struct CreationRecord {
  IUnknown *chainIdentity = nullptr;
  ID3D12CommandQueue *commandQueue = nullptr;
};
std::array<CreationRecord, 8> g_creation_record_slots{};

MethodAddressSnapshot g_cached_methods{};
MethodAddressSnapshot g_attached_methods{};

LONG Read(volatile LONG *value) noexcept {
  return InterlockedCompareExchange(value, 0, 0);
}

LONG64 Read64(volatile LONG64 *value) noexcept {
  return InterlockedCompareExchange64(value, 0, 0);
}

HRESULT LastErrorOrFailure() noexcept {
  const DWORD error = GetLastError();
  return error == NO_ERROR ? E_FAIL : HRESULT_FROM_WIN32(error);
}

template <typename T> void SafeRelease(T *&value) noexcept {
  if (value != nullptr) {
    value->Release();
    value = nullptr;
  }
}

template <typename T>
T VtableMethod(IUnknown *object, std::size_t index) noexcept {
  if (object == nullptr)
    return nullptr;
  auto **table = *reinterpret_cast<void ***>(object);
  return reinterpret_cast<T>(table[index]);
}

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
    UpdatePeak(InterlockedIncrement(&g_in_flight));
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

class ExclusiveLock {
public:
  explicit ExclusiveLock(SRWLOCK *lock) noexcept : lock_(lock) {
    AcquireSRWLockExclusive(lock_);
  }
  ~ExclusiveLock() { ReleaseSRWLockExclusive(lock_); }
  ExclusiveLock(const ExclusiveLock &) = delete;
  ExclusiveLock &operator=(const ExclusiveLock &) = delete;

private:
  SRWLOCK *lock_;
};

class DetourThreadSet {
public:
  static constexpr std::size_t kCapacity = 256;

  ~DetourThreadSet() {
    for (std::size_t index = 0; index < count_; ++index)
      CloseHandle(handles_[index]);
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

bool ConsumeFault(QaFaultMode fault) noexcept {
  return InterlockedCompareExchange(
             &g_armed_fault_mode, static_cast<LONG>(kQaFaultNone),
             static_cast<LONG>(fault)) == static_cast<LONG>(fault);
}

DWORD CountRetiredSubmissionSlots() noexcept {
  DWORD count = 0;
  for (volatile LONG &slot : g_retired_submission_slots) {
    if (Read(&slot) != 0)
      ++count;
  }
  return count;
}

void RetireWaitEvent(HANDLE event) noexcept {
  if (event == nullptr)
    return;
  for (HANDLE &slot : g_retired_wait_event_handles) {
    if (slot == nullptr) {
      slot = event;
      InterlockedIncrement64(&g_retired_wait_event_count);
      return;
    }
  }
  // An event with a pending fence registration must never be closed or reused.
  // Losing the handle leaks it until process exit, which is the safe failure.
  InterlockedIncrement64(&g_retired_wait_event_count);
}

void PoisonIdleProof(HANDLE event, bool pending_registration,
                     bool timeout) noexcept {
  InterlockedIncrement64(&g_resource_idle_failures);
  if (timeout)
    InterlockedIncrement64(&g_resource_idle_timeouts);
  if (pending_registration)
    RetireWaitEvent(event);
  else if (event != nullptr)
    CloseHandle(event);
  InterlockedExchange(&g_overlay_ready, 0);
  InterlockedExchange(&g_idle_wait_poisoned, 1);
  InterlockedExchange(&g_registered_resources_retired, 1);
}

void MarkUntrackedSubmission(std::size_t slot) noexcept {
  InterlockedIncrement64(&g_submission_signal_failures);
  if (InterlockedExchange(&g_retired_submission_slots[slot], 1) == 0)
    InterlockedIncrement64(&g_submission_slot_retirements);
  InterlockedExchange(&g_untracked_submission, 1);
  InterlockedExchange(&g_registered_resources_retired, 1);
  InterlockedExchange(&g_overlay_ready, 0);
}

void RecoverUntrackedSubmissions() noexcept {
  if (InterlockedExchange(&g_untracked_submission, 0) == 0)
    return;
  for (volatile LONG &slot : g_retired_submission_slots)
    InterlockedExchange(&slot, 0);
  InterlockedExchange(&g_registered_resources_retired, 0);
  InterlockedIncrement64(&g_independent_idle_recoveries);
}

bool ReleaseBackbuffers() noexcept {
  if (Read(&g_untracked_submission) != 0 ||
      Read(&g_idle_wait_poisoned) != 0) {
    InterlockedExchange(&g_registered_resources_retired, 1);
    return false;
  }
  InterlockedExchange(&g_overlay_ready, 0);
  for (std::size_t index = 0; index < g_backbuffers.size(); ++index) {
    SafeRelease(g_backbuffers[index]);
    g_pending_fences[index] = 0;
    InterlockedExchange(&g_retired_submission_slots[index], 0);
  }
  g_backbuffer_count = 0;
  return true;
}

bool WaitForResourceIdle() noexcept {
  if (Read(&g_idle_wait_poisoned) != 0) {
    InterlockedIncrement64(&g_resource_idle_failures);
    return false;
  }
  if (g_command_queue == nullptr || g_fence == nullptr) {
    PoisonIdleProof(nullptr, false, false);
    return false;
  }
  if (g_inside_present_hot_path) {
    InterlockedIncrement64(&g_present_blocking_wait_calls);
    PoisonIdleProof(nullptr, false, false);
    return false;
  }
  const UINT64 value = g_next_fence++;
  const HRESULT signal_result = g_command_queue->Signal(g_fence, value);
  if (FAILED(signal_result)) {
    PoisonIdleProof(nullptr, false, false);
    return false;
  }
  InterlockedIncrement64(&g_command_queue_signals);
  InterlockedIncrement64(&g_resource_idle_signals);
  const bool inject_stale_timeout =
      ConsumeFault(kQaFaultNextIdleWaitStaleTimeout);
  UINT64 required_value = value;
  if (inject_stale_timeout)
    required_value += 0x1'0000'0000ull;
  UINT64 completed = g_fence->GetCompletedValue();
  if (completed == UINT64_MAX) {
    PoisonIdleProof(nullptr, false, false);
    return false;
  }
  if (completed < required_value) {
    HANDLE event = CreateEventW(nullptr, FALSE, FALSE, nullptr);
    if (event == nullptr) {
      PoisonIdleProof(nullptr, false, false);
      return false;
    }
    if (FAILED(g_fence->SetEventOnCompletion(required_value, event))) {
      PoisonIdleProof(event, false, false);
      return false;
    }
    if (inject_stale_timeout)
      SetEvent(event);
    const ULONGLONG deadline = GetTickCount64() + 5000u;
    for (;;) {
      const ULONGLONG now = GetTickCount64();
      const DWORD remaining =
          now >= deadline ? 0u : static_cast<DWORD>(deadline - now);
      InterlockedIncrement64(&g_resource_idle_waits);
      const DWORD wait_result = WaitForSingleObject(event, remaining);
      completed = g_fence->GetCompletedValue();
      if (completed == UINT64_MAX) {
        PoisonIdleProof(event, true, false);
        return false;
      }
      if (wait_result == WAIT_OBJECT_0 && completed >= required_value)
        break;
      if (wait_result == WAIT_OBJECT_0) {
        InterlockedIncrement64(&g_stale_wake_rejections);
        continue;
      }
      PoisonIdleProof(event, true, wait_result == WAIT_TIMEOUT);
      return false;
    }
    CloseHandle(event);
  }
  InterlockedIncrement64(&g_resource_idle_completions);
  RecoverUntrackedSubmissions();
  return true;
}

HRESULT RecreateBackbuffers() noexcept {
  if (!ReleaseBackbuffers())
    return DXGI_ERROR_DEVICE_REMOVED;
  if (g_selected_chain1 == nullptr || g_device == nullptr ||
      g_rtv_heap == nullptr) {
    return DXGI_ERROR_INVALID_CALL;
  }
  DXGI_SWAP_CHAIN_DESC1 description{};
  HRESULT result = g_selected_chain1->GetDesc1(&description);
  if (FAILED(result) || description.BufferCount == 0 ||
      description.BufferCount > kMaximumBackBuffers) {
    return FAILED(result) ? result : E_INVALIDARG;
  }
  D3D12_CPU_DESCRIPTOR_HANDLE handle =
      g_rtv_heap->GetCPUDescriptorHandleForHeapStart();
  for (UINT index = 0; index < description.BufferCount; ++index) {
    result = g_selected_chain->GetBuffer(
        index, IID_PPV_ARGS(&g_backbuffers[static_cast<std::size_t>(index)]));
    if (FAILED(result)) {
      ReleaseBackbuffers();
      return result;
    }
    g_device->CreateRenderTargetView(
        g_backbuffers[static_cast<std::size_t>(index)], nullptr, handle);
    handle.ptr += g_rtv_stride;
  }
  g_backbuffer_count = description.BufferCount;
  InterlockedIncrement64(&g_resource_recreations);
  InterlockedExchange(&g_overlay_ready, 1);
  return S_OK;
}

bool ReleasePersistentResources() noexcept {
  if (!ReleaseBackbuffers())
    return false;
  SafeRelease(g_command_list);
  for (ID3D12CommandAllocator *&allocator : g_allocators)
    SafeRelease(allocator);
  SafeRelease(g_rtv_heap);
  SafeRelease(g_fence);
  InterlockedExchange(&g_preallocated_resources, 0);
  InterlockedExchange(&g_separate_command_list, 0);
  return true;
}

bool ReleaseRegistration() noexcept {
  if (!ReleasePersistentResources())
    return false;
  InterlockedExchange(&g_registered, 0);
  SafeRelease(g_selected_chain3);
  SafeRelease(g_selected_chain1);
  SafeRelease(g_selected_identity);
  SafeRelease(g_selected_chain);
  SafeRelease(g_command_queue);
  SafeRelease(g_device);
  return true;
}

HRESULT CreatePersistentResources() noexcept {
  DXGI_SWAP_CHAIN_DESC1 chain_description{};
  HRESULT result = g_selected_chain1->GetDesc1(&chain_description);
  if (FAILED(result) || chain_description.BufferCount == 0 ||
      chain_description.BufferCount > kMaximumBackBuffers) {
    return FAILED(result) ? result : E_INVALIDARG;
  }
  D3D12_DESCRIPTOR_HEAP_DESC heap_description{};
  heap_description.Type = D3D12_DESCRIPTOR_HEAP_TYPE_RTV;
  heap_description.NumDescriptors = kMaximumBackBuffers;
  result = g_device->CreateDescriptorHeap(&heap_description,
                                          IID_PPV_ARGS(&g_rtv_heap));
  g_rtv_stride = g_device->GetDescriptorHandleIncrementSize(
      D3D12_DESCRIPTOR_HEAP_TYPE_RTV);
  for (UINT index = 0; SUCCEEDED(result) && index < chain_description.BufferCount;
       ++index) {
    result = g_device->CreateCommandAllocator(
        D3D12_COMMAND_LIST_TYPE_DIRECT,
        IID_PPV_ARGS(&g_allocators[static_cast<std::size_t>(index)]));
  }
  if (SUCCEEDED(result)) {
    result = g_device->CreateCommandList(
        0, D3D12_COMMAND_LIST_TYPE_DIRECT, g_allocators[0], nullptr,
        IID_PPV_ARGS(&g_command_list));
  }
  if (SUCCEEDED(result))
    result = g_command_list->Close();
  if (SUCCEEDED(result))
    result = g_device->CreateFence(0, D3D12_FENCE_FLAG_NONE,
                                   IID_PPV_ARGS(&g_fence));
  if (SUCCEEDED(result))
    result = RecreateBackbuffers();
  if (SUCCEEDED(result)) {
    InterlockedExchange(&g_preallocated_resources, 1);
    InterlockedExchange(&g_separate_command_list, 1);
  }
  return result;
}

void ReleaseCreationRecords() noexcept {
  ExclusiveLock lock(&g_creation_lock);
  for (CreationRecord &record : g_creation_record_slots) {
    SafeRelease(record.chainIdentity);
    SafeRelease(record.commandQueue);
  }
}

void RecordCreation(IDXGISwapChain1 *chain, IUnknown *creation_device) noexcept {
  if (chain == nullptr || creation_device == nullptr)
    return;
  ID3D12CommandQueue *queue = nullptr;
  IUnknown *identity = nullptr;
  if (FAILED(creation_device->QueryInterface(IID_PPV_ARGS(&queue))) ||
      FAILED(chain->QueryInterface(IID_PPV_ARGS(&identity)))) {
    SafeRelease(identity);
    SafeRelease(queue);
    return;
  }
  ExclusiveLock lock(&g_creation_lock);
  for (CreationRecord &record : g_creation_record_slots) {
    if (record.chainIdentity == nullptr) {
      record.chainIdentity = identity;
      record.commandQueue = queue;
      InterlockedIncrement64(&g_creation_records);
      return;
    }
  }
  InterlockedIncrement64(&g_creation_record_overflows);
  SafeRelease(identity);
  SafeRelease(queue);
}

ID3D12CommandQueue *FindRecordedQueue(IDXGISwapChain *chain) noexcept {
  ID3D12CommandQueue *result = nullptr;
  AcquireSRWLockShared(&g_creation_lock);
  for (const CreationRecord &record : g_creation_record_slots) {
    if (record.chainIdentity != nullptr && ExactIdentity(record.chainIdentity, chain)) {
      result = record.commandQueue;
      result->AddRef();
      break;
    }
  }
  ReleaseSRWLockShared(&g_creation_lock);
  return result;
}

bool IsSelectedLocked(IUnknown *chain) noexcept {
  if (Read(&g_registered) == 0)
    return false;
  return chain == g_selected_identity ||
         chain == reinterpret_cast<IUnknown *>(g_selected_chain) ||
         chain == reinterpret_cast<IUnknown *>(g_selected_chain1) ||
         chain == reinterpret_cast<IUnknown *>(g_selected_chain3);
}

bool SubmitOverlay() noexcept {
  if (Read(&g_overlay_ready) == 0 || g_selected_chain3 == nullptr ||
      g_command_queue == nullptr || g_command_list == nullptr ||
      g_fence == nullptr || g_backbuffer_count == 0 ||
      Read(&g_untracked_submission) != 0 ||
      Read(&g_idle_wait_poisoned) != 0) {
    return false;
  }
  const UINT index = g_selected_chain3->GetCurrentBackBufferIndex();
  if (index >= g_backbuffer_count || index >= kMaximumBackBuffers)
    return false;
  const std::size_t slot = static_cast<std::size_t>(index);
  if (Read(&g_retired_submission_slots[slot]) != 0)
    return false;
  const UINT64 pending = g_pending_fences[slot];
  const UINT64 completed = g_fence->GetCompletedValue();
  if (completed == UINT64_MAX) {
    PoisonIdleProof(nullptr, false, false);
    return false;
  }
  if (pending != 0 && completed < pending) {
    InterlockedIncrement64(&g_skipped_gpu_busy);
    return false;
  }
  HRESULT result = g_allocators[slot]->Reset();
  if (SUCCEEDED(result))
    result = g_command_list->Reset(g_allocators[slot], nullptr);
  D3D12_RESOURCE_BARRIER to_render{};
  to_render.Type = D3D12_RESOURCE_BARRIER_TYPE_TRANSITION;
  to_render.Transition.pResource = g_backbuffers[slot];
  to_render.Transition.Subresource = D3D12_RESOURCE_BARRIER_ALL_SUBRESOURCES;
  to_render.Transition.StateBefore = D3D12_RESOURCE_STATE_PRESENT;
  to_render.Transition.StateAfter = D3D12_RESOURCE_STATE_RENDER_TARGET;
  D3D12_RESOURCE_BARRIER to_present = to_render;
  to_present.Transition.StateBefore = D3D12_RESOURCE_STATE_RENDER_TARGET;
  to_present.Transition.StateAfter = D3D12_RESOURCE_STATE_PRESENT;
  D3D12_CPU_DESCRIPTOR_HANDLE rtv =
      g_rtv_heap->GetCPUDescriptorHandleForHeapStart();
  rtv.ptr += static_cast<SIZE_T>(index) * g_rtv_stride;
  if (SUCCEEDED(result)) {
    static constexpr FLOAT kOverlayColor[4] = {0.055f, 0.18f, 0.42f, 1.0f};
    g_command_list->ResourceBarrier(1, &to_render);
    g_command_list->OMSetRenderTargets(1, &rtv, FALSE, nullptr);
    g_command_list->ClearRenderTargetView(rtv, kOverlayColor, 0, nullptr);
    g_command_list->ResourceBarrier(1, &to_present);
    result = g_command_list->Close();
  }
  if (FAILED(result))
    return false;
  ID3D12CommandList *lists[] = {g_command_list};
  g_command_queue->ExecuteCommandLists(1, lists);
  InterlockedIncrement64(&g_command_lists_executed);
  const UINT64 fence_value = g_next_fence++;
  if (ConsumeFault(kQaFaultNextSubmissionSignal)) {
    MarkUntrackedSubmission(slot);
    return false;
  }
  result = g_command_queue->Signal(g_fence, fence_value);
  if (FAILED(result)) {
    MarkUntrackedSubmission(slot);
    return false;
  }
  g_pending_fences[slot] = fence_value;
  InterlockedIncrement64(&g_command_queue_signals);
  InterlockedIncrement64(&g_overlay_submissions);
  return true;
}

template <typename Chain, typename Original, typename... Args>
HRESULT PresentCommon(const CallbackLifetimeGuard &callback, Chain *chain,
                      Original original, volatile LONG64 *counter,
                      Args... args) noexcept {
  InterlockedIncrement64(counter);
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
    if (Read(&g_registered) != 0)
      InterlockedIncrement64(&g_competing_refusals);
    else
      InterlockedIncrement64(&g_skipped_unregistered);
    ReleaseSRWLockShared(&g_resource_lifetime_lock);
    return original(chain, args...);
  }
  if (Read(&g_forced_present_gate) != 0 ||
      InterlockedCompareExchange(&g_submit_active, 1, 0) != 0) {
    InterlockedIncrement64(&g_skipped_contention);
    ReleaseSRWLockShared(&g_resource_lifetime_lock);
    return original(chain, args...);
  }
  while (Read(&g_pause_in_flight) != 0)
    SwitchToThread();
  g_inside_present_hot_path = true;
  SubmitOverlay();
  g_inside_present_hot_path = false;
  InterlockedExchange(&g_submit_active, 0);
  ReleaseSRWLockShared(&g_resource_lifetime_lock);
  return original(chain, args...);
}

HRESULT STDMETHODCALLTYPE HookPresent(IDXGISwapChain *chain, UINT interval,
                                      UINT flags) noexcept {
  CallbackLifetimeGuard callback;
  return PresentCommon(callback, chain, g_true_present, &g_present_calls,
                       interval, flags);
}

HRESULT STDMETHODCALLTYPE
HookPresent1(IDXGISwapChain1 *chain, UINT interval, UINT flags,
             const DXGI_PRESENT_PARAMETERS *parameters) noexcept {
  CallbackLifetimeGuard callback;
  return PresentCommon(callback, chain, g_true_present1, &g_present1_calls,
                       interval, flags, parameters);
}

HRESULT STDMETHODCALLTYPE HookSetFullscreenState(IDXGISwapChain *chain,
                                                 BOOL fullscreen,
                                                 IDXGIOutput *output) noexcept {
  CallbackLifetimeGuard callback;
  if (callback.detaching())
    return g_true_fullscreen(chain, fullscreen, output);
  AcquireSRWLockShared(&g_resource_lifetime_lock);
  const bool selected = IsSelectedLocked(chain);
  ReleaseSRWLockShared(&g_resource_lifetime_lock);
  const HRESULT result = g_true_fullscreen(chain, fullscreen, output);
  if (selected)
    InterlockedIncrement64(&g_fullscreen_calls);
  return result;
}

HRESULT STDMETHODCALLTYPE HookResizeBuffers(IDXGISwapChain *chain, UINT count,
                                            UINT width, UINT height,
                                            DXGI_FORMAT format,
                                            UINT flags) noexcept {
  CallbackLifetimeGuard callback;
  if (callback.detaching())
    return g_true_resize(chain, count, width, height, format, flags);
  ExclusiveLock resize_lock(&g_resize_call_lock);
  bool selected = false;
  bool resources_idle = true;
  {
    ExclusiveLock resource_lock(&g_resource_lifetime_lock);
    selected = IsSelectedLocked(chain);
    if (selected) {
      resources_idle = WaitForResourceIdle();
      if (resources_idle)
        ReleaseBackbuffers();
    }
  }
  if (!selected)
    return g_true_resize(chain, count, width, height, format, flags);
  InterlockedIncrement64(&g_resize_calls);
  if (!resources_idle) {
    InterlockedIncrement64(&g_resize_failures);
    return DXGI_ERROR_DEVICE_REMOVED;
  }
  const HRESULT result =
      g_true_resize(chain, count, width, height, format, flags);
  {
    ExclusiveLock resource_lock(&g_resource_lifetime_lock);
    InterlockedIncrement64(SUCCEEDED(result) ? &g_resize_successes
                                             : &g_resize_failures);
    if (IsSelectedLocked(chain) && FAILED(RecreateBackbuffers()))
      InterlockedExchange(&g_overlay_ready, 0);
  }
  return result;
}

HRESULT STDMETHODCALLTYPE HookCreateSwapChainForHwnd(
    IDXGIFactory2 *factory, IUnknown *device, HWND window,
    const DXGI_SWAP_CHAIN_DESC1 *description,
    const DXGI_SWAP_CHAIN_FULLSCREEN_DESC *fullscreen, IDXGIOutput *restrict_to,
    IDXGISwapChain1 **swap_chain) noexcept {
  CallbackLifetimeGuard callback;
  const HRESULT result = g_true_create_swap_chain(
      factory, device, window, description, fullscreen, restrict_to, swap_chain);
  if (!callback.detaching() && SUCCEEDED(result) && swap_chain != nullptr)
    RecordCreation(*swap_chain, device);
  return result;
}

bool InspectChainMethods(IDXGISwapChain *chain,
                         MethodAddressSnapshot *methods) noexcept {
  if (chain == nullptr || methods == nullptr)
    return false;
  *methods = {};
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
  }
  SafeRelease(chain1);
  return methods->present != 0 && methods->setFullscreenState != 0 &&
         methods->resizeBuffers != 0 && methods->present1 != 0;
}

bool SameChainMethods(const MethodAddressSnapshot &left,
                      const MethodAddressSnapshot &right) noexcept {
  return left.present == right.present &&
         left.setFullscreenState == right.setFullscreenState &&
         left.resizeBuffers == right.resizeBuffers &&
         left.present1 == right.present1;
}

HWND CreateProbeWindow() noexcept {
  return CreateWindowExW(0, L"STATIC", L"GameHub DXGI D3D12 QA probe",
                         WS_OVERLAPPED, 0, 0, 64, 64, nullptr, nullptr,
                         GetModuleHandleW(nullptr), nullptr);
}

HRESULT CreateWarpDeviceAndQueue(IDXGIFactory4 *factory,
                                 ID3D12Device **device,
                                 ID3D12CommandQueue **queue) noexcept {
  IDXGIAdapter *adapter = nullptr;
  HRESULT result = factory->EnumWarpAdapter(IID_PPV_ARGS(&adapter));
  if (SUCCEEDED(result)) {
    result = D3D12CreateDevice(adapter, D3D_FEATURE_LEVEL_11_0,
                               IID_PPV_ARGS(device));
  }
  D3D12_COMMAND_QUEUE_DESC description{};
  description.Type = D3D12_COMMAND_LIST_TYPE_DIRECT;
  if (SUCCEEDED(result))
    result = (*device)->CreateCommandQueue(&description, IID_PPV_ARGS(queue));
  SafeRelease(adapter);
  return result;
}

HRESULT DiscoverMethods(MethodAddressSnapshot *methods) noexcept {
  if (Read(&g_inside_dllmain) != 0) {
    InterlockedIncrement(&g_dllmain_graphics_calls);
    return E_UNEXPECTED;
  }
  HWND window = CreateProbeWindow();
  if (window == nullptr)
    return LastErrorOrFailure();
  IDXGIFactory4 *factory = nullptr;
  ID3D12Device *device = nullptr;
  ID3D12CommandQueue *queue = nullptr;
  IDXGISwapChain1 *chain1 = nullptr;
  IDXGISwapChain *chain = nullptr;
  HRESULT result = CreateDXGIFactory2(0, IID_PPV_ARGS(&factory));
  if (SUCCEEDED(result))
    result = CreateWarpDeviceAndQueue(factory, &device, &queue);
  DXGI_SWAP_CHAIN_DESC1 description{};
  description.Width = 64;
  description.Height = 64;
  description.Format = DXGI_FORMAT_B8G8R8A8_UNORM;
  description.SampleDesc.Count = 1;
  description.BufferUsage = DXGI_USAGE_RENDER_TARGET_OUTPUT;
  description.BufferCount = 2;
  description.SwapEffect = DXGI_SWAP_EFFECT_FLIP_DISCARD;
  description.Scaling = DXGI_SCALING_STRETCH;
  description.AlphaMode = DXGI_ALPHA_MODE_IGNORE;
  DXGI_SWAP_CHAIN_FULLSCREEN_DESC fullscreen{};
  fullscreen.Windowed = TRUE;
  if (SUCCEEDED(result)) {
    result = factory->CreateSwapChainForHwnd(queue, window, &description,
                                             &fullscreen, nullptr, &chain1);
  }
  if (SUCCEEDED(result))
    result = chain1->QueryInterface(IID_PPV_ARGS(&chain));
  if (SUCCEEDED(result) && InspectChainMethods(chain, methods)) {
    methods->createSwapChainForHwnd = reinterpret_cast<ULONG_PTR>(
        VtableMethod<CreateSwapChainForHwndFunction>(factory, 15));
    InterlockedExchange(&g_present1_present, methods->present1 != 0 ? 1 : 0);
    InterlockedExchange(&g_create_swap_chain_hook_present,
                        methods->createSwapChainForHwnd != 0 ? 1 : 0);
    if (methods->createSwapChainForHwnd == 0)
      result = E_NOINTERFACE;
  } else if (SUCCEEDED(result)) {
    result = E_NOINTERFACE;
  }
  SafeRelease(chain);
  SafeRelease(chain1);
  SafeRelease(queue);
  SafeRelease(device);
  SafeRelease(factory);
  DestroyWindow(window);
  return result;
}

LONG AttachMethods(const MethodAddressSnapshot &methods) noexcept {
  g_true_present = reinterpret_cast<PresentFunction>(methods.present);
  g_true_fullscreen = reinterpret_cast<SetFullscreenStateFunction>(
      methods.setFullscreenState);
  g_true_resize =
      reinterpret_cast<ResizeBuffersFunction>(methods.resizeBuffers);
  g_true_present1 = reinterpret_cast<Present1Function>(methods.present1);
  g_true_create_swap_chain = reinterpret_cast<CreateSwapChainForHwndFunction>(
      methods.createSwapChainForHwnd);
  if (g_true_present == nullptr || g_true_fullscreen == nullptr ||
      g_true_resize == nullptr || g_true_present1 == nullptr ||
      g_true_create_swap_chain == nullptr) {
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
#define GAMEHUB_ATTACH(pointer, hook)                                         \
  if (error == NO_ERROR) {                                                    \
    error = DetourAttach(reinterpret_cast<PVOID *>(&pointer),                 \
                         reinterpret_cast<PVOID>(hook));                      \
  }
  GAMEHUB_ATTACH(g_true_present, HookPresent);
  GAMEHUB_ATTACH(g_true_fullscreen, HookSetFullscreenState);
  GAMEHUB_ATTACH(g_true_resize, HookResizeBuffers);
  GAMEHUB_ATTACH(g_true_present1, HookPresent1);
  GAMEHUB_ATTACH(g_true_create_swap_chain, HookCreateSwapChainForHwnd);
#undef GAMEHUB_ATTACH
  if (error == NO_ERROR)
    error = DetourTransactionCommit();
  else
    DetourTransactionAbort();
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
#define GAMEHUB_DETACH(pointer, hook)                                         \
  if (error == NO_ERROR && pointer != nullptr) {                              \
    error = DetourDetach(reinterpret_cast<PVOID *>(&pointer),                 \
                         reinterpret_cast<PVOID>(hook));                      \
  }
  GAMEHUB_DETACH(g_true_present, HookPresent);
  GAMEHUB_DETACH(g_true_fullscreen, HookSetFullscreenState);
  GAMEHUB_DETACH(g_true_resize, HookResizeBuffers);
  GAMEHUB_DETACH(g_true_present1, HookPresent1);
  GAMEHUB_DETACH(g_true_create_swap_chain, HookCreateSwapChainForHwnd);
  GAMEHUB_DETACH(g_true_entry, HookApplicationEntry);
#undef GAMEHUB_DETACH
  if (error == NO_ERROR)
    error = DetourTransactionCommit();
  else
    DetourTransactionAbort();
  if (error == NO_ERROR)
    InterlockedExchange(&g_detach_threads, enlisted);
  return error;
}

} // namespace

extern "C" BOOL WINAPI GameHubDxgiD3d12QaGetSnapshot(
    BootstrapSnapshot *output, DWORD output_size) {
  if (output == nullptr || output_size != sizeof(*output))
    return FALSE;
  BootstrapSnapshot snapshot{};
  snapshot.structSize = sizeof(snapshot);
  snapshot.schemaVersion = kSchemaVersion;
#define GAMEHUB_READ_DWORD(field, global)                                     \
  snapshot.field = static_cast<DWORD>(Read(&global))
#define GAMEHUB_READ_COUNTER(field, global)                                   \
  snapshot.field = static_cast<unsigned long long>(Read64(&global))
  GAMEHUB_READ_DWORD(restoreAfterWithSucceeded, g_restore_after_with);
  GAMEHUB_READ_DWORD(dllMainGraphicsCalls, g_dllmain_graphics_calls);
  snapshot.entryAttachError = Read(&g_entry_attach_error);
  snapshot.methodAttachError = Read(&g_method_attach_error);
  GAMEHUB_READ_DWORD(entryHookAttached, g_entry_attached);
  GAMEHUB_READ_DWORD(methodDiscoveryBeforeApplicationEntry,
                     g_method_discovered_before_entry);
  GAMEHUB_READ_DWORD(methodHooksAttached, g_methods_attached);
  GAMEHUB_READ_DWORD(methodAttachThreadsEnlisted, g_method_attach_threads);
  GAMEHUB_READ_DWORD(present1Present, g_present1_present);
  GAMEHUB_READ_DWORD(createSwapChainHookPresent,
                     g_create_swap_chain_hook_present);
  GAMEHUB_READ_DWORD(registered, g_registered);
  GAMEHUB_READ_DWORD(identityMatched, g_identity_matched);
  GAMEHUB_READ_DWORD(deviceIdentityMatched, g_device_identity_matched);
  GAMEHUB_READ_DWORD(commandQueueIdentityMatched,
                     g_command_queue_identity_matched);
  GAMEHUB_READ_DWORD(creationRecordMatched, g_creation_record_matched);
  GAMEHUB_READ_DWORD(liveMethodBodiesMatched, g_live_method_bodies_matched);
  GAMEHUB_READ_DWORD(overlayReady, g_overlay_ready);
  GAMEHUB_READ_DWORD(preallocatedHotPathResources, g_preallocated_resources);
  GAMEHUB_READ_DWORD(separateCommandListSubmission, g_separate_command_list);
  GAMEHUB_READ_DWORD(armedFaultMode, g_armed_fault_mode);
  GAMEHUB_READ_DWORD(untrackedSubmission, g_untracked_submission);
  snapshot.retiredSubmissionSlots = CountRetiredSubmissionSlots();
  GAMEHUB_READ_DWORD(idleWaitPoisoned, g_idle_wait_poisoned);
  GAMEHUB_READ_DWORD(registeredResourcesRetired,
                     g_registered_resources_retired);
  GAMEHUB_READ_DWORD(detachAttempted, g_detach_attempted);
  snapshot.detachError = Read(&g_detach_error);
  GAMEHUB_READ_DWORD(detachQuiesced, g_detach_quiesced);
  GAMEHUB_READ_DWORD(detachWaitingExclusive, g_detach_waiting_exclusive);
  GAMEHUB_READ_DWORD(detachCommitComplete, g_detach_commit_complete);
  GAMEHUB_READ_DWORD(detachThreadsEnlisted, g_detach_threads);
  snapshot.inFlight = Read(&g_in_flight);
  snapshot.peakInFlight = Read(&g_peak_in_flight);
  snapshot.callbackAdmissionWaiters = Read(&g_callback_admission_waiters);
  GAMEHUB_READ_COUNTER(callbackAdmissionAttempts,
                       g_callback_admission_attempts);
  GAMEHUB_READ_COUNTER(presentCalls, g_present_calls);
  GAMEHUB_READ_COUNTER(present1Calls, g_present1_calls);
  GAMEHUB_READ_COUNTER(commandListsExecuted, g_command_lists_executed);
  GAMEHUB_READ_COUNTER(overlaySubmissions, g_overlay_submissions);
  GAMEHUB_READ_COUNTER(submissionSignalFailures,
                       g_submission_signal_failures);
  GAMEHUB_READ_COUNTER(submissionSlotRetirements,
                       g_submission_slot_retirements);
  GAMEHUB_READ_COUNTER(independentIdleRecoveries,
                       g_independent_idle_recoveries);
  GAMEHUB_READ_COUNTER(commandQueueSignals, g_command_queue_signals);
  GAMEHUB_READ_COUNTER(resourceIdleSignals, g_resource_idle_signals);
  GAMEHUB_READ_COUNTER(resourceIdleCompletions,
                       g_resource_idle_completions);
  GAMEHUB_READ_COUNTER(resourceIdleFailures, g_resource_idle_failures);
  GAMEHUB_READ_COUNTER(resourceIdleWaitsOutsidePresent, g_resource_idle_waits);
  GAMEHUB_READ_COUNTER(resourceIdleTimeouts, g_resource_idle_timeouts);
  GAMEHUB_READ_COUNTER(staleWakeRejections, g_stale_wake_rejections);
  GAMEHUB_READ_COUNTER(retiredWaitEvents, g_retired_wait_event_count);
  GAMEHUB_READ_COUNTER(presentBlockingWaitCalls,
                       g_present_blocking_wait_calls);
  GAMEHUB_READ_COUNTER(skippedContention, g_skipped_contention);
  GAMEHUB_READ_COUNTER(skippedGpuBusy, g_skipped_gpu_busy);
  GAMEHUB_READ_COUNTER(skippedUnregistered, g_skipped_unregistered);
  GAMEHUB_READ_COUNTER(competingChainRefusals, g_competing_refusals);
  GAMEHUB_READ_COUNTER(resizeBuffersCalls, g_resize_calls);
  GAMEHUB_READ_COUNTER(resizeBuffersSuccesses, g_resize_successes);
  GAMEHUB_READ_COUNTER(resizeBuffersFailures, g_resize_failures);
  GAMEHUB_READ_COUNTER(fullscreenCalls, g_fullscreen_calls);
  GAMEHUB_READ_COUNTER(creationRecords, g_creation_records);
  GAMEHUB_READ_COUNTER(creationRecordOverflows, g_creation_record_overflows);
  GAMEHUB_READ_COUNTER(resourceRecreations, g_resource_recreations);
  GAMEHUB_READ_COUNTER(postDetachPresentForwards,
                       g_post_detach_present_forwards);
#undef GAMEHUB_READ_COUNTER
#undef GAMEHUB_READ_DWORD
  if (TryAcquireSRWLockShared(&g_resource_lifetime_lock)) {
    snapshot.selectedSwapChain =
        reinterpret_cast<ULONG_PTR>(g_selected_chain);
    snapshot.selectedDevice = reinterpret_cast<ULONG_PTR>(g_device);
    snapshot.selectedCommandQueue =
        reinterpret_cast<ULONG_PTR>(g_command_queue);
    ReleaseSRWLockShared(&g_resource_lifetime_lock);
  }
  snapshot.cachedMethods = g_cached_methods;
  snapshot.attachedMethods = g_attached_methods;
  *output = snapshot;
  return TRUE;
}

extern "C" HRESULT WINAPI GameHubDxgiD3d12QaRegisterSwapChain(
    IDXGISwapChain *swap_chain, ID3D12Device *device,
    ID3D12CommandQueue *command_queue) {
  if (swap_chain == nullptr || device == nullptr || command_queue == nullptr ||
      Read(&g_methods_attached) == 0 || Read(&g_registered) != 0 ||
      Read(&g_detaching) != 0) {
    return E_INVALIDARG;
  }
  ID3D12Device *chain_device = nullptr;
  ID3D12Device *queue_device = nullptr;
  HRESULT result = swap_chain->GetDevice(IID_PPV_ARGS(&chain_device));
  const HRESULT queue_device_result =
      command_queue->GetDevice(IID_PPV_ARGS(&queue_device));
  ID3D12CommandQueue *recorded_queue = FindRecordedQueue(swap_chain);
  MethodAddressSnapshot live_methods{};
  const bool methods_match = InspectChainMethods(swap_chain, &live_methods) &&
                             SameChainMethods(live_methods, g_cached_methods);
  const bool device_identity = SUCCEEDED(result) &&
                               SUCCEEDED(queue_device_result) &&
                               ExactIdentity(chain_device, device) &&
                               ExactIdentity(queue_device, device);
  const D3D12_COMMAND_QUEUE_DESC queue_description = command_queue->GetDesc();
  const bool creation_match = recorded_queue != nullptr;
  const bool queue_identity =
      creation_match && ExactIdentity(recorded_queue, command_queue) &&
      queue_description.Type == D3D12_COMMAND_LIST_TYPE_DIRECT;
  InterlockedExchange(&g_device_identity_matched, device_identity ? 1 : 0);
  InterlockedExchange(&g_command_queue_identity_matched,
                      queue_identity ? 1 : 0);
  InterlockedExchange(&g_creation_record_matched, creation_match ? 1 : 0);
  InterlockedExchange(&g_live_method_bodies_matched, methods_match ? 1 : 0);
  SafeRelease(recorded_queue);
  SafeRelease(queue_device);
  SafeRelease(chain_device);
  if (!device_identity || !queue_identity || !methods_match)
    return E_NOINTERFACE;

  ExclusiveLock control_lock(&g_control_lock);
  ExclusiveLock resource_lock(&g_resource_lifetime_lock);
  if (Read(&g_methods_attached) == 0 || Read(&g_registered) != 0 ||
      Read(&g_detaching) != 0) {
    return E_INVALIDARG;
  }
  IUnknown *identity = nullptr;
  IDXGISwapChain1 *chain1 = nullptr;
  IDXGISwapChain3 *chain3 = nullptr;
  result = swap_chain->QueryInterface(IID_PPV_ARGS(&identity));
  if (SUCCEEDED(result))
    result = swap_chain->QueryInterface(IID_PPV_ARGS(&chain1));
  if (SUCCEEDED(result))
    result = swap_chain->QueryInterface(IID_PPV_ARGS(&chain3));
  if (FAILED(result)) {
    SafeRelease(chain3);
    SafeRelease(chain1);
    SafeRelease(identity);
    return result;
  }
  g_selected_chain = swap_chain;
  g_selected_chain->AddRef();
  g_selected_identity = identity;
  g_selected_chain1 = chain1;
  g_selected_chain3 = chain3;
  g_device = device;
  g_device->AddRef();
  g_command_queue = command_queue;
  g_command_queue->AddRef();
  result = CreatePersistentResources();
  if (FAILED(result)) {
    ReleaseRegistration();
    return result;
  }
  InterlockedExchange(&g_identity_matched, 1);
  InterlockedExchange(&g_registered, 1);
  return S_OK;
}

extern "C" void WINAPI GameHubDxgiD3d12QaSetPresentGate(BOOL held) {
  InterlockedExchange(&g_forced_present_gate, held ? 1 : 0);
}

extern "C" void WINAPI GameHubDxgiD3d12QaSetPauseInFlight(BOOL held) {
  InterlockedExchange(&g_pause_in_flight, held ? 1 : 0);
}

extern "C" BOOL WINAPI GameHubDxgiD3d12QaArmFault(DWORD fault_mode) {
  if ((fault_mode != kQaFaultNextSubmissionSignal &&
       fault_mode != kQaFaultNextIdleWaitStaleTimeout) ||
      Read(&g_registered) == 0 || Read(&g_detaching) != 0) {
    return FALSE;
  }
  return InterlockedCompareExchange(
             &g_armed_fault_mode, static_cast<LONG>(fault_mode),
             static_cast<LONG>(kQaFaultNone)) ==
         static_cast<LONG>(kQaFaultNone);
}

extern "C" DWORD WINAPI GameHubDxgiD3d12QaDetach() {
  if (InterlockedExchange(&g_detach_attempted, 1) != 0)
    return static_cast<DWORD>(Read(&g_detach_error));
  ExclusiveLock control_lock(&g_control_lock);
  InterlockedExchange(&g_callback_admission_closed, 1);
  InterlockedExchange(&g_detaching, 1);
  const ULONGLONG deadline = GetTickCount64() + 5000u;
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
  const LONG detour_error = DetachMethods();
  if (detour_error == NO_ERROR)
    InterlockedExchange(&g_detach_commit_complete, 1);
  bool resources_idle = true;
  {
    ExclusiveLock resource_lock(&g_resource_lifetime_lock);
    if (Read(&g_registered) != 0)
      resources_idle = WaitForResourceIdle();
    if (resources_idle)
      ReleaseRegistration();
  }
  ReleaseCreationRecords();
  const LONG error = detour_error != NO_ERROR
                         ? detour_error
                         : resources_idle ? NO_ERROR : ERROR_BUSY;
  InterlockedExchange(&g_detach_error, error);
  if (detour_error == NO_ERROR) {
    InterlockedExchange(&g_methods_attached, 0);
    InterlockedExchange(&g_entry_attached, 0);
  }
  ReleaseSRWLockExclusive(&g_callback_lifetime_lock);
  InterlockedExchange(&g_callback_admission_closed, 0);
  WakeByAddressAll(const_cast<LONG *>(&g_callback_admission_closed));
  return static_cast<DWORD>(error);
}

BOOL WINAPI DllMain(HINSTANCE instance, DWORD reason, LPVOID) {
  if (reason != DLL_PROCESS_ATTACH)
    return TRUE;
  InterlockedExchange(&g_inside_dllmain, 1);
  DisableThreadLibraryCalls(instance);
  InterlockedExchange(&g_restore_after_with, DetourRestoreAfterWith() ? 1 : 0);
  HMODULE executable = GetModuleHandleW(nullptr);
  g_true_entry = reinterpret_cast<ApplicationEntryFunction>(
      GetProcAddress(executable, "GameHubDxgiD3d12QaApplicationEntry"));
  LONG error =
      g_true_entry == nullptr ? ERROR_PROC_NOT_FOUND : DetourTransactionBegin();
  if (error == NO_ERROR)
    error = DetourUpdateThread(GetCurrentThread());
  if (error == NO_ERROR) {
    error = DetourAttach(reinterpret_cast<PVOID *>(&g_true_entry),
                         reinterpret_cast<PVOID>(HookApplicationEntry));
  }
  if (error == NO_ERROR)
    error = DetourTransactionCommit();
  else
    DetourTransactionAbort();
  InterlockedExchange(&g_entry_attach_error, error);
  InterlockedExchange(&g_entry_attached, error == NO_ERROR ? 1 : 0);
  InterlockedExchange(&g_inside_dllmain, 0);
  return TRUE;
}
