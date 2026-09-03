import { describe, it, expect } from 'vitest';
import { findLinuxAsset } from '../src/lib/fetchLatestGnirehtet.js';

describe('fetchLatestGnirehtet - findLinuxAsset', () => {
  const sampleAssets = [
    {
      name: 'SHA256SUMS.txt',
      browser_download_url: 'https://github.com/Genymobile/gnirehtet/releases/download/v2.5.1/SHA256SUMS.txt'
    },
    {
      name: 'gnirehtet-java-v2.5.1.zip',
      browser_download_url: 'https://github.com/Genymobile/gnirehtet/releases/download/v2.5.1/gnirehtet-java-v2.5.1.zip'
    },
    {
      name: 'gnirehtet-rust-linux64-v2.5.1.zip',
      browser_download_url: 'https://github.com/Genymobile/gnirehtet/releases/download/v2.5.1/gnirehtet-rust-linux64-v2.5.1.zip'
    },
    {
      name: 'gnirehtet-rust-win64-v2.5.1.zip',
      browser_download_url: 'https://github.com/Genymobile/gnirehtet/releases/download/v2.5.1/gnirehtet-rust-win64-v2.5.1.zip'
    }
  ];

  it('matches gnirehtet-rust-linux64-v2.5.1.zip correctly', () => {
    const asset = findLinuxAsset(sampleAssets);
    expect(asset).not.toBeNull();
    expect(asset.name).toBe('gnirehtet-rust-linux64-v2.5.1.zip');
  });

  it('matches older naming conventions like gnirehtet-linux64-v2.4.zip', () => {
    const olderAssets = [
      { name: 'gnirehtet-linux64-v2.4.zip', browser_download_url: 'https://example.com/gnirehtet-linux64-v2.4.zip' }
    ];
    const asset = findLinuxAsset(olderAssets);
    expect(asset).not.toBeNull();
    expect(asset.name).toBe('gnirehtet-linux64-v2.4.zip');
  });

  it('matches simple linux64.zip naming', () => {
    const simpleAssets = [
      { name: 'gnirehtet-linux64.zip', browser_download_url: 'https://example.com/gnirehtet-linux64.zip' }
    ];
    const asset = findLinuxAsset(simpleAssets);
    expect(asset).not.toBeNull();
    expect(asset.name).toBe('gnirehtet-linux64.zip');
  });

  it('rejects win64 or java zips when no linux asset is present', () => {
    const nonLinuxAssets = [
      { name: 'gnirehtet-java-v2.5.1.zip', browser_download_url: 'https://example.com/java.zip' },
      { name: 'gnirehtet-rust-win64-v2.5.1.zip', browser_download_url: 'https://example.com/win64.zip' }
    ];
    const asset = findLinuxAsset(nonLinuxAssets);
    expect(asset).toBeNull();
  });

  it('handles null, undefined, or empty assets array safely', () => {
    expect(findLinuxAsset(null)).toBeNull();
    expect(findLinuxAsset(undefined)).toBeNull();
    expect(findLinuxAsset([])).toBeNull();
  });
});
