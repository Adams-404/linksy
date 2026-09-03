import { execSync } from 'node:child_process';
import { logger } from '../utils/logger.js';

/**
 * Parses stdout from `adb devices`.
 * @param {string} stdout
 * @returns {Array<{ serial: string, state: string, isAuthorized: boolean }>}
 */
export function parseAdbDevices(stdout) {
  if (!stdout || typeof stdout !== 'string') {
    return [];
  }

  const lines = stdout.split('\n');
  const devices = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (
      !trimmed ||
      trimmed.startsWith('List of devices') ||
      trimmed.startsWith('* daemon')
    ) {
      continue;
    }

    const parts = trimmed.split(/\s+/);
    if (parts.length >= 2) {
      const serial = parts[0];
      const state = parts[1];
      devices.push({
        serial,
        state,
        isAuthorized: state === 'device'
      });
    }
  }

  return devices;
}

/**
 * Executes `adb devices` and returns parsed device list.
 * @returns {Array<{ serial: string, state: string, isAuthorized: boolean }>}
 */
export function getConnectedDevices() {
  try {
    const output = execSync('adb devices', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe']
    });
    return parseAdbDevices(output);
  } catch (err) {
    logger.debug(`adb devices failed: ${err.message}`);
    return [];
  }
}

/**
 * Checks detailed device status for doctor and setup commands.
 * @returns {{
 *   adbAvailable: boolean,
 *   devices: Array<{ serial: string, state: string, isAuthorized: boolean }>,
 *   hasAnyDevice: boolean,
 *   hasAuthorizedDevice: boolean,
 *   error: string|null
 * }}
 */
export function checkDeviceStatus() {
  try {
    const output = execSync('adb devices', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe']
    });
    const devices = parseAdbDevices(output);
    const hasAnyDevice = devices.length > 0;
    const hasAuthorizedDevice = devices.some(d => d.isAuthorized);

    return {
      adbAvailable: true,
      devices,
      hasAnyDevice,
      hasAuthorizedDevice,
      error: null
    };
  } catch (err) {
    return {
      adbAvailable: false,
      devices: [],
      hasAnyDevice: false,
      hasAuthorizedDevice: false,
      error: err.message
    };
  }
}
