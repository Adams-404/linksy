import path from 'node:path';
import os from 'node:os';

export const LINKSY_DIR = path.join(os.homedir(), '.linksy');
export const GNIREHTET_DIR = path.join(LINKSY_DIR, 'gnirehtet');
export const GNIREHTET_BIN = path.join(GNIREHTET_DIR, 'gnirehtet');
export const GNIREHTET_APK = path.join(GNIREHTET_DIR, 'gnirehtet.apk');
export const PID_FILE = path.join(LINKSY_DIR, 'gnirehtet.pid');
export const LOG_FILE = path.join(LINKSY_DIR, 'gnirehtet.log');
