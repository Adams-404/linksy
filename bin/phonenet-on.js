#!/usr/bin/env node

import { onCommand } from '../src/commands/on.js';
import { logger } from '../src/utils/logger.js';

try {
  const foreground = process.argv.includes('-f') || process.argv.includes('--foreground');
  await onCommand({ foreground });
} catch (err) {
  logger.error(`Failed to start tethering: ${err.message}`, err);
  process.exit(1);
}
