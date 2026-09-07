#!/usr/bin/env node

import { onCommand } from '../src/commands/on.js';
import { logger } from '../src/utils/logger.js';

try {
  const foreground = process.argv.includes('-f') || process.argv.includes('--foreground');
  const wifi = process.argv.includes('-w') || process.argv.includes('--wifi');
  const bluetooth = process.argv.includes('-b') || process.argv.includes('--bluetooth');
  await onCommand({ foreground, wifi, bluetooth });
} catch (err) {
  logger.error(`Failed to start tethering: ${err.message}`, err);
  process.exit(1);
}
