#!/usr/bin/env node

import { Command } from 'commander';
import { setVerbose, logger } from '../src/utils/logger.js';
import { setupCommand } from '../src/commands/setup.js';
import { onCommand } from '../src/commands/on.js';
import { offCommand } from '../src/commands/off.js';
import { statusCommand } from '../src/commands/status.js';
import { doctorCommand } from '../src/commands/doctor.js';
import { uninstallCommand } from '../src/commands/uninstall.js';

const program = new Command();

program
  .name('linksy-phonenet')
  .description('Reverse USB tethering CLI for Linux — share laptop Wi-Fi with Android without root')
  .version('1.0.0')
  .option('--verbose', 'Show detailed error output and debug messages')
  .hook('preAction', (thisCommand) => {
    const opts = thisCommand.opts();
    if (opts.verbose) {
      setVerbose(true);
    }
  });

program
  .command('setup')
  .description('First-time setup: installs adb if missing, downloads Gnirehtet, checks Wi-Fi card')
  .action(async () => {
    try {
      await setupCommand();
    } catch (err) {
      logger.error(`Setup encountered an error: ${err.message}`, err);
      process.exit(1);
    }
  });

program
  .command('on')
  .description('Start reverse tethering to share internet with connected Android phone')
  .option('-f, --foreground', 'Run Gnirehtet in foreground instead of detached background')
  .action(async (options) => {
    try {
      await onCommand(options);
    } catch (err) {
      logger.error(`Failed to start tethering: ${err.message}`, err);
      process.exit(1);
    }
  });

program
  .command('off')
  .description('Stop reverse tethering and close connection')
  .action(async () => {
    try {
      await offCommand();
    } catch (err) {
      logger.error(`Failed to stop tethering: ${err.message}`, err);
      process.exit(1);
    }
  });

program
  .command('status')
  .description('Show status of Gnirehtet, connected phone, and tethering session')
  .action(async () => {
    try {
      await statusCommand();
    } catch (err) {
      logger.error(`Failed to check status: ${err.message}`, err);
      process.exit(1);
    }
  });

program
  .command('doctor')
  .description('Run diagnostics and provide troubleshooting fixes')
  .action(async () => {
    try {
      await doctorCommand();
    } catch (err) {
      logger.error(`Diagnostics encountered an error: ${err.message}`, err);
      process.exit(1);
    }
  });

program
  .command('uninstall')
  .description('Remove ~/.linksy/ directory and clean up Linksy files')
  .action(async () => {
    try {
      await uninstallCommand();
    } catch (err) {
      logger.error(`Failed to uninstall: ${err.message}`, err);
      process.exit(1);
    }
  });

// Handle unknown commands gracefully
program.on('command:*', () => {
  logger.error(`Invalid command: ${program.args.join(' ')}`);
  logger.info('See --help for a list of available commands.');
  process.exit(1);
});

program.parseAsync(process.argv).catch((err) => {
  logger.error(`Unexpected error: ${err.message}`, err);
  process.exit(1);
});
