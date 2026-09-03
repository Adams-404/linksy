import { logger } from '../utils/logger.js';

export const GITHUB_RELEASES_API_URL = 'https://api.github.com/repos/Genymobile/gnirehtet/releases/latest';
export const FALLBACK_RELEASES_URL = 'https://github.com/Genymobile/gnirehtet/releases';
export const LINUX64_ASSET_REGEX = /linux64.*\.zip$/i;

/**
 * Finds the linux64 release asset from a list of release assets.
 * @param {Array<object>} assets - The assets array from GitHub release API.
 * @returns {object|null} The matching asset or null.
 */
export function findLinuxAsset(assets) {
  if (!Array.isArray(assets)) {
    return null;
  }

  for (const asset of assets) {
    if (asset && asset.name && LINUX64_ASSET_REGEX.test(asset.name)) {
      return asset;
    }
    if (asset && asset.browser_download_url && LINUX64_ASSET_REGEX.test(asset.browser_download_url)) {
      return asset;
    }
  }

  return null;
}

/**
 * Fetches JSON with a single retry on failure.
 * @param {string} url
 * @param {RequestInit} options
 * @returns {Promise<any>}
 */
async function fetchWithRetry(url, options = {}, retries = 1) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      if (attempt > 0) {
        logger.warn('Retrying GitHub API request...');
        await new Promise(resolve => setTimeout(resolve, 1500));
      }

      const response = await fetch(url, {
        headers: {
          'User-Agent': 'linksy-cli',
          'Accept': 'application/vnd.github.v3+json',
          ...options.headers
        },
        ...options
      });

      if (!response.ok) {
        throw new Error(`GitHub API returned HTTP ${response.status} (${response.statusText})`);
      }

      return await response.json();
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

/**
 * Dynamically resolves the latest Gnirehtet release and matching linux64 asset.
 * @returns {Promise<{ version: string, assetName: string, downloadUrl: string, size: number }>}
 */
export async function fetchLatestGnirehtetRelease() {
  let releaseData;
  try {
    releaseData = await fetchWithRetry(GITHUB_RELEASES_API_URL);
  } catch (err) {
    logger.error('Failed to communicate with GitHub API to resolve latest Gnirehtet release.', err);
    logger.info(`You can check releases manually at: ${FALLBACK_RELEASES_URL}`);
    throw new Error(`GitHub API request failed: ${err.message}`);
  }

  const asset = findLinuxAsset(releaseData.assets);
  if (!asset) {
    logger.error('No compatible linux64 asset found in the latest Gnirehtet release.');
    logger.info(`Please check the Gnirehtet releases page directly: ${FALLBACK_RELEASES_URL}`);
    throw new Error('No compatible linux64 asset found in latest release');
  }

  return {
    version: releaseData.tag_name || releaseData.name || 'latest',
    assetName: asset.name,
    downloadUrl: asset.browser_download_url,
    size: asset.size
  };
}
