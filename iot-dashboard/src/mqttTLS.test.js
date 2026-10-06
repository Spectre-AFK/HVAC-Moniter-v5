import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chmodSync, mkdtempSync, readFileSync, rmSync, rmdirSync, writeFileSync } from 'node:fs';
import { X509Certificate } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connect as connectTls, createServer } from 'node:tls';
import { mqttOptions } from '../../mqtt-bridge/mqttOptions.js';

const settings = { MQTT_URL: 'mqtts://mqtt.checkmytemp.com:8883', MQTT_USERNAME: 'fixture-user', MQTT_PASSWORD: 'fixture-password' };

describe('certificate-verified MQTT configuration', () => {
  it('keeps the certificate deployment hook executable on Linux', () => {
    const hook = readFileSync(new URL('../../mosquitto/deploy-certificate.sh', import.meta.url), 'utf8');
    expect(hook.startsWith('#!/bin/bash\n')).toBe(true);
    expect(hook).not.toContain('\r');
  });
  it('requires certificate and hostname verification for the alternative bridge', () => {
    expect(mqttOptions(settings)).toMatchObject({
      rejectUnauthorized: true, servername: 'mqtt.checkmytemp.com', minVersion: 'TLSv1.2',
      username: settings.MQTT_USERNAME, password: settings.MQTT_PASSWORD,
    });
  });

    describe('TLS handshake verification with local certificate fixtures', () => {
      let directory;
      let server;
      let port;
      let ca;
      const files = ['openssl.cnf', 'extensions.cnf', 'ca.key', 'ca.pem', 'server.key', 'server.csr', 'server.pem'];
      beforeAll(async () => {
        directory = mkdtempSync(join(tmpdir(), 'hvac-mqtt-tls-test-'));
        const path = name => join(directory, name);
        writeFileSync(path('openssl.cnf'), '[req]\ndistinguished_name = dn\n[dn]\n');
        writeFileSync(path('extensions.cnf'), 'subjectAltName=DNS:mqtt.checkmytemp.com\nbasicConstraints=critical,CA:FALSE\nextendedKeyUsage=serverAuth\n');
        const run = args => execFileSync('openssl', args, { stdio: 'pipe', timeout: 15_000 });
        run(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
          '-keyout', path('ca.key'), '-out', path('ca.pem'), '-subj', '/CN=Local MQTT Test CA',
          '-config', path('openssl.cnf'), '-addext', 'basicConstraints=critical,CA:TRUE']);
        run(['req', '-new', '-newkey', 'rsa:2048', '-nodes', '-keyout', path('server.key'),
          '-out', path('server.csr'), '-subj', '/CN=mqtt.checkmytemp.com', '-config', path('openssl.cnf')]);
        run(['x509', '-req', '-in', path('server.csr'), '-CA', path('ca.pem'), '-CAkey', path('ca.key'),
          '-set_serial', '1', '-days', '1', '-extfile', path('extensions.cnf'), '-out', path('server.pem')]);
        chmodSync(path('ca.key'), 0o600);
        chmodSync(path('server.key'), 0o600);
        ca = readFileSync(path('ca.pem'));
        server = createServer({ key: readFileSync(path('server.key')), cert: readFileSync(path('server.pem')), minVersion: 'TLSv1.2' },
          socket => socket.end());
        await new Promise((resolve, reject) => {
          server.once('error', reject);
          server.listen(0, '127.0.0.1', resolve);
        });
        port = server.address().port;
      }, 30_000);
      afterAll(async () => {
        if (server?.listening) await new Promise(resolve => server.close(resolve));
        if (directory) {
          for (const name of files) rmSync(join(directory, name), { force: true });
          rmdirSync(directory);
        }
      });
      function handshake({ hostname = 'mqtt.checkmytemp.com', trust = ca } = {}) {
        return new Promise((resolve, reject) => {
          const options = mqttOptions({ ...settings, MQTT_URL: `mqtts://${hostname}:8883` });
          const socket = connectTls({ ...options, host: '127.0.0.1', port, ca: trust });
          socket.setTimeout(5000, () => socket.destroy(new Error('Local TLS handshake timed out.')));
          socket.once('secureConnect', () => {
            socket.end();
            resolve(socket.authorized);
          });
          socket.once('error', reject);
        });
      }
      it('accepts a trusted chain with the matching DNS hostname', async () => {
        await expect(handshake()).resolves.toBe(true);
      });
      it('rejects a trusted certificate presented for the wrong DNS hostname', async () => {
        await expect(handshake({ hostname: 'wrong.example.com' })).rejects.toMatchObject({ code: 'ERR_TLS_CERT_ALTNAME_INVALID' });
      });
      it('rejects a certificate signed by an untrusted CA', async () => {
        await expect(handshake({ trust: [] })).rejects.toThrow();
      });
    });
  it.each(['mqtt://mqtt.checkmytemp.com:1883', 'mqtts://127.0.0.1:8883',
    'mqtts://[::1]:8883', 'mqtts://localhost:8883', 'mqtts://mqtt.checkmytemp.com:1883',
    'mqtts://mqtt.checkmytemp.com/path', 'mqtts://mqtt.checkmytemp.com?rejectUnauthorized=false',
    'mqtts://-mqtt.example.com:8883', 'mqtts://mqtt-.example.com:8883',
    'mqtts://mqtt..example.com:8883', 'mqtts://mqtt.example.com.:8883'])(
    'refuses unsafe or malformed broker configuration %s', MQTT_URL => {
      expect(() => mqttOptions({ ...settings, MQTT_URL })).toThrow();
    });
  it('rejects URL credentials and missing authentication', () => {
    expect(() => mqttOptions({ ...settings, MQTT_URL: 'mqtts://user:password@mqtt.example.com:8883' })).toThrow('separate environment');
    expect(() => mqttOptions({ ...settings, MQTT_USERNAME: '' })).toThrow('required');
    expect(() => mqttOptions({ ...settings, MQTT_PASSWORD: '' })).toThrow('required');
  });
  it('exports Node-RED with a wired TLS configuration and no client private key', () => {
    const flow = JSON.parse(readFileSync(new URL('../../node-red/flows.json', import.meta.url), 'utf8'));
    const broker = flow.find(node => node.type === 'mqtt-broker');
    const tls = flow.find(node => node.id === broker.tls);
    expect(broker).toMatchObject({ broker: 'mqtt.checkmytemp.com', port: '8883', usetls: true, verifyservercert: true });
    expect(tls).toMatchObject({ type: 'tls-config', verifyservercert: true, servername: broker.broker, key: '', cert: '' });
  });
  it('pins the genuine self-signed ISRG roots rather than a renewing leaf certificate', () => {
    const source = readFileSync(new URL('../../esp32 code/mqtt_trust.h', import.meta.url), 'utf8');
    const pems = source.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g);
    expect(pems).toHaveLength(2);
    const expected = [
      '96:BC:EC:06:26:49:76:F3:74:60:77:9A:CF:28:C5:A7:CF:E8:A3:C0:AA:E1:1A:8F:FC:EE:05:C0:BD:DF:08:C6',
      '69:72:9B:8E:15:A8:6E:FC:17:7A:57:AF:B7:17:1D:FC:64:AD:D2:8C:2F:CA:8C:F1:50:7E:34:45:3C:CB:14:70',
    ];
    pems.forEach((pem, i) => {
      const cert = new X509Certificate(pem);
      expect(cert.ca).toBe(true);
      expect(cert.fingerprint256).toBe(expected[i]);
      expect(cert.verify(cert.publicKey)).toBe(true);
    });
    expect(source).not.toContain('PRIVATE KEY');
  });
  it('keeps the firmware secure client wired without an insecure/plaintext switch', () => {
    const source = readFileSync(new URL('../../esp32 code/hvac_sensor.ino', import.meta.url), 'utf8');
    expect(source).toMatch(/WiFiClientSecure espClient;/);
    expect(source).toContain('espClient.setCACert(MQTT_ROOT_CA)');
    expect(source).toContain('MqttSecurity::clockReady(time(nullptr))');
    expect(source).not.toMatch(/\.setInsecure\s*\(|\.setPlainStart\s*\(/);
  });
  it('routes the optional primary LAN address with the original certificate hostname and CA', () => {
    const source = readFileSync(new URL('../../esp32 code/hvac_sensor.ino', import.meta.url), 'utf8');
    expect(source).toContain('MqttSecurity::usesLanDestination(server, appConfig.mqtt_server, appConfig.mqtt_lan_ip)');
    expect(source).toContain('espClient.connect(destination, appConfig.mqtt_port, server, MQTT_ROOT_CA, nullptr, nullptr)');
    expect(source).toContain('doc["mqtt_lan_ip"] | ""');
    expect(source).toContain('doc["mqtt_lan_ip"] = appConfig.mqtt_lan_ip');
    expect(source).toContain('wm.addParameter(&custom_mqtt_lan_ip)');
    expect(source).not.toContain('mqttClient.setServer(destination');
  });
  it('separates MQTT broker rejections from negative TLS transport failures', () => {
    const source = readFileSync(new URL('../../esp32 code/hvac_sensor.ino', import.meta.url), 'utf8');
    expect(source).toContain('MqttSecurity::isTlsFailure(tlsCode)');
    expect(source).toContain('MqttSecurity::isBrokerRejection(state)');
    expect(source).toContain('MQTT authentication rejected:');
    expect(source).not.toContain('if (tlsCode != 0)');
  });
});
