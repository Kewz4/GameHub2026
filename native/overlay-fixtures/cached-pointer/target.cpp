#include "contract.hpp"

// Deliberately keep a non-trivial, non-inlined body. The cached dependency
// stores this entry address, and Detours patches this entry rather than an IAT
// slot. Volatile intermediates also keep the synthetic target large enough for
// a deterministic x64 trampoline in optimized QA builds.
extern "C" __declspec(noinline) DWORD WINAPI
GameHubCachedPointerTarget(DWORD input) {
  volatile DWORD mixed = static_cast<DWORD>(
      input ^ gamehub::overlay::cached_pointer_qa::kOriginalXorMask);
  const DWORD rotated = static_cast<DWORD>((mixed << 7u) | (mixed >> 25u));
  volatile DWORD result = static_cast<DWORD>(
      rotated + gamehub::overlay::cached_pointer_qa::kOriginalBias);
  return result;
}
