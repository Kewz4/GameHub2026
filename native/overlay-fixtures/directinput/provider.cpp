#define GAMEHUB_DI_PROVIDER_DEFINITIONS
#include "contract.hpp"

#include <algorithm>
#include <array>
#include <cstring>
#include <new>

namespace {

std::array<DIOBJECTDATAFORMAT, 256> MakeKeyboardObjects() {
  std::array<DIOBJECTDATAFORMAT, 256> objects{};
  for (DWORD index = 0; index < objects.size(); ++index) {
    objects[index] = {
        &GUID_Key, index,
        static_cast<DWORD>(DIDFT_BUTTON | DIDFT_MAKEINSTANCE(index)), 0};
  }
  return objects;
}

template <std::size_t ButtonCount>
std::array<DIOBJECTDATAFORMAT, 3 + ButtonCount> MakeMouseObjects() {
  std::array<DIOBJECTDATAFORMAT, 3 + ButtonCount> objects{};
  objects[0] = {&GUID_XAxis, static_cast<DWORD>(offsetof(DIMOUSESTATE2, lX)),
                static_cast<DWORD>(DIDFT_RELAXIS | DIDFT_MAKEINSTANCE(0)), 0};
  objects[1] = {&GUID_YAxis, static_cast<DWORD>(offsetof(DIMOUSESTATE2, lY)),
                static_cast<DWORD>(DIDFT_RELAXIS | DIDFT_MAKEINSTANCE(1)), 0};
  objects[2] = {&GUID_ZAxis, static_cast<DWORD>(offsetof(DIMOUSESTATE2, lZ)),
                static_cast<DWORD>(DIDFT_RELAXIS | DIDFT_MAKEINSTANCE(2)), 0};
  for (DWORD index = 0; index < ButtonCount; ++index) {
    objects[3 + index] = {
        &GUID_Button,
        static_cast<DWORD>(offsetof(DIMOUSESTATE2, rgbButtons) + index),
        static_cast<DWORD>(DIDFT_BUTTON | DIDFT_MAKEINSTANCE(index)), 0};
  }
  return objects;
}

template <typename State, std::size_t ButtonCount, bool Extended>
std::array<DIOBJECTDATAFORMAT, 8 + 4 + ButtonCount + (Extended ? 24 : 0)>
MakeJoystickObjects() {
  constexpr std::size_t kCount = 8 + 4 + ButtonCount + (Extended ? 24 : 0);
  std::array<DIOBJECTDATAFORMAT, kCount> objects{};
  const GUID *axes[8] = {&GUID_XAxis,  &GUID_YAxis,  &GUID_ZAxis,
                         &GUID_RxAxis, &GUID_RyAxis, &GUID_RzAxis,
                         &GUID_Slider, &GUID_Slider};
  const DWORD offsets[8] = {
      static_cast<DWORD>(offsetof(State, lX)),
      static_cast<DWORD>(offsetof(State, lY)),
      static_cast<DWORD>(offsetof(State, lZ)),
      static_cast<DWORD>(offsetof(State, lRx)),
      static_cast<DWORD>(offsetof(State, lRy)),
      static_cast<DWORD>(offsetof(State, lRz)),
      static_cast<DWORD>(offsetof(State, rglSlider)),
      static_cast<DWORD>(offsetof(State, rglSlider) + sizeof(LONG))};
  std::size_t cursor = 0;
  for (DWORD index = 0; index < 8; ++index) {
    objects[cursor++] = {
        axes[index], offsets[index],
        static_cast<DWORD>(DIDFT_ABSAXIS | DIDFT_MAKEINSTANCE(index)), 0};
  }
  for (DWORD index = 0; index < 4; ++index) {
    objects[cursor++] = {
        &GUID_POV,
        static_cast<DWORD>(offsetof(State, rgdwPOV) + index * sizeof(DWORD)),
        static_cast<DWORD>(DIDFT_POV | DIDFT_MAKEINSTANCE(index)), 0};
  }
  for (DWORD index = 0; index < ButtonCount; ++index) {
    objects[cursor++] = {
        &GUID_Button, static_cast<DWORD>(offsetof(State, rgbButtons) + index),
        static_cast<DWORD>(DIDFT_BUTTON | DIDFT_MAKEINSTANCE(index)), 0};
  }
  if constexpr (Extended) {
    const DWORD extended_offsets[24] = {
        static_cast<DWORD>(offsetof(State, lVX)),
        static_cast<DWORD>(offsetof(State, lVY)),
        static_cast<DWORD>(offsetof(State, lVZ)),
        static_cast<DWORD>(offsetof(State, lVRx)),
        static_cast<DWORD>(offsetof(State, lVRy)),
        static_cast<DWORD>(offsetof(State, lVRz)),
        static_cast<DWORD>(offsetof(State, rglVSlider)),
        static_cast<DWORD>(offsetof(State, rglVSlider) + sizeof(LONG)),
        static_cast<DWORD>(offsetof(State, lAX)),
        static_cast<DWORD>(offsetof(State, lAY)),
        static_cast<DWORD>(offsetof(State, lAZ)),
        static_cast<DWORD>(offsetof(State, lARx)),
        static_cast<DWORD>(offsetof(State, lARy)),
        static_cast<DWORD>(offsetof(State, lARz)),
        static_cast<DWORD>(offsetof(State, rglASlider)),
        static_cast<DWORD>(offsetof(State, rglASlider) + sizeof(LONG)),
        static_cast<DWORD>(offsetof(State, lFX)),
        static_cast<DWORD>(offsetof(State, lFY)),
        static_cast<DWORD>(offsetof(State, lFZ)),
        static_cast<DWORD>(offsetof(State, lFRx)),
        static_cast<DWORD>(offsetof(State, lFRy)),
        static_cast<DWORD>(offsetof(State, lFRz)),
        static_cast<DWORD>(offsetof(State, rglFSlider)),
        static_cast<DWORD>(offsetof(State, rglFSlider) + sizeof(LONG))};
    for (DWORD index = 0; index < 24; ++index) {
      objects[cursor++] = {
          axes[index % 8], extended_offsets[index],
          static_cast<DWORD>(DIDFT_ABSAXIS | DIDFT_MAKEINSTANCE(8 + index)), 0};
    }
  }
  return objects;
}

auto g_keyboard_objects = MakeKeyboardObjects();
auto g_mouse_objects = MakeMouseObjects<4>();
auto g_mouse2_objects = MakeMouseObjects<8>();
auto g_joystick_objects = MakeJoystickObjects<DIJOYSTATE, 32, false>();
auto g_joystick2_objects = MakeJoystickObjects<DIJOYSTATE2, 128, true>();

} // namespace

extern "C" const DIDATAFORMAT c_dfDIKeyboard = {
    sizeof(DIDATAFORMAT),
    sizeof(DIOBJECTDATAFORMAT),
    DIDF_RELAXIS,
    sizeof(BYTE) * 256u,
    static_cast<DWORD>(g_keyboard_objects.size()),
    g_keyboard_objects.data()};
extern "C" const DIDATAFORMAT c_dfDIMouse = {
    sizeof(DIDATAFORMAT),
    sizeof(DIOBJECTDATAFORMAT),
    DIDF_RELAXIS,
    sizeof(DIMOUSESTATE),
    static_cast<DWORD>(g_mouse_objects.size()),
    g_mouse_objects.data()};
extern "C" const DIDATAFORMAT c_dfDIMouse2 = {
    sizeof(DIDATAFORMAT),
    sizeof(DIOBJECTDATAFORMAT),
    DIDF_RELAXIS,
    sizeof(DIMOUSESTATE2),
    static_cast<DWORD>(g_mouse2_objects.size()),
    g_mouse2_objects.data()};
extern "C" const DIDATAFORMAT c_dfDIJoystick = {
    sizeof(DIDATAFORMAT),
    sizeof(DIOBJECTDATAFORMAT),
    DIDF_ABSAXIS,
    sizeof(DIJOYSTATE),
    static_cast<DWORD>(g_joystick_objects.size()),
    g_joystick_objects.data()};
extern "C" const DIDATAFORMAT c_dfDIJoystick2 = {
    sizeof(DIDATAFORMAT),
    sizeof(DIOBJECTDATAFORMAT),
    DIDF_ABSAXIS,
    sizeof(DIJOYSTATE2),
    static_cast<DWORD>(g_joystick2_objects.size()),
    g_joystick2_objects.data()};

namespace {

using namespace gamehub::overlay::directinput_qa;

struct RangeEntry {
  DWORD offset = 0;
  LONG minimum = -1000;
  LONG maximum = 1000;
  bool valid = false;
};

struct DeviceObject {
  IDirectInputDevice8A a{};
  IDirectInputDevice8W w{};
  LONG references = 1;
  bool acquired = false;
  HWND cooperativeWindow = nullptr;
  DWORD cooperativeFlags = 0;
  HANDLE eventHandle = nullptr;
  DIDATAFORMAT format{};
  std::array<DIOBJECTDATAFORMAT, kMaxFormatObjects> objects{};
  std::array<GUID, kMaxFormatObjects> guids{};
  std::array<RangeEntry, kMaxFormatObjects> ranges{};
};

struct RootObject {
  IDirectInput8A a{};
  IDirectInput8W w{};
  LONG references = 1;
};

volatile LONG g_direct_input_create_calls = 0;
volatile LONG g_root_create_calls_a = 0;
volatile LONG g_root_create_calls_w = 0;
volatile LONG g_get_state_calls = 0;
volatile LONG g_get_data_calls = 0;
volatile LONG g_null_infinite_drain_calls = 0;
volatile LONG g_poll_calls = 0;
volatile LONG g_acquire_calls = 0;
volatile LONG g_unacquire_calls = 0;
volatile LONG g_set_format_calls = 0;
volatile LONG g_set_coop_calls = 0;
volatile LONG g_set_action_map_calls = 0;
volatile LONG g_set_event_calls = 0;
volatile LONG g_live_roots = 0;
volatile LONG g_live_devices = 0;
volatile LONG g_total_references = 0;
volatile LONG g_queued_events = kInitialQueuedEvents;
volatile LONG g_poll_generation = 0;
volatile LONG g_physical_neutral = FALSE;
volatile LONG g_next_data_result = DI_OK;
volatile LONG g_set_action_map_result = DIERR_UNSUPPORTED;

LONG AtomicRead(volatile LONG *value) {
  return InterlockedCompareExchange(value, 0, 0);
}

extern IDirectInputDevice8AVtbl g_device_vtable_a;
extern IDirectInputDevice8WVtbl g_device_vtable_w;
extern IDirectInput8AVtbl g_root_vtable_a;
extern IDirectInput8WVtbl g_root_vtable_w;

DeviceObject *FromA(IDirectInputDevice8A *value) {
  return reinterpret_cast<DeviceObject *>(
      reinterpret_cast<unsigned char *>(value) - offsetof(DeviceObject, a));
}

DeviceObject *FromW(IDirectInputDevice8W *value) {
  return reinterpret_cast<DeviceObject *>(
      reinterpret_cast<unsigned char *>(value) - offsetof(DeviceObject, w));
}

RootObject *RootFromA(IDirectInput8A *value) {
  return reinterpret_cast<RootObject *>(
      reinterpret_cast<unsigned char *>(value) - offsetof(RootObject, a));
}

RootObject *RootFromW(IDirectInput8W *value) {
  return reinterpret_cast<RootObject *>(
      reinterpret_cast<unsigned char *>(value) - offsetof(RootObject, w));
}

DWORD PropertyId(REFGUID property) {
  const ULONG_PTR address = reinterpret_cast<ULONG_PTR>(&property);
  return address <= 0xffffu ? static_cast<DWORD>(address) : 0u;
}

DWORD ObjectWidth(DWORD type) {
  if ((type & DIDFT_BUTTON) != 0u)
    return sizeof(BYTE);
  if ((type & DIDFT_AXIS) != 0u || (type & DIDFT_POV) != 0u) {
    return sizeof(LONG);
  }
  return 0;
}

bool ValidateAndCopyFormat(DeviceObject *device,
                           const DIDATAFORMAT *candidate) {
  if (candidate == nullptr || candidate->dwSize != sizeof(DIDATAFORMAT) ||
      candidate->dwObjSize != sizeof(DIOBJECTDATAFORMAT) ||
      candidate->dwDataSize == 0 || candidate->dwDataSize > kMaxFormatBytes ||
      candidate->dwNumObjs == 0 || candidate->dwNumObjs > kMaxFormatObjects ||
      candidate->rgodf == nullptr ||
      (candidate->dwFlags != DIDF_ABSAXIS &&
       candidate->dwFlags != DIDF_RELAXIS)) {
    return false;
  }

  std::array<bool, kMaxFormatBytes> occupied{};
  for (DWORD index = 0; index < candidate->dwNumObjs; ++index) {
    const DIOBJECTDATAFORMAT &object = candidate->rgodf[index];
    const DWORD width = ObjectWidth(object.dwType);
    if (width == 0 || object.dwOfs >= candidate->dwDataSize ||
        width > candidate->dwDataSize - object.dwOfs) {
      return false;
    }
    for (DWORD byte = 0; byte < width; ++byte) {
      if (occupied[object.dwOfs + byte])
        return false;
      occupied[object.dwOfs + byte] = true;
    }
    for (DWORD prior = 0; prior < index; ++prior) {
      if (candidate->rgodf[prior].dwOfs == object.dwOfs ||
          candidate->rgodf[prior].dwType == object.dwType) {
        return false;
      }
    }
  }

  device->format = *candidate;
  device->format.rgodf = device->objects.data();
  for (DWORD index = 0; index < candidate->dwNumObjs; ++index) {
    device->objects[index] = candidate->rgodf[index];
    if (candidate->rgodf[index].pguid != nullptr) {
      device->guids[index] = *candidate->rgodf[index].pguid;
      device->objects[index].pguid = &device->guids[index];
    } else {
      device->objects[index].pguid = nullptr;
    }
    device->ranges[index].offset = device->objects[index].dwOfs;
    device->ranges[index].minimum = -1000;
    device->ranges[index].maximum = 1000;
    device->ranges[index].valid =
        (device->objects[index].dwType & DIDFT_AXIS) != 0u;
  }
  return true;
}

RangeEntry *FindRange(DeviceObject *device, DWORD offset) {
  for (DWORD index = 0; index < device->format.dwNumObjs; ++index) {
    if (device->ranges[index].valid && device->ranges[index].offset == offset) {
      return &device->ranges[index];
    }
  }
  return nullptr;
}

HRESULT QueryDevice(DeviceObject *device, REFIID iid, void **output) {
  if (output == nullptr)
    return E_POINTER;
  *output = nullptr;
  if (IsEqualIID(iid, IID_IUnknown) ||
      IsEqualIID(iid, IID_IDirectInputDevice8A)) {
    *output = &device->a;
  } else if (IsEqualIID(iid, IID_IDirectInputDevice8W)) {
    *output = &device->w;
  } else {
    return E_NOINTERFACE;
  }
  InterlockedIncrement(&device->references);
  InterlockedIncrement(&g_total_references);
  return S_OK;
}

ULONG AddRefDevice(DeviceObject *device) {
  InterlockedIncrement(&g_total_references);
  return static_cast<ULONG>(InterlockedIncrement(&device->references));
}

ULONG ReleaseDevice(DeviceObject *device) {
  InterlockedDecrement(&g_total_references);
  const LONG remaining = InterlockedDecrement(&device->references);
  if (remaining == 0) {
    InterlockedDecrement(&g_live_devices);
    delete device;
  }
  return static_cast<ULONG>(remaining);
}

HRESULT GetPropertyDevice(DeviceObject *device, REFGUID property,
                          DIPROPHEADER *header) {
  if (header == nullptr || header->dwHeaderSize != sizeof(DIPROPHEADER)) {
    return DIERR_INVALIDPARAM;
  }
  if (PropertyId(property) != 4u || header->dwHow != DIPH_BYOFFSET ||
      header->dwSize != sizeof(DIPROPRANGE)) {
    return DIERR_UNSUPPORTED;
  }
  RangeEntry *range = FindRange(device, header->dwObj);
  if (range == nullptr)
    return DIERR_OBJECTNOTFOUND;
  auto *output = reinterpret_cast<DIPROPRANGE *>(header);
  output->lMin = range->minimum;
  output->lMax = range->maximum;
  return DI_OK;
}

HRESULT SetPropertyDevice(DeviceObject *device, REFGUID property,
                          const DIPROPHEADER *header) {
  if (header == nullptr || header->dwHeaderSize != sizeof(DIPROPHEADER)) {
    return DIERR_INVALIDPARAM;
  }
  const DWORD property_id = PropertyId(property);
  if (property_id == 4u && header->dwHow == DIPH_BYOFFSET &&
      header->dwSize == sizeof(DIPROPRANGE)) {
    RangeEntry *range = FindRange(device, header->dwObj);
    if (range == nullptr)
      return DIERR_OBJECTNOTFOUND;
    const auto *input = reinterpret_cast<const DIPROPRANGE *>(header);
    if (input->lMin >= input->lMax)
      return DIERR_INVALIDPARAM;
    range->minimum = input->lMin;
    range->maximum = input->lMax;
    return DI_OK;
  }
  if (property_id == 2u && header->dwSize == sizeof(DIPROPDWORD)) {
    return DI_OK;
  }
  return DIERR_UNSUPPORTED;
}

HRESULT GetStateDevice(DeviceObject *device, DWORD bytes, void *output) {
  InterlockedIncrement(&g_get_state_calls);
  if (!device->acquired)
    return DIERR_NOTACQUIRED;
  if (output == nullptr || device->format.dwNumObjs == 0 ||
      bytes != device->format.dwDataSize) {
    return DIERR_INVALIDPARAM;
  }
  const bool physical_neutral = AtomicRead(&g_physical_neutral) != FALSE;
  auto *data = static_cast<unsigned char *>(output);
  for (DWORD index = 0; index < device->format.dwNumObjs; ++index) {
    const DIOBJECTDATAFORMAT &object = device->objects[index];
    if ((object.dwType & DIDFT_BUTTON) != 0u) {
      data[object.dwOfs] = physical_neutral ? 0u : 0x80u;
    } else if ((object.dwType & DIDFT_POV) != 0u) {
      const DWORD value = physical_neutral ? 0xffffffffu : 9000u;
      std::memcpy(data + object.dwOfs, &value, sizeof(value));
    } else if ((object.dwType & DIDFT_AXIS) != 0u) {
      LONG value = 0;
      if (device->format.dwFlags == DIDF_ABSAXIS) {
        RangeEntry *range = FindRange(device, object.dwOfs);
        if (range == nullptr)
          return DIERR_OBJECTNOTFOUND;
        const long long midpoint =
            static_cast<long long>(range->minimum) +
            (static_cast<long long>(range->maximum) - range->minimum) / 2;
        value = physical_neutral ? static_cast<LONG>(midpoint) : range->minimum;
      } else {
        value = physical_neutral ? 0 : 111;
      }
      std::memcpy(data + object.dwOfs, &value, sizeof(value));
    }
  }
  return DI_OK;
}

HRESULT GetDataDevice(DeviceObject *device, DWORD object_bytes,
                      DIDEVICEOBJECTDATA *events, DWORD *count, DWORD flags) {
  InterlockedIncrement(&g_get_data_calls);
  if (!device->acquired)
    return DIERR_NOTACQUIRED;
  if (count == nullptr || object_bytes != sizeof(DIDEVICEOBJECTDATA)) {
    return DIERR_INVALIDPARAM;
  }
  const HRESULT next_data_result =
      static_cast<HRESULT>(AtomicRead(&g_next_data_result));
  if (FAILED(next_data_result))
    return next_data_result;
  const DWORD available =
      static_cast<DWORD>(std::max<LONG>(AtomicRead(&g_queued_events), 0));
  if (events == nullptr) {
    if (*count == INFINITE) {
      InterlockedIncrement(&g_null_infinite_drain_calls);
      *count = available;
      InterlockedExchange(&g_queued_events, 0);
      return next_data_result;
    }
    *count = available;
    return next_data_result;
  }
  const DWORD requested = *count;
  const DWORD copied = (std::min)(requested, available);
  for (DWORD index = 0; index < copied; ++index) {
    DIDEVICEOBJECTDATA value{};
    value.dwOfs = index;
    value.dwData = 0x80u;
    value.dwTimeStamp = 100u + index;
    value.dwSequence = 200u + index;
    events[index] = value;
  }
  *count = copied;
  if ((flags & DIGDD_PEEK) == 0u) {
    InterlockedExchangeAdd(&g_queued_events, -static_cast<LONG>(copied));
  }
  return available > copied ? DI_BUFFEROVERFLOW : next_data_result;
}

HRESULT SetCoopDevice(DeviceObject *device, HWND window, DWORD flags) {
  InterlockedIncrement(&g_set_coop_calls);
  const DWORD location = flags & (DISCL_FOREGROUND | DISCL_BACKGROUND);
  const DWORD sharing = flags & (DISCL_EXCLUSIVE | DISCL_NONEXCLUSIVE);
  const DWORD known = DISCL_FOREGROUND | DISCL_BACKGROUND | DISCL_EXCLUSIVE |
                      DISCL_NONEXCLUSIVE | DISCL_NOWINKEY;
  if ((flags & ~known) != 0u ||
      (location != DISCL_FOREGROUND && location != DISCL_BACKGROUND) ||
      (sharing != DISCL_EXCLUSIVE && sharing != DISCL_NONEXCLUSIVE) ||
      window == nullptr) {
    return DIERR_INVALIDPARAM;
  }
  device->cooperativeWindow = window;
  device->cooperativeFlags = flags;
  return DI_OK;
}

HRESULT CreateDevice(bool wide, REFGUID, void **output, IUnknown *outer) {
  if (output == nullptr)
    return E_POINTER;
  *output = nullptr;
  if (outer != nullptr)
    return CLASS_E_NOAGGREGATION;
  auto *device = new (std::nothrow) DeviceObject;
  if (device == nullptr)
    return DIERR_OUTOFMEMORY;
  device->a.lpVtbl = &g_device_vtable_a;
  device->w.lpVtbl = &g_device_vtable_w;
  InterlockedIncrement(&g_live_devices);
  InterlockedIncrement(&g_total_references);
  *output =
      wide ? static_cast<void *>(&device->w) : static_cast<void *>(&device->a);
  return DI_OK;
}

HRESULT QueryRoot(RootObject *root, REFIID iid, void **output) {
  if (output == nullptr)
    return E_POINTER;
  *output = nullptr;
  if (IsEqualIID(iid, IID_IUnknown) || IsEqualIID(iid, IID_IDirectInput8A)) {
    *output = &root->a;
  } else if (IsEqualIID(iid, IID_IDirectInput8W)) {
    *output = &root->w;
  } else {
    return E_NOINTERFACE;
  }
  InterlockedIncrement(&root->references);
  InterlockedIncrement(&g_total_references);
  return S_OK;
}

ULONG AddRefRoot(RootObject *root) {
  InterlockedIncrement(&g_total_references);
  return static_cast<ULONG>(InterlockedIncrement(&root->references));
}

ULONG ReleaseRoot(RootObject *root) {
  InterlockedDecrement(&g_total_references);
  const LONG remaining = InterlockedDecrement(&root->references);
  if (remaining == 0) {
    InterlockedDecrement(&g_live_roots);
    delete root;
  }
  return static_cast<ULONG>(remaining);
}

HRESULT STDMETHODCALLTYPE DeviceQueryA(IDirectInputDevice8A *self, REFIID iid,
                                       void **output) {
  return QueryDevice(FromA(self), iid, output);
}
HRESULT STDMETHODCALLTYPE DeviceQueryW(IDirectInputDevice8W *self, REFIID iid,
                                       void **output) {
  return QueryDevice(FromW(self), iid, output);
}
ULONG STDMETHODCALLTYPE DeviceAddRefA(IDirectInputDevice8A *self) {
  return AddRefDevice(FromA(self));
}
ULONG STDMETHODCALLTYPE DeviceAddRefW(IDirectInputDevice8W *self) {
  return AddRefDevice(FromW(self));
}
ULONG STDMETHODCALLTYPE DeviceReleaseA(IDirectInputDevice8A *self) {
  return ReleaseDevice(FromA(self));
}
ULONG STDMETHODCALLTYPE DeviceReleaseW(IDirectInputDevice8W *self) {
  return ReleaseDevice(FromW(self));
}

#define DEVICE_COMMON_METHODS(Suffix, Interface, From)                         \
  HRESULT STDMETHODCALLTYPE DeviceGetCapabilities##Suffix(Interface *,         \
                                                          DIDEVCAPS *) {       \
    return DIERR_UNSUPPORTED;                                                  \
  }                                                                            \
  HRESULT STDMETHODCALLTYPE DeviceGetProperty##Suffix(                         \
      Interface *self, REFGUID property, DIPROPHEADER *header) {               \
    return GetPropertyDevice(From(self), property, header);                    \
  }                                                                            \
  HRESULT STDMETHODCALLTYPE DeviceSetProperty##Suffix(                         \
      Interface *self, REFGUID property, const DIPROPHEADER *header) {         \
    return SetPropertyDevice(From(self), property, header);                    \
  }                                                                            \
  HRESULT STDMETHODCALLTYPE DeviceAcquire##Suffix(Interface *self) {           \
    InterlockedIncrement(&g_acquire_calls);                                    \
    From(self)->acquired = true;                                               \
    return DI_OK;                                                              \
  }                                                                            \
  HRESULT STDMETHODCALLTYPE DeviceUnacquire##Suffix(Interface *self) {         \
    InterlockedIncrement(&g_unacquire_calls);                                  \
    From(self)->acquired = false;                                              \
    return DI_OK;                                                              \
  }                                                                            \
  HRESULT STDMETHODCALLTYPE DeviceGetState##Suffix(                            \
      Interface *self, DWORD bytes, void *output) {                            \
    return GetStateDevice(From(self), bytes, output);                          \
  }                                                                            \
  HRESULT STDMETHODCALLTYPE DeviceGetData##Suffix(                             \
      Interface *self, DWORD object_bytes, DIDEVICEOBJECTDATA *events,         \
      DWORD *count, DWORD flags) {                                             \
    return GetDataDevice(From(self), object_bytes, events, count, flags);      \
  }                                                                            \
  HRESULT STDMETHODCALLTYPE DeviceSetFormat##Suffix(                           \
      Interface *self, const DIDATAFORMAT *format) {                           \
    InterlockedIncrement(&g_set_format_calls);                                 \
    return ValidateAndCopyFormat(From(self), format) ? DI_OK                   \
                                                     : DIERR_INVALIDPARAM;     \
  }                                                                            \
  HRESULT STDMETHODCALLTYPE DeviceSetEvent##Suffix(Interface *self,            \
                                                   HANDLE event_handle) {      \
    InterlockedIncrement(&g_set_event_calls);                                  \
    From(self)->eventHandle = event_handle;                                    \
    return DI_OK;                                                              \
  }                                                                            \
  HRESULT STDMETHODCALLTYPE DeviceSetCoop##Suffix(Interface *self,             \
                                                  HWND window, DWORD flags) {  \
    return SetCoopDevice(From(self), window, flags);                           \
  }                                                                            \
  HRESULT STDMETHODCALLTYPE DeviceRunControlPanel##Suffix(Interface *, HWND,   \
                                                          DWORD) {             \
    return DIERR_UNSUPPORTED;                                                  \
  }                                                                            \
  HRESULT STDMETHODCALLTYPE DeviceInitialize##Suffix(Interface *, HINSTANCE,   \
                                                     DWORD, REFGUID) {         \
    return DI_OK;                                                              \
  }                                                                            \
  HRESULT STDMETHODCALLTYPE DeviceGetForceFeedbackState##Suffix(Interface *,   \
                                                                DWORD *) {     \
    return DIERR_UNSUPPORTED;                                                  \
  }                                                                            \
  HRESULT STDMETHODCALLTYPE DeviceSendForceFeedbackCommand##Suffix(            \
      Interface *, DWORD) {                                                    \
    return DIERR_UNSUPPORTED;                                                  \
  }                                                                            \
  HRESULT STDMETHODCALLTYPE DeviceEscape##Suffix(Interface *, DIEFFESCAPE *) { \
    return DIERR_UNSUPPORTED;                                                  \
  }                                                                            \
  HRESULT STDMETHODCALLTYPE DevicePoll##Suffix(Interface *self) {              \
    InterlockedIncrement(&g_poll_calls);                                       \
    InterlockedIncrement(&g_poll_generation);                                  \
    return From(self)->acquired ? DI_OK : DIERR_NOTACQUIRED;                   \
  }                                                                            \
  HRESULT STDMETHODCALLTYPE DeviceSendData##Suffix(                            \
      Interface *, DWORD, const DIDEVICEOBJECTDATA *, DWORD *, DWORD) {        \
    return DIERR_UNSUPPORTED;                                                  \
  }

DEVICE_COMMON_METHODS(A, IDirectInputDevice8A, FromA)
DEVICE_COMMON_METHODS(W, IDirectInputDevice8W, FromW)

#define DEVICE_TYPED_METHODS(Suffix, Interface, ObjCallback, ObjInfo,          \
                             EffectCallback, EffectInfo, FileName,             \
                             FileCallback, ActionFormat, UserName, ImageInfo)  \
  HRESULT STDMETHODCALLTYPE DeviceEnumObjects##Suffix(                         \
      Interface *, ObjCallback, void *, DWORD) {                               \
    return DIERR_UNSUPPORTED;                                                  \
  }                                                                            \
  HRESULT STDMETHODCALLTYPE DeviceGetObjectInfo##Suffix(                       \
      Interface *, ObjInfo *, DWORD, DWORD) {                                  \
    return DIERR_UNSUPPORTED;                                                  \
  }                                                                            \
  HRESULT STDMETHODCALLTYPE DeviceGetDeviceInfo##Suffix(Interface *, void *) { \
    return DIERR_UNSUPPORTED;                                                  \
  }                                                                            \
  HRESULT STDMETHODCALLTYPE DeviceCreateEffect##Suffix(                        \
      Interface *, REFGUID, const DIEFFECT *, IDirectInputEffect **,           \
      IUnknown *) {                                                            \
    return DIERR_UNSUPPORTED;                                                  \
  }                                                                            \
  HRESULT STDMETHODCALLTYPE DeviceEnumEffects##Suffix(                         \
      Interface *, EffectCallback, void *, DWORD) {                            \
    return DIERR_UNSUPPORTED;                                                  \
  }                                                                            \
  HRESULT STDMETHODCALLTYPE DeviceGetEffectInfo##Suffix(                       \
      Interface *, EffectInfo *, REFGUID) {                                    \
    return DIERR_UNSUPPORTED;                                                  \
  }                                                                            \
  HRESULT STDMETHODCALLTYPE DeviceEnumCreatedEffects##Suffix(                  \
      Interface *, LPDIENUMCREATEDEFFECTOBJECTSCALLBACK, void *, DWORD) {      \
    return DIERR_UNSUPPORTED;                                                  \
  }                                                                            \
  HRESULT STDMETHODCALLTYPE DeviceEnumEffectsInFile##Suffix(                   \
      Interface *, FileName, FileCallback, void *, DWORD) {                    \
    return DIERR_UNSUPPORTED;                                                  \
  }                                                                            \
  HRESULT STDMETHODCALLTYPE DeviceWriteEffectToFile##Suffix(                   \
      Interface *, FileName, DWORD, DIFILEEFFECT *, DWORD) {                   \
    return DIERR_UNSUPPORTED;                                                  \
  }                                                                            \
  HRESULT STDMETHODCALLTYPE DeviceBuildActionMap##Suffix(                      \
      Interface *, ActionFormat *, UserName, DWORD) {                          \
    return DIERR_UNSUPPORTED;                                                  \
  }                                                                            \
  HRESULT STDMETHODCALLTYPE DeviceSetActionMap##Suffix(                        \
      Interface *, ActionFormat *, UserName, DWORD) {                          \
    InterlockedIncrement(&g_set_action_map_calls);                             \
    return static_cast<HRESULT>(AtomicRead(&g_set_action_map_result));         \
  }                                                                            \
  HRESULT STDMETHODCALLTYPE DeviceGetImageInfo##Suffix(Interface *,            \
                                                       ImageInfo *) {          \
    return DIERR_UNSUPPORTED;                                                  \
  }

DEVICE_TYPED_METHODS(A, IDirectInputDevice8A, LPDIENUMDEVICEOBJECTSCALLBACKA,
                     DIDEVICEOBJECTINSTANCEA, LPDIENUMEFFECTSCALLBACKA,
                     DIEFFECTINFOA, LPCSTR, LPDIENUMEFFECTSINFILECALLBACK,
                     DIACTIONFORMATA, LPCSTR, DIDEVICEIMAGEINFOHEADERA)
DEVICE_TYPED_METHODS(W, IDirectInputDevice8W, LPDIENUMDEVICEOBJECTSCALLBACKW,
                     DIDEVICEOBJECTINSTANCEW, LPDIENUMEFFECTSCALLBACKW,
                     DIEFFECTINFOW, LPCWSTR, LPDIENUMEFFECTSINFILECALLBACK,
                     DIACTIONFORMATW, LPCWSTR, DIDEVICEIMAGEINFOHEADERW)

HRESULT STDMETHODCALLTYPE RootQueryA(IDirectInput8A *self, REFIID iid,
                                     void **output) {
  return QueryRoot(RootFromA(self), iid, output);
}
HRESULT STDMETHODCALLTYPE RootQueryW(IDirectInput8W *self, REFIID iid,
                                     void **output) {
  return QueryRoot(RootFromW(self), iid, output);
}
ULONG STDMETHODCALLTYPE RootAddRefA(IDirectInput8A *self) {
  return AddRefRoot(RootFromA(self));
}
ULONG STDMETHODCALLTYPE RootAddRefW(IDirectInput8W *self) {
  return AddRefRoot(RootFromW(self));
}
ULONG STDMETHODCALLTYPE RootReleaseA(IDirectInput8A *self) {
  return ReleaseRoot(RootFromA(self));
}
ULONG STDMETHODCALLTYPE RootReleaseW(IDirectInput8W *self) {
  return ReleaseRoot(RootFromW(self));
}
HRESULT STDMETHODCALLTYPE RootCreateA(IDirectInput8A *, REFGUID guid,
                                      IDirectInputDevice8A **output,
                                      IUnknown *outer) {
  InterlockedIncrement(&g_root_create_calls_a);
  return CreateDevice(false, guid, reinterpret_cast<void **>(output), outer);
}
HRESULT STDMETHODCALLTYPE RootCreateW(IDirectInput8W *, REFGUID guid,
                                      IDirectInputDevice8W **output,
                                      IUnknown *outer) {
  InterlockedIncrement(&g_root_create_calls_w);
  return CreateDevice(true, guid, reinterpret_cast<void **>(output), outer);
}

#define ROOT_METHODS(Suffix, Interface, EnumCallback, DeviceName,              \
                     SemanticsCallback, ConfigureParams)                       \
  HRESULT STDMETHODCALLTYPE RootEnumDevices##Suffix(                           \
      Interface *, DWORD, EnumCallback, void *, DWORD) {                       \
    return DIERR_UNSUPPORTED;                                                  \
  }                                                                            \
  HRESULT STDMETHODCALLTYPE RootGetDeviceStatus##Suffix(Interface *,           \
                                                        REFGUID) {             \
    return DI_OK;                                                              \
  }                                                                            \
  HRESULT STDMETHODCALLTYPE RootRunControlPanel##Suffix(Interface *, HWND,     \
                                                        DWORD) {               \
    return DIERR_UNSUPPORTED;                                                  \
  }                                                                            \
  HRESULT STDMETHODCALLTYPE RootInitialize##Suffix(Interface *, HINSTANCE,     \
                                                   DWORD) {                    \
    return DI_OK;                                                              \
  }                                                                            \
  HRESULT STDMETHODCALLTYPE RootFindDevice##Suffix(Interface *, REFGUID,       \
                                                   DeviceName, GUID *) {       \
    return DIERR_UNSUPPORTED;                                                  \
  }                                                                            \
  HRESULT STDMETHODCALLTYPE RootEnumBySemantics##Suffix(                       \
      Interface *, DeviceName, void *, SemanticsCallback, void *, DWORD) {     \
    return DIERR_UNSUPPORTED;                                                  \
  }                                                                            \
  HRESULT STDMETHODCALLTYPE RootConfigure##Suffix(                             \
      Interface *, LPDICONFIGUREDEVICESCALLBACK, ConfigureParams *, DWORD,     \
      void *) {                                                                \
    return DIERR_UNSUPPORTED;                                                  \
  }

ROOT_METHODS(A, IDirectInput8A, LPDIENUMDEVICESCALLBACKA, LPCSTR,
             LPDIENUMDEVICESBYSEMANTICSCBA, DICONFIGUREDEVICESPARAMSA)
ROOT_METHODS(W, IDirectInput8W, LPDIENUMDEVICESCALLBACKW, LPCWSTR,
             LPDIENUMDEVICESBYSEMANTICSCBW, DICONFIGUREDEVICESPARAMSW)

IDirectInputDevice8AVtbl g_device_vtable_a = {
    DeviceQueryA,
    DeviceAddRefA,
    DeviceReleaseA,
    DeviceGetCapabilitiesA,
    DeviceEnumObjectsA,
    DeviceGetPropertyA,
    DeviceSetPropertyA,
    DeviceAcquireA,
    DeviceUnacquireA,
    DeviceGetStateA,
    DeviceGetDataA,
    DeviceSetFormatA,
    DeviceSetEventA,
    DeviceSetCoopA,
    DeviceGetObjectInfoA,
    reinterpret_cast<HRESULT(STDMETHODCALLTYPE *)(
        IDirectInputDevice8A *, DIDEVICEINSTANCEA *)>(DeviceGetDeviceInfoA),
    DeviceRunControlPanelA,
    DeviceInitializeA,
    DeviceCreateEffectA,
    DeviceEnumEffectsA,
    DeviceGetEffectInfoA,
    DeviceGetForceFeedbackStateA,
    DeviceSendForceFeedbackCommandA,
    DeviceEnumCreatedEffectsA,
    DeviceEscapeA,
    DevicePollA,
    DeviceSendDataA,
    DeviceEnumEffectsInFileA,
    DeviceWriteEffectToFileA,
    DeviceBuildActionMapA,
    DeviceSetActionMapA,
    DeviceGetImageInfoA,
};

IDirectInputDevice8WVtbl g_device_vtable_w = {
    DeviceQueryW,
    DeviceAddRefW,
    DeviceReleaseW,
    DeviceGetCapabilitiesW,
    DeviceEnumObjectsW,
    DeviceGetPropertyW,
    DeviceSetPropertyW,
    DeviceAcquireW,
    DeviceUnacquireW,
    DeviceGetStateW,
    DeviceGetDataW,
    DeviceSetFormatW,
    DeviceSetEventW,
    DeviceSetCoopW,
    DeviceGetObjectInfoW,
    reinterpret_cast<HRESULT(STDMETHODCALLTYPE *)(
        IDirectInputDevice8W *, DIDEVICEINSTANCEW *)>(DeviceGetDeviceInfoW),
    DeviceRunControlPanelW,
    DeviceInitializeW,
    DeviceCreateEffectW,
    DeviceEnumEffectsW,
    DeviceGetEffectInfoW,
    DeviceGetForceFeedbackStateW,
    DeviceSendForceFeedbackCommandW,
    DeviceEnumCreatedEffectsW,
    DeviceEscapeW,
    DevicePollW,
    DeviceSendDataW,
    DeviceEnumEffectsInFileW,
    DeviceWriteEffectToFileW,
    DeviceBuildActionMapW,
    DeviceSetActionMapW,
    DeviceGetImageInfoW,
};

IDirectInput8AVtbl g_root_vtable_a = {
    RootQueryA,
    RootAddRefA,
    RootReleaseA,
    RootCreateA,
    RootEnumDevicesA,
    RootGetDeviceStatusA,
    RootRunControlPanelA,
    RootInitializeA,
    RootFindDeviceA,
    reinterpret_cast<HRESULT(STDMETHODCALLTYPE *)(
        IDirectInput8A *, LPCSTR, DIACTIONFORMATA *,
        LPDIENUMDEVICESBYSEMANTICSCBA, void *, DWORD)>(RootEnumBySemanticsA),
    RootConfigureA,
};

IDirectInput8WVtbl g_root_vtable_w = {
    RootQueryW,
    RootAddRefW,
    RootReleaseW,
    RootCreateW,
    RootEnumDevicesW,
    RootGetDeviceStatusW,
    RootRunControlPanelW,
    RootInitializeW,
    RootFindDeviceW,
    reinterpret_cast<HRESULT(STDMETHODCALLTYPE *)(
        IDirectInput8W *, LPCWSTR, DIACTIONFORMATW *,
        LPDIENUMDEVICESBYSEMANTICSCBW, void *, DWORD)>(RootEnumBySemanticsW),
    RootConfigureW,
};

} // namespace

extern "C" HRESULT WINAPI DirectInput8Create(HINSTANCE, DWORD version,
                                             REFIID iid, void **output,
                                             IUnknown *outer) {
  InterlockedIncrement(&g_direct_input_create_calls);
  if (output == nullptr)
    return E_POINTER;
  *output = nullptr;
  if (outer != nullptr)
    return CLASS_E_NOAGGREGATION;
  if (version != DIRECTINPUT_VERSION)
    return DIERR_OLDDIRECTINPUTVERSION;
  auto *root = new (std::nothrow) RootObject;
  if (root == nullptr)
    return DIERR_OUTOFMEMORY;
  root->a.lpVtbl = &g_root_vtable_a;
  root->w.lpVtbl = &g_root_vtable_w;
  if (IsEqualIID(iid, IID_IDirectInput8A)) {
    *output = &root->a;
  } else if (IsEqualIID(iid, IID_IDirectInput8W)) {
    *output = &root->w;
  } else {
    delete root;
    return DIERR_NOINTERFACE;
  }
  InterlockedIncrement(&g_live_roots);
  InterlockedIncrement(&g_total_references);
  return DI_OK;
}

extern "C" BOOL WINAPI GameHubSyntheticDiGetProviderSnapshot(
    ProviderSnapshot *output, DWORD output_size) {
  if (output == nullptr || output_size != sizeof(*output))
    return FALSE;
  ProviderSnapshot snapshot{};
  snapshot.structSize = sizeof(snapshot);
  snapshot.schemaVersion = kSchemaVersion;
  snapshot.directInput8CreateCalls = AtomicRead(&g_direct_input_create_calls);
  snapshot.rootCreateDeviceCallsA = AtomicRead(&g_root_create_calls_a);
  snapshot.rootCreateDeviceCallsW = AtomicRead(&g_root_create_calls_w);
  snapshot.getDeviceStateCalls = AtomicRead(&g_get_state_calls);
  snapshot.getDeviceDataCalls = AtomicRead(&g_get_data_calls);
  snapshot.nullInfiniteDrainCalls = AtomicRead(&g_null_infinite_drain_calls);
  snapshot.pollCalls = AtomicRead(&g_poll_calls);
  snapshot.acquireCalls = AtomicRead(&g_acquire_calls);
  snapshot.unacquireCalls = AtomicRead(&g_unacquire_calls);
  snapshot.setDataFormatCalls = AtomicRead(&g_set_format_calls);
  snapshot.setCooperativeLevelCalls = AtomicRead(&g_set_coop_calls);
  snapshot.setActionMapCalls = AtomicRead(&g_set_action_map_calls);
  snapshot.setEventNotificationCalls = AtomicRead(&g_set_event_calls);
  snapshot.liveRootObjects = AtomicRead(&g_live_roots);
  snapshot.liveDeviceObjects = AtomicRead(&g_live_devices);
  snapshot.totalReferences = AtomicRead(&g_total_references);
  snapshot.queuedEvents = AtomicRead(&g_queued_events);
  snapshot.pollGeneration = AtomicRead(&g_poll_generation);
  snapshot.physicalNeutral = AtomicRead(&g_physical_neutral);
  snapshot.nextDataResult =
      static_cast<HRESULT>(AtomicRead(&g_next_data_result));
  *output = snapshot;
  return TRUE;
}

extern "C" BOOL WINAPI GameHubSyntheticDiSetPhysical(BOOL neutral,
                                                     DWORD queued_events,
                                                     HRESULT next_data_result) {
  if (queued_events > 1024u)
    return FALSE;
  InterlockedExchange(&g_physical_neutral, neutral ? TRUE : FALSE);
  InterlockedExchange(&g_queued_events, static_cast<LONG>(queued_events));
  InterlockedExchange(&g_next_data_result, next_data_result);
  return TRUE;
}

extern "C" BOOL WINAPI GameHubSyntheticDiSetActionMapResult(HRESULT result) {
  InterlockedExchange(&g_set_action_map_result, result);
  return TRUE;
}

extern "C" BOOL WINAPI GameHubSyntheticDiSetRange(LPUNKNOWN device,
                                                  DWORD offset, LONG minimum,
                                                  LONG maximum) {
  if (device == nullptr || minimum >= maximum)
    return FALSE;
  auto *interface_a = reinterpret_cast<IDirectInputDevice8A *>(device);
  if (interface_a->lpVtbl != &g_device_vtable_a)
    return FALSE;
  RangeEntry *range = FindRange(FromA(interface_a), offset);
  if (range == nullptr)
    return FALSE;
  range->minimum = minimum;
  range->maximum = maximum;
  return TRUE;
}

extern "C" LPCDIDATAFORMAT WINAPI
GameHubSyntheticDiGetFormat(FormatKind format_kind) {
  switch (format_kind) {
  case FormatKind::kKeyboard:
    return &c_dfDIKeyboard;
  case FormatKind::kMouse:
    return &c_dfDIMouse;
  case FormatKind::kMouse2:
    return &c_dfDIMouse2;
  case FormatKind::kJoystick:
    return &c_dfDIJoystick;
  case FormatKind::kJoystick2:
    return &c_dfDIJoystick2;
  default:
    return nullptr;
  }
}
