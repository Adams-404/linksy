import { describe, it, expect, vi, beforeEach } from 'vitest';
import { nameCommand } from '../src/commands/name.js';
import * as configModule from '../src/lib/config.js';
import * as wifiHotspotModule from '../src/lib/wifiHotspot.js';

describe('nameCommand', () => {
  let mockConfig;

  beforeEach(() => {
    mockConfig = { wifiSsid: 'Linksy-ThinkPad-T490s' };
    vi.spyOn(configModule, 'getSavedConfig').mockImplementation(() => mockConfig);
    vi.spyOn(configModule, 'saveConfig').mockImplementation((newCfg) => {
      mockConfig = { ...mockConfig, ...newCfg };
      return mockConfig;
    });
    vi.spyOn(wifiHotspotModule, 'isHotspotRunning').mockReturnValue(false);
  });

  it('updates wifiSsid when valid newName is passed', async () => {
    await nameCommand('Adams-Hotspot');
    expect(mockConfig.wifiSsid).toBe('Adams-Hotspot');
  });

  it('trims leading and trailing whitespace from newName', async () => {
    await nameCommand('   Office-Wifi   ');
    expect(mockConfig.wifiSsid).toBe('Office-Wifi');
  });

  it('exits with error when newName is longer than 32 characters', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit(1)');
    });

    const tooLongName = 'This-Hotspot-Name-Is-Way-Too-Long-For-80211-SSID';
    await expect(nameCommand(tooLongName)).rejects.toThrow('process.exit(1)');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
