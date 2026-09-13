#pragma once

#include <windows.h>

#include <cstdint>
#include <map>
#include <string>
#include <vector>

namespace gamehub::overlay::qa {

enum class LineReadStatus {
  kLine,
  kEof,
  kTimeout,
  kTooLong,
  kIoError,
};

class PipeLineReader {
 public:
  explicit PipeLineReader(HANDLE pipe) : pipe_(pipe) {}

  LineReadStatus ReadLine(DWORD timeout_ms, std::string* line,
                          DWORD* win32_error);

 private:
  HANDLE pipe_;
  std::string pending_;
};

struct JsonValue {
  enum class Type { kNull, kBoolean, kInteger, kString, kArray, kObject };

  Type type = Type::kNull;
  bool boolean = false;
  std::int64_t integer = 0;
  std::string string;
  std::vector<JsonValue> array;
  std::map<std::string, JsonValue> object;
};

bool ParseJson(const std::string& input, JsonValue* output, std::string* error);

std::string JsonEscape(const std::string& input);
std::wstring Utf8ToWide(const std::string& input);
std::string WideToUtf8(const std::wstring& input);
std::wstring QuoteWindowsArgument(const std::wstring& argument);
std::wstring BuildCommandLine(const std::wstring& executable,
                              const std::vector<std::wstring>& arguments);

}  // namespace gamehub::overlay::qa
