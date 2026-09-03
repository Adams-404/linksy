#!/usr/bin/env node

import { doctorCommand } from '../src/commands/doctor.js';
import { logger } from '../src/utils/logger.js';

try {
  await doctorCommand();
} catch (err) {
  logger.error(`Failed to run diagnostics: ${err.message}`, err);
  process.exit(1);
}
