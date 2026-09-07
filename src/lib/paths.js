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

export const BT_DIR = path.join(LINKSY_DIR, 'bluetooth');
export const BT_PID_FILE = path.join(LINKSY_DIR, 'bluetooth.pid');
export const BT_LOG_FILE = path.join(LINKSY_DIR, 'bluetooth.log');
