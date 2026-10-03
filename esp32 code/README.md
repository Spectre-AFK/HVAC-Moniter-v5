# ESP32 sensor firmware

Target: **ESP32 Dev Module** (`esp32:esp32:esp32`), Arduino ESP32 core 3.3.1.
Dependencies are pinned in [sketch.yaml](sketch.yaml).

## Build

Install Arduino CLI, then from the repository root run:

```powershell
.\scripts\build-firmware.ps1
```

The script stages [main.ino](main.ino) as a correctly named Arduino sketch in temporary
storage, copies [config.h](config.h) and the profile, and compiles `classic`. The profile
installs its pinned board core/libraries. Override `-ArduinoCli` or `-BuildRoot` for an
isolated toolchain/build location. No flash/upload is performed automatically.

For Arduino IDE, copy the files into a folder whose `.ino` file matches its name, select
the classic ESP32 board, and install the profile's library versions.

## Wiring and setup

- DS18B20 buses: GPIO 4, 5, 16, 17, 18, up to five probes, with appropriate 1-Wire pull-ups.
- Optional 128x64 SSD1306 OLED on I2C, address 0x3C.
- Hold the BOOT button (GPIO 0) for three seconds to reopen the setup portal.
- Configure broker, port, credentials, probe count and optional display through the portal.
- Portal sessions time out after 180 seconds. Save settings before exiting.

Configuration is loaded and validated before OLED initialization. Invalid persisted probe
counts are clamped and invalid ports replaced with 1883, with diagnostics. LittleFS uses
format-on-mount-failure, so filesystem corruption can erase persisted configuration.
Configuration writes use a temporary file followed by rename, retaining the prior file
on a short write. Failures are logged; verify saved settings after restarting.

## Runtime behavior

Probe conversions are requested asynchronously, with cached readings refreshed every
30 seconds. The first publish happens after probes and the NTP clock are ready; subsequent
successful publishes are ten minutes apart. Disconnected/invalid probes retain their
array positions as `null`.

Reconnection makes one bounded attempt per five seconds, alternating the configured
primary/fallback broker, rather than sitting in an endless reconnect loop. Heartbeats,
button checks and sensor processing continue between attempts. Individual network
connection attempts can still block briefly.

MQTT payload size and publish success are checked. A failed publish retries the latest
cached readings after five seconds; there is no durable backlog. Invalid NTP time is
never intentionally published. Scheduling timers use unsigned `millis()` differences;
the diagnostic uptime display resets when `millis()` wraps, approximately every 49 days.

The default ten-minute publish cadence cannot reliably measure sub-twelve-minute compressor
cycles. Temperature-cycle messages are estimates, not direct equipment-state measurements.

## Network safety and hardware validation

The transport is plain MQTT and the setup portal is not authenticated. Use a trusted LAN
and an authenticated broker; do not expose the broker or portal to the public Internet.
New boards have no default fallback broker; configure one manually in the setup portal
only if it points to a trusted endpoint. Existing saved fallback settings are preserved. TLS and secure
provisioning remain separate work.

Compilation cannot verify pin wiring, an absent OLED, flash corruption, WiFi loss, NTP
failure or broker outages. Exercise those scenarios on the actual board before rollout.
