#include "contract.hpp"

namespace {

volatile LONG g_get_state_calls = 0;
volatile LONG g_get_state_ex_calls = 0;
volatile LONG g_get_keystroke_calls = 0;
volatile LONG g_enable_calls = 0;
volatile LONG g_set_state_calls = 0;
volatile LONG g_enabled = 1;
volatile LONG g_physical_connected = 1;
volatile LONG g_physical_neutral = 0;
volatile LONG g_physical_packet =
    static_cast<LONG>(gamehub::overlay::xinput_qa::kPhysicalStatePacket);
volatile LONG g_queued_keystrokes =
    static_cast<LONG>(gamehub::overlay::xinput_qa::kInitialPendingBuffers);
volatile LONG g_last_left_motor_speed = 0;
volatile LONG g_last_right_motor_speed = 0;
volatile LONG g_current_left_motor_speed = 0;
volatile LONG g_current_right_motor_speed = 0;

void ClearState(gamehub::overlay::xinput_qa::State* state) {
  ZeroMemory(state, sizeof(*state));
}

void FillPhysicalGamepad(gamehub::overlay::xinput_qa::Gamepad* gamepad) {
  using namespace gamehub::overlay::xinput_qa;
  if (InterlockedCompareExchange(&g_physical_neutral, 0, 0) != 0) {
    ZeroMemory(gamepad, sizeof(*gamepad));
    return;
  }
  gamepad->buttons = kPhysicalButtons;
  gamepad->leftTrigger = kPhysicalLeftTrigger;
  gamepad->rightTrigger = kPhysicalRightTrigger;
  gamepad->thumbLX = kPhysicalThumbLX;
  gamepad->thumbLY = kPhysicalThumbLY;
  gamepad->thumbRX = kPhysicalThumbRX;
  gamepad->thumbRY = kPhysicalThumbRY;
}

bool PopQueuedKeystroke() {
  LONG queued = InterlockedCompareExchange(&g_queued_keystrokes, 0, 0);
  while (queued > 0) {
    const LONG observed =
        InterlockedCompareExchange(&g_queued_keystrokes, queued - 1, queued);
    if (observed == queued) return true;
    queued = observed;
  }
  return false;
}

}  // namespace

extern "C" DWORD WINAPI
XInputGetState(DWORD user_index, gamehub::overlay::xinput_qa::State* state) {
  InterlockedIncrement(&g_get_state_calls);
  if (state == nullptr) return ERROR_BAD_ARGUMENTS;
  ClearState(state);
  if (user_index != 0 ||
      InterlockedCompareExchange(&g_physical_connected, 0, 0) == 0) {
    return ERROR_DEVICE_NOT_CONNECTED;
  }
  if (InterlockedCompareExchange(&g_enabled, 0, 0) == 0) {
    state->packetNumber = gamehub::overlay::xinput_qa::kProviderDisabledPacket;
    return ERROR_SUCCESS;
  }
  state->packetNumber =
      static_cast<DWORD>(InterlockedCompareExchange(&g_physical_packet, 0, 0));
  FillPhysicalGamepad(&state->gamepad);
  return ERROR_SUCCESS;
}

extern "C" DWORD WINAPI
XInputGetStateEx(DWORD user_index, gamehub::overlay::xinput_qa::State* state) {
  InterlockedIncrement(&g_get_state_ex_calls);
  if (state == nullptr) return ERROR_BAD_ARGUMENTS;
  ClearState(state);
  if (user_index != 0 ||
      InterlockedCompareExchange(&g_physical_connected, 0, 0) == 0) {
    return ERROR_DEVICE_NOT_CONNECTED;
  }
  if (InterlockedCompareExchange(&g_enabled, 0, 0) == 0) {
    state->packetNumber = gamehub::overlay::xinput_qa::kProviderDisabledPacket;
    return ERROR_SUCCESS;
  }
  state->packetNumber =
      static_cast<DWORD>(InterlockedCompareExchange(&g_physical_packet, 0, 0));
  FillPhysicalGamepad(&state->gamepad);
  if (InterlockedCompareExchange(&g_physical_neutral, 0, 0) == 0) {
    state->gamepad.buttons = gamehub::overlay::xinput_qa::kPhysicalExButtons;
  }
  return ERROR_SUCCESS;
}

extern "C" DWORD WINAPI
XInputGetKeystroke(DWORD user_index, DWORD reserved,
                   gamehub::overlay::xinput_qa::Keystroke* keystroke) {
  InterlockedIncrement(&g_get_keystroke_calls);
  if (keystroke == nullptr || reserved != 0) return ERROR_BAD_ARGUMENTS;
  ZeroMemory(keystroke, sizeof(*keystroke));
  if (user_index != 0 &&
      user_index != gamehub::overlay::xinput_qa::kXUserIndexAny) {
    return ERROR_DEVICE_NOT_CONNECTED;
  }
  if (InterlockedCompareExchange(&g_physical_connected, 0, 0) == 0) {
    return ERROR_DEVICE_NOT_CONNECTED;
  }
  if (!PopQueuedKeystroke()) {
    return gamehub::overlay::xinput_qa::kErrorEmpty;
  }
  keystroke->virtualKey = gamehub::overlay::xinput_qa::kPhysicalVirtualKey;
  keystroke->unicode = gamehub::overlay::xinput_qa::kPhysicalUnicode;
  keystroke->flags = gamehub::overlay::xinput_qa::kPhysicalKeyFlags;
  keystroke->userIndex = 0;
  keystroke->hidCode = gamehub::overlay::xinput_qa::kPhysicalHidCode;
  return ERROR_SUCCESS;
}

extern "C" VOID WINAPI XInputEnable(BOOL enable) {
  InterlockedIncrement(&g_enable_calls);
  InterlockedExchange(&g_enabled, enable ? 1 : 0);
  if (enable) {
    InterlockedExchange(
        &g_current_left_motor_speed,
        InterlockedCompareExchange(&g_last_left_motor_speed, 0, 0));
    InterlockedExchange(
        &g_current_right_motor_speed,
        InterlockedCompareExchange(&g_last_right_motor_speed, 0, 0));
  } else {
    InterlockedExchange(&g_current_left_motor_speed, 0);
    InterlockedExchange(&g_current_right_motor_speed, 0);
  }
}

extern "C" DWORD WINAPI XInputSetState(
    DWORD user_index, gamehub::overlay::xinput_qa::Vibration* vibration) {
  InterlockedIncrement(&g_set_state_calls);
  if (vibration == nullptr) return ERROR_BAD_ARGUMENTS;
  if (user_index != 0 ||
      InterlockedCompareExchange(&g_physical_connected, 0, 0) == 0) {
    return ERROR_DEVICE_NOT_CONNECTED;
  }
  InterlockedExchange(&g_last_left_motor_speed,
                      static_cast<LONG>(vibration->leftMotorSpeed));
  InterlockedExchange(&g_last_right_motor_speed,
                      static_cast<LONG>(vibration->rightMotorSpeed));
  if (InterlockedCompareExchange(&g_enabled, 0, 0) != 0) {
    InterlockedExchange(&g_current_left_motor_speed,
                        static_cast<LONG>(vibration->leftMotorSpeed));
    InterlockedExchange(&g_current_right_motor_speed,
                        static_cast<LONG>(vibration->rightMotorSpeed));
  }
  return ERROR_SUCCESS;
}

extern "C" BOOL WINAPI GameHubSyntheticXInputGetProviderSnapshot(
    gamehub::overlay::xinput_qa::ProviderSnapshot* output, DWORD output_size) {
  using gamehub::overlay::xinput_qa::ProviderSnapshot;
  if (output == nullptr || output_size != sizeof(ProviderSnapshot)) {
    SetLastError(ERROR_INSUFFICIENT_BUFFER);
    return FALSE;
  }
  output->structSize = sizeof(ProviderSnapshot);
  output->schemaVersion = gamehub::overlay::xinput_qa::kSchemaVersion;
  output->getStateCalls =
      static_cast<DWORD>(InterlockedCompareExchange(&g_get_state_calls, 0, 0));
  output->getStateExCalls = static_cast<DWORD>(
      InterlockedCompareExchange(&g_get_state_ex_calls, 0, 0));
  output->getKeystrokeCalls = static_cast<DWORD>(
      InterlockedCompareExchange(&g_get_keystroke_calls, 0, 0));
  output->enableCalls =
      static_cast<DWORD>(InterlockedCompareExchange(&g_enable_calls, 0, 0));
  output->setStateCalls =
      static_cast<DWORD>(InterlockedCompareExchange(&g_set_state_calls, 0, 0));
  output->enabled =
      static_cast<DWORD>(InterlockedCompareExchange(&g_enabled, 0, 0));
  output->physicalConnected = static_cast<DWORD>(
      InterlockedCompareExchange(&g_physical_connected, 0, 0));
  output->physicalNeutral =
      static_cast<DWORD>(InterlockedCompareExchange(&g_physical_neutral, 0, 0));
  output->physicalPacket =
      static_cast<DWORD>(InterlockedCompareExchange(&g_physical_packet, 0, 0));
  output->queuedKeystrokes = static_cast<DWORD>(
      InterlockedCompareExchange(&g_queued_keystrokes, 0, 0));
  output->lastLeftMotorSpeed = static_cast<DWORD>(
      InterlockedCompareExchange(&g_last_left_motor_speed, 0, 0));
  output->lastRightMotorSpeed = static_cast<DWORD>(
      InterlockedCompareExchange(&g_last_right_motor_speed, 0, 0));
  output->currentLeftMotorSpeed = static_cast<DWORD>(
      InterlockedCompareExchange(&g_current_left_motor_speed, 0, 0));
  output->currentRightMotorSpeed = static_cast<DWORD>(
      InterlockedCompareExchange(&g_current_right_motor_speed, 0, 0));
  return TRUE;
}

extern "C" BOOL WINAPI GameHubSyntheticXInputSetPhysical(BOOL connected,
                                                         BOOL neutral,
                                                         DWORD packet_number) {
  if (packet_number == 0) return FALSE;
  InterlockedExchange(&g_physical_connected, connected ? 1 : 0);
  InterlockedExchange(&g_physical_neutral, neutral ? 1 : 0);
  InterlockedExchange(&g_physical_packet, static_cast<LONG>(packet_number));
  return TRUE;
}

extern "C" BOOL WINAPI GameHubSyntheticXInputQueueKeystrokes(DWORD count) {
  if (count > 1'024u) return FALSE;
  InterlockedExchange(&g_queued_keystrokes, static_cast<LONG>(count));
  return TRUE;
}

BOOL WINAPI DllMain(HINSTANCE instance, DWORD reason, LPVOID) {
  if (reason == DLL_PROCESS_ATTACH) DisableThreadLibraryCalls(instance);
  return TRUE;
}
