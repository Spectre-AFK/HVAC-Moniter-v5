# Mosquitto TLS rollout (Raspberry Pi)

Target: Mosquitto **2.0.21**, installed as `mosquitto.service`, with the existing password
file `/etc/mosquitto/passwd`. Hostname: **mqtt.checkmytemp.com**.
The broker certificate has already been issued through Certbot/Cloudflare DNS validation.
These files are deployment instructions/templates, not an automatic remote deployment.

## Preconditions

- Cloudflare `mqtt` A record is DNS-only and points to the correct public IPv4 address.
- Pi has a reserved LAN address. Remote MQTT will use TCP 8883, not a web proxy.
- `/etc/mosquitto/passwd` contains the usernames/passwords used by your devices and Node-RED.
  Use `sudo mosquitto_passwd /etc/mosquitto/passwd USERNAME` to add/update a user privately.
  **Do not use `-c` on an existing password file**: that overwrites other accounts.
- Keep certificate/private-key files and Cloudflare API tokens on the Pi only.
- Use a recent Node.js/Node-RED runtime and up-to-date CA trust on the Pi.
- Schedule the broker restart: existing clients will briefly disconnect.

## 1. Copy the deployment files

Copy this repository's [deploy-certificate.sh](deploy-certificate.sh) and
[mqtt-tls.conf.example](mqtt-tls.conf.example) to your Pi, for example into
`/home/spectre/hvac-tls/`. Do not copy any secrets into the repository.
The shell script must use LF line endings.

On the Pi:

```bash
sudo install -d -m 755 /etc/letsencrypt/renewal-hooks/deploy
sudo install -o root -g root -m 750 /home/spectre/hvac-tls/deploy-certificate.sh /etc/letsencrypt/renewal-hooks/deploy/50-mosquitto.sh
sudo sed -i 's/\r$//' /etc/letsencrypt/renewal-hooks/deploy/50-mosquitto.sh
sudo bash -n /etc/letsencrypt/renewal-hooks/deploy/50-mosquitto.sh
sudo /etc/letsencrypt/renewal-hooks/deploy/50-mosquitto.sh --install-only
sudo -u mosquitto test -r /etc/mosquitto/certs/current/fullchain.pem
sudo -u mosquitto test -r /etc/mosquitto/certs/current/privkey.pem
sudo -u mosquitto test -r /etc/mosquitto/passwd
```

All `test` commands should exit successfully (they print nothing). The hook checks the
certificate chain/hostname/expiry and matching private key before publishing a complete
generation. Directories are root-owned, group-readable by Mosquitto, with a 640 private key.
It does not loosen access to `/etc/letsencrypt`.

If execution says `No such file or directory` even though the installed file exists,
inspect its first line with `sudo head -n 1 /etc/letsencrypt/renewal-hooks/deploy/50-mosquitto.sh | cat -A`.
`#!/bin/bash^M$` means CRLF line endings made the kernel search for a nonexistent
interpreter. The `sed` step above removes the carriage returns. The result should be
`#!/bin/bash$`; do not remove certificate files or reinstall Bash to resolve this.

The `current` symlink switches the pair together. Old generations are retained for manual
rollback; periodically remove only old, explicitly identified generations after verifying
the active listener. They contain private keys and must remain protected.

## 2. Consolidate the existing authentication/listener files

The reported setup has `local.conf` with `listener 1883` and `allow_anonymous true`,
and `auth.conf` with `allow_anonymous false` and `password_file /etc/mosquitto/passwd`.
Do not append another global authentication setting to those conflicting files.

Back up those two files by renaming them out of the `.conf` set. If the backup names
already exist, choose unused names instead; never overwrite a prior backup.

```bash
sudo mv -n /etc/mosquitto/conf.d/local.conf /etc/mosquitto/conf.d/local.conf.pre-tls
sudo mv -n /etc/mosquitto/conf.d/auth.conf /etc/mosquitto/conf.d/auth.conf.pre-tls
```

Confirm the original two `.conf` files are gone before proceeding. Preserve the main
`mosquitto.conf`, which includes `conf.d` and the existing logging/persistence settings.
Check for additional listener/authentication config files if your setup has changed.

```bash
sudo install -o root -g root -m 644 /home/spectre/hvac-tls/mqtt-tls.conf.example /etc/mosquitto/conf.d/mqtt.conf
sudo nano /etc/mosquitto/conf.d/mqtt.conf
```

**During the short migration window only**, uncomment `listener 1883` at the bottom
if old firmware still needs it. Authentication is required on both listeners.
If old clients were anonymous, supply credentials before enabling the stricter broker.
Restrict any remaining public 1883 forwarding by source address where possible.

The example uses server-authenticated TLS, not mutual TLS: `require_certificate false`
does not disable TLS; it means devices authenticate with MQTT username/password instead
of presenting a client certificate. `tls_version tlsv1.2` is the minimum, not a request
to disable TLS 1.3.

```bash
sudo systemctl restart mosquitto.service
sudo systemctl status mosquitto.service --no-pager
sudo journalctl -u mosquitto.service -n 40 --no-pager
sudo ss -ltnp
```

Expect a listener on 8883 and an active service. If startup fails, inspect the error locally.
Never share secret file contents or paste an entire config containing credentials.

## 3. Verify TLS before migrating clients

On the Pi, bypass external DNS routing while still verifying the certificate hostname:

```bash
openssl s_client -connect 127.0.0.1:8883 -servername mqtt.checkmytemp.com -verify_hostname mqtt.checkmytemp.com -verify_return_error -CAfile /etc/ssl/certs/ca-certificates.crt </dev/null
```

Expected: successful handshake and certificate verification (`Verify return code: 0 (ok)`
or `Verification: OK`). This does not test MQTT authentication or data delivery.
Repeat with a wrong verification hostname and confirm it **fails**:

```bash
openssl s_client -connect 127.0.0.1:8883 -servername mqtt.checkmytemp.com -verify_hostname wrong.example.com -verify_return_error -CAfile /etc/ssl/certs/ca-certificates.crt </dev/null
```

Configure router/firewall TCP **8883 -> Pi:8883** only after local verification. Leave
the Node-RED editor and MQTT credentials/private keys unexposed. Test 8883 from another
network; a test from inside the LAN does not prove Internet reachability.

## 4. Migrate Node-RED and boards

In Node-RED's existing broker node (do not create a second active ingestion subscription):

- Host: `mqtt.checkmytemp.com`; port: `8883`; TLS enabled.
- TLS configuration: verify server certificate **enabled**; server name `mqtt.checkmytemp.com`.
- Leave client certificate/private key blank. For this public certificate use the runtime
  trust store. Never upload the broker's private key as a client key.
- Preserve/configure the username/password on the broker Security tab.

On the Pi only, to avoid router hairpin NAT, add a single hosts entry with `sudo nano /etc/hosts`:

```text
127.0.0.1 mqtt.checkmytemp.com
```

Do not duplicate/conflict with an existing entry. Node-RED still connects by hostname,
so certificate verification remains intact. Reconnect/redeploy the broker configuration.
If the runtime cannot trust the chain, update its CA trust or configure the verified public
ISRG root CA; never turn verification off.

Flash the updated [ESP32 firmware](../esp32%20code/README.md) to one test board first.
Keep its filesystem/configuration; open setup by holding BOOT for three seconds:

- Hostname `mqtt.checkmytemp.com`, port `8883`, existing broker username/password.
- Optional LAN destination IPv4: `192.168.0.132` for boards on this Pi's LAN; blank for remote boards.
- Optional fallback: a valid certificate DNS hostname on the same TLS port, blank to disable.
- No `mqtts://` prefix, path, raw IP or insecure fallback.

Local boards can use router hairpin NAT, a LAN DNS override mapping
`mqtt.checkmytemp.com` to the Pi's LAN IP, or the firmware's optional LAN destination
field. That field routes the primary connection directly to a private IPv4 address but
keeps the original TLS hostname/SNI and trusted CA verification. It does not affect distinct
fallback hostnames. Keep the Pi's LAN IP stable, and clear the field on boards moved off-site.
Remote boards leave the field blank and use the public DNS record.
Do not replace the certificate hostname with an IP to work around local DNS.
NTP must work before the ESP32 can validate certificate dates.

Confirm Node-RED shows connected, HTTP writes succeed, and fresh device/probe readings
reach Supabase. Then migrate each remaining board.

### Diagnosing a local connectivity failure

If Node-RED says connected but a board reports `rc=-2`, test TCP 8883 to both the Pi's LAN
IP and public hostname from another LAN device. Node-RED's Pi-only hosts override does
not affect the ESP32. Also test the hostname from an external network:

- LAN IP fails: check `ss -ltnp` and the Pi firewall before changing DNS or certificates.
- LAN IP succeeds, external hostname succeeds, LAN hostname fails: use the optional LAN
  destination or split DNS; the router's hairpin path is not working.
- External hostname fails too: check WAN address, DNS and TCP forwarding.

Mosquitto listening on 8883 does not override UFW's default deny. For an IPv4 A-record
deployment intended to accept remote boards, allow IPv4 TCP 8883 explicitly:

```bash
sudo ufw allow proto tcp from 0.0.0.0/0 to any port 8883 comment 'MQTT TLS IPv4'
```

Apply only when using UFW and when remote access is intended; restrict source addresses
where practical. Do not disable the firewall or add unnecessary IPv6 exposure.

## 5. Close plaintext access and verify renewal

After every board and ingestion client uses TLS:

1. Remove `listener 1883` from `mqtt.conf`; restart Mosquitto.
2. Remove router port 1883 forwarding and unnecessary IPv6/firewall exposure.
3. Confirm `ss -ltnp` no longer shows an MQTT 1883 listener and test from outside the LAN.
4. Keep broker authentication enabled. Rotate credentials formerly sent over an untrusted
   plaintext network after all clients are migrated.
5. Test automatic renewal **including the deployment hook**:

```bash
sudo certbot renew --dry-run --run-deploy-hooks
```

If your Certbot version lacks `--run-deploy-hooks`, run the ordinary dry run, then invoke
the hook manually to exercise certificate installation/reload. Inspect the service logs
and rerun the TLS verification afterward. The hook ignores unrelated certificate lineages.
Keep the Certbot timer enabled and monitor expiry and hook failures.

## Rollback

If the new broker configuration fails to start, stop and inspect the error rather than
repeatedly restarting. The TLS certificate hook does not delete prior certificate generations.
For a configuration rollback, rename `mqtt.conf` to a non-`.conf` backup name, then restore
the saved listener/authentication files only after resolving their conflicting
`allow_anonymous` directives. Prefer `allow_anonymous false`; do not restore public
anonymous access as a troubleshooting shortcut. Keep TCP 8883 closed externally until
the corrected TLS listener is verified.

TLS is not complete until the remote TLS test, MQTT authentication, every board, plaintext
closure and renewal reload are verified. Firmware compilation/script checks cannot prove
those remote/hardware outcomes.

References: [Mosquitto configuration](https://mosquitto.org/man/mosquitto-conf-5.html),
[Let's Encrypt roots](https://letsencrypt.org/certificates/),
[Certbot Cloudflare plugin](https://certbot-dns-cloudflare.readthedocs.io/en/stable/).
