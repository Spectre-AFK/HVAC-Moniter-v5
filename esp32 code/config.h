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

// DS18B20 1-Wire Bus Pin
#define ONE_WIRE_BUS 4 

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
};

// Define global configuration object
extern Config appConfig;

// LittleFS file path
const char* CONFIG_FILE = "/config.json";