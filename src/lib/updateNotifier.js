import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import chalk from 'chalk';
import { UPDATE_CHECK_FILE, LINKSY_DIR } from './paths.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const DEFAULT_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
export const NPM_REGISTRY_URL = 'https://registry.npmjs.org/linksy-phonenet/latest';

let cachedVersion = null;
let hasNotified = false;

/**
 * Returns current Linksy CLI version from package.json.
 * @returns {string}
 */
export function getCliVersion() {
  if (cachedVersion) return cachedVersion;
  try {
    const pkgPath = path.resolve(__dirname, '../../package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    cachedVersion = pkg.version || '1.2.1';
    return cachedVersion;
  } catch {
    return '1.2.1';
  }
}

/**
 * Compares two semantic version strings (e.g. "1.2.1" vs "1.3.0").
 * Returns true if latest is strictly greater than current.
 * @param {string} current
 * @param {string} latest
 * @returns {boolean}
 */
export function isNewerVersion(current, latest) {
  if (!latest || !current) return false;
  const cleanCur = String(current).replace(/^v/i, '').trim();
  const cleanLat = String(latest).replace(/^v/i, '').trim();

  const curParts = cleanCur.split('.').map(n => parseInt(n, 10) || 0);
  const latParts = cleanLat.split('.').map(n => parseInt(n, 10) || 0);

  for (let i = 0; i < 3; i++) {
    const c = curParts[i] ?? 0;
    const l = latParts[i] ?? 0;
    if (l > c) return true;
    if (l < c) return false;
  }
  return false;
}

/**
 * Reads cached update metadata from ~/.linksy/update-check.json.
 * @returns {{ lastChecked: number, latestVersion: string | null }}
 */
export function getUpdateCache() {
  if (fs.existsSync(UPDATE_CHECK_FILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(UPDATE_CHECK_FILE, 'utf8'));
      return {
        lastChecked: typeof data.lastChecked === 'number' ? data.lastChecked : 0,
        latestVersion: typeof data.latestVersion === 'string' ? data.latestVersion : null
      };
    } catch {
      return { lastChecked: 0, latestVersion: null };
    }
  }
  return { lastChecked: 0, latestVersion: null };
}

/**
 * Saves update metadata to ~/.linksy/update-check.json.
 * @param {{ lastChecked?: number, latestVersion?: string }} data
 */
export function saveUpdateCache(data = {}) {
  try {
    if (!fs.existsSync(LINKSY_DIR)) {
      fs.mkdirSync(LINKSY_DIR, { recursive: true });
    }
    const current = getUpdateCache();
    const updated = {
      lastChecked: data.lastChecked || Date.now(),
      latestVersion: data.latestVersion || current.latestVersion || null
    };
    fs.writeFileSync(UPDATE_CHECK_FILE, JSON.stringify(updated, null, 2), 'utf8');
    return updated;
  } catch {
    return { lastChecked: 0, latestVersion: null };
  }
}

/**
 * Fetches the latest published version of linksy-phonenet from the NPM registry.
 * @param {number} [timeoutMs=3000]
 * @returns {Promise<string | null>}
 */
export async function fetchLatestVersion(timeoutMs = 3000) {
  try {
    const res = await fetch(NPM_REGISTRY_URL, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { Accept: 'application/json' }
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data && typeof data.version === 'string' ? data.version : null;
  } catch {
    return null;
  }
}

/**
 * Checks for available updates. Uses 24h cache by default unless force is true.
 * @param {object} [options]
 * @param {string} [options.currentVersion]
 * @param {number} [options.timeoutMs=3000]
 * @param {boolean} [options.force=false]
 * @param {number} [options.cacheTtlMs=DEFAULT_CACHE_TTL_MS]
 * @returns {Promise<{ currentVersion: string, latestVersion: string, hasUpdate: boolean, fromCache: boolean, error?: boolean }>}
 */
export async function checkForUpdates({
  currentVersion = getCliVersion(),
  timeoutMs = 3000,
  force = false,
  cacheTtlMs = DEFAULT_CACHE_TTL_MS
} = {}) {
  const cache = getUpdateCache();
  const cacheAge = Date.now() - cache.lastChecked;

  // Use fresh cache if available and not forcing network check
  if (!force && cacheAge < cacheTtlMs && cache.latestVersion) {
    return {
      currentVersion,
      latestVersion: cache.latestVersion,
      hasUpdate: isNewerVersion(currentVersion, cache.latestVersion),
      fromCache: true
    };
  }

  // Query registry
  const latest = await fetchLatestVersion(timeoutMs);
  if (latest) {
    saveUpdateCache({ lastChecked: Date.now(), latestVersion: latest });
    return {
      currentVersion,
      latestVersion: latest,
      hasUpdate: isNewerVersion(currentVersion, latest),
      fromCache: false
    };
  }

  // Network check failed (offline or timeout) — fallback to cache if available
  return {
    currentVersion,
    latestVersion: cache.latestVersion || currentVersion,
    hasUpdate: cache.latestVersion ? isNewerVersion(currentVersion, cache.latestVersion) : false,
    fromCache: true,
    error: true
  };
}

/**
 * Spawns an unref'd detached background process to update the cache file
 * without blocking or slowing down user commands.
 */
export function triggerBackgroundUpdateCheck() {
  if (process.env.NO_UPDATE_NOTIFIER || process.env.CI) return;

  const cache = getUpdateCache();
  const cacheAge = Date.now() - cache.lastChecked;

  // Only spawn if cache is older than TTL
  if (cacheAge < DEFAULT_CACHE_TTL_MS) return;

  try {
    const workerScript = path.join(__dirname, 'updateWorker.js');
    const child = spawn(process.execPath, [workerScript], {
      detached: true,
      stdio: 'ignore'
    });
    child.unref();
  } catch {
    // Ignore spawn failures
  }
}

/**
 * Returns formatted terminal update banner string.
 * @param {string} current
 * @param {string} latest
 * @returns {string}
 */
export function formatUpdateBanner(current, latest) {
  const line1Text = `  Update available: ${current} → ${latest}`;
  const line2Text = `  Run: linksy update`;
  const maxLen = Math.max(line1Text.length, line2Text.length) + 4;
  const dashes = '─'.repeat(maxLen);

  const pad1 = ' '.repeat(maxLen - line1Text.length);
  const pad2 = ' '.repeat(maxLen - line2Text.length);

  const lines = [
    '',
    chalk.yellow(`╭${dashes}╮`),
    chalk.yellow('│') +
      chalk.bold.yellow('  Update available: ') +
      chalk.dim(current) +
      chalk.bold.yellow(' → ') +
      chalk.bold.green(latest) +
      pad1 +
      chalk.yellow('│'),
    chalk.yellow('│') +
      chalk.dim('  Run: ') +
      chalk.cyan.bold('linksy update') +
      pad2 +
      chalk.yellow('│'),
    chalk.yellow(`╰${dashes}╯`),
    ''
  ];

  return lines.join('\n');
}

/**
 * Renders the update notification banner to stdout.
 * @param {string} current
 * @param {string} latest
 */
export function renderUpdateBanner(current, latest) {
  console.log(formatUpdateBanner(current, latest));
}

/**
 * Checks cache synchronously and prints update notification if an update is available.
 * Also triggers a background refresh if cache is expired.
 * Guaranteed to execute in under 1ms and never block commands.
 * @param {string} [currentVersion]
 */
export function notifyIfUpdateAvailable(currentVersion = getCliVersion()) {
  if (hasNotified) return;
  if (process.env.NO_UPDATE_NOTIFIER || process.env.CI) return;
  if (!process.stdout.isTTY) return;

  // 1. Read existing cache to see if an update was previously discovered
  const cache = getUpdateCache();
  if (cache.latestVersion && isNewerVersion(currentVersion, cache.latestVersion)) {
    renderUpdateBanner(currentVersion, cache.latestVersion);
    hasNotified = true;
  }

  // 2. Refresh cache asynchronously in the background if expired
  triggerBackgroundUpdateCheck();
}
