# ESP32 sensor firmware

Target: **ESP32 Dev Module** (`esp32:esp32:esp32`), Arduino ESP32 core 3.3.1.
Dependencies are pinned in [sketch.yaml](sketch.yaml).

## Build

Install Arduino CLI, then from the repository root run:

```powershell
.\scripts\build-firmware.ps1
```

The script stages [hvac_sensor.ino](hvac_sensor.ino) as a correctly named Arduino sketch in temporary
storage, copies [config.h](config.h), [mqtt_security.h](mqtt_security.h),
[mqtt_trust.h](mqtt_trust.h) and the profile, and compiles `classic`. The profile
installs its pinned board core/libraries. Override `-ArduinoCli` or `-BuildRoot` for an
isolated toolchain/build location. No flash/upload is performed automatically.
The verified TLS build uses approximately 95% of the default classic ESP32 flash partition;
check build size before adding features. Static RAM reporting does not measure TLS heap usage.

For Arduino IDE, copy the files into a folder whose `.ino` file matches its name, select
the classic ESP32 board, and install the profile's library versions.

## Wiring and setup

- DS18B20 buses: GPIO 4, 5, 16, 17, 18, up to five probes, with appropriate 1-Wire pull-ups.
- Optional 128x64 SSD1306 OLED on I2C, address 0x3C.
- Hold the BOOT button (GPIO 0) for three seconds to reopen the setup portal.
- Configure broker, port, credentials, probe count and optional display through the portal.
- Portal sessions time out after 180 seconds. Save settings before exiting.

Configuration is loaded and validated before OLED initialization. Invalid persisted probe
counts are clamped and invalid ports replaced with 8883, with diagnostics. LittleFS uses
format-on-mount-failure, so filesystem corruption can erase persisted configuration.
Configuration writes use a temporary file followed by rename, retaining the prior file
on a short write. Failures are logged; verify saved settings after restarting.

## Runtime behavior

Probe conversions are requested asynchronously, with cached readings refreshed every
30 seconds. The first publish happens after probes and the NTP clock are ready; subsequent
successful publishes are ten minutes apart. Disconnected/invalid probes retain their
array positions as `null`.

Reconnection is scheduled no more often than every five seconds, alternating the configured
primary/fallback broker, rather than sitting in an endless reconnect loop. Heartbeats,
button checks and sensor processing continue between attempts. Individual network
connection attempts can block for the connection/handshake timeout; button checks resume
between attempts. TLS handshake timeout is ten seconds.

MQTT payload size and publish success are checked. A failed publish retries the latest
cached readings after five seconds; there is no durable backlog. Invalid NTP time is
never intentionally published. Scheduling timers use unsigned `millis()` differences;
the diagnostic uptime display resets when `millis()` wraps, approximately every 49 days.

The default ten-minute publish cadence cannot reliably measure sub-twelve-minute compressor
cycles. Temperature-cycle messages are estimates, not direct equipment-state measurements.

## Network safety and hardware validation

MQTT now uses `WiFiClientSecure`, verifying the certificate chain, expiry and DNS hostname
against the public ISRG Root X1/X2 certificates in [mqtt_trust.h](mqtt_trust.h).
Default broker: `mqtt.checkmytemp.com:8883`. Username and password are required.
The client waits for a plausible NTP clock before TLS and never bypasses verification.
The trust roots, unlike the broker leaf, do not change on every certificate renewal.
Review CA expiry/rotation periodically and rebuild/reflash when trust anchors change.

**Upgrade:** existing saved settings are retained. A stored IP, port 1883 or empty credentials
is rejected with a diagnostic; hold BOOT to change to the certificate hostname/TLS port.
Do not erase the filesystem merely to migrate. New boards have no default fallback.
The fallback remains manually configurable but must use a certificate DNS hostname,
the same TLS port and credentials, and one of the trusted CA chains. Raw IPs are not accepted
in either hostname field.

For local boards, use split LAN DNS, router hairpin NAT, or the optional
**MQTT LAN destination IPv4 (optional, primary only)** portal field. On this Pi's LAN,
enter `192.168.0.132` in that field while keeping the primary hostname
`mqtt.checkmytemp.com` and port `8883`. Reserve/stabilize the Pi's LAN address.
Only canonical private IPv4 addresses (10/8, 172.16/12 or 192.168/16) are accepted.
Blank preserves the original public-DNS behavior; old saved files default to blank.

The LAN field changes only the primary broker's network destination. The secure client
connects to that IP while explicitly retaining the configured hostname for SNI and
certificate verification. MQTT CONNECT and credentials are sent only after TLS succeeds.
Different fallback hostnames continue to use DNS and the same verified TLS port.
There is no automatic plaintext or insecure fallback if the local address fails.
Clear this field before moving a board to another site's network.

This does not change public DNS, the router, or the Pi's hosts file. Do not replace the
certificate hostname with an IP or call `setInsecure()` to resolve DNS/certificate problems.
Follow the
[broker rollout](../mosquitto/README.md) and test one board before migrating all devices.

The WiFiManager setup portal is still unauthenticated HTTP on its local access point.
The password field is masked but that is not transport encryption. Provision only in a
trusted environment; secure provisioning and stored-credential encryption remain future work.

Compilation cannot verify pin wiring, an absent OLED, flash corruption, WiFi loss, NTP
failure or broker outages. Exercise those scenarios on the actual board before rollout.

## Connection diagnostics

Positive MQTT return codes 1-5 are broker CONNECT rejections after the TLS transport is
established; 4/5 indicate credential/authorization rejection. The Pi login is not
automatically a Mosquitto account. List only broker usernames with
`sudo cut -d: -f1 /etc/mosquitto/passwd`, then enter the account's matching password privately
in setup. Current username/password fields hold at most 31 characters each.

Negative TLS return codes indicate transport/certificate failures. The pinned ESP32 SDK
can retain a positive socket descriptor (for example 48) in `lastError()` after a successful
handshake; it must not be displayed as a TLS error or used to justify bypassing verification.
