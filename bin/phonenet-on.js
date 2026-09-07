#!/usr/bin/env node

import { onCommand } from '../src/commands/on.js';
import { logger } from '../src/utils/logger.js';

try {
  const getArg = (flag, short) => {
    const idx = process.argv.findIndex(a => a === flag || a === short);
    return idx !== -1 && idx + 1 < process.argv.length ? process.argv[idx + 1] : undefined;
  };
  const foreground = process.argv.includes('-f') || process.argv.includes('--foreground');
  const wifi = process.argv.includes('-w') || process.argv.includes('--wifi');
  const bluetooth = process.argv.includes('-b') || process.argv.includes('--bluetooth');
  const password = getArg('--password', '-p');
  const ssid = getArg('--ssid', '-s');
  const noPassword = process.argv.includes('--no-password') || process.argv.includes('--open');
  await onCommand({ foreground, wifi, bluetooth, password, ssid, noPassword });
} catch (err) {
  logger.error(`Failed to start tethering: ${err.message}`, err);
  process.exit(1);
}
