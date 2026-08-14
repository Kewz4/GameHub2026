#include <windows.h>
#include <shellapi.h>

#include <cstdint>

namespace {

constexpr wchar_t kMarkerName[] = L"gamehub-overlay-qa-marker64.dll";
constexpr DWORD kExpectedMarkerMagic = 0x47485141;
constexpr SIZE_T kJsonCapacity = 512 * 1024;

using MarkerMagicFunction = DWORD(WINAPI*)();

struct Buffer {
  char* data;
  SIZE_T size;
  SIZE_T capacity;
  bool valid;
};

void AppendBytes(Buffer* output, const char* value, SIZE_T length) {
  if (!output->valid || length > output->capacity - output->size) {
    output->valid = false;
    return;
  }
  for (SIZE_T index = 0; index < length; ++index) {
    output->data[output->size + index] = value[index];
  }
  output->size += length;
}

void AppendLiteral(Buffer* output, const char* value) {
  SIZE_T length = 0;
  while (value[length] != '\0') ++length;
  AppendBytes(output, value, length);
}

void AppendUnsigned(Buffer* output, std::uint64_t value) {
  char digits[32];
  SIZE_T count = 0;
  do {
    digits[count++] = static_cast<char>('0' + value % 10);
    value /= 10;
  } while (value != 0);
  while (count > 0) {
    --count;
    AppendBytes(output, &digits[count], 1);
  }
}

void AppendHexQuad(Buffer* output, unsigned value) {
  static constexpr char kHex[] = "0123456789abcdef";
  char encoded[6] = {
      '\\', 'u', '0', '0', kHex[(value >> 4) & 0xf], kHex[value & 0xf]};
  AppendBytes(output, encoded, sizeof(encoded));
}

void AppendJsonWideString(Buffer* output, const wchar_t* value) {
  AppendLiteral(output, "\"");
  for (SIZE_T index = 0; value[index] != L'\0'; ++index) {
    const wchar_t character = value[index];
    switch (character) {
      case L'"':
        AppendLiteral(output, "\\\"");
        continue;
      case L'\\':
        AppendLiteral(output, "\\\\");
        continue;
      case L'\b':
        AppendLiteral(output, "\\b");
        continue;
      case L'\f':
        AppendLiteral(output, "\\f");
        continue;
      case L'\n':
        AppendLiteral(output, "\\n");
        continue;
      case L'\r':
        AppendLiteral(output, "\\r");
        continue;
      case L'\t':
        AppendLiteral(output, "\\t");
        continue;
      default:
        break;
    }
    if (character < 0x20) {
      AppendHexQuad(output, static_cast<unsigned>(character));
      continue;
    }

    int code_units = 1;
    if (character >= 0xd800 && character <= 0xdbff &&
        value[index + 1] >= 0xdc00 && value[index + 1] <= 0xdfff) {
      code_units = 2;
    }
    char encoded[8];
    const int bytes = WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS,
                                          value + index, code_units, encoded,
                                          sizeof(encoded), nullptr, nullptr);
    if (bytes <= 0) {
      output->valid = false;
      return;
    }
    AppendBytes(output, encoded, static_cast<SIZE_T>(bytes));
    if (code_units == 2) ++index;
  }
  AppendLiteral(output, "\"");
}

bool WideEquals(const wchar_t* left, const wchar_t* right) {
  SIZE_T index = 0;
  while (left[index] != L'\0' && right[index] != L'\0') {
    if (left[index] != right[index]) return false;
    ++index;
  }
  return left[index] == right[index];
}

wchar_t* CanonicalExecutablePath(HANDLE heap) {
  wchar_t* queried = static_cast<wchar_t*>(
      HeapAlloc(heap, HEAP_ZERO_MEMORY, 32'768 * sizeof(wchar_t)));
  wchar_t* canonical = static_cast<wchar_t*>(
      HeapAlloc(heap, HEAP_ZERO_MEMORY, 32'768 * sizeof(wchar_t)));
  if (queried == nullptr || canonical == nullptr) {
    if (queried != nullptr) HeapFree(heap, 0, queried);
    if (canonical != nullptr) HeapFree(heap, 0, canonical);
    return nullptr;
  }

  DWORD queried_length = 32'768;
  if (!QueryFullProcessImageNameW(GetCurrentProcess(), 0, queried,
                                  &queried_length)) {
    HeapFree(heap, 0, queried);
    HeapFree(heap, 0, canonical);
    return nullptr;
  }
  HANDLE image =
      CreateFileW(queried, FILE_READ_ATTRIBUTES,
                  FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
                  nullptr, OPEN_EXISTING, 0, nullptr);
  HeapFree(heap, 0, queried);
  if (image == INVALID_HANDLE_VALUE) {
    HeapFree(heap, 0, canonical);
    return nullptr;
  }
  const DWORD canonical_length = GetFinalPathNameByHandleW(
      image, canonical, 32'768, FILE_NAME_NORMALIZED | VOLUME_NAME_DOS);
  CloseHandle(image);
  if (canonical_length == 0 || canonical_length >= 32'768) {
    HeapFree(heap, 0, canonical);
    return nullptr;
  }

  if (canonical[0] == L'\\' && canonical[1] == L'\\' && canonical[2] == L'?' &&
      canonical[3] == L'\\') {
    SIZE_T source = 4;
    SIZE_T destination = 0;
    while (canonical[source] != L'\0') {
      canonical[destination++] = canonical[source++];
    }
    canonical[destination] = L'\0';
  }
  return canonical;
}

std::uint64_t CurrentCreationTicks() {
  FILETIME creation;
  FILETIME exit;
  FILETIME kernel;
  FILETIME user;
  creation.dwLowDateTime = creation.dwHighDateTime = 0;
  if (!GetProcessTimes(GetCurrentProcess(), &creation, &exit, &kernel, &user)) {
    return 0;
  }
  ULARGE_INTEGER ticks;
  ticks.LowPart = creation.dwLowDateTime;
  ticks.HighPart = creation.dwHighDateTime;
  return ticks.QuadPart;
}

[[noreturn]] void Finish(DWORD exit_code) { ExitProcess(exit_code); }

}  // namespace

extern "C" void WINAPI GameHubFixtureEntry() {
  // These are deliberately the first observable application operations. The
  // fixture uses a custom PE entry point and no CRT startup, so this proves the
  // marker was loader-imported before any fixture application code executed.
  HMODULE marker = GetModuleHandleW(kMarkerName);
  MarkerMagicFunction marker_magic_function =
      marker == nullptr ? nullptr
                        : reinterpret_cast<MarkerMagicFunction>(GetProcAddress(
                              marker, "GameHubOverlayQaMarkerMagic"));
  const DWORD marker_magic =
      marker_magic_function == nullptr ? 0 : marker_magic_function();
  const bool marker_loaded_before_entry =
      marker != nullptr && marker_magic == kExpectedMarkerMagic;

  int argument_count = 0;
  wchar_t** arguments = CommandLineToArgvW(GetCommandLineW(), &argument_count);
  if (arguments == nullptr || argument_count < 4 ||
      !WideEquals(arguments[1], L"--result") ||
      !WideEquals(arguments[3], L"--")) {
    if (arguments != nullptr) LocalFree(arguments);
    Finish(20);
  }

  HANDLE heap = GetProcessHeap();
  wchar_t* canonical_executable = CanonicalExecutablePath(heap);
  char* json_memory =
      static_cast<char*>(HeapAlloc(heap, HEAP_ZERO_MEMORY, kJsonCapacity));
  if (canonical_executable == nullptr || json_memory == nullptr) {
    if (canonical_executable != nullptr)
      HeapFree(heap, 0, canonical_executable);
    if (json_memory != nullptr) HeapFree(heap, 0, json_memory);
    LocalFree(arguments);
    Finish(21);
  }

  Buffer output{json_memory, 0, kJsonCapacity, true};
  AppendLiteral(&output, "{\"schemaVersion\":1,\"entryReached\":true,");
  AppendLiteral(&output, "\"markerLoadedBeforeEntry\":");
  AppendLiteral(&output, marker_loaded_before_entry ? "true" : "false");
  AppendLiteral(&output, ",\"markerMagic\":");
  AppendUnsigned(&output, marker_magic);
  AppendLiteral(&output, ",\"pid\":");
  AppendUnsigned(&output, GetCurrentProcessId());
  AppendLiteral(&output, ",\"creationTicks\":\"");
  AppendUnsigned(&output, CurrentCreationTicks());
  AppendLiteral(&output, "\",\"canonicalExecutablePath\":");
  AppendJsonWideString(&output, canonical_executable);
  AppendLiteral(&output, ",\"args\":[");
  for (int index = 4; index < argument_count; ++index) {
    if (index != 4) AppendLiteral(&output, ",");
    AppendJsonWideString(&output, arguments[index]);
  }
  AppendLiteral(&output, "]}\n");

  DWORD exit_code = 0;
  if (!output.valid) {
    exit_code = 22;
  } else {
    HANDLE result =
        CreateFileW(arguments[2], GENERIC_WRITE, 0, nullptr, CREATE_NEW,
                    FILE_ATTRIBUTE_NORMAL | FILE_FLAG_WRITE_THROUGH, nullptr);
    if (result == INVALID_HANDLE_VALUE) {
      exit_code = 23;
    } else {
      DWORD written = 0;
      if (output.size > MAXDWORD ||
          !WriteFile(result, output.data, static_cast<DWORD>(output.size),
                     &written, nullptr) ||
          written != output.size || !FlushFileBuffers(result)) {
        exit_code = 24;
      }
      CloseHandle(result);
    }
  }
  if (!marker_loaded_before_entry && exit_code == 0) exit_code = 25;

  HeapFree(heap, 0, canonical_executable);
  HeapFree(heap, 0, json_memory);
  LocalFree(arguments);
  Finish(exit_code);
}
