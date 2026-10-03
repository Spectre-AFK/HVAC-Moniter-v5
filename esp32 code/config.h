#pragma once

#include <Arduino.h>

// ---------------------------------------------------------
// HARDWARE PINS & SETTINGS
// ---------------------------------------------------------

// OLED Display (I2C)
#define SCREEN_WIDTH 128
#define SCREEN_HEIGHT 64
#define OLED_RESET -1
#define SCREEN_ADDRESS 0x3C // 0x3C is standard for 0.96" OLEDs

// DS18B20 1-Wire Bus Pins — one dedicated pin per sensor (index matches sensor_index)
#define MAX_SENSORS 5
const uint8_t ONE_WIRE_PINS[MAX_SENSORS] = {4, 5, 16, 17, 18};

// Hold this button (the BOOT button on most ESP32 dev boards) while running to reopen the setup portal
#define CONFIG_BUTTON_PIN 0
#define CONFIG_BUTTON_HOLD_MS 3000

// MQTT Publish Topic
#define MQTT_TOPIC "home/sensors/temp"
// Client ID is derived at runtime from the MAC address (see deviceId in main.ino) to avoid collisions between boards

// ---------------------------------------------------------
// CONFIGURATION STRUCTURE
// ---------------------------------------------------------
struct Config {
  char mqtt_server[40];
  int mqtt_port;
  char mqtt_username[32]; // leave blank if the broker doesn't require auth
  char mqtt_password[32];
  int sensor_count;
  bool has_display; // set false for boards with no OLED wired up
  char mqtt_fallback_server[40]; // tried when mqtt_server (local broker) is unreachable; blank to disable
};

// Define global configuration object
extern Config appConfig;

// LittleFS file path
const char* CONFIG_FILE = "/config.json";