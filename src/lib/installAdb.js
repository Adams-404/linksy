import { execSync, spawnSync } from 'node:child_process';
import { detectPackageManager } from './detectPackageManager.js';
import { logger } from '../utils/logger.js';

/**
 * Checks if adb binary is available on PATH.
 * @returns {boolean}
 */
export function isAdbInstalled() {
  try {
    execSync('adb version', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Gets the installed adb version string, if available.
 * @returns {string|null}
 */
export function getAdbVersion() {
  try {
    const output = execSync('adb version', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
    const match = output.match(/Android Debug Bridge version ([\d.]+)/);
    return match ? match[1] : output.split('\n')[0].trim();
  } catch {
    return null;
  }
}

/**
 * Ensures adb is installed, prompting and executing package manager install if missing.
 * @returns {Promise<boolean>} True if adb is installed and available, false otherwise.
 */
export async function ensureAdbInstalled() {
  if (isAdbInstalled()) {
    logger.success(`adb is installed (${getAdbVersion() || 'ready'})`);
    return true;
  }

  logger.warn('Android Debug Bridge (adb) is not installed on this system.');
  logger.info('adb is required for Linksy to establish the USB connection to your Android phone.');

  const pm = detectPackageManager();
  if (!pm) {
    logger.error('Could not automatically detect a supported package manager (supported: DNF, APT, Pacman, Zypper).');
    logger.info('Please install adb manually:');
    logger.substep('Debian/Ubuntu: sudo apt install android-tools-adb (or adb)');
    logger.substep('Fedora: sudo dnf install android-tools');
    logger.substep('Arch Linux: sudo pacman -S android-tools');
    logger.substep('Official Platform Tools: https://developer.android.com/tools/releases/platform-tools');
    return false;
  }

  logger.info(`Detected package manager: ${pm.name}`);
  logger.info(`Linksy will now install adb using: ${pm.installCmd}`);
  logger.info('This operation requires elevated privileges (sudo).');

  try {
    if (pm.preCommandArray) {
      logger.info('Updating package lists...');
      spawnSync('sudo', pm.preCommandArray, { stdio: 'inherit' });
    }

    const result = spawnSync('sudo', pm.commandArray, { stdio: 'inherit' });
    if (result.status !== 0) {
      logger.error(`Package manager exited with status code ${result.status}`);
      return false;
    }

    if (isAdbInstalled()) {
      logger.success('adb was successfully installed!');
      return true;
    } else {
      logger.error('Installation finished, but adb is still not found on PATH. You may need to restart your terminal.');
      return false;
    }
  } catch (err) {
    logger.error('Failed to install adb automatically.', err);
    logger.info(`You can try running the install command manually: ${pm.installCmd}`);
    return false;
  }
}
