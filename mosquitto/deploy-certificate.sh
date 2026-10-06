#!/bin/bash
set -euo pipefail
umask 077

hostname="mqtt.checkmytemp.com"
expected_lineage="/etc/letsencrypt/live/$hostname"
lineage="${RENEWED_LINEAGE:-$expected_lineage}"
base="/etc/mosquitto/certs"
install_only=false

if [ "$#" -gt 1 ] || { [ "$#" -eq 1 ] && [ "$1" != "--install-only" ]; }; then
    echo "Usage: $0 [--install-only]" >&2
    exit 1
fi
if [ "$#" -eq 1 ]; then install_only=true; fi
if [ "$(id -u)" -ne 0 ]; then
    echo "Run this hook as root." >&2
    exit 1
fi
if [ "$lineage" != "$expected_lineage" ]; then
    echo "Skipping unrelated certificate: $lineage"
    exit 0
fi

openssl verify -purpose sslserver -verify_hostname "$hostname" \
    -CAfile /etc/ssl/certs/ca-certificates.crt \
    -untrusted "$lineage/chain.pem" "$lineage/cert.pem"
openssl x509 -in "$lineage/cert.pem" -checkend 86400 -noout
certificate_key="$(openssl x509 -in "$lineage/cert.pem" -pubkey -noout |
    openssl pkey -pubin -outform DER | openssl dgst -sha256)"
private_key="$(openssl pkey -in "$lineage/privkey.pem" -pubout -outform DER |
    openssl dgst -sha256)"
if [ "$certificate_key" != "$private_key" ]; then
    echo "Certificate and private key do not match; existing broker files are untouched." >&2
    exit 1
fi

install -d -o root -g mosquitto -m 750 "$base"
exec 9>"$base/.deploy.lock"
flock -x 9
staging="$(mktemp -d "$base/generation.XXXXXX")"
temporary_link="$base/.current.$$"
published=false
cleanup() {
    if [ -L "$temporary_link" ]; then rm -- "$temporary_link"; fi
    if [ "$published" = false ]; then
        rm -f -- "$staging/fullchain.pem" "$staging/privkey.pem"
        rmdir -- "$staging"
    fi
}
trap cleanup EXIT
install -o root -g mosquitto -m 640 "$lineage/fullchain.pem" "$staging/fullchain.pem"
install -o root -g mosquitto -m 640 "$lineage/privkey.pem" "$staging/privkey.pem"
chown root:mosquitto "$staging"
chmod 750 "$staging"
ln -s "$staging" "$temporary_link"
# Switch the certificate/key pair together; keep prior generations for manual rollback.
mv -Tf -- "$temporary_link" "$base/current"
published=true

if [ "$install_only" = true ]; then
    echo "Certificate pair installed. Configure the TLS listener before restarting Mosquitto."
else
    systemctl reload mosquitto.service
    echo "Mosquitto was signalled to reload its renewed certificate. Verify the TLS listener and logs."
fi
