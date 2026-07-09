import test from 'node:test';
import assert from 'node:assert';
import { validateNmapData, parseNmapXml, parseNmapJson, sanitizeString, parseXmlAttributes } from './nmap-parser.ts';

test('sanitizeString strips non-printable ASCII control characters', () => {
  const dirty = 'ssh\x00\x1Fversion\x7F';
  const clean = sanitizeString(dirty);
  assert.strictEqual(clean, 'sshversion');
});

test('parseNmapXml parses standard Nmap XML structure', () => {
  const xmlContent = `<?xml version="1.0" encoding="UTF-8"?>
<nmaprun scanner="nmap" args="nmap -sV 192.168.0.1" start="1700000000" version="7.93">
  <host>
    <status state="up" reason="arp-response"/>
    <address addr="192.168.0.100" addrtype="ipv4"/>
    <address addr="00:11:22:33:44:55" addrtype="mac" vendor="Apple"/>
    <hostnames>
      <hostname name="my-apple-device" type="user"/>
    </hostnames>
    <ports>
      <port protocol="tcp" portid="22">
        <state state="open" reason="syn-ack"/>
        <service name="ssh\x02" product="OpenSSH" version="8.4p1\\x00"/>
      </port>
      <port protocol="tcp" portid="80">
        <state state="open" reason="syn-ack"/>
        <service name="http" product="nginx" version="1.18.0"/>
      </port>
      <port protocol="tcp" portid="443">
        <state state="closed" reason="conn-refused"/>
      </port>
    </ports>
  </host>
</nmaprun>`;

  const { hosts, errors } = parseNmapXml(xmlContent);
  assert.strictEqual(errors.length, 0);
  assert.strictEqual(hosts.length, 1);
  
  const host = hosts[0];
  assert.strictEqual(host.ip, '192.168.0.100');
  assert.strictEqual(host.mac, '00:11:22:33:44:55');
  assert.strictEqual(host.vendor, 'Apple');
  assert.strictEqual(host.hostname, 'my-apple-device');
  assert.strictEqual(host.ports.length, 2);
  
  // Test sanitization & port values
  assert.strictEqual(host.ports[0].port, 22);
  assert.strictEqual(host.ports[0].serviceName, 'ssh');
  assert.strictEqual(host.ports[0].serviceVersion, 'OpenSSH 8.4p1\\x00');
});

test('parseNmapXml validates strict port typing and required fields', () => {
  const xmlInvalidPort = `<?xml version="1.0"?>
<nmaprun>
  <host>
    <status state="up"/>
    <address addr="192.168.0.100" addrtype="ipv4"/>
    <ports>
      <port protocol="tcp" portid="999999">
        <state state="open"/>
      </port>
    </ports>
  </host>
</nmaprun>`;

  const { hosts, errors } = parseNmapXml(xmlInvalidPort);
  assert.strictEqual(errors.length, 1);
  assert.match(errors[0], /invalid port/);

  const xmlMissingAddress = `<?xml version="1.0"?>
<nmaprun>
  <host>
    <status state="up"/>
    <ports>
      <port protocol="tcp" portid="80">
        <state state="open"/>
      </port>
    </ports>
  </host>
</nmaprun>`;

  const res = parseNmapXml(xmlMissingAddress);
  assert.strictEqual(res.errors.length, 1);
  assert.match(res.errors[0], /missing both IP and MAC/);
});

test('parseNmapJson parses custom format JSON', () => {
  const jsonContent = JSON.stringify({
    hosts: [
      {
        ip: '192.168.1.5',
        mac: 'aa:bb:cc:dd:ee:ff',
        vendor: 'Raspberry Pi Foundation',
        hostname: 'pi-hole',
        status: 'up',
        ports: [
          {
            port: 80,
            protocol: 'tcp',
            serviceName: 'http\x05',
            serviceVersion: 'lighttpd'
          }
        ]
      }
    ]
  });

  const { hosts, errors } = parseNmapJson(jsonContent);
  assert.strictEqual(errors.length, 0);
  assert.strictEqual(hosts.length, 1);
  
  const host = hosts[0];
  assert.strictEqual(host.ip, '192.168.1.5');
  assert.strictEqual(host.mac, 'aa:bb:cc:dd:ee:ff');
  assert.strictEqual(host.ports[0].port, 80);
  assert.strictEqual(host.ports[0].serviceName, 'http');
});

test('parseNmapJson parses converted Nmap XML json format', () => {
  const jsonContent = JSON.stringify({
    nmaprun: {
      host: [
        {
          status: { _attributes: { state: 'up' } },
          address: [
            { _attributes: { addr: '10.0.0.1', addrtype: 'ipv4' } }
          ],
          hostnames: {
            hostname: { _attributes: { name: 'router.local' } }
          },
          ports: {
            port: [
              {
                _attributes: { protocol: 'tcp', portid: '53' },
                state: { _attributes: { state: 'open' } },
                service: { _attributes: { name: 'dns', product: 'dnsmasq', version: '2.85' } }
              }
            ]
          }
        }
      ]
    }
  });

  const { hosts, errors } = parseNmapJson(jsonContent);
  assert.strictEqual(errors.length, 0);
  assert.strictEqual(hosts.length, 1);
  
  const host = hosts[0];
  assert.strictEqual(host.ip, '10.0.0.1');
  assert.strictEqual(host.hostname, 'router.local');
  assert.strictEqual(host.ports[0].port, 53);
  assert.strictEqual(host.ports[0].serviceName, 'dns');
  assert.strictEqual(host.ports[0].serviceVersion, 'dnsmasq 2.85');
});

test('validateNmapData detects XML vs JSON auto-discovery format', () => {
  const xmlPayload = '<nmaprun><host><status state="up"/><address addr="1.2.3.4" addrtype="ipv4"/></host></nmaprun>';
  const jsonPayload = '{"hosts":[{"ip":"1.2.3.4"}]}';

  const resXml = validateNmapData(xmlPayload, 'application/xml');
  assert.strictEqual(resXml.valid, true);
  assert.strictEqual(resXml.hosts[0].ip, '1.2.3.4');

  const resJson = validateNmapData(jsonPayload, 'application/json');
  assert.strictEqual(resJson.valid, true);
  assert.strictEqual(resJson.hosts[0].ip, '1.2.3.4');
});

test('parseXmlAttributes handles single quotes and extra spacing', () => {
  const attrs = parseXmlAttributes(`<address addr='192.168.0.50' addrtype="mac"   vendor='Raspberry Pi' />`);
  assert.strictEqual(attrs.addr, '192.168.0.50');
  assert.strictEqual(attrs.addrtype, 'mac');
  assert.strictEqual(attrs.vendor, 'Raspberry Pi');
});

test('parseNmapXml parses non-sequential attributes', () => {
  const xmlContent = `<?xml version="1.0" encoding="UTF-8"?>
<nmaprun scanner="nmap" args="nmap -sV 192.168.0.1" start="1700000000" version="7.93">
  <host>
    <status reason="arp-response" state="up"/>
    <address addrtype="ipv4" addr="192.168.0.100"/>
    <address vendor="Apple" addrtype="mac" addr="00:11:22:33:44:55"/>
    <ports>
      <port protocol="tcp" portid="80">
        <state state="open" reason="syn-ack"/>
        <service product="nginx" name="http" version="1.18.0"/>
      </port>
    </ports>
  </host>
</nmaprun>`;

  const { hosts, errors } = parseNmapXml(xmlContent);
  assert.strictEqual(errors.length, 0);
  assert.strictEqual(hosts.length, 1);
  assert.strictEqual(hosts[0].ip, '192.168.0.100');
  assert.strictEqual(hosts[0].mac, '00:11:22:33:44:55');
  assert.strictEqual(hosts[0].vendor, 'Apple');
  assert.strictEqual(hosts[0].ports[0].serviceName, 'http');
  assert.strictEqual(hosts[0].ports[0].serviceVersion, 'nginx 1.18.0');
});

test('parseNmapJson parses xml2js style "$" attribute format', () => {
  const jsonContent = JSON.stringify({
    nmaprun: {
      host: [
        {
          status: { $: { state: 'up' } },
          address: [
            { $: { addr: '10.0.0.1', addrtype: 'ipv4' } }
          ],
          hostnames: {
            hostname: { $: { name: 'router.local' } }
          },
          ports: {
            port: [
              {
                $: { protocol: 'tcp', portid: '53' },
                state: { $: { state: 'open' } },
                service: { $: { name: 'dns', product: 'dnsmasq', version: '2.85' } }
              }
            ]
          }
        }
      ]
    }
  });

  const { hosts, errors } = parseNmapJson(jsonContent);
  assert.strictEqual(errors.length, 0);
  assert.strictEqual(hosts.length, 1);
  assert.strictEqual(hosts[0].ip, '10.0.0.1');
  assert.strictEqual(hosts[0].hostname, 'router.local');
  assert.strictEqual(hosts[0].ports[0].port, 53);
  assert.strictEqual(hosts[0].ports[0].serviceName, 'dns');
  assert.strictEqual(hosts[0].ports[0].serviceVersion, 'dnsmasq 2.85');
});
