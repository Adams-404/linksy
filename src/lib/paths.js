import path from 'node:path';
import os from 'node:os';

export const LINKSY_DIR = path.join(os.homedir(), '.linksy');
export const GNIREHTET_DIR = path.join(LINKSY_DIR, 'gnirehtet');
export const GNIREHTET_BIN = path.join(GNIREHTET_DIR, 'gnirehtet');
export const GNIREHTET_APK = path.join(GNIREHTET_DIR, 'gnirehtet.apk');
export const PID_FILE = path.join(LINKSY_DIR, 'gnirehtet.pid');
export const LOG_FILE = path.join(LINKSY_DIR, 'gnirehtet.log');

export const WIFI_DIR = path.join(LINKSY_DIR, 'wifi');
export const WIFI_PID_FILE = path.join(LINKSY_DIR, 'wifi.pid');
export const WIFI_LOG_FILE = path.join(LINKSY_DIR, 'wifi.log');
export const WIFI_CONFIG_FILE = path.join(WIFI_DIR, 'hostapd.conf');
export const WIFI_LEASES_FILE = path.join(WIFI_DIR, 'dnsmasq.leases');
export const WIFI_DENY_FILE = path.join(WIFI_DIR, 'hostapd.deny');
export const WIFI_ACCEPT_FILE = path.join(WIFI_DIR, 'hostapd.accept');
export const HOSTAPD_CTRL_DIR = '/run/hostapd';

export const BT_DIR = path.join(LINKSY_DIR, 'bluetooth');
export const BT_PID_FILE = path.join(LINKSY_DIR, 'bluetooth.pid');
export const BT_LOG_FILE = path.join(LINKSY_DIR, 'bluetooth.log');

export const CONFIG_FILE = path.join(LINKSY_DIR, 'config.json');
export const UPDATE_CHECK_FILE = path.join(LINKSY_DIR, 'update-check.json');

// Ensure system sbin directories (/usr/local/sbin, /usr/sbin, /sbin) are in process.env.PATH
// so commands like iw, hostapd, and dnsmasq can be located by unprivileged users on Debian/Ubuntu.
export function ensureSystemSbinInPath() {
  const currentPath = process.env.PATH || '';
  const sbinDirs = ['/usr/local/sbin', '/usr/sbin', '/sbin'];
  const existing = currentPath.split(':');
  const missingSbin = sbinDirs.filter(d => !existing.includes(d));
  if (missingSbin.length > 0) {
    process.env.PATH = `${currentPath}:${missingSbin.join(':')}`;
  }
}
ensureSystemSbinInPath();

