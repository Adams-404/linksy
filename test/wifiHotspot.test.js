import { describe, it, expect } from 'vitest';
import {
  parseActiveWifiInfo,
  generateHostapdConfig,
  getWifiHotspotStatus,
  getDefaultHotspotSsid
} from '../src/lib/wifiHotspot.js';

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
