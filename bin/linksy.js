#!/usr/bin/env node

import { Command } from 'commander';
import { setVerbose, logger } from '../src/utils/logger.js';
import { setupCommand } from '../src/commands/setup.js';
import { onCommand } from '../src/commands/on.js';
import { offCommand } from '../src/commands/off.js';
import { statusCommand } from '../src/commands/status.js';
import { doctorCommand } from '../src/commands/doctor.js';
import { uninstallCommand } from '../src/commands/uninstall.js';
import {
  blockCommand,
  unblockCommand,
  whitelistCommand,
  unwhitelistCommand,
  devicesCommand
} from '../src/commands/block.js';

const program = new Command();

program
  .name('linksy-phonenet')
  .description('Reverse USB tethering CLI for Linux — share laptop Wi-Fi with Android without root')
  .version('1.1.0')
  .option('--verbose', 'Show detailed error output and debug messages')
  .addHelpText('after', `
Examples:
  $ linksy on --wifi                    # Share laptop Wi-Fi wirelessly to phone
  $ linksy on --wifi -p <password>      # Change hotspot password and connect
  $ linksy on --wifi --no-password      # Start open Wi-Fi network without password
  $ linksy devices                      # View connected devices (IP, MAC, signal)
  $ linksy block <device>               # Block a device from the Wi-Fi hotspot
  $ linksy unblock <device>             # Unblock a device
  $ linksy on                           # Reverse tether over USB cable
  $ linksy status                       # Check active connection, SSID & password
  $ linksy off                          # Disconnect all active sessions
`)
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
  .description('Start reverse tethering to share internet (USB, Wi-Fi, or Bluetooth)')
  .option('-w, --wifi', 'Share internet wirelessly via concurrent Wi-Fi AP+STA hotspot (no USB cable)')
  .option('-b, --bluetooth', 'Share internet wirelessly via Bluetooth reverse tethering (no USB cable)')
  .option('-s, --ssid <name>', 'Custom Wi-Fi hotspot SSID (saved as default)')
  .option('-p, --password <pass>', 'Custom Wi-Fi hotspot password (saved as default)')
  .option('--no-password', 'Disable Wi-Fi password (create an open hotspot)')
  .option('--open', 'Alias for --no-password')
  .option('-f, --foreground', 'Run Gnirehtet in foreground instead of detached background')
  .addHelpText('after', `
Examples:
  $ linksy on                           # Start reverse tethering over USB cable
  $ linksy on --wifi                    # Start Wi-Fi hotspot (wireless, uses saved password)
  $ linksy on --wifi -p <password>      # Change hotspot password and start
  $ linksy on --wifi -s "MyWifi" -p <password> # Change SSID & password and start
  $ linksy on --wifi --no-password      # Start open Wi-Fi hotspot with no password
  $ linksy on --bluetooth               # Start Bluetooth reverse tethering
`)
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
  .command('devices')
  .description('List devices connected to the Linksy Wi-Fi hotspot with IPs, MACs, and signal strength')
  .action(async () => {
    try {
      await devicesCommand();
    } catch (err) {
      logger.error(`Failed to get connected devices: ${err.message}`, err);
      process.exit(1);
    }
  });

program
  .command('block <device>')
  .description('Block a device from accessing the Wi-Fi hotspot (by MAC, IP, or hostname)')
  .action(async (device) => {
    try {
      await blockCommand(device);
    } catch (err) {
      logger.error(`Failed to block device: ${err.message}`, err);
      process.exit(1);
    }
  });

program
  .command('unblock <device>')
  .description('Unblock a device to allow it to reconnect to the Wi-Fi hotspot')
  .action(async (device) => {
    try {
      await unblockCommand(device);
    } catch (err) {
      logger.error(`Failed to unblock device: ${err.message}`, err);
      process.exit(1);
    }
  });

program
  .command('whitelist <device>')
  .description('Whitelist a device (by MAC, IP, or hostname)')
  .option('--remove', 'Remove the device from the whitelist')
  .action(async (device, options) => {
    try {
      if (options.remove) {
        await unwhitelistCommand(device);
      } else {
        await whitelistCommand(device);
      }
    } catch (err) {
      logger.error(`Failed to update whitelist: ${err.message}`, err);
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
