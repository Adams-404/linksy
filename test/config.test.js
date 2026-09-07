import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import { getSavedConfig, saveConfig } from '../src/lib/config.js';
import { CONFIG_FILE } from '../src/lib/paths.js';

describe('config module', () => {
  const backupConfig = fs.existsSync(CONFIG_FILE) ? fs.readFileSync(CONFIG_FILE, 'utf8') : null;

  beforeEach(() => {
    if (fs.existsSync(CONFIG_FILE)) {
      fs.unlinkSync(CONFIG_FILE);
    }
  });

  afterEach(() => {
    if (backupConfig !== null) {
      fs.writeFileSync(CONFIG_FILE, backupConfig, 'utf8');
    } else if (fs.existsSync(CONFIG_FILE)) {
      fs.unlinkSync(CONFIG_FILE);
    }
  });

  it('returns empty object when config does not exist', () => {
    expect(getSavedConfig()).toEqual({});
  });

  it('saves and reads back configuration', () => {
    saveConfig({ wifiPassword: 'mock_pass_val_123', wifiSsid: 'MyPhoneNet' });
    const loaded = getSavedConfig();
    expect(loaded.wifiPassword).toBe('mock_pass_val_123');
    expect(loaded.wifiSsid).toBe('MyPhoneNet');
  });

  it('merges new configuration with existing fields', () => {
    saveConfig({ wifiPassword: 'mock_pass_val_456' });
    saveConfig({ wifiSsid: 'ssid1' });
    const loaded = getSavedConfig();
    expect(loaded.wifiPassword).toBe('mock_pass_val_456');
    expect(loaded.wifiSsid).toBe('ssid1');
  });
});
