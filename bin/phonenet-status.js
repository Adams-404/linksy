#!/usr/bin/env node

import { statusCommand } from '../src/commands/status.js';
import { logger } from '../src/utils/logger.js';

try {
  await statusCommand();
} catch (err) {
  logger.error(`Failed to check status: ${err.message}`, err);
  process.exit(1);
}
