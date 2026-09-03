import { execSync } from 'node:child_process';
import fs from 'node:fs';

const SUPPORTED_PACKAGE_MANAGERS = [
  {
    type: 'dnf',
    name: 'DNF (Fedora / RHEL)',
    binary: 'dnf',
    installCmd: 'sudo dnf install -y android-tools',
    commandArray: ['dnf', 'install', '-y', 'android-tools']
  },
  {
    type: 'apt',
    name: 'APT (Debian / Ubuntu)',
    binary: 'apt-get',
    installCmd: 'sudo apt-get update && sudo apt-get install -y android-tools-adb',
    commandArray: ['apt-get', 'install', '-y', 'android-tools-adb'],
    preCommandArray: ['apt-get', 'update']
  },
  {
    type: 'pacman',
    name: 'Pacman (Arch Linux)',
    binary: 'pacman',
    installCmd: 'sudo pacman -S --noconfirm android-tools',
    commandArray: ['pacman', '-S', '--noconfirm', 'android-tools']
  },
  {
    type: 'zypper',
    name: 'Zypper (openSUSE)',
    binary: 'zypper',
    installCmd: 'sudo zypper install -y android-tools',
    commandArray: ['zypper', 'install', '-y', 'android-tools']
  }
];

function defaultCheckBinary(binaryName) {
  try {
    execSync(`command -v ${binaryName}`, { stdio: 'ignore' });
    return true;
  } catch {
    // Also check standard /usr/bin and /bin locations
    return fs.existsSync(`/usr/bin/${binaryName}`) || fs.existsSync(`/bin/${binaryName}`);
  }
}

/**
 * Detects the system package manager.
 * @param {function(string): boolean} [checkFn] - Optional checker function for dependency injection / testing.
 * @returns {object|null} The detected package manager info or null if unsupported.
 */
export function detectPackageManager(checkFn = defaultCheckBinary) {
  for (const pm of SUPPORTED_PACKAGE_MANAGERS) {
    if (checkFn(pm.binary)) {
      return { ...pm };
    }
  }
  return null;
}

export { SUPPORTED_PACKAGE_MANAGERS };
