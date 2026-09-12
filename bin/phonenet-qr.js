#!/usr/bin/env node

import { Command } from 'commander';
import { qrCommand } from '../src/commands/qr.js';
import { logger } from '../src/utils/logger.js';

const program = new Command();

program
  .name('phonenet-qr')
  .description('Display a scannable Wi-Fi QR code in the terminal to instantly connect your phone')
  .option('-s, --ssid <name>', 'Wi-Fi hotspot SSID (defaults to active or saved hotspot)')
  .option('-n, --name <name>', 'Alias for --ssid')
  .option('-p, --password <pass>', 'Wi-Fi password (defaults to active or saved password)')
  .option('--no-password', 'Generate QR code for an open network without password')
  .option('--open', 'Alias for --no-password')
  .action(async (options) => {
    try {
      await qrCommand(options);
    } catch (err) {
      logger.error(`Failed to display QR code: ${err.message}`, err);
      process.exit(1);
    }
  });

program.parseAsync(process.argv).catch((err) => {
  logger.error(`Unexpected error: ${err.message}`, err);
  process.exit(1);
});
