import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  escapeWifiField,
  generateWifiQrString,
  resolveWifiCredentials,
  renderTerminalQr
} from '../src/lib/qrCode.js';
import { qrCommand } from '../src/commands/qr.js';
import * as configModule from '../src/lib/config.js';
import * as wifiHotspotModule from '../src/lib/wifiHotspot.js';

describe('qrCode library', () => {
  describe('escapeWifiField', () => {
    it('escapes special characters correctly according to ZXing Wi-Fi format', () => {
      expect(escapeWifiField('hello;world')).toBe('hello\\;world');
      expect(escapeWifiField('net:work')).toBe('net\\:work');
      expect(escapeWifiField('back\\slash')).toBe('back\\\\slash');
      expect(escapeWifiField('quote"test')).toBe('quote\\"test');
      expect(escapeWifiField('comma,separated')).toBe('comma\\,separated');
    });

    it('handles empty or null values', () => {
      expect(escapeWifiField('')).toBe('');
      expect(escapeWifiField(null)).toBe('');
      expect(escapeWifiField(undefined)).toBe('');
    });
  });

  describe('generateWifiQrString', () => {
    it('throws error when SSID is missing or empty', () => {
      expect(() => generateWifiQrString({})).toThrow('SSID is required');
      expect(() => generateWifiQrString({ ssid: '' })).toThrow('SSID is required');
      expect(() => generateWifiQrString({ ssid: '   ' })).toThrow('SSID is required');
    });

    it('generates standard WPA Wi-Fi QR string with password', () => {
      const qr = generateWifiQrString({
        ssid: 'Linksy-ThinkPad',
        password: 'linksy12345'
      });
      expect(qr).toBe('WIFI:T:WPA;S:Linksy-ThinkPad;P:linksy12345;;');
    });

    it('generates nopass Wi-Fi QR string for open networks', () => {
      const qr1 = generateWifiQrString({ ssid: 'PublicWifi' });
      expect(qr1).toBe('WIFI:T:nopass;S:PublicWifi;;');

      const qr2 = generateWifiQrString({ ssid: 'PublicWifi', password: null });
      expect(qr2).toBe('WIFI:T:nopass;S:PublicWifi;;');

      const qr3 = generateWifiQrString({ ssid: 'PublicWifi', security: 'nopass' });
      expect(qr3).toBe('WIFI:T:nopass;S:PublicWifi;;');

      const qr4 = generateWifiQrString({ ssid: 'PublicWifi', password: 'open' });
      expect(qr4).toBe('WIFI:T:nopass;S:PublicWifi;;');
    });

    it('supports WEP security type', () => {
      const qr = generateWifiQrString({
        ssid: 'OldNetwork',
        password: '1234567890',
        security: 'WEP'
      });
      expect(qr).toBe('WIFI:T:WEP;S:OldNetwork;P:1234567890;;');
    });

    it('supports hidden network flag', () => {
      const qr = generateWifiQrString({
        ssid: 'HiddenWifi',
        password: 'secretpassword',
        hidden: true
      });
      expect(qr).toBe('WIFI:T:WPA;S:HiddenWifi;P:secretpassword;H:true;;');
    });

    it('escapes special characters inside SSID and password', () => {
      const qr = generateWifiQrString({
        ssid: 'My:Special;SSID',
        password: 'pass"word\\with:semicolon;'
      });
      expect(qr).toBe('WIFI:T:WPA;S:My\\:Special\\;SSID;P:pass\\"word\\\\with\\:semicolon\\;;;');
    });
  });

  describe('resolveWifiCredentials', () => {
    let mockSavedConfig;

    beforeEach(() => {
      mockSavedConfig = {
        wifiSsid: 'Saved-Network',
        wifiPassword: 'saved-password'
      };
      vi.spyOn(configModule, 'getSavedConfig').mockImplementation(() => mockSavedConfig);
      vi.spyOn(wifiHotspotModule, 'getDefaultHotspotSsid').mockReturnValue('Linksy-Default');
      vi.spyOn(wifiHotspotModule, 'getWifiHotspotStatus').mockReturnValue({
        running: false,
        pid: null,
        ssid: null,
        channel: null,
        password: null
      });
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('resolves active hotspot credentials when hotspot is running', () => {
      vi.spyOn(wifiHotspotModule, 'getWifiHotspotStatus').mockReturnValue({
        running: true,
        pid: 1234,
        ssid: 'Active-Linksy-Hotspot',
        channel: 6,
        password: 'active-password'
      });

      const creds = resolveWifiCredentials();
      expect(creds.isActive).toBe(true);
      expect(creds.isCustom).toBe(false);
      expect(creds.ssid).toBe('Active-Linksy-Hotspot');
      expect(creds.password).toBe('active-password');
      expect(creds.isOpen).toBe(false);
    });

    it('resolves active open hotspot when password is null or empty', () => {
      vi.spyOn(wifiHotspotModule, 'getWifiHotspotStatus').mockReturnValue({
        running: true,
        pid: 1234,
        ssid: 'Active-Open-Hotspot',
        channel: 6,
        password: null
      });

      const creds = resolveWifiCredentials();
      expect(creds.isActive).toBe(true);
      expect(creds.ssid).toBe('Active-Open-Hotspot');
      expect(creds.password).toBeNull();
      expect(creds.isOpen).toBe(true);
    });

    it('resolves custom options overriding active or saved settings', () => {
      const creds = resolveWifiCredentials({
        ssid: 'Custom-SSID',
        password: 'custom-pass'
      });
      expect(creds.isCustom).toBe(true);
      expect(creds.ssid).toBe('Custom-SSID');
      expect(creds.password).toBe('custom-pass');
      expect(creds.isOpen).toBe(false);
    });

    it('handles open network flags (--no-password, --open)', () => {
      const creds1 = resolveWifiCredentials({ noPassword: true });
      expect(creds1.isCustom).toBe(true);
      expect(creds1.isOpen).toBe(true);
      expect(creds1.password).toBeNull();

      const creds2 = resolveWifiCredentials({ open: true });
      expect(creds2.isCustom).toBe(true);
      expect(creds2.isOpen).toBe(true);
      expect(creds2.password).toBeNull();
    });

    it('falls back to saved configuration when hotspot is inactive', () => {
      const creds = resolveWifiCredentials();
      expect(creds.isActive).toBe(false);
      expect(creds.isCustom).toBe(false);
      expect(creds.ssid).toBe('Saved-Network');
      expect(creds.password).toBe('saved-password');
      expect(creds.isOpen).toBe(false);
    });

    it('falls back to default SSID and password when saved config is empty', () => {
      vi.spyOn(configModule, 'getSavedConfig').mockReturnValue({});
      const creds = resolveWifiCredentials();
      expect(creds.ssid).toBe('Linksy-Default');
      expect(creds.password).toBe('linksy12345');
      expect(creds.isOpen).toBe(false);
    });
  });

  describe('renderTerminalQr', () => {
    it('renders a valid terminal QR code string', async () => {
      const qrStr = 'WIFI:T:WPA;S:TestSSID;P:TestPassword;;';
      const rendered = await renderTerminalQr(qrStr);
      expect(typeof rendered).toBe('string');
      expect(rendered.length).toBeGreaterThan(50);
      // Contains Unicode half-block characters
      expect(rendered).toMatch(/[▄█▀ ]/);
    });
  });

  describe('qrCommand', () => {
    let logSpy;

    beforeEach(() => {
      logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      vi.spyOn(wifiHotspotModule, 'getDefaultHotspotSsid').mockReturnValue('Linksy-Test');
      vi.spyOn(configModule, 'getSavedConfig').mockReturnValue({
        wifiSsid: 'Linksy-Test',
        wifiPassword: 'linksy12345'
      });
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('executes without error for inactive hotspot', async () => {
      vi.spyOn(wifiHotspotModule, 'getWifiHotspotStatus').mockReturnValue({
        running: false
      });

      await qrCommand();
      expect(logSpy).toHaveBeenCalled();
    });

    it('executes without error for active hotspot', async () => {
      vi.spyOn(wifiHotspotModule, 'getWifiHotspotStatus').mockReturnValue({
        running: true,
        ssid: 'ActiveHotspot',
        password: 'mypassword',
        channel: 6
      });

      await qrCommand();
      expect(logSpy).toHaveBeenCalled();
    });

    it('executes without error for custom options', async () => {
      await qrCommand({ ssid: 'CustomSSID', password: 'CustomPassword' });
      expect(logSpy).toHaveBeenCalled();
    });
  });
});
