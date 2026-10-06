param(
    [string]$ArduinoCli = 'arduino-cli',
    [string]$BuildRoot = (Join-Path $env:TEMP 'hvac-firmware-build')
)
$ErrorActionPreference = 'Stop'
$source = Join-Path $PSScriptRoot '..\esp32 code'
$sketch = Join-Path $BuildRoot 'hvac-sensor'
New-Item -ItemType Directory -Path $sketch -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $source 'hvac_sensor.ino') -Destination (Join-Path $sketch 'hvac-sensor.ino')
Copy-Item -LiteralPath (Join-Path $source 'config.h') -Destination $sketch
Copy-Item -LiteralPath (Join-Path $source 'mqtt_security.h') -Destination $sketch
Copy-Item -LiteralPath (Join-Path $source 'mqtt_trust.h') -Destination $sketch
Copy-Item -LiteralPath (Join-Path $source 'sketch.yaml') -Destination $sketch
& $ArduinoCli compile --profile classic --warnings all --build-path (Join-Path $BuildRoot 'output') $sketch
if ($LASTEXITCODE -ne 0) { throw "Firmware compilation failed ($LASTEXITCODE)." }
