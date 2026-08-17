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

// MQTT Publish Topic
#define MQTT_TOPIC "home/sensors/temp"
// Client ID is derived at runtime from the MAC address (see deviceId in main.ino) to avoid collisions between boards

// ---------------------------------------------------------
// CONFIGURATION STRUCTURE
// ---------------------------------------------------------
struct Config {
  char mqtt_server[40];
  int mqtt_port;
  int sensor_count;
  bool has_display; // set false for boards with no OLED wired up
};

// Define global configuration object
extern Config appConfig;

// LittleFS file path
const char* CONFIG_FILE = "/config.json";