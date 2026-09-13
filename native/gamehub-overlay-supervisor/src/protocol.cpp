#include "protocol.hpp"

#include <algorithm>
#include <charconv>
#include <limits>
#include <stdexcept>
#include <string_view>

namespace gamehub::overlay::qa {
namespace {

constexpr std::size_t kMaximumFrameBytes = 64 * 1024;
constexpr int kMaximumJsonDepth = 16;

void AppendUtf8(std::uint32_t code_point, std::string* output) {
  if (code_point <= 0x7f) {
    output->push_back(static_cast<char>(code_point));
  } else if (code_point <= 0x7ff) {
    output->push_back(static_cast<char>(0xc0 | (code_point >> 6)));
    output->push_back(static_cast<char>(0x80 | (code_point & 0x3f)));
  } else if (code_point <= 0xffff) {
    output->push_back(static_cast<char>(0xe0 | (code_point >> 12)));
    output->push_back(static_cast<char>(0x80 | ((code_point >> 6) & 0x3f)));
    output->push_back(static_cast<char>(0x80 | (code_point & 0x3f)));
  } else {
    output->push_back(static_cast<char>(0xf0 | (code_point >> 18)));
    output->push_back(static_cast<char>(0x80 | ((code_point >> 12) & 0x3f)));
    output->push_back(static_cast<char>(0x80 | ((code_point >> 6) & 0x3f)));
    output->push_back(static_cast<char>(0x80 | (code_point & 0x3f)));
  }
}

class JsonParser {
 public:
  explicit JsonParser(std::string_view input) : input_(input) {}

  bool Parse(JsonValue* output, std::string* error) {
    SkipWhitespace();
    if (!ParseValue(0, output)) {
      *error = error_;
      return false;
    }
    SkipWhitespace();
    if (position_ != input_.size()) {
      *error = "trailing JSON data";
      return false;
    }
    return true;
  }

 private:
  bool ParseValue(int depth, JsonValue* output) {
    if (depth > kMaximumJsonDepth) return Fail("JSON nesting is too deep");
    if (position_ >= input_.size()) return Fail("unexpected end of JSON");

    const char next = input_[position_];
    if (next == '"') {
      output->type = JsonValue::Type::kString;
      return ParseString(&output->string);
    }
    if (next == '{') return ParseObject(depth, output);
    if (next == '[') return ParseArray(depth, output);
    if (next == '-' || (next >= '0' && next <= '9')) {
      return ParseInteger(output);
    }
    if (ConsumeLiteral("true")) {
      output->type = JsonValue::Type::kBoolean;
      output->boolean = true;
      return true;
    }
    if (ConsumeLiteral("false")) {
      output->type = JsonValue::Type::kBoolean;
      output->boolean = false;
      return true;
    }
    if (ConsumeLiteral("null")) {
      output->type = JsonValue::Type::kNull;
      return true;
    }
    return Fail("unsupported JSON token");
  }

  bool ParseObject(int depth, JsonValue* output) {
    ++position_;
    output->type = JsonValue::Type::kObject;
    SkipWhitespace();
    if (Consume('}')) return true;

    while (true) {
      std::string key;
      if (!ParseString(&key)) return false;
      SkipWhitespace();
      if (!Consume(':')) return Fail("expected ':' after object key");
      SkipWhitespace();
      JsonValue value;
      if (!ParseValue(depth + 1, &value)) return false;
      if (!output->object.emplace(key, std::move(value)).second) {
        return Fail("duplicate object key");
      }
      SkipWhitespace();
      if (Consume('}')) return true;
      if (!Consume(',')) return Fail("expected ',' or '}' in object");
      SkipWhitespace();
    }
  }

  bool ParseArray(int depth, JsonValue* output) {
    ++position_;
    output->type = JsonValue::Type::kArray;
    SkipWhitespace();
    if (Consume(']')) return true;

    while (true) {
      JsonValue value;
      if (!ParseValue(depth + 1, &value)) return false;
      output->array.push_back(std::move(value));
      SkipWhitespace();
      if (Consume(']')) return true;
      if (!Consume(',')) return Fail("expected ',' or ']' in array");
      SkipWhitespace();
    }
  }

  bool ParseString(std::string* output) {
    if (!Consume('"')) return Fail("expected JSON string");
    output->clear();
    while (position_ < input_.size()) {
      const unsigned char current =
          static_cast<unsigned char>(input_[position_++]);
      if (current == '"') return true;
      if (current < 0x20) return Fail("control character in JSON string");
      if (current != '\\') {
        output->push_back(static_cast<char>(current));
        continue;
      }
      if (position_ >= input_.size()) return Fail("truncated JSON escape");
      const char escaped = input_[position_++];
      switch (escaped) {
        case '"':
        case '\\':
        case '/':
          output->push_back(escaped);
          break;
        case 'b':
          output->push_back('\b');
          break;
        case 'f':
          output->push_back('\f');
          break;
        case 'n':
          output->push_back('\n');
          break;
        case 'r':
          output->push_back('\r');
          break;
        case 't':
          output->push_back('\t');
          break;
        case 'u': {
          std::uint32_t first = 0;
          if (!ParseHexQuad(&first)) return false;
          std::uint32_t code_point = first;
          if (first >= 0xd800 && first <= 0xdbff) {
            if (position_ + 2 > input_.size() || input_[position_] != '\\' ||
                input_[position_ + 1] != 'u') {
              return Fail("high surrogate without low surrogate");
            }
            position_ += 2;
            std::uint32_t second = 0;
            if (!ParseHexQuad(&second)) return false;
            if (second < 0xdc00 || second > 0xdfff) {
              return Fail("invalid low surrogate");
            }
            code_point = 0x10000 + ((first - 0xd800) << 10) + (second - 0xdc00);
          } else if (first >= 0xdc00 && first <= 0xdfff) {
            return Fail("unexpected low surrogate");
          }
          AppendUtf8(code_point, output);
          break;
        }
        default:
          return Fail("invalid JSON escape");
      }
    }
    return Fail("unterminated JSON string");
  }

  bool ParseHexQuad(std::uint32_t* value) {
    if (position_ + 4 > input_.size()) return Fail("truncated unicode escape");
    *value = 0;
    for (int index = 0; index < 4; ++index) {
      const char digit = input_[position_++];
      *value <<= 4;
      if (digit >= '0' && digit <= '9') {
        *value += digit - '0';
      } else if (digit >= 'a' && digit <= 'f') {
        *value += 10 + digit - 'a';
      } else if (digit >= 'A' && digit <= 'F') {
        *value += 10 + digit - 'A';
      } else {
        return Fail("invalid unicode escape");
      }
    }
    return true;
  }

  bool ParseInteger(JsonValue* output) {
    const std::size_t start = position_;
    if (input_[position_] == '-') ++position_;
    if (position_ >= input_.size()) return Fail("truncated integer");
    if (input_[position_] == '0') {
      ++position_;
      if (position_ < input_.size() && input_[position_] >= '0' &&
          input_[position_] <= '9') {
        return Fail("leading zero in integer");
      }
    } else {
      if (input_[position_] < '1' || input_[position_] > '9') {
        return Fail("invalid integer");
      }
      while (position_ < input_.size() && input_[position_] >= '0' &&
             input_[position_] <= '9') {
        ++position_;
      }
    }
    const std::string_view token = input_.substr(start, position_ - start);
    std::int64_t value = 0;
    const auto result =
        std::from_chars(token.data(), token.data() + token.size(), value);
    if (result.ec != std::errc() || result.ptr != token.data() + token.size()) {
      return Fail("integer is out of range");
    }
    output->type = JsonValue::Type::kInteger;
    output->integer = value;
    return true;
  }

  bool ConsumeLiteral(std::string_view literal) {
    if (input_.substr(position_, literal.size()) != literal) return false;
    position_ += literal.size();
    return true;
  }

  bool Consume(char expected) {
    if (position_ >= input_.size() || input_[position_] != expected) {
      return false;
    }
    ++position_;
    return true;
  }

  void SkipWhitespace() {
    while (position_ < input_.size()) {
      const char current = input_[position_];
      if (current != ' ' && current != '\t' && current != '\r' &&
          current != '\n') {
        return;
      }
      ++position_;
    }
  }

  bool Fail(const char* message) {
    if (error_.empty()) error_ = message;
    return false;
  }

  std::string_view input_;
  std::size_t position_ = 0;
  std::string error_;
};

}  // namespace

LineReadStatus PipeLineReader::ReadLine(DWORD timeout_ms, std::string* line,
                                        DWORD* win32_error) {
  const ULONGLONG deadline = GetTickCount64() + timeout_ms;
  *win32_error = ERROR_SUCCESS;
  line->clear();

  while (true) {
    const std::size_t newline = pending_.find('\n');
    if (newline != std::string::npos) {
      *line = pending_.substr(0, newline);
      pending_.erase(0, newline + 1);
      if (!line->empty() && line->back() == '\r') line->pop_back();
      return LineReadStatus::kLine;
    }
    if (pending_.size() > kMaximumFrameBytes) {
      return LineReadStatus::kTooLong;
    }

    DWORD available = 0;
    if (!PeekNamedPipe(pipe_, nullptr, 0, nullptr, &available, nullptr)) {
      *win32_error = GetLastError();
      if (*win32_error == ERROR_BROKEN_PIPE ||
          *win32_error == ERROR_PIPE_NOT_CONNECTED) {
        return LineReadStatus::kEof;
      }
      return LineReadStatus::kIoError;
    }

    if (available > 0) {
      char buffer[4096];
      const DWORD requested =
          std::min<DWORD>(available, static_cast<DWORD>(sizeof(buffer)));
      DWORD read = 0;
      if (!ReadFile(pipe_, buffer, requested, &read, nullptr)) {
        *win32_error = GetLastError();
        if (*win32_error == ERROR_BROKEN_PIPE) return LineReadStatus::kEof;
        return LineReadStatus::kIoError;
      }
      if (read == 0) return LineReadStatus::kEof;
      pending_.append(buffer, read);
      continue;
    }

    if (GetTickCount64() >= deadline) return LineReadStatus::kTimeout;
    Sleep(5);
  }
}

bool ParseJson(const std::string& input, JsonValue* output,
               std::string* error) {
  return JsonParser(input).Parse(output, error);
}

std::string JsonEscape(const std::string& input) {
  static constexpr char kHex[] = "0123456789abcdef";
  std::string escaped;
  escaped.reserve(input.size() + 8);
  for (const unsigned char character : input) {
    switch (character) {
      case '"':
        escaped += "\\\"";
        break;
      case '\\':
        escaped += "\\\\";
        break;
      case '\b':
        escaped += "\\b";
        break;
      case '\f':
        escaped += "\\f";
        break;
      case '\n':
        escaped += "\\n";
        break;
      case '\r':
        escaped += "\\r";
        break;
      case '\t':
        escaped += "\\t";
        break;
      default:
        if (character < 0x20) {
          escaped += "\\u00";
          escaped.push_back(kHex[character >> 4]);
          escaped.push_back(kHex[character & 0x0f]);
        } else {
          escaped.push_back(static_cast<char>(character));
        }
    }
  }
  return escaped;
}

std::wstring Utf8ToWide(const std::string& input) {
  if (input.empty()) return {};
  if (input.size() >
      static_cast<std::size_t>(std::numeric_limits<int>::max())) {
    throw std::runtime_error("UTF-8 input is too long");
  }
  const int length =
      MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, input.data(),
                          static_cast<int>(input.size()), nullptr, 0);
  if (length <= 0) throw std::runtime_error("invalid UTF-8 input");
  std::wstring output(static_cast<std::size_t>(length), L'\0');
  if (MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, input.data(),
                          static_cast<int>(input.size()), output.data(),
                          length) != length) {
    throw std::runtime_error("UTF-8 conversion failed");
  }
  return output;
}

std::string WideToUtf8(const std::wstring& input) {
  if (input.empty()) return {};
  if (input.size() >
      static_cast<std::size_t>(std::numeric_limits<int>::max())) {
    throw std::runtime_error("UTF-16 input is too long");
  }
  const int length = WideCharToMultiByte(
      CP_UTF8, WC_ERR_INVALID_CHARS, input.data(),
      static_cast<int>(input.size()), nullptr, 0, nullptr, nullptr);
  if (length <= 0) throw std::runtime_error("invalid UTF-16 input");
  std::string output(static_cast<std::size_t>(length), '\0');
  if (WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, input.data(),
                          static_cast<int>(input.size()), output.data(), length,
                          nullptr, nullptr) != length) {
    throw std::runtime_error("UTF-16 conversion failed");
  }
  return output;
}

std::wstring QuoteWindowsArgument(const std::wstring& argument) {
  if (argument.empty()) return L"\"\"";
  if (argument.find_first_of(L" \t\n\v\"") == std::wstring::npos) {
    return argument;
  }

  std::wstring quoted;
  quoted.push_back(L'"');
  std::size_t backslashes = 0;
  for (const wchar_t character : argument) {
    if (character == L'\\') {
      ++backslashes;
      continue;
    }
    if (character == L'"') {
      quoted.append(backslashes * 2 + 1, L'\\');
      quoted.push_back(L'"');
      backslashes = 0;
      continue;
    }
    quoted.append(backslashes, L'\\');
    backslashes = 0;
    quoted.push_back(character);
  }
  quoted.append(backslashes * 2, L'\\');
  quoted.push_back(L'"');
  return quoted;
}

std::wstring BuildCommandLine(const std::wstring& executable,
                              const std::vector<std::wstring>& arguments) {
  std::wstring command_line = QuoteWindowsArgument(executable);
  for (const auto& argument : arguments) {
    command_line.push_back(L' ');
    command_line += QuoteWindowsArgument(argument);
  }
  return command_line;
}

}  // namespace gamehub::overlay::qa
