#pragma once

#include <cstring>

namespace MqttSecurity {
constexpr const char* DEFAULT_HOST = "mqtt.checkmytemp.com";
constexpr int DEFAULT_PORT = 8883;
constexpr long long MIN_TLS_EPOCH = 1767225600LL;

inline bool validHostname(const char* host) {
  if (!host) return false;
  const size_t length = std::strlen(host);
  if (length == 0 || length > 253) return false;
  size_t labelLength = 0;
  bool hasDot = false;
  bool hasLetter = false;
  for (size_t i = 0; i < length; i++) {
    const char ch = host[i];
    const bool letter = (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z');
    if (ch == '.') {
      if (labelLength == 0 || host[i - 1] == '-') return false;
      labelLength = 0;
      hasDot = true;
    } else {
      if (!letter && !(ch >= '0' && ch <= '9') && ch != '-') return false;
      if (labelLength == 0 && ch == '-') return false;
      if (++labelLength > 63) return false;
      hasLetter = hasLetter || letter;
    }
  }
  return hasDot && hasLetter && labelLength > 0 && host[length - 1] != '-';
}

inline bool validPort(int port) {
  return port > 0 && port <= 65535 && port != 1883;
}

inline bool clockReady(long long epoch) {
  return epoch >= MIN_TLS_EPOCH;
}

inline bool isTlsFailure(int code) {
  // A successful ESP32 handshake can leave a positive socket descriptor in lastError().
  return code < 0;
}

inline bool isBrokerRejection(int state) {
  return state >= 1 && state <= 5;
}

inline bool parseLanAddress(const char* value, unsigned char (&address)[4]) {
  if (!value || std::strlen(value) == 0 || std::strlen(value) > 15) return false;
  unsigned char parsed[4];
  const char* cursor = value;
  for (int i = 0; i < 4; i++) {
    const char* start = cursor;
    unsigned int octet = 0;
    while (*cursor >= '0' && *cursor <= '9') {
      octet = octet * 10 + (*cursor++ - '0');
      if (octet > 255 || cursor - start > 3) return false;
    }
    if (cursor == start || (cursor - start > 1 && *start == '0')) return false;
    parsed[i] = static_cast<unsigned char>(octet);
    if (i < 3) {
      if (*cursor++ != '.') return false;
    } else if (*cursor != '\0') {
      return false;
    }
  }
  const bool privateAddress = parsed[0] == 10 ||
    (parsed[0] == 172 && parsed[1] >= 16 && parsed[1] <= 31) ||
    (parsed[0] == 192 && parsed[1] == 168);
  if (!privateAddress) return false;
  for (int i = 0; i < 4; i++) address[i] = parsed[i];
  return true;
}

inline bool usesLanDestination(const char* host, const char* primaryHost, const char* lanIp) {
  return host && primaryHost && lanIp && lanIp[0] != '\0' && std::strcmp(host, primaryHost) == 0;
}
}
