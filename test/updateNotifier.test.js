import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import {
  isNewerVersion,
  getCliVersion,
  getUpdateCache,
  saveUpdateCache,
  checkForUpdates,
  formatUpdateBanner,
  DEFAULT_CACHE_TTL_MS
} from '../src/lib/updateNotifier.js';
import { UPDATE_CHECK_FILE } from '../src/lib/paths.js';

describe('updateNotifier module', () => {
  const backupCache = fs.existsSync(UPDATE_CHECK_FILE)
    ? fs.readFileSync(UPDATE_CHECK_FILE, 'utf8')
    : null;

  beforeEach(() => {
    if (fs.existsSync(UPDATE_CHECK_FILE)) {
      fs.unlinkSync(UPDATE_CHECK_FILE);
    }
  });

  afterEach(() => {
    if (backupCache !== null) {
      fs.writeFileSync(UPDATE_CHECK_FILE, backupCache, 'utf8');
    } else if (fs.existsSync(UPDATE_CHECK_FILE)) {
      fs.unlinkSync(UPDATE_CHECK_FILE);
    }
  });

  describe('isNewerVersion', () => {
    it('returns true when latest patch version is higher', () => {
      expect(isNewerVersion('1.2.1', '1.2.2')).toBe(true);
    });

    it('returns true when latest minor version is higher', () => {
      expect(isNewerVersion('1.2.1', '1.3.0')).toBe(true);
    });

    it('returns true when latest major version is higher', () => {
      expect(isNewerVersion('1.2.1', '2.0.0')).toBe(true);
    });

    it('handles "v" prefix in versions', () => {
      expect(isNewerVersion('v1.2.1', 'v1.3.0')).toBe(true);
      expect(isNewerVersion('1.2.1', 'v1.3.0')).toBe(true);
      expect(isNewerVersion('v1.2.1', '1.3.0')).toBe(true);
    });

    it('returns false when versions are identical', () => {
      expect(isNewerVersion('1.2.1', '1.2.1')).toBe(false);
      expect(isNewerVersion('v1.2.1', '1.2.1')).toBe(false);
    });

    it('returns false when latest is an older version', () => {
      expect(isNewerVersion('1.3.0', '1.2.1')).toBe(false);
      expect(isNewerVersion('2.0.0', '1.9.9')).toBe(false);
    });

    it('returns false on invalid or null inputs', () => {
      expect(isNewerVersion(null, '1.3.0')).toBe(false);
      expect(isNewerVersion('1.2.1', null)).toBe(false);
      expect(isNewerVersion('', '')).toBe(false);
    });
  });

  describe('getCliVersion', () => {
    it('returns a valid semver version string', () => {
      const ver = getCliVersion();
      expect(ver).toMatch(/^\d+\.\d+\.\d+$/);
    });
  });

  describe('cache operations', () => {
    it('returns default empty values when cache does not exist', () => {
      const cache = getUpdateCache();
      expect(cache.lastChecked).toBe(0);
      expect(cache.latestVersion).toBeNull();
    });

    it('saves and reloads cache', () => {
      const now = Date.now();
      saveUpdateCache({ lastChecked: now, latestVersion: '1.5.0' });

      const loaded = getUpdateCache();
      expect(loaded.lastChecked).toBe(now);
      expect(loaded.latestVersion).toBe('1.5.0');
    });
  });

  describe('checkForUpdates with cache', () => {
    it('returns cached version without network call when cache is fresh', async () => {
      const now = Date.now();
      saveUpdateCache({ lastChecked: now, latestVersion: '1.9.0' });

      const result = await checkForUpdates({
        currentVersion: '1.2.1',
        cacheTtlMs: DEFAULT_CACHE_TTL_MS,
        force: false
      });

      expect(result.fromCache).toBe(true);
      expect(result.latestVersion).toBe('1.9.0');
      expect(result.hasUpdate).toBe(true);
    });

    it('reports no update when cached version equals current version', async () => {
      const now = Date.now();
      saveUpdateCache({ lastChecked: now, latestVersion: '1.2.1' });

      const result = await checkForUpdates({
        currentVersion: '1.2.1',
        cacheTtlMs: DEFAULT_CACHE_TTL_MS,
        force: false
      });

      expect(result.fromCache).toBe(true);
      expect(result.hasUpdate).toBe(false);
    });
  });

  describe('formatUpdateBanner', () => {
    it('formats a banner with versions and update instructions', () => {
      const banner = formatUpdateBanner('1.2.1', '1.3.0');
      expect(banner).toContain('1.2.1');
      expect(banner).toContain('1.3.0');
      expect(banner).toContain('linksy update');
      expect(banner).toContain('Update available:');
    });
  });
});
