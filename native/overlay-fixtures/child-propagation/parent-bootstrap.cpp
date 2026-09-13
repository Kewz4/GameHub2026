#include "contract.hpp"

#include <detours.h>
#include <strsafe.h>

#include <array>
#include <cstring>

namespace {

using gamehub::overlay::child_propagation_qa::CapabilityState;
using gamehub::overlay::child_propagation_qa::ChildHandshake;
using gamehub::overlay::child_propagation_qa::HandshakeState;
using gamehub::overlay::child_propagation_qa::ParentBootstrapSnapshot;

struct FileIdentity {
  DWORD volumeSerial;
  DWORD indexHigh;
  DWORD indexLow;
};

struct HandshakeHandles {
  HANDLE mapping = nullptr;
  HANDLE ready = nullptr;
  HANDLE release = nullptr;
  ChildHandshake* view = nullptr;
};

GameHubCreateProcessWFunction g_true_w = &CreateProcessW;
GameHubCreateProcessAFunction g_true_a = &CreateProcessA;
HANDLE g_pinned_renderer = INVALID_HANDLE_VALUE;
HANDLE g_pinned_marker = INVALID_HANDLE_VALUE;
FileIdentity g_pinned_identity{};
FileIdentity g_pinned_marker_identity{};
std::array<wchar_t, 32'768> g_pinned_canonical{};
std::array<wchar_t, 32'768> g_pinned_marker_canonical{};
std::array<char, 32'768> g_marker_ansi{};
volatile LONG g_restore_succeeded = 0;
volatile LONG g_cache_initialized = 0;
volatile LONG g_cached_pointers_matched = 0;
volatile LONG g_attach_error = ERROR_INVALID_STATE;
volatile LONG g_attached = 0;
volatile LONG g_hook_calls_w = 0;
volatile LONG g_hook_calls_a = 0;
volatile LONG g_exact_attempts = 0;
volatile LONG g_instrumented_children = 0;
volatile LONG g_aborted_children = 0;
volatile LONG g_passthrough_children = 0;
volatile LONG g_capability_state =
    static_cast<LONG>(CapabilityState::kUnknown);
volatile LONG g_last_error = ERROR_SUCCESS;
volatile LONG g_last_original_flags = 0;
volatile LONG g_last_forwarded_flags = 0;
volatile LONG g_last_caller_suspended = 0;
volatile LONG g_last_handshake_ready = 0;
volatile LONG g_last_identity_valid = 0;
volatile LONG g_last_suspend_balance_valid = 0;
volatile LONG g_last_inherit_handles_forwarded = 0;
ULONG_PTR g_cached_w = 0;
ULONG_PTR g_target_w = 0;
ULONG_PTR g_cached_a = 0;
ULONG_PTR g_target_a = 0;
ULONG_PTR g_last_process_attributes = 0;
ULONG_PTR g_last_thread_attributes = 0;
ULONG_PTR g_last_environment = 0;
ULONG_PTR g_last_startup_info_forwarded = 0;
DWORD g_last_process_id = 0;
ULONGLONG g_last_creation_ticks = 0;

ULONGLONG FileTimeTicks(const FILETIME& value) {
  ULARGE_INTEGER ticks{};
  ticks.LowPart = value.dwLowDateTime;
  ticks.HighPart = value.dwHighDateTime;
  return ticks.QuadPart;
}

bool ReadIdentity(HANDLE file, FileIdentity* identity) {
  BY_HANDLE_FILE_INFORMATION information{};
  if (!GetFileInformationByHandle(file, &information)) return false;
  identity->volumeSerial = information.dwVolumeSerialNumber;
  identity->indexHigh = information.nFileIndexHigh;
  identity->indexLow = information.nFileIndexLow;
  return true;
}

bool SameIdentity(const FileIdentity& left, const FileIdentity& right) {
  return left.volumeSerial == right.volumeSerial &&
         left.indexHigh == right.indexHigh && left.indexLow == right.indexLow;
}

bool ExactOrdinalPath(const wchar_t* left, const wchar_t* right) {
  return CompareStringOrdinal(left, -1, right, -1, TRUE) == CSTR_EQUAL;
}

bool DirectoryFromModule(HINSTANCE instance, wchar_t* output,
                         size_t output_count) {
  const DWORD length = GetModuleFileNameW(instance, output,
                                          static_cast<DWORD>(output_count));
  if (length == 0 || length >= output_count) return false;
  for (size_t index = length; index > 0; --index) {
    if (output[index - 1] == L'\\' || output[index - 1] == L'/') {
      output[index - 1] = L'\0';
      return true;
    }
  }
  return false;
}

bool JoinPath(const wchar_t* directory, const wchar_t* name, wchar_t* output,
              size_t output_count) {
  return SUCCEEDED(StringCchPrintfW(output, output_count, L"%s\\%s",
                                    directory, name));
}

bool ExactAnsi(const wchar_t* wide, char* output, size_t output_count) {
  BOOL used_default = FALSE;
  const int required = WideCharToMultiByte(CP_ACP, WC_NO_BEST_FIT_CHARS, wide,
                                            -1, nullptr, 0, nullptr,
                                            &used_default);
  if (required <= 0 || used_default ||
      static_cast<size_t>(required) > output_count) {
    return false;
  }
  used_default = FALSE;
  const int written = WideCharToMultiByte(
      CP_ACP, WC_NO_BEST_FIT_CHARS, wide, -1, output, required, nullptr,
      &used_default);
  return written == required && !used_default;
}

bool InitializePinnedArtifacts(HINSTANCE instance) {
  std::array<wchar_t, 32'768> directory{};
  std::array<wchar_t, 32'768> renderer{};
  std::array<wchar_t, 32'768> marker{};
  if (!DirectoryFromModule(instance, directory.data(), directory.size()) ||
      !JoinPath(directory.data(),
                gamehub::overlay::child_propagation_qa::kRendererName,
                renderer.data(), renderer.size()) ||
      !JoinPath(directory.data(),
                gamehub::overlay::child_propagation_qa::kChildMarkerName,
                marker.data(), marker.size())) {
    return false;
  }

  // Denying FILE_SHARE_WRITE and FILE_SHARE_DELETE pins the allowlisted file
  // identity across the later CreateProcess call in this bounded QA process.
  g_pinned_renderer = CreateFileW(
      renderer.data(), GENERIC_READ | FILE_EXECUTE, FILE_SHARE_READ, nullptr,
      OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, nullptr);
  if (g_pinned_renderer == INVALID_HANDLE_VALUE ||
      !ReadIdentity(g_pinned_renderer, &g_pinned_identity)) {
    return false;
  }
  const DWORD canonical_length = GetFinalPathNameByHandleW(
      g_pinned_renderer, g_pinned_canonical.data(),
      static_cast<DWORD>(g_pinned_canonical.size()),
      FILE_NAME_NORMALIZED | VOLUME_NAME_DOS);
  g_pinned_marker = CreateFileW(
      marker.data(), GENERIC_READ | FILE_EXECUTE, FILE_SHARE_READ, nullptr,
      OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, nullptr);
  const DWORD marker_canonical_length =
      g_pinned_marker == INVALID_HANDLE_VALUE
          ? 0
          : GetFinalPathNameByHandleW(
                g_pinned_marker, g_pinned_marker_canonical.data(),
                static_cast<DWORD>(g_pinned_marker_canonical.size()),
                FILE_NAME_NORMALIZED | VOLUME_NAME_DOS);
  if (canonical_length == 0 || canonical_length >= g_pinned_canonical.size() ||
      !ReadIdentity(g_pinned_marker, &g_pinned_marker_identity) ||
      marker_canonical_length == 0 ||
      marker_canonical_length >= g_pinned_marker_canonical.size() ||
      !ExactAnsi(g_pinned_marker_canonical.data(), g_marker_ansi.data(),
                 g_marker_ansi.size())) {
    return false;
  }
  return true;
}

bool ResolveCandidate(const wchar_t* application_name,
                      FileIdentity* identity,
                      std::array<wchar_t, 32'768>* canonical) {
  if (application_name == nullptr || application_name[0] == L'\0') return false;
  HANDLE file = CreateFileW(application_name, GENERIC_READ, FILE_SHARE_READ,
                            nullptr, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL,
                            nullptr);
  if (file == INVALID_HANDLE_VALUE) return false;
  const bool read_identity = ReadIdentity(file, identity);
  const DWORD length =
      read_identity
          ? GetFinalPathNameByHandleW(file, canonical->data(),
                                     static_cast<DWORD>(canonical->size()),
                                     FILE_NAME_NORMALIZED | VOLUME_NAME_DOS)
          : 0;
  CloseHandle(file);
  return read_identity && length != 0 && length < canonical->size();
}

bool IsExactAllowedW(const wchar_t* application_name) {
  FileIdentity identity{};
  std::array<wchar_t, 32'768> canonical{};
  return ResolveCandidate(application_name, &identity, &canonical) &&
         SameIdentity(identity, g_pinned_identity) &&
         ExactOrdinalPath(canonical.data(), g_pinned_canonical.data());
}

bool ExactWideFromAnsi(const char* ansi,
                       std::array<wchar_t, 32'768>* wide) {
  if (ansi == nullptr || ansi[0] == '\0') return false;
  const int required = MultiByteToWideChar(CP_ACP, 0, ansi, -1, nullptr, 0);
  if (required <= 0 || static_cast<size_t>(required) > wide->size()) return false;
  if (MultiByteToWideChar(CP_ACP, 0, ansi, -1, wide->data(), required) !=
      required) {
    return false;
  }
  std::array<char, 32'768> round_trip{};
  BOOL used_default = FALSE;
  const int written = WideCharToMultiByte(
      CP_ACP, WC_NO_BEST_FIT_CHARS, wide->data(), -1, round_trip.data(),
      static_cast<int>(round_trip.size()), nullptr, &used_default);
  return written > 0 && !used_default && strcmp(ansi, round_trip.data()) == 0;
}

bool IsExactAllowedA(const char* application_name) {
  std::array<wchar_t, 32'768> wide{};
  return ExactWideFromAnsi(application_name, &wide) &&
         IsExactAllowedW(wide.data());
}

void MarkUnavailable(DWORD error) {
  InterlockedExchange(&g_capability_state,
                      static_cast<LONG>(CapabilityState::kUnavailable));
  InterlockedExchange(&g_last_error, static_cast<LONG>(error));
}

void RecordCallInputs(LPSECURITY_ATTRIBUTES process_attributes,
                      LPSECURITY_ATTRIBUTES thread_attributes,
                      BOOL inherit_handles, DWORD original_flags,
                      LPVOID environment, const void* startup_info) {
  g_last_process_attributes =
      reinterpret_cast<ULONG_PTR>(process_attributes);
  g_last_thread_attributes = reinterpret_cast<ULONG_PTR>(thread_attributes);
  g_last_environment = reinterpret_cast<ULONG_PTR>(environment);
  g_last_startup_info_forwarded = reinterpret_cast<ULONG_PTR>(startup_info);
  InterlockedExchange(&g_last_inherit_handles_forwarded,
                      inherit_handles ? 1 : 0);
  InterlockedExchange(&g_last_original_flags,
                      static_cast<LONG>(original_flags));
  InterlockedExchange(&g_last_forwarded_flags,
                      static_cast<LONG>(original_flags | CREATE_SUSPENDED));
  InterlockedExchange(&g_last_caller_suspended,
                      (original_flags & CREATE_SUSPENDED) != 0 ? 1 : 0);
  InterlockedExchange(&g_last_handshake_ready, 0);
  InterlockedExchange(&g_last_identity_valid, 0);
  InterlockedExchange(&g_last_suspend_balance_valid, 0);
}

bool QueryCreatedIdentity(const PROCESS_INFORMATION& process,
                          ULONGLONG* creation_ticks) {
  if (process.hProcess == nullptr || process.hThread == nullptr ||
      process.dwProcessId == 0 ||
      process.dwProcessId != GetProcessId(process.hProcess)) {
    return false;
  }
  FILETIME creation{};
  FILETIME exit{};
  FILETIME kernel{};
  FILETIME user{};
  if (!GetProcessTimes(process.hProcess, &creation, &exit, &kernel, &user)) {
    return false;
  }

  std::array<wchar_t, 32'768> image{};
  DWORD image_length = static_cast<DWORD>(image.size());
  if (!QueryFullProcessImageNameW(process.hProcess, 0, image.data(),
                                  &image_length)) {
    return false;
  }
  FileIdentity identity{};
  std::array<wchar_t, 32'768> canonical{};
  if (!ResolveCandidate(image.data(), &identity, &canonical) ||
      !SameIdentity(identity, g_pinned_identity) ||
      !ExactOrdinalPath(canonical.data(), g_pinned_canonical.data())) {
    return false;
  }
  *creation_ticks = FileTimeTicks(creation);
  return *creation_ticks != 0;
}

bool FormatObjectNames(DWORD process_id, ULONGLONG creation_ticks,
                       wchar_t* mapping, size_t mapping_count,
                       wchar_t* ready, size_t ready_count, wchar_t* release,
                       size_t release_count) {
  return SUCCEEDED(StringCchPrintfW(
             mapping, mapping_count, L"Local\\GameHubChildQa_%lu_%I64u_Map",
             process_id, creation_ticks)) &&
         SUCCEEDED(StringCchPrintfW(
             ready, ready_count, L"Local\\GameHubChildQa_%lu_%I64u_Ready",
             process_id, creation_ticks)) &&
         SUCCEEDED(StringCchPrintfW(
             release, release_count,
             L"Local\\GameHubChildQa_%lu_%I64u_Release", process_id,
             creation_ticks));
}

void CloseHandshake(HandshakeHandles* handles) {
  if (handles->view != nullptr) UnmapViewOfFile(handles->view);
  if (handles->release != nullptr) CloseHandle(handles->release);
  if (handles->ready != nullptr) CloseHandle(handles->ready);
  if (handles->mapping != nullptr) CloseHandle(handles->mapping);
  *handles = {};
}

bool CreateHandshake(DWORD process_id, ULONGLONG creation_ticks,
                     HandshakeHandles* handles) {
  FILETIME parent_creation{};
  FILETIME parent_exit{};
  FILETIME parent_kernel{};
  FILETIME parent_user{};
  if (!GetProcessTimes(GetCurrentProcess(), &parent_creation, &parent_exit,
                       &parent_kernel, &parent_user)) {
    return false;
  }
  std::array<wchar_t, 160> mapping_name{};
  std::array<wchar_t, 160> ready_name{};
  std::array<wchar_t, 160> release_name{};
  if (!FormatObjectNames(process_id, creation_ticks, mapping_name.data(),
                         mapping_name.size(), ready_name.data(),
                         ready_name.size(), release_name.data(),
                         release_name.size())) {
    return false;
  }
  handles->mapping = CreateFileMappingW(
      INVALID_HANDLE_VALUE, nullptr, PAGE_READWRITE, 0,
      static_cast<DWORD>(sizeof(ChildHandshake)), mapping_name.data());
  if (handles->mapping == nullptr || GetLastError() == ERROR_ALREADY_EXISTS) {
    CloseHandshake(handles);
    return false;
  }
  handles->ready = CreateEventW(nullptr, TRUE, FALSE, ready_name.data());
  if (handles->ready == nullptr || GetLastError() == ERROR_ALREADY_EXISTS) {
    CloseHandshake(handles);
    return false;
  }
  handles->release = CreateEventW(nullptr, TRUE, FALSE, release_name.data());
  if (handles->release == nullptr || GetLastError() == ERROR_ALREADY_EXISTS) {
    CloseHandshake(handles);
    return false;
  }
  handles->view = static_cast<ChildHandshake*>(MapViewOfFile(
      handles->mapping, FILE_MAP_ALL_ACCESS, 0, 0, sizeof(ChildHandshake)));
  if (handles->view == nullptr) {
    CloseHandshake(handles);
    return false;
  }
  ZeroMemory(handles->view, sizeof(ChildHandshake));
  handles->view->structSize = sizeof(ChildHandshake);
  handles->view->schemaVersion =
      gamehub::overlay::child_propagation_qa::kSchemaVersion;
  handles->view->magic =
      gamehub::overlay::child_propagation_qa::kHandshakeMagic;
  handles->view->expectedProcessId = process_id;
  handles->view->expectedParentProcessId = GetCurrentProcessId();
  handles->view->expectedCreationTicks = creation_ticks;
  handles->view->expectedParentCreationTicks = FileTimeTicks(parent_creation);
  if (handles->view->expectedParentCreationTicks == 0) {
    CloseHandshake(handles);
    return false;
  }
  return true;
}

void CloseAndClearProcessInformation(PROCESS_INFORMATION* process) {
  if (process == nullptr) return;
  if (process->hThread != nullptr) CloseHandle(process->hThread);
  if (process->hProcess != nullptr) CloseHandle(process->hProcess);
  ZeroMemory(process, sizeof(*process));
}

BOOL AbortNeverStarted(PROCESS_INFORMATION* process, HandshakeHandles* handshake,
                       DWORD error) {
  DWORD cleanup_error = error;
  if (process != nullptr && process->hProcess != nullptr) {
    const BOOL termination_requested = TerminateProcess(process->hProcess, error);
    const DWORD wait = WaitForSingleObject(process->hProcess, 5'000);
    if (wait == WAIT_OBJECT_0) {
      InterlockedIncrement(&g_aborted_children);
    } else {
      cleanup_error = termination_requested ? WAIT_TIMEOUT : GetLastError();
      if (cleanup_error == ERROR_SUCCESS) cleanup_error = ERROR_GEN_FAILURE;
    }
  }
  CloseHandshake(handshake);
  CloseAndClearProcessInformation(process);
  MarkUnavailable(cleanup_error);
  SetLastError(cleanup_error);
  return FALSE;
}

BOOL CompleteExactChild(PROCESS_INFORMATION* process,
                        bool caller_requested_suspended) {
  HandshakeHandles handshake{};
  ULONGLONG creation_ticks = 0;
  if (!QueryCreatedIdentity(*process, &creation_ticks)) {
    return AbortNeverStarted(process, &handshake, ERROR_INVALID_DATA);
  }
  InterlockedExchange(&g_last_identity_valid, 1);
  g_last_process_id = process->dwProcessId;
  g_last_creation_ticks = creation_ticks;

  if (!CreateHandshake(process->dwProcessId, creation_ticks, &handshake)) {
    return AbortNeverStarted(process, &handshake, ERROR_INVALID_DATA);
  }
  FileIdentity marker_identity{};
  std::array<wchar_t, 32'768> marker_canonical{};
  if (!ResolveCandidate(g_pinned_marker_canonical.data(), &marker_identity,
                        &marker_canonical) ||
      !SameIdentity(marker_identity, g_pinned_marker_identity) ||
      !ExactOrdinalPath(marker_canonical.data(),
                        g_pinned_marker_canonical.data())) {
    return AbortNeverStarted(process, &handshake, ERROR_INVALID_DATA);
  }
  LPCSTR marker_paths[] = {g_marker_ansi.data()};
  if (!DetourUpdateProcessWithDll(process->hProcess, marker_paths, 1)) {
    const DWORD error = GetLastError();
    return AbortNeverStarted(process, &handshake,
                             error == ERROR_SUCCESS ? ERROR_DLL_INIT_FAILED
                                                    : error);
  }

  const DWORD resume_count = ResumeThread(process->hThread);
  if (resume_count != 1) {
    return AbortNeverStarted(process, &handshake, ERROR_INVALID_STATE);
  }
  HANDLE handshake_waits[] = {handshake.ready, process->hProcess};
  const DWORD wait = WaitForMultipleObjects(
      ARRAYSIZE(handshake_waits), handshake_waits, FALSE,
      gamehub::overlay::child_propagation_qa::kHandshakeTimeoutMs);
  const LONG handshake_state =
      handshake.view == nullptr
          ? static_cast<LONG>(HandshakeState::kMarkerFailed)
          : InterlockedCompareExchange(&handshake.view->state, 0, 0);
  const bool identity_matches =
      wait == WAIT_OBJECT_0 && handshake.view != nullptr &&
      handshake.view->structSize == sizeof(ChildHandshake) &&
      handshake.view->schemaVersion ==
          gamehub::overlay::child_propagation_qa::kSchemaVersion &&
      handshake.view->magic ==
          gamehub::overlay::child_propagation_qa::kHandshakeMagic &&
      handshake_state == static_cast<LONG>(HandshakeState::kMarkerReady) &&
      handshake.view->markerProcessId == process->dwProcessId &&
      handshake.view->markerCreationTicks == creation_ticks &&
      handshake.view->restoreAfterWithSucceeded == 1 &&
      handshake.view->markerLoadedBeforeEntry == 1;
  if (!identity_matches) {
    return AbortNeverStarted(process, &handshake,
                             wait == WAIT_TIMEOUT ? WAIT_TIMEOUT
                                                  : ERROR_INVALID_DATA);
  }
  InterlockedExchange(&g_last_handshake_ready, 1);

  wchar_t crash_mode[8]{};
  if (GetEnvironmentVariableW(L"GAMEHUB_CHILD_QA_PARENT_CRASH_AFTER_READY",
                              crash_mode, ARRAYSIZE(crash_mode)) == 1 &&
      crash_mode[0] == L'1') {
    CloseHandle(g_pinned_renderer);
    g_pinned_renderer = INVALID_HANDLE_VALUE;
    CloseHandle(g_pinned_marker);
    g_pinned_marker = INVALID_HANDLE_VALUE;
    TerminateProcess(GetCurrentProcess(), 77);
    return FALSE;
  }

  if (caller_requested_suspended) {
    const DWORD previous_count = SuspendThread(process->hThread);
    if (previous_count != 0) {
      return AbortNeverStarted(process, &handshake, ERROR_INVALID_STATE);
    }
  }
  InterlockedExchange(&g_last_suspend_balance_valid, 1);
  if (!SetEvent(handshake.release)) {
    const DWORD error = GetLastError();
    return AbortNeverStarted(process, &handshake, error);
  }
  CloseHandshake(&handshake);
  InterlockedIncrement(&g_instrumented_children);
  InterlockedCompareExchange(&g_capability_state,
                             static_cast<LONG>(CapabilityState::kReady),
                             static_cast<LONG>(CapabilityState::kUnknown));
  InterlockedExchange(&g_last_error, ERROR_SUCCESS);
  SetLastError(ERROR_SUCCESS);
  return TRUE;
}

BOOL WINAPI HookedCreateProcessW(
    LPCWSTR application_name, LPWSTR command_line,
    LPSECURITY_ATTRIBUTES process_attributes,
    LPSECURITY_ATTRIBUTES thread_attributes, BOOL inherit_handles,
    DWORD creation_flags, LPVOID environment, LPCWSTR current_directory,
    LPSTARTUPINFOW startup_info, LPPROCESS_INFORMATION process_information) {
  InterlockedIncrement(&g_hook_calls_w);
  if (!IsExactAllowedW(application_name)) {
    InterlockedIncrement(&g_passthrough_children);
    MarkUnavailable(ERROR_NOT_SUPPORTED);
    return g_true_w(application_name, command_line, process_attributes,
                    thread_attributes, inherit_handles, creation_flags,
                    environment, current_directory, startup_info,
                    process_information);
  }
  InterlockedIncrement(&g_exact_attempts);
  RecordCallInputs(process_attributes, thread_attributes, inherit_handles,
                   creation_flags, environment, startup_info);
  const BOOL created = g_true_w(
      application_name, command_line, process_attributes, thread_attributes,
      inherit_handles, creation_flags | CREATE_SUSPENDED, environment,
      current_directory, startup_info, process_information);
  if (!created) {
    MarkUnavailable(GetLastError());
    return FALSE;
  }
  return CompleteExactChild(process_information,
                            (creation_flags & CREATE_SUSPENDED) != 0);
}

BOOL WINAPI HookedCreateProcessA(
    LPCSTR application_name, LPSTR command_line,
    LPSECURITY_ATTRIBUTES process_attributes,
    LPSECURITY_ATTRIBUTES thread_attributes, BOOL inherit_handles,
    DWORD creation_flags, LPVOID environment, LPCSTR current_directory,
    LPSTARTUPINFOA startup_info, LPPROCESS_INFORMATION process_information) {
  InterlockedIncrement(&g_hook_calls_a);
  if (!IsExactAllowedA(application_name)) {
    InterlockedIncrement(&g_passthrough_children);
    MarkUnavailable(ERROR_NOT_SUPPORTED);
    return g_true_a(application_name, command_line, process_attributes,
                    thread_attributes, inherit_handles, creation_flags,
                    environment, current_directory, startup_info,
                    process_information);
  }
  InterlockedIncrement(&g_exact_attempts);
  RecordCallInputs(process_attributes, thread_attributes, inherit_handles,
                   creation_flags, environment, startup_info);
  const BOOL created = g_true_a(
      application_name, command_line, process_attributes, thread_attributes,
      inherit_handles, creation_flags | CREATE_SUSPENDED, environment,
      current_directory, startup_info, process_information);
  if (!created) {
    MarkUnavailable(GetLastError());
    return FALSE;
  }
  return CompleteExactChild(process_information,
                            (creation_flags & CREATE_SUSPENDED) != 0);
}

LONG AbortTransaction(LONG error) {
  DetourTransactionAbort();
  return error;
}

LONG AttachHooks() {
  const DWORD initialized = GameHubChildQaCacheInitialized();
  g_cached_w = GameHubChildQaCachedCreateProcessW();
  g_cached_a = GameHubChildQaCachedCreateProcessA();
  g_target_w = reinterpret_cast<ULONG_PTR>(&CreateProcessW);
  g_target_a = reinterpret_cast<ULONG_PTR>(&CreateProcessA);
  InterlockedExchange(&g_cache_initialized, initialized == 1 ? 1 : 0);
  const bool pointers_match = initialized == 1 && g_cached_w != 0 &&
                              g_cached_a != 0 && g_cached_w == g_target_w &&
                              g_cached_a == g_target_a;
  InterlockedExchange(&g_cached_pointers_matched, pointers_match ? 1 : 0);
  if (!pointers_match) return ERROR_INVALID_STATE;

  g_true_w = &CreateProcessW;
  g_true_a = &CreateProcessA;
  LONG error = DetourTransactionBegin();
  if (error != NO_ERROR) return error;
  error = DetourUpdateThread(GetCurrentThread());
  if (error != NO_ERROR) return AbortTransaction(error);
  error = DetourAttach(reinterpret_cast<PVOID*>(&g_true_w),
                       reinterpret_cast<PVOID>(&HookedCreateProcessW));
  if (error != NO_ERROR) return AbortTransaction(error);
  error = DetourAttach(reinterpret_cast<PVOID*>(&g_true_a),
                       reinterpret_cast<PVOID>(&HookedCreateProcessA));
  if (error != NO_ERROR) return AbortTransaction(error);
  error = DetourTransactionCommit();
  if (error == NO_ERROR) InterlockedExchange(&g_attached, 1);
  return error;
}

}  // namespace

extern "C" BOOL WINAPI GameHubChildQaGetParentSnapshot(
    ParentBootstrapSnapshot* output, DWORD output_size) {
  if (output == nullptr || output_size != sizeof(ParentBootstrapSnapshot)) {
    SetLastError(ERROR_INSUFFICIENT_BUFFER);
    return FALSE;
  }
  output->structSize = sizeof(ParentBootstrapSnapshot);
  output->schemaVersion =
      gamehub::overlay::child_propagation_qa::kSchemaVersion;
  output->restoreAfterWithSucceeded = static_cast<DWORD>(
      InterlockedCompareExchange(&g_restore_succeeded, 0, 0));
  output->cacheInitializedBeforeAttach = static_cast<DWORD>(
      InterlockedCompareExchange(&g_cache_initialized, 0, 0));
  output->cachedPointersMatchedBeforeAttach = static_cast<DWORD>(
      InterlockedCompareExchange(&g_cached_pointers_matched, 0, 0));
  output->attachError = InterlockedCompareExchange(&g_attach_error, 0, 0);
  output->attached =
      static_cast<DWORD>(InterlockedCompareExchange(&g_attached, 0, 0));
  output->hookCallsW =
      static_cast<DWORD>(InterlockedCompareExchange(&g_hook_calls_w, 0, 0));
  output->hookCallsA =
      static_cast<DWORD>(InterlockedCompareExchange(&g_hook_calls_a, 0, 0));
  output->exactAttempts = static_cast<DWORD>(
      InterlockedCompareExchange(&g_exact_attempts, 0, 0));
  output->instrumentedChildren = static_cast<DWORD>(
      InterlockedCompareExchange(&g_instrumented_children, 0, 0));
  output->abortedNeverStartedChildren = static_cast<DWORD>(
      InterlockedCompareExchange(&g_aborted_children, 0, 0));
  output->passthroughChildren = static_cast<DWORD>(
      InterlockedCompareExchange(&g_passthrough_children, 0, 0));
  output->capabilityState = static_cast<DWORD>(
      InterlockedCompareExchange(&g_capability_state, 0, 0));
  output->lastError =
      static_cast<DWORD>(InterlockedCompareExchange(&g_last_error, 0, 0));
  output->lastOriginalFlags = static_cast<DWORD>(
      InterlockedCompareExchange(&g_last_original_flags, 0, 0));
  output->lastForwardedFlags = static_cast<DWORD>(
      InterlockedCompareExchange(&g_last_forwarded_flags, 0, 0));
  output->lastCallerRequestedSuspended = static_cast<DWORD>(
      InterlockedCompareExchange(&g_last_caller_suspended, 0, 0));
  output->lastHandshakeReady = static_cast<DWORD>(
      InterlockedCompareExchange(&g_last_handshake_ready, 0, 0));
  output->lastIdentityValid = static_cast<DWORD>(
      InterlockedCompareExchange(&g_last_identity_valid, 0, 0));
  output->lastSuspendBalanceValid = static_cast<DWORD>(
      InterlockedCompareExchange(&g_last_suspend_balance_valid, 0, 0));
  output->lastInheritHandlesForwarded = static_cast<DWORD>(
      InterlockedCompareExchange(&g_last_inherit_handles_forwarded, 0, 0));
  output->cachedCreateProcessW = g_cached_w;
  output->targetCreateProcessW = g_target_w;
  output->cachedCreateProcessA = g_cached_a;
  output->targetCreateProcessA = g_target_a;
  output->lastProcessAttributes = g_last_process_attributes;
  output->lastThreadAttributes = g_last_thread_attributes;
  output->lastEnvironment = g_last_environment;
  output->lastStartupInfoForwarded = g_last_startup_info_forwarded;
  output->lastProcessId = g_last_process_id;
  output->lastCreationTicks = g_last_creation_ticks;
  return TRUE;
}

BOOL WINAPI DllMain(HINSTANCE instance, DWORD reason, LPVOID reserved) {
  if (DetourIsHelperProcess()) return TRUE;
  if (reason == DLL_PROCESS_ATTACH) {
    const BOOL restored = DetourRestoreAfterWith();
    InterlockedExchange(&g_restore_succeeded, restored ? 1 : 0);
    DisableThreadLibraryCalls(instance);
    const LONG error =
        restored && InitializePinnedArtifacts(instance)
            ? AttachHooks()
            : static_cast<LONG>(ERROR_INVALID_STATE);
    InterlockedExchange(&g_attach_error, error);
  } else if (reason == DLL_PROCESS_DETACH && reserved == nullptr) {
    if (g_pinned_renderer != INVALID_HANDLE_VALUE) {
      CloseHandle(g_pinned_renderer);
      g_pinned_renderer = INVALID_HANDLE_VALUE;
    }
    if (g_pinned_marker != INVALID_HANDLE_VALUE) {
      CloseHandle(g_pinned_marker);
      g_pinned_marker = INVALID_HANDLE_VALUE;
    }
  }
  return TRUE;
}
