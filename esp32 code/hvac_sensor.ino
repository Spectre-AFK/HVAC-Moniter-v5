#include <Arduino.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <LittleFS.h>
#include <WiFiManager.h>
#include <ArduinoJson.h>
#include <PubSubClient.h>
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <OneWire.h>
#include <DallasTemperature.h>
#include <time.h>
#include "config.h"
#include "mqtt_security.h"
#include "mqtt_trust.h"

// Initialize Global Config with defaults
Config appConfig = { "mqtt.checkmytemp.com", 8883, "", "", 1, true, "", "" };

// Global Objects
WiFiClientSecure espClient;
PubSubClient mqttClient(espClient);
// Unique per-device identifier (derived from MAC), used as both the MQTT client ID and payload device_id
String deviceId;
Adafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, OLED_RESET);
OneWire oneWireBuses[MAX_SENSORS] = { OneWire(ONE_WIRE_PINS[0]), OneWire(ONE_WIRE_PINS[1]), OneWire(ONE_WIRE_PINS[2]), OneWire(ONE_WIRE_PINS[3]), OneWire(ONE_WIRE_PINS[4]) };
DallasTemperature sensors[MAX_SENSORS] = { DallasTemperature(&oneWireBuses[0]), DallasTemperature(&oneWireBuses[1]), DallasTemperature(&oneWireBuses[2]), DallasTemperature(&oneWireBuses[3]), DallasTemperature(&oneWireBuses[4]) };
// Cache of the latest reading per sensor, shared between the display (refreshed every heartbeat) and MQTT publish (every publishInterval)
float lastTemps[MAX_SENSORS];

// Timers and State Flags
unsigned long lastMsgTime = 0;
unsigned long lastHeartbeatTime = 0;
const long publishInterval = 600000; // Publish every 10 minutes
const long heartbeatInterval = 30000; // Refresh the diagnostic OLED and log a "still alive" line at this cadence
bool shouldSaveConfig = false;
bool sensorReadPending = false;
bool hasSensorReading = false;
bool hasPublished = false;
bool displayReady = false;
unsigned long conversionStartedAt = 0;
unsigned long lastPublishAttempt = 0;

// ---------------------------------------------------------
// FILE SYSTEM HELPER FUNCTIONS
// ---------------------------------------------------------
void saveConfigCallback() {
  Serial.println("Configuration changes detected in portal.");
  shouldSaveConfig = true;
}

void loadConfig() {
  if (LittleFS.begin(true)) { // formatOnFail=true
    if (LittleFS.exists(CONFIG_FILE)) {
      File file = LittleFS.open(CONFIG_FILE, "r");
      if (file) {
        JsonDocument doc;
        if (deserializeJson(doc, file) == DeserializationError::Ok) {
          strlcpy(appConfig.mqtt_server, doc["mqtt_server"] | MqttSecurity::DEFAULT_HOST, sizeof(appConfig.mqtt_server));
          appConfig.mqtt_port = doc["mqtt_port"] | MqttSecurity::DEFAULT_PORT;
          strlcpy(appConfig.mqtt_username, doc["mqtt_username"] | "", sizeof(appConfig.mqtt_username));
          strlcpy(appConfig.mqtt_password, doc["mqtt_password"] | "", sizeof(appConfig.mqtt_password));
          appConfig.sensor_count = doc["sensor_count"] | 1;
          appConfig.has_display = doc["has_display"] | true;
          strlcpy(appConfig.mqtt_fallback_server, doc["mqtt_fallback_server"] | "", sizeof(appConfig.mqtt_fallback_server));
          const char* lanIp = doc["mqtt_lan_ip"] | "";
          if (strlen(lanIp) >= sizeof(appConfig.mqtt_lan_ip) ||
              (!doc["mqtt_lan_ip"].isNull() && !doc["mqtt_lan_ip"].is<const char*>())) {
            Serial.println("Invalid saved LAN destination; reopen setup to correct it.");
            strlcpy(appConfig.mqtt_lan_ip, "invalid", sizeof(appConfig.mqtt_lan_ip));
          } else {
            strlcpy(appConfig.mqtt_lan_ip, lanIp, sizeof(appConfig.mqtt_lan_ip));
          }
          Serial.println("Config loaded from LittleFS");
        } else {
          Serial.println("Invalid config JSON; using defaults.");
        }
        file.close();
      } else {
        Serial.println("Could not open stored config; using defaults.");
      }
    }
  } else {
    Serial.println("LittleFS initialization failed; config cannot be persisted.");
  }
  if (appConfig.sensor_count < 1 || appConfig.sensor_count > MAX_SENSORS) {
    Serial.println("Invalid saved sensor count; clamping to supported range.");
    appConfig.sensor_count = constrain(appConfig.sensor_count, 1, MAX_SENSORS);
  }
  if (appConfig.mqtt_port < 1 || appConfig.mqtt_port > 65535) {
    Serial.println("Invalid saved MQTT port; using TLS port 8883.");
    appConfig.mqtt_port = MqttSecurity::DEFAULT_PORT;
  }
  if (strlen(appConfig.mqtt_server) == 0) {
    Serial.println("Empty saved MQTT server; using local default.");
    strlcpy(appConfig.mqtt_server, MqttSecurity::DEFAULT_HOST, sizeof(appConfig.mqtt_server));
  }
  if (!MqttSecurity::validHostname(appConfig.mqtt_server) || !MqttSecurity::validPort(appConfig.mqtt_port)) {
    Serial.println("Saved MQTT settings are not TLS-compatible. Hold BOOT for setup: use a certificate hostname and TLS port.");
  }
  unsigned char lanAddress[4];
  if (appConfig.mqtt_lan_ip[0] != '\0' && !MqttSecurity::parseLanAddress(appConfig.mqtt_lan_ip, lanAddress)) {
    Serial.println("Saved LAN destination is not a valid private IPv4 address. Hold BOOT to correct it or leave it blank.");
  }
}

void saveConfig() {
  JsonDocument doc;
  doc["mqtt_server"] = appConfig.mqtt_server;
  doc["mqtt_port"] = appConfig.mqtt_port;
  doc["mqtt_username"] = appConfig.mqtt_username;
  doc["mqtt_password"] = appConfig.mqtt_password;
  doc["sensor_count"] = appConfig.sensor_count;
  doc["has_display"] = appConfig.has_display;
  doc["mqtt_fallback_server"] = appConfig.mqtt_fallback_server;
  doc["mqtt_lan_ip"] = appConfig.mqtt_lan_ip;

  const char* temporaryFile = "/config.tmp";
  File file = LittleFS.open(temporaryFile, "w");
  if (file) {
    const size_t expected = measureJson(doc);
    const size_t written = serializeJson(doc, file);
    file.close();
    if (written == expected && LittleFS.rename(temporaryFile, CONFIG_FILE)) {
      Serial.println("Config saved to LittleFS");
    } else {
      Serial.println("Config write failed; prior settings retained.");
      if (!LittleFS.remove(temporaryFile)) Serial.println("Could not clean up temporary config.");
    }
  } else {
    Serial.println("Could not open config for writing; settings are not saved.");
  }
}

// ---------------------------------------------------------
// SENSOR HELPER
// ---------------------------------------------------------
// Reads every configured sensor into lastTemps[]; called on its own cadence so the
// diagnostic display stays fresh independent of the (much slower) MQTT publish interval.
void readAllSensors() {
  if (sensorReadPending) return;
  for (int i = 0; i < appConfig.sensor_count && i < MAX_SENSORS; i++) {
    sensors[i].requestTemperatures();
  }
  conversionStartedAt = millis();
  sensorReadPending = true;
}

void completeSensorRead() {
  if (!sensorReadPending || millis() - conversionStartedAt < 750) return;
  for (int i = 0; i < appConfig.sensor_count && i < MAX_SENSORS; i++) {
    const float reading = sensors[i].getTempCByIndex(0);
    lastTemps[i] = isfinite(reading) && reading >= -55 && reading <= 125 ? reading : DEVICE_DISCONNECTED_C;
  }
  sensorReadPending = false;
  hasSensorReading = true;
  updateDisplay();
}

// ---------------------------------------------------------
// OLED HELPER
// ---------------------------------------------------------
// The screen sits inside the sealed enclosure (not visible in normal use), so it's
// laid out as a diagnostic dump for whoever opens the box, not a pretty at-a-glance readout.
void formatUptime(unsigned long ms, char* buf, size_t bufSize) {
  unsigned long totalSeconds = ms / 1000;
  unsigned long days = totalSeconds / 86400;
  unsigned long hours = (totalSeconds % 86400) / 3600;
  unsigned long minutes = (totalSeconds % 3600) / 60;
  unsigned long seconds = totalSeconds % 60;
  if (days > 0) {
    snprintf(buf, bufSize, "%lud %02lu:%02lu:%02lu", days, hours, minutes, seconds);
  } else {
    snprintf(buf, bufSize, "%02lu:%02lu:%02lu", hours, minutes, seconds);
  }
}

void updateDisplay() {
  if (!appConfig.has_display || !displayReady) return;

  display.clearDisplay();
  display.setTextSize(1);
  display.setTextColor(SSD1306_WHITE);

  display.setCursor(0, 0);
  if (WiFi.status() == WL_CONNECTED) {
    display.println(WiFi.localIP());
  } else {
    display.println("WiFi: disconnected");
  }

  display.setCursor(0, 8);
  display.printf("RSSI:%ddBm MQTT:%s\n", WiFi.RSSI(), mqttClient.connected() ? "OK" : "DOWN");

  char uptimeBuf[24];
  formatUptime(millis(), uptimeBuf, sizeof(uptimeBuf));
  display.setCursor(0, 16);
  display.print("Up: ");
  display.println(uptimeBuf);

  display.setCursor(0, 24);
  display.printf("Heap: %lu KB\n", (unsigned long)(ESP.getFreeHeap() / 1024));

  int lineY = 32;
  for (int i = 0; i < appConfig.sensor_count && i < MAX_SENSORS && lineY <= 56; i += 2) {
    display.setCursor(0, lineY);
    if (lastTemps[i] == DEVICE_DISCONNECTED_C) {
      display.printf("S%d:ERR", i);
    } else {
      display.printf("S%d:%.1fC", i, lastTemps[i]);
    }
    if (i + 1 < appConfig.sensor_count && i + 1 < MAX_SENSORS) {
      display.print(" ");
      if (lastTemps[i + 1] == DEVICE_DISCONNECTED_C) {
        display.printf("S%d:ERR", i + 1);
      } else {
        display.printf("S%d:%.1fC", i + 1, lastTemps[i + 1]);
      }
    }
    display.println();
    lineY += 8;
  }

  display.display();
}

// ---------------------------------------------------------
// STATUS SCREEN
// ---------------------------------------------------------
// Full-screen message for startup phases and setup mode (no-op on boards without an OLED).
void showStatus(const char* title, const char* line1, const char* line2, const char* line3) {
  if (!appConfig.has_display || !displayReady) return;
  display.clearDisplay();
  display.setTextColor(SSD1306_WHITE);
  display.setTextSize(2);
  display.setCursor(0, 0);
  display.println(title);
  display.setTextSize(1);
  display.setCursor(0, 24);
  display.println(line1);
  display.println(line2);
  display.println(line3);
  display.display();
}

// ---------------------------------------------------------
// CONFIG PORTAL
// ---------------------------------------------------------
// forcePortal=false: portal only opens if saved WiFi can't connect (normal boot).
// forcePortal=true: portal opens on demand (button hold) so MQTT/sensor settings can be changed later.
void runConfigPortal(bool forcePortal) {
  WiFiManager wm;
  wm.setSaveConfigCallback(saveConfigCallback);
  wm.setSaveParamsCallback(saveConfigCallback);
  wm.setConfigPortalTimeout(180);

  WiFiManagerParameter custom_mqtt_server("server", "MQTT TLS hostname (not an IP or URL)", appConfig.mqtt_server, 253);
  WiFiManagerParameter custom_mqtt_fallback("fallback", "MQTT fallback TLS hostname (blank if none)", appConfig.mqtt_fallback_server, 253);
  WiFiManagerParameter custom_mqtt_lan_ip("lan_ip", "MQTT LAN destination IPv4 (optional, primary only)", appConfig.mqtt_lan_ip, 15);

  char portStr[6];
  itoa(appConfig.mqtt_port, portStr, 10);
  WiFiManagerParameter custom_mqtt_port("port", "MQTT TLS port (normally 8883; not 1883)", portStr, 5);

  WiFiManagerParameter custom_mqtt_username("mqtt_user", "MQTT Username (required)", appConfig.mqtt_username, 31);
  WiFiManagerParameter custom_mqtt_password("mqtt_pass", "MQTT Password (required)", appConfig.mqtt_password, 31,
    "type=\"password\"");

  char countStr[4];
  itoa(appConfig.sensor_count, countStr, 10);
  WiFiManagerParameter custom_sensor_count("count", "Sensor Count (1-5)", countStr, 4);

  char displayStr[2];
  itoa(appConfig.has_display ? 1 : 0, displayStr, 10);
  WiFiManagerParameter custom_has_display("display", "Has OLED Display (1=yes, 0=no)", displayStr, 2);

  wm.addParameter(&custom_mqtt_server);
  wm.addParameter(&custom_mqtt_lan_ip);
  wm.addParameter(&custom_mqtt_fallback);
  wm.addParameter(&custom_mqtt_port);
  wm.addParameter(&custom_mqtt_username);
  wm.addParameter(&custom_mqtt_password);
  wm.addParameter(&custom_sensor_count);
  wm.addParameter(&custom_has_display);

  shouldSaveConfig = false;

  // Fires whenever the setup access point comes up, both on-demand and when saved WiFi fails at boot
  wm.setAPCallback([](WiFiManager*) {
    showStatus("WiFi Setup", "ACTIVE", "Join: Sensor WiFi Setup", "Open 192.168.4.1");
  });

  if (forcePortal) {
    // Time out so a stray button press doesn't leave a running sensor stuck in setup mode
    wm.setConfigPortalTimeout(180);
    wm.startConfigPortal("Sensor WiFi Setup");
  } else if (!wm.autoConnect("Sensor WiFi Setup")) {
    Serial.println("Failed to connect and hit timeout");
    delay(3000);
    ESP.restart();
  }

  if (shouldSaveConfig) {
    const char* lanIp = custom_mqtt_lan_ip.getValue();
    unsigned char lanAddress[4];
    if (lanIp[0] != '\0' && !MqttSecurity::parseLanAddress(lanIp, lanAddress)) {
      Serial.println("Invalid LAN destination: enter a private IPv4 address or leave it blank. MQTT settings were not saved.");
      showStatus("Setup error", "Invalid LAN destination", "MQTT settings not saved", "Reopen setup to correct");
      return;
    }
    strlcpy(appConfig.mqtt_server, custom_mqtt_server.getValue(), sizeof(appConfig.mqtt_server));
    if (strlen(appConfig.mqtt_server) == 0) {
      Serial.println("Empty portal MQTT server; using local default.");
      strlcpy(appConfig.mqtt_server, MqttSecurity::DEFAULT_HOST, sizeof(appConfig.mqtt_server));
    }
    strlcpy(appConfig.mqtt_fallback_server, custom_mqtt_fallback.getValue(), sizeof(appConfig.mqtt_fallback_server));
    appConfig.mqtt_port = atoi(custom_mqtt_port.getValue());
    if (appConfig.mqtt_port < 1 || appConfig.mqtt_port > 65535) {
      Serial.println("Invalid portal MQTT port; using TLS port 8883.");
      appConfig.mqtt_port = MqttSecurity::DEFAULT_PORT;
    }
    strlcpy(appConfig.mqtt_username, custom_mqtt_username.getValue(), sizeof(appConfig.mqtt_username));
    strlcpy(appConfig.mqtt_password, custom_mqtt_password.getValue(), sizeof(appConfig.mqtt_password));
    strlcpy(appConfig.mqtt_lan_ip, lanIp, sizeof(appConfig.mqtt_lan_ip));
    const int configuredCount = atoi(custom_sensor_count.getValue());
    if (configuredCount < 1 || configuredCount > MAX_SENSORS) {
      Serial.println("Invalid portal sensor count; clamping to supported range.");
    }
    appConfig.sensor_count = constrain(configuredCount, 1, MAX_SENSORS);
    const char* displayValue = custom_has_display.getValue();
    if (strcmp(displayValue, "0") == 0 || strcmp(displayValue, "1") == 0) {
      appConfig.has_display = strcmp(displayValue, "1") == 0;
    } else {
      Serial.println("Invalid portal display setting; retaining the previous value.");
    }
    saveConfig();
  }
}

// Returns once the config button has been held for CONFIG_BUTTON_HOLD_MS, then reopens the portal
// and reboots so new settings (sensor count, display, broker) take effect cleanly.
unsigned long buttonPressedAt = 0;
void checkConfigButton() {
  if (digitalRead(CONFIG_BUTTON_PIN) == LOW) {
    if (buttonPressedAt == 0) buttonPressedAt = millis();
    if (millis() - buttonPressedAt >= CONFIG_BUTTON_HOLD_MS) {
      Serial.println("Config button held - opening setup portal");
      mqttClient.disconnect();
      runConfigPortal(true);
      ESP.restart();
    }
  } else {
    buttonPressedAt = 0;
  }
}

// ---------------------------------------------------------
// MQTT RECONNECT
// ---------------------------------------------------------
// Credentials are sent only after the secure client verifies the chain and DNS hostname.
void logTlsError() {
  char tlsError[160];
  const int tlsCode = espClient.lastError(tlsError, sizeof(tlsError));
  if (MqttSecurity::isTlsFailure(tlsCode)) Serial.printf("TLS error %d: %s\n", tlsCode, tlsError);
}

bool tryConnect(const char* server) {
  if (!MqttSecurity::validHostname(server) || !MqttSecurity::validPort(appConfig.mqtt_port)) {
    Serial.println("MQTT connection refused: use a valid DNS hostname and TLS port, not a raw IP or port 1883.");
    return false;
  }
  if (strlen(appConfig.mqtt_username) == 0 || strlen(appConfig.mqtt_password) == 0) {
    Serial.println("MQTT connection refused: configure broker username and password in setup.");
    return false;
  }
  if (!MqttSecurity::clockReady(time(nullptr))) {
    Serial.println("Waiting for NTP before verifying the MQTT certificate.");
    return false;
  }
  Serial.printf("Attempting MQTT connection to %s:%d...", server, appConfig.mqtt_port);
  showStatus("Loading...", "Connecting to MQTT", server, "");
  mqttClient.setServer(server, appConfig.mqtt_port);
  if (MqttSecurity::usesLanDestination(server, appConfig.mqtt_server, appConfig.mqtt_lan_ip)) {
    unsigned char address[4];
    if (!MqttSecurity::parseLanAddress(appConfig.mqtt_lan_ip, address)) {
      Serial.println("MQTT connection refused: the configured LAN destination is invalid. Correct it in setup.");
      return false;
    }
    const IPAddress destination(address[0], address[1], address[2], address[3]);
    Serial.printf("\nRouting TLS to LAN %s:%d; verifying certificate hostname %s.\n",
      appConfig.mqtt_lan_ip, appConfig.mqtt_port, server);
    // PubSubClient completes MQTT CONNECT over this verified transport without reconnecting by DNS.
    if (!espClient.connected() &&
        !espClient.connect(destination, appConfig.mqtt_port, server, MQTT_ROOT_CA, nullptr, nullptr)) {
      Serial.println("LAN TLS connection failed before MQTT authentication.");
      logTlsError();
      return false;
    }
  }
  const bool connected = mqttClient.connect(deviceId.c_str(), appConfig.mqtt_username, appConfig.mqtt_password);
  if (connected) {
    Serial.println("connected");
  } else {
    const int state = mqttClient.state();
    Serial.printf("failed, rc=%d\n", state);
    if (MqttSecurity::isBrokerRejection(state)) {
      if (state == MQTT_CONNECT_BAD_CREDENTIALS || state == MQTT_CONNECT_UNAUTHORIZED) {
        Serial.println("MQTT authentication rejected: check the Mosquitto account, matching password and authorization.");
      } else {
        Serial.println("MQTT broker rejected CONNECT after TLS succeeded. Check the broker log.");
      }
    } else {
      logTlsError();
    }
  }
  return connected;
}

void reconnect() {
  static unsigned long lastAttempt = 0;
  static bool attempted = false;
  static bool useFallback = false;
  const unsigned long now = millis();
  if (WiFi.status() != WL_CONNECTED || (attempted && now - lastAttempt < 5000)) return;
  attempted = true;
  lastAttempt = now;
  const bool connected = tryConnect(useFallback ? appConfig.mqtt_fallback_server : appConfig.mqtt_server);
  useFallback = !connected && !useFallback && strlen(appConfig.mqtt_fallback_server) > 0;
  if (!connected) Serial.println("Broker unavailable; next attempt in 5 seconds.");
  updateDisplay();
}

// ---------------------------------------------------------
// MAIN SETUP
// ---------------------------------------------------------
void setup() {
  Serial.begin(115200);
  pinMode(CONFIG_BUTTON_PIN, INPUT_PULLUP);
  loadConfig();

  // 1. Initialize OLED (skip entirely on boards with no screen wired up)
  if (appConfig.has_display) {
    if(!display.begin(SSD1306_SWITCHCAPVCC, SCREEN_ADDRESS)) {
      Serial.println(F("SSD1306 allocation failed"));
      appConfig.has_display = false;
    } else {
      displayReady = true;
      display.setTextColor(SSD1306_WHITE);
      showStatus("Loading...", "Starting up", "", "");
    }
  }
  Serial.print("Display: ");
  Serial.println(appConfig.has_display ? "Enabled" : "Disabled / not detected");

  // 3-5. WiFi + config portal (blocks until WiFi connects; saves any changes made in the portal)
  showStatus("Loading...", "Connecting to WiFi", "", "");
  runConfigPortal(false);
  if (appConfig.has_display && !displayReady) {
    displayReady = display.begin(SSD1306_SWITCHCAPVCC, SCREEN_ADDRESS);
    if (!displayReady) {
      Serial.println("OLED initialization failed after portal configuration.");
      appConfig.has_display = false;
    }
  }
  WiFi.setAutoReconnect(true);
  espClient.setCACert(MQTT_ROOT_CA);
  espClient.setHandshakeTimeout(10);
  espClient.setConnectionTimeout(2000);
  mqttClient.setSocketTimeout(2);
  if (!mqttClient.setBufferSize(512)) Serial.println("MQTT buffer allocation failed.");
  showStatus("Loading...", "WiFi connected", "Starting sensors", "");

  // Derive a stable, unique device ID from the MAC address (avoids client-ID clashes when multiple boards share a broker)
  deviceId = WiFi.macAddress();
  deviceId.replace(":", "");

  // 6. Setup 1-Wire Sensors & NTP time (needed for real reading timestamps); MQTT server is chosen in reconnect()
  for (int i = 0; i < MAX_SENSORS; i++) {
    lastTemps[i] = DEVICE_DISCONNECTED_C;
  }
  for (int i = 0; i < appConfig.sensor_count && i < MAX_SENSORS; i++) {
    sensors[i].begin();
    sensors[i].setWaitForConversion(false);
  }
  configTime(0, 0, "pool.ntp.org", "time.nist.gov");

  readAllSensors();
  updateDisplay();
}

// ---------------------------------------------------------
// MAIN LOOP
// ---------------------------------------------------------
void loop() {
  checkConfigButton();
  if (!mqttClient.connected()) {
    reconnect();
  }
  if (mqttClient.connected()) mqttClient.loop();
  completeSensorRead();

  unsigned long now = millis();

  if (now - lastHeartbeatTime > heartbeatInterval) {
    lastHeartbeatTime = now;
    readAllSensors(); // keep the sealed-box diagnostic screen fresh independent of the publish cadence
    updateDisplay();
    const unsigned long elapsed = now - lastMsgTime;
    Serial.printf("Alive - next publish in %lus\n", hasPublished && elapsed < (unsigned long)publishInterval
      ? ((unsigned long)publishInterval - elapsed) / 1000 : 0);
  }

  if ((!hasPublished || now - lastMsgTime >= (unsigned long)publishInterval) &&
      now - lastPublishAttempt >= 5000 && hasSensorReading && mqttClient.connected()) {
    lastPublishAttempt = now;
    const time_t timestamp = time(nullptr);
    if (timestamp < 946684800) {
      Serial.println("Clock is not synchronized; postponing publish.");
      return;
    }

    // Create a JSON payload from the most recent cached readings (refreshed at least every heartbeatInterval)
    JsonDocument doc;
    doc["device_id"] = deviceId;
    doc["timestamp"] = timestamp;
    JsonArray tempArray = doc["temperatures"].to<JsonArray>();

    for (int i = 0; i < appConfig.sensor_count && i < MAX_SENSORS; i++) {
      Serial.printf("Sensor %d (pin %d): %.2f C\n", i, ONE_WIRE_PINS[i], lastTemps[i]);
      if (lastTemps[i] == DEVICE_DISCONNECTED_C) {
        tempArray.add(nullptr); // keep array position == sensor_index when a probe drops off the bus
      } else {
        tempArray.add(lastTemps[i]);
      }
    }

    char jsonBuffer[320];
    if (measureJson(doc) >= sizeof(jsonBuffer)) {
      Serial.println("MQTT JSON exceeds the publish buffer; reading not sent.");
      return;
    }
    serializeJson(doc, jsonBuffer, sizeof(jsonBuffer));
    
    // Publish to the local MQTT broker
    if (mqttClient.publish(MQTT_TOPIC, jsonBuffer)) {
      lastMsgTime = now;
      hasPublished = true;
      Serial.println(jsonBuffer);
    } else {
      Serial.println("MQTT publish failed; retrying latest readings in 5 seconds.");
    }
  }
  delay(10);
}