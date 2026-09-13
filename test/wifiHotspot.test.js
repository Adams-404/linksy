import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'node:fs';
import {
  parseActiveWifiInfo,
  generateHostapdConfig,
  getWifiHotspotStatus,
  getDefaultHotspotSsid,
  generateApMac,
  parseRegulatoryBands,
  isChannelCompatibleWithRegion,
  normalizeBand,
  getSystemCountryFallback,
  isHotspotRunning,
  generateStartScript,
  generateStopScript
} from '../src/lib/wifiHotspot.js';
import { WIFI_PID_FILE } from '../src/lib/paths.js';

describe('wifiHotspot - parseActiveWifiInfo', () => {
  it('correctly parses 5GHz active connection details', () => {
    const output = `
Connected to 0e:ea:14:1c:5f:8f (on wlp0s20f3)
	SSID: Silicon_Rubi_Hotspot
	freq: 5785.0
	RX: 378903275 bytes (414340 packets)
Interface wlp0s20f3
	channel 157 (5785 MHz), width: 40 MHz, center1: 5795 MHz
    `;

    const parsed = parseActiveWifiInfo(output);
    expect(parsed.connected).toBe(true);
    expect(parsed.channel).toBe(157);
    expect(parsed.freq).toBe(5785);
    expect(parsed.hwMode).toBe('a');
    expect(parsed.ssid).toBe('Silicon_Rubi_Hotspot');
    expect(parsed.width).toBe(40);
  });

  it('correctly parses 2.4GHz active connection details', () => {
    const output = `
Connected to aa:bb:cc:dd:ee:ff (on wlan0)
	SSID: Home_Network_2G
	freq: 2437.0
Interface wlan0
	channel 6 (2437 MHz), width: 20 MHz
    `;

    const parsed = parseActiveWifiInfo(output);
    expect(parsed.connected).toBe(true);
    expect(parsed.channel).toBe(6);
    expect(parsed.freq).toBe(2437);
    expect(parsed.hwMode).toBe('g');
    expect(parsed.ssid).toBe('Home_Network_2G');
    expect(parsed.width).toBe(20);
  });

  it('returns disconnected when input is empty or disconnected', () => {
    expect(parseActiveWifiInfo('')).toEqual({
      connected: false,
      channel: null,
      freq: null,
      hwMode: null,
      ssid: null,
      width: null
    });
    expect(parseActiveWifiInfo('Not connected.')).toEqual({
      connected: false,
      channel: null,
      freq: null,
      hwMode: null,
      ssid: null,
      width: null
    });
  });
});

describe('wifiHotspot - generateHostapdConfig', () => {
  it('generates valid hostapd configuration for 5GHz', () => {
    const conf = generateHostapdConfig({
      apIface: 'ap0',
      ssid: 'TestHotspot',
      password: 'mock_hotspot_key',
      channel: 157,
      hwMode: 'a'
    });

    expect(conf).toContain('interface=ap0');
    expect(conf).toContain('ssid=TestHotspot');
    expect(conf).toContain('hw_mode=a');
    expect(conf).toContain('channel=157');
    expect(conf).toContain('ieee80211ac=1');
    expect(conf).toContain('wpa=2');
    expect(conf).toContain('wpa_passphrase=mock_hotspot_key');
  });

  it('generates valid hostapd configuration for 2.4GHz', () => {
    const conf = generateHostapdConfig({
      apIface: 'wlan0_ap',
      ssid: 'GuestWifi',
      password: 'mock_hotspot_key',
      channel: 11,
      hwMode: 'g'
    });

    expect(conf).toContain('interface=wlan0_ap');
    expect(conf).toContain('ssid=GuestWifi');
    expect(conf).toContain('hw_mode=g');
    expect(conf).toContain('channel=11');
    expect(conf).not.toContain('ieee80211ac=1');
    expect(conf).toContain('wpa_passphrase=mock_hotspot_key');
  });

  it('generates open network configuration when password is null or not provided', () => {
    const conf = generateHostapdConfig({
      apIface: 'ap0',
      ssid: 'OpenHotspot',
      password: null,
      channel: 157,
      hwMode: 'a'
    });

    expect(conf).toContain('interface=ap0');
    expect(conf).toContain('ssid=OpenHotspot');
    expect(conf).toContain('auth_algs=1');
    expect(conf).not.toContain('wpa=2');
    expect(conf).not.toContain('wpa_passphrase=');
  });

  it('omits country_code by default to prevent regulatory update stalls on self-managed firmware', () => {
    const conf = generateHostapdConfig({
      apIface: 'ap0',
      ssid: 'TestHotspot',
      channel: 157,
      hwMode: 'a'
    });

    expect(conf).not.toContain('country_code=');
    expect(conf).not.toContain('ieee80211d=');
  });

  it('includes country_code and ieee80211d when explicitly specified', () => {
    const conf = generateHostapdConfig({
      apIface: 'ap0',
      ssid: 'TestHotspot',
      channel: 157,
      hwMode: 'a',
      countryCode: 'US'
    });

    expect(conf).toContain('country_code=US');
    expect(conf).toContain('ieee80211d=1');
  });
});

describe('wifiHotspot - getWifiHotspotStatus', () => {
  it('reports status object with running, pid, ssid, channel, and password properties', () => {
    const status = getWifiHotspotStatus();
    expect(status).toHaveProperty('running');
    expect(typeof status.running).toBe('boolean');
    expect(status).toHaveProperty('pid');
    expect(status).toHaveProperty('ssid');
    expect(status).toHaveProperty('channel');
    expect(status).toHaveProperty('password');
  });
});

describe('wifiHotspot - getDefaultHotspotSsid', () => {
  it('returns a non-empty string starting with Linksy-', () => {
    const ssid = getDefaultHotspotSsid();
    expect(typeof ssid).toBe('string');
    expect(ssid.startsWith('Linksy-')).toBe(true);
    expect(ssid.length).toBeGreaterThan(7);
    expect(ssid.length).toBeLessThanOrEqual(32);
  });

  it('contains valid SSID characters without spaces', () => {
    const ssid = getDefaultHotspotSsid();
    expect(ssid).toMatch(/^[a-zA-Z0-9_-]+$/);
  });
});

describe('wifiHotspot - generateApMac', () => {
  it('generates a distinct LAA MAC address from physical MAC', () => {
    const apMac = generateApMac('82:66:e9:b9:4f:8c');
    expect(apMac).toBe('82:66:e9:b9:4f:8d');
  });

  it('sets bit 1 (locally administered) and clears bit 0 (unicast)', () => {
    const apMac = generateApMac('00:11:22:33:44:55');
    expect(apMac).toBe('02:11:22:33:44:56');
  });

  it('handles last octet overflow with modulo 256 wrap-around', () => {
    const apMac = generateApMac('82:66:e9:b9:4f:ff');
    expect(apMac).toBe('82:66:e9:b9:4f:00');
  });

  it('returns null for empty, null, or malformed MAC addresses', () => {
    expect(generateApMac(null)).toBeNull();
    expect(generateApMac('')).toBeNull();
    expect(generateApMac('not-a-mac')).toBeNull();
    expect(generateApMac('00:11:22:33:44')).toBeNull();
  });
});

describe('wifiHotspot - parseRegulatoryBands', () => {
  it('parses country code and frequency ranges from iw reg get output', () => {
    const raw = `
global
country NG: DFS-ETSI
	(2402 - 2482 @ 40), (N/A, 20), (N/A)
	(5250 - 5330 @ 80), (N/A, 30), (0 ms), DFS
	(5735 - 5835 @ 80), (N/A, 30), (N/A)
    `;

    const parsed = parseRegulatoryBands(raw);
    expect(parsed.country).toBe('NG');
    expect(parsed.ranges).toHaveLength(3);
    expect(parsed.ranges[0]).toEqual({ start: 2402, end: 2482, bw: 40 });
    expect(parsed.ranges[1]).toEqual({ start: 5250, end: 5330, bw: 80 });
    expect(parsed.ranges[2]).toEqual({ start: 5735, end: 5835, bw: 80 });
  });

  it('handles empty or malformed output gracefully', () => {
    expect(parseRegulatoryBands('')).toEqual({ country: null, ranges: [] });
    expect(parseRegulatoryBands(null)).toEqual({ country: null, ranges: [] });
  });
});

describe('wifiHotspot - isChannelCompatibleWithRegion', () => {
  it('permits 2.4 GHz channels 1 through 13 in Nigeria (NG)', () => {
    const res = isChannelCompatibleWithRegion({ channel: 6, freq: 2437, countryCode: 'NG' });
    expect(res.compatible).toBe(true);
    expect(res.band).toBe('2.4GHz');
  });

  it('permits 5 GHz Channel 149 in Nigeria (5.8 GHz Band 4 is allowed)', () => {
    const res = isChannelCompatibleWithRegion({ channel: 149, freq: 5745, countryCode: 'NG' });
    expect(res.compatible).toBe(true);
    expect(res.band).toBe('5GHz');
  });

  it('permits 5 GHz Channel 52 (DFS) in Nigeria', () => {
    const res = isChannelCompatibleWithRegion({ channel: 52, freq: 5260, countryCode: 'NG' });
    expect(res.compatible).toBe(true);
    expect(res.band).toBe('5GHz');
  });

  it('rejects 5 GHz Channel 48 in Nigeria (restricted for mobile devices under NCC/ETSI rules)', () => {
    const res = isChannelCompatibleWithRegion({ channel: 48, freq: 5240, countryCode: 'NG' });
    expect(res.compatible).toBe(false);
    expect(res.country).toBe('NG');
    expect(res.reason).toContain('restricted in Nigeria (NG)');
  });

  it('rejects 5 GHz Channel 36 in Nigeria', () => {
    const res = isChannelCompatibleWithRegion({ channel: 36, freq: 5180, countryCode: 'NG' });
    expect(res.compatible).toBe(false);
    expect(res.country).toBe('NG');
  });

  it('rejects 5 GHz Channel 100 in Nigeria', () => {
    const res = isChannelCompatibleWithRegion({ channel: 100, freq: 5500, countryCode: 'NG' });
    expect(res.compatible).toBe(false);
    expect(res.country).toBe('NG');
  });

  it('allows 5 GHz Channel 48 in the US', () => {
    const res = isChannelCompatibleWithRegion({ channel: 48, freq: 5240, countryCode: 'US' });
    expect(res.compatible).toBe(true);
  });

  it('rejects Channel 14 outside Japan', () => {
    const res = isChannelCompatibleWithRegion({ channel: 14, freq: 2484, countryCode: 'US' });
    expect(res.compatible).toBe(false);
    expect(res.reason).toContain('Japan');
  });

  it('allows Channel 14 in Japan', () => {
    const res = isChannelCompatibleWithRegion({ channel: 14, freq: 2484, countryCode: 'JP' });
    expect(res.compatible).toBe(true);
  });
});

describe('wifiHotspot - normalizeBand', () => {
  it('normalizes 2.4 GHz variants', () => {
    expect(normalizeBand('2.4')).toBe('2.4');
    expect(normalizeBand('2.4GHz')).toBe('2.4');
    expect(normalizeBand('2g')).toBe('2.4');
    expect(normalizeBand('bg')).toBe('2.4');
  });

  it('normalizes 5 GHz variants', () => {
    expect(normalizeBand('5')).toBe('5');
    expect(normalizeBand('5ghz')).toBe('5');
    expect(normalizeBand('5G')).toBe('5');
    expect(normalizeBand('a')).toBe('5');
  });

  it('returns null for invalid or null band', () => {
    expect(normalizeBand(null)).toBeNull();
    expect(normalizeBand('auto')).toBeNull();
    expect(normalizeBand('invalid')).toBeNull();
  });
});

describe('wifiHotspot - isHotspotRunning', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns false when no pid files exist', () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(false);
    expect(isHotspotRunning()).toBe(false);
  });

  it('returns true when WIFI_PID_FILE points to an active process', () => {
    vi.spyOn(fs, 'existsSync').mockImplementation(p => p === WIFI_PID_FILE);
    vi.spyOn(fs, 'readFileSync').mockReturnValue('12345');
    vi.spyOn(process, 'kill').mockImplementation((pid, sig) => {
      if (pid === 12345 && sig === 0) return true;
      throw new Error('Process not found');
    });
    expect(isHotspotRunning()).toBe(true);
  });

  it('returns true when dnsmasq pid file points to an active process', () => {
    vi.spyOn(fs, 'existsSync').mockImplementation(p => typeof p === 'string' && p.endsWith('.dnsmasq'));
    vi.spyOn(fs, 'readFileSync').mockReturnValue('54321');
    vi.spyOn(process, 'kill').mockImplementation((pid, sig) => {
      if (pid === 54321 && sig === 0) return true;
      throw new Error('Process not found');
    });
    expect(isHotspotRunning()).toBe(true);
  });

  it('returns true when kill throws EPERM (process alive but unprivileged)', () => {
    vi.spyOn(fs, 'existsSync').mockImplementation(p => typeof p === 'string' && p.endsWith('.dnsmasq'));
    vi.spyOn(fs, 'readFileSync').mockReturnValue('54321');
    vi.spyOn(process, 'kill').mockImplementation(() => {
      const err = new Error('EPERM');
      err.code = 'EPERM';
      throw err;
    });
    expect(isHotspotRunning()).toBe(true);
  });

  it('returns false when pid file points to dead process', () => {
    vi.spyOn(fs, 'existsSync').mockImplementation(p => p === WIFI_PID_FILE);
    vi.spyOn(fs, 'readFileSync').mockReturnValue('99999');
    vi.spyOn(process, 'kill').mockImplementation(() => {
      const err = new Error('ESRCH');
      err.code = 'ESRCH';
      throw err;
    });
    expect(isHotspotRunning()).toBe(false);
  });
});

describe('wifiHotspot - script generation', () => {
  it('generates valid start script with robust dnsmasq cleanup and escaped variables', () => {
    const script = generateStartScript({
      activeWifi: { iface: 'wlp0s20f3', channel: 6, hwMode: 'g' },
      apIface: 'ap0',
      adminGroup: 'wheel'
    });

    expect(script).toContain('IFACE="wlp0s20f3"');
    expect(script).toContain('AP_IFACE="ap0"');
    expect(script).toContain('kill -9 "$(cat "${PID_FILE}.dnsmasq")"');
    expect(script).toContain('pkill -9 -f "dnsmasq.*--interface=${AP_IFACE}"');
    expect(script).toContain('pkill -9 -f "dnsmasq.*192\\.168\\.42\\."');
    expect(script).toContain('--pid-file="${PID_FILE}.dnsmasq"');
    expect(script).toContain('ADMIN_GROUP="wheel"');
    expect(script).not.toContain('undefined');
  });

  it('generates valid stop script with robust dnsmasq cleanup and escaped variables', () => {
    const script = generateStopScript({
      iface: 'wlp0s20f3',
      apIface: 'ap0'
    });

    expect(script).toContain('IFACE="wlp0s20f3"');
    expect(script).toContain('AP_IFACE="ap0"');
    expect(script).toContain('kill -9 "$(cat "${PID_FILE}.dnsmasq")"');
    expect(script).toContain('pkill -9 -f "dnsmasq.*--interface=${AP_IFACE}"');
    expect(script).toContain('pkill -9 -f "dnsmasq.*192\\.168\\.42\\."');
    expect(script).toContain('killall -9 hostapd');
    expect(script).toContain('iw dev "$AP_IFACE" del');
    expect(script).not.toContain('undefined');
  });
});

