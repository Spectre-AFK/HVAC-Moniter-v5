#include <Arduino.h>
#include <WiFi.h>
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

// Initialize Global Config with defaults
Config appConfig = { "192.168.0.132", 1883, 1, true };

// Global Objects
WiFiClient espClient;
PubSubClient mqttClient(espClient);
// Unique per-device identifier (derived from MAC), used as both the MQTT client ID and payload device_id
String deviceId;
Adafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, OLED_RESET);
OneWire oneWireBuses[MAX_SENSORS] = { OneWire(ONE_WIRE_PINS[0]), OneWire(ONE_WIRE_PINS[1]), OneWire(ONE_WIRE_PINS[2]), OneWire(ONE_WIRE_PINS[3]), OneWire(ONE_WIRE_PINS[4]) };
DallasTemperature sensors[MAX_SENSORS] = { DallasTemperature(&oneWireBuses[0]), DallasTemperature(&oneWireBuses[1]), DallasTemperature(&oneWireBuses[2]), DallasTemperature(&oneWireBuses[3]), DallasTemperature(&oneWireBuses[4]) };

// Timers and State Flags
unsigned long lastMsgTime = 0;
const long publishInterval = 600000; // Publish every 10 minutes
bool shouldSaveConfig = false;

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
          strlcpy(appConfig.mqtt_server, doc["mqtt_server"] | "192.168.1.100", sizeof(appConfig.mqtt_server));
          appConfig.mqtt_port = doc["mqtt_port"] | 1883;
          appConfig.sensor_count = doc["sensor_count"] | 1;
          appConfig.has_display = doc["has_display"] | true;
          Serial.println("Config loaded from LittleFS");
        }
        file.close();
      }
    }
  }
}

void saveConfig() {
  JsonDocument doc;
  doc["mqtt_server"] = appConfig.mqtt_server;
  doc["mqtt_port"] = appConfig.mqtt_port;
  doc["sensor_count"] = appConfig.sensor_count;
  doc["has_display"] = appConfig.has_display;

  File file = LittleFS.open(CONFIG_FILE, "w");
  if (file) {
    serializeJson(doc, file);
    file.close();
    Serial.println("Config saved to LittleFS");
  }
}

// ---------------------------------------------------------
// OLED HELPER
// ---------------------------------------------------------
void updateDisplay(float temp0) {
  if (!appConfig.has_display) return;

  display.clearDisplay();
  
  display.setTextSize(1);
  display.setCursor(0, 0);
  display.print("IP: ");
  display.println(WiFi.localIP());

  display.setCursor(0, 12);
  display.print("MQTT: ");
  display.println(mqttClient.connected() ? "Connected" : "Wait...");

  display.setCursor(0, 24);
  display.print("Sensors: ");
  display.println(appConfig.sensor_count);

  display.setTextSize(2);
  display.setCursor(0, 42);
  if (temp0 == DEVICE_DISCONNECTED_C) {
    display.print("ERR");
  } else {
    display.print(temp0, 1);
    display.print(" C");
  }
  
  display.display();
}

// ---------------------------------------------------------
// MQTT RECONNECT
// ---------------------------------------------------------
void reconnect() {
  // Loop until we're reconnected
  while (!mqttClient.connected()) {
    Serial.print("Attempting MQTT connection...");
    if (mqttClient.connect(deviceId.c_str())) {
      Serial.println("connected");
    } else {
      Serial.print("failed, rc=");
      Serial.print(mqttClient.state());
      Serial.println(" try again in 5 seconds");
      
      // Update display during wait
      updateDisplay(DEVICE_DISCONNECTED_C);
      delay(5000);
    }
  }
}

// ---------------------------------------------------------
// MAIN SETUP
// ---------------------------------------------------------
void setup() {
  Serial.begin(115200);

  // 1. Initialize OLED (skip entirely on boards with no screen wired up)
  if (appConfig.has_display) {
    if(!display.begin(SSD1306_SWITCHCAPVCC, SCREEN_ADDRESS)) {
      Serial.println(F("SSD1306 allocation failed"));
      appConfig.has_display = false;
    } else {
      display.setTextColor(SSD1306_WHITE);
      display.clearDisplay();
      display.setCursor(0,20);
      display.setTextSize(1);
      display.println("Starting Setup...");
      display.display();
    }
  }

  // 2. Load Config from LittleFS
  loadConfig();

  // 3. Setup WiFiManager Custom Parameters
  WiFiManager wm;
  wm.setSaveConfigCallback(saveConfigCallback);

  WiFiManagerParameter custom_mqtt_server("server", "MQTT Server IP", appConfig.mqtt_server, 40);
  
  char portStr[6];
  itoa(appConfig.mqtt_port, portStr, 10);
  WiFiManagerParameter custom_mqtt_port("port", "MQTT Port", portStr, 6);

  char countStr[4];
  itoa(appConfig.sensor_count, countStr, 10);
  WiFiManagerParameter custom_sensor_count("count", "Sensor Count (1-5)", countStr, 4);

  char displayStr[2];
  itoa(appConfig.has_display ? 1 : 0, displayStr, 10);
  WiFiManagerParameter custom_has_display("display", "Has OLED Display (1=yes, 0=no)", displayStr, 2);

  wm.addParameter(&custom_mqtt_server);
  wm.addParameter(&custom_mqtt_port);
  wm.addParameter(&custom_sensor_count);
  wm.addParameter(&custom_has_display);

  // 4. Captive Portal (Blocking loop until WiFi connects)
  if(!wm.autoConnect("Sensor WiFi Setup")) {
    Serial.println("Failed to connect and hit timeout");
    delay(3000);
    ESP.restart();
  }

  // 5. Save new config if changed in the captive portal UI
  if (shouldSaveConfig) {
    strlcpy(appConfig.mqtt_server, custom_mqtt_server.getValue(), sizeof(appConfig.mqtt_server));
    appConfig.mqtt_port = atoi(custom_mqtt_port.getValue());
    appConfig.sensor_count = atoi(custom_sensor_count.getValue());
    appConfig.has_display = atoi(custom_has_display.getValue()) != 0;
    saveConfig();
  }

  // Derive a stable, unique device ID from the MAC address (avoids client-ID clashes when multiple boards share a broker)
  deviceId = WiFi.macAddress();
  deviceId.replace(":", "");

  // 6. Setup MQTT, 1-Wire Sensors & NTP time (needed for real reading timestamps)
  mqttClient.setServer(appConfig.mqtt_server, appConfig.mqtt_port);
  for (int i = 0; i < appConfig.sensor_count && i < MAX_SENSORS; i++) {
    sensors[i].begin();
  }
  configTime(0, 0, "pool.ntp.org", "time.nist.gov");
}

// ---------------------------------------------------------
// MAIN LOOP
// ---------------------------------------------------------
void loop() {
  if (!mqttClient.connected()) {
    reconnect();
  }
  mqttClient.loop();

  unsigned long now = millis();
  if (now - lastMsgTime > publishInterval) {
    lastMsgTime = now;

    // Create a JSON payload
    JsonDocument doc;
    doc["device_id"] = deviceId;
    doc["timestamp"] = time(nullptr); // unix epoch seconds (synced via NTP in setup)
    JsonArray tempArray = doc["temperatures"].to<JsonArray>();

    float firstTemp = DEVICE_DISCONNECTED_C;

    for (int i = 0; i < appConfig.sensor_count; i++) {
      sensors[i].requestTemperatures(); // each sensor is on its own dedicated 1-Wire pin
      float t = sensors[i].getTempCByIndex(0);
      if (t == DEVICE_DISCONNECTED_C) {
        tempArray.add(nullptr); // keep array position == sensor_index when a probe drops off the bus
      } else {
        tempArray.add(t);
      }
      if (i == 0) firstTemp = t; // Grab the first sensor's data to show on the OLED
    }

    char jsonBuffer[320];
    serializeJson(doc, jsonBuffer);
    
    // Publish to the local MQTT broker
    mqttClient.publish(MQTT_TOPIC, jsonBuffer);
    Serial.println(jsonBuffer);

    // Update OLED screen
    updateDisplay(firstTemp);
  }
}