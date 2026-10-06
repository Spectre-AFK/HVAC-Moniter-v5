#include "../mqtt_security.h"
#include <cassert>
#include <string>

int main() {
  for (const char* host : {"mqtt.checkmytemp.com", "fallback.example.com", "MQTT.Example.COM", "a-b.example.com"}) {
    assert(MqttSecurity::validHostname(host));
  }
  for (const char* host : {"", "localhost", "127.0.0.1", "::1", "[::1]", "mqtts://mqtt.example.com",
      "mqtt.example.com:8883", "mqtt.example.com/path", " mqtt.example.com", ".example.com",
      "mqtt..example.com", "mqtt.example.com.", "-mqtt.example.com", "mqtt-.example.com",
      "mqtt_example.com", "*.example.com"}) {
    assert(!MqttSecurity::validHostname(host));
  }
  assert(!MqttSecurity::validHostname(nullptr));
  assert(!MqttSecurity::validHostname((std::string(64, 'a') + ".example.com").c_str()));
  const std::string maxHost = std::string(63, 'a') + "." + std::string(63, 'b') + "." +
    std::string(63, 'c') + "." + std::string(61, 'd');
  assert(maxHost.length() == 253 && MqttSecurity::validHostname(maxHost.c_str()));
  assert(!MqttSecurity::validHostname((maxHost + "d").c_str()));
  assert(MqttSecurity::validPort(8883));
  assert(MqttSecurity::validPort(8884));
  assert(!MqttSecurity::validPort(1883));
  assert(!MqttSecurity::validPort(0));
  assert(!MqttSecurity::validPort(-1));
  assert(!MqttSecurity::validPort(65536));
  assert(!MqttSecurity::clockReady(MqttSecurity::MIN_TLS_EPOCH - 1));
  assert(MqttSecurity::clockReady(MqttSecurity::MIN_TLS_EPOCH));
  assert(MqttSecurity::isTlsFailure(-1));
  assert(MqttSecurity::isTlsFailure(-9984));
  assert(!MqttSecurity::isTlsFailure(0));
  assert(!MqttSecurity::isTlsFailure(48));
  for (int state : {1, 2, 3, 4, 5}) assert(MqttSecurity::isBrokerRejection(state));
  for (int state : {-4, -3, -2, -1, 0, 6, 48}) assert(!MqttSecurity::isBrokerRejection(state));
  unsigned char address[4];
  for (const char* ip : {"192.168.0.132", "192.168.255.254", "10.0.0.1", "10.255.255.254",
      "172.16.0.1", "172.31.255.254"}) {
    assert(MqttSecurity::parseLanAddress(ip, address));
  }
  assert(MqttSecurity::parseLanAddress("192.168.0.132", address));
  assert(address[0] == 192 && address[1] == 168 && address[2] == 0 && address[3] == 132);
  for (const char* ip : {"", "localhost", "mqtt.checkmytemp.com", "68.106.32.49", "127.0.0.1",
      "0.0.0.0", "169.254.1.1", "172.15.255.255", "172.32.0.1", "192.169.0.1",
      "192.168.0.256", "192.168.0", "192.168.0.132.", "192.168..132", "192.168.0.132:8883",
      " 192.168.0.132", "192.168.0.132 ", "192.168.00.132", "192.168.0.-1", "::1"}) {
    assert(!MqttSecurity::parseLanAddress(ip, address));
  }
  assert(!MqttSecurity::parseLanAddress(nullptr, address));
  assert(MqttSecurity::usesLanDestination("mqtt.checkmytemp.com", "mqtt.checkmytemp.com", "192.168.0.132"));
  assert(!MqttSecurity::usesLanDestination("fallback.example.com", "mqtt.checkmytemp.com", "192.168.0.132"));
  assert(!MqttSecurity::usesLanDestination("mqtt.checkmytemp.com", "mqtt.checkmytemp.com", ""));
  assert(!MqttSecurity::usesLanDestination(nullptr, "mqtt.checkmytemp.com", "192.168.0.132"));
}
