import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  parseStationDump,
  parseDnsmasqLeases,
  parseArpTable,
  resolveToMac,
  blockDevice,
  unblockDevice,
  whitelistDevice,
  unwhitelistDevice,
  getBlocklist,
  getWhitelist
} from '../src/lib/deviceManager.js';
import * as configModule from '../src/lib/config.js';
import * as wifiHotspotModule from '../src/lib/wifiHotspot.js';
import fs from 'node:fs';

beforeEach(() => {
  vi.spyOn(wifiHotspotModule, 'isHotspotRunning').mockReturnValue(false);
});

describe('deviceManager - parseStationDump', () => {
  it('returns empty array when input is empty or invalid', () => {
    expect(parseStationDump('')).toEqual([]);
    expect(parseStationDump(null)).toEqual([]);
    expect(parseStationDump(undefined)).toEqual([]);
  });

  it('parses single station output with signal, bitrate, and byte counters', () => {
    const sampleOutput = `
Station de:99:a9:f4:57:d6 (on ap0)
	inactive time:	230 ms
	rx bytes:	145023
	rx packets:	1200
	tx bytes:	850123
	tx packets:	1800
	tx retries:	2
	tx failed:	0
	rx drop misc:	0
	signal:  	-26 dBm
	signal avg:	-25 dBm
	tx bitrate:	65.0 MBit/s MCS 7
	rx bitrate:	72.2 MBit/s MCS 7
	rx duration:	152000 us
	tx duration:	210000 us
	expected throughput:	45.2Mbps
	authorized:	yes
	authenticated:	yes
	associated:	yes
	preamble:	long
	WMM/WME:	yes
	MFP:		no
	TDLS peer:	no
	DTIM period:	2
	beacon int:	100
	short preamble:	yes
	short slot time:	yes
	connected time:	185 seconds
    `;

    const result = parseStationDump(sampleOutput);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      mac: 'de:99:a9:f4:57:d6',
      signal: -26,
      txBitrate: '65.0 MBit/s MCS 7',
      rxBitrate: '72.2 MBit/s MCS 7',
      rxBytes: 145023,
      txBytes: 850123,
      connectedTimeSec: 185
    });
  });

  it('parses multiple stations correctly', () => {
    const sampleOutput = `
Station aa:bb:cc:11:22:33 (on ap0)
	rx bytes:	1000
	tx bytes:	2000
	signal:  	-42 dBm
	connected time:	50 seconds
Station 44:55:66:77:88:99 (on ap0)
	rx bytes:	3000
	tx bytes:	4000
	signal:  	-55 dBm
	connected time:	120 seconds
    `;

    const result = parseStationDump(sampleOutput);
    expect(result).toHaveLength(2);
    expect(result[0].mac).toBe('aa:bb:cc:11:22:33');
    expect(result[0].signal).toBe(-42);
    expect(result[1].mac).toBe('44:55:66:77:88:99');
    expect(result[1].signal).toBe(-55);
  });
});

describe('deviceManager - parseDnsmasqLeases', () => {
  it('returns empty map for empty or invalid input', () => {
    expect(parseDnsmasqLeases('').size).toBe(0);
    expect(parseDnsmasqLeases(null).size).toBe(0);
  });

  it('parses leases into a map with IP and hostname', () => {
    const sampleLeases = `
1773024844 de:99:a9:f4:57:d6 192.168.42.29 S26-Ultra 01:de:99:a9:f4:57:d6
1773024900 11:22:33:44:55:66 192.168.42.30 * 01:11:22:33:44:55:66
    `;

    const map = parseDnsmasqLeases(sampleLeases);
    expect(map.size).toBe(2);

    const dev1 = map.get('de:99:a9:f4:57:d6');
    expect(dev1).toEqual({
      ip: '192.168.42.29',
      hostname: 'S26-Ultra'
    });

    const dev2 = map.get('11:22:33:44:55:66');
    expect(dev2).toEqual({
      ip: '192.168.42.30',
      hostname: 'Unknown'
    });
  });
});

describe('deviceManager - parseArpTable', () => {
  it('returns empty map for empty or invalid input', () => {
    expect(parseArpTable('').size).toBe(0);
    expect(parseArpTable(null).size).toBe(0);
  });

  it('parses ARP table lines skipping headers and zero-MACs', () => {
    const sampleArp = `
IP address       HW type     Flags       HW address            Mask     Device
192.168.42.29    0x1         0x2         de:99:a9:f4:57:d6     *        ap0
192.168.42.50    0x1         0x0         00:00:00:00:00:00     *        ap0
192.168.1.1      0x1         0x2         aa:bb:cc:dd:ee:ff     *        wlp0s20f3
    `;

    const map = parseArpTable(sampleArp);
    expect(map.size).toBe(2);
    expect(map.get('de:99:a9:f4:57:d6')).toBe('192.168.42.29');
    expect(map.get('aa:bb:cc:dd:ee:ff')).toBe('192.168.1.1');
    expect(map.has('00:00:00:00:00:00')).toBe(false);
  });
});

describe('deviceManager - resolveToMac', () => {
  it('recognizes direct MAC address string', () => {
    expect(resolveToMac('DE:99:A9:F4:57:D6')).toBe('de:99:a9:f4:57:d6');
    expect(resolveToMac('11:22:33:44:55:66')).toBe('11:22:33:44:55:66');
  });

  it('returns null for non-resolvable random text', () => {
    expect(resolveToMac('non-existent-device-xyz-123')).toBeNull();
    expect(resolveToMac('')).toBeNull();
    expect(resolveToMac(null)).toBeNull();
  });
});

describe('deviceManager - blockDevice and unblockDevice', () => {
  let mockConfig;

  beforeEach(() => {
    mockConfig = { blacklist: [], whitelist: [] };
    vi.spyOn(configModule, 'getSavedConfig').mockImplementation(() => mockConfig);
    vi.spyOn(configModule, 'saveConfig').mockImplementation((newCfg) => {
      mockConfig = { ...mockConfig, ...newCfg };
    });
    vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {});
  });

  it('adds MAC to blacklist on blockDevice', () => {
    const targetMac = 'aa:bb:cc:dd:ee:ff';
    const res = blockDevice(targetMac);
    expect(res.success).toBe(true);
    expect(res.mac).toBe(targetMac);
    expect(getBlocklist()).toContain(targetMac);
  });

  it('removes MAC from blacklist on unblockDevice', () => {
    const targetMac = 'aa:bb:cc:dd:ee:ff';
    mockConfig.blacklist = [targetMac];

    const res = unblockDevice(targetMac);
    expect(res.success).toBe(true);
    expect(res.mac).toBe(targetMac);
    expect(getBlocklist()).not.toContain(targetMac);
  });

  it('fails gracefully when unblocking a non-blocked device', () => {
    const res = unblockDevice('11:22:33:44:55:66');
    expect(res.success).toBe(false);
    expect(res.error).toContain('is not in the blocklist');
  });
});

describe('deviceManager - whitelistDevice and unwhitelistDevice', () => {
  let mockConfig;

  beforeEach(() => {
    mockConfig = { blacklist: [], whitelist: [] };
    vi.spyOn(configModule, 'getSavedConfig').mockImplementation(() => mockConfig);
    vi.spyOn(configModule, 'saveConfig').mockImplementation((newCfg) => {
      mockConfig = { ...mockConfig, ...newCfg };
    });
    vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {});
  });

  it('adds MAC to whitelist on whitelistDevice', () => {
    const targetMac = '12:34:56:78:9a:bc';
    const res = whitelistDevice(targetMac);
    expect(res.success).toBe(true);
    expect(res.mac).toBe(targetMac);
    expect(getWhitelist()).toContain(targetMac);
  });

  it('removes MAC from whitelist on unwhitelistDevice', () => {
    const targetMac = '12:34:56:78:9a:bc';
    mockConfig.whitelist = [targetMac];

    const res = unwhitelistDevice(targetMac);
    expect(res.success).toBe(true);
    expect(res.mac).toBe(targetMac);
    expect(getWhitelist()).not.toContain(targetMac);
  });
});
