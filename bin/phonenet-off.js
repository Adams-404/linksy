#!/usr/bin/env node

import { offCommand } from '../src/commands/off.js';
import { logger } from '../src/utils/logger.js';

try {
  await offCommand();
} catch (err) {
  logger.error(`Failed to stop tethering: ${err.message}`, err);
  process.exit(1);
}
