import chalk from 'chalk';
import {
  blockDevice,
  unblockDevice,
  whitelistDevice,
  unwhitelistDevice,
  getConnectedDevices,
  getBlocklist,
  getWhitelist
} from '../lib/deviceManager.js';
import { logger } from '../utils/logger.js';

export async function blockCommand(identifier) {
  if (!identifier) {
    logger.error('Please specify a device to block (MAC address, IP address, or device name).');
    const connected = getConnectedDevices('ap0');
    if (connected.length > 0) {
      console.log(chalk.bold('\nCurrently connected devices:'));
      for (const dev of connected) {
        console.log(`  • ${chalk.cyan(dev.hostname)} (${chalk.yellow(dev.ip)}) — MAC: ${chalk.green(dev.mac)}`);
      }
      console.log(chalk.dim('\nUsage: linksy block <MAC or IP>'));
    }
    process.exit(1);
  }

  const result = blockDevice(identifier);
  if (!result.success) {
    logger.error(result.error);
    process.exit(1);
  }

  logger.success(`Blocked device ${chalk.bold.red(result.mac)} from accessing Linksy Hotspot.`);
  logger.info('The device has been disconnected and added to your persistent blocklist.');
}

export async function unblockCommand(identifier) {
  if (!identifier) {
    logger.error('Please specify a device to unblock.');
    const blocked = getBlocklist();
    if (blocked.length > 0) {
      console.log(chalk.bold('\nCurrently blocked devices:'));
      for (const mac of blocked) {
        console.log(`  • ${chalk.red(mac)}`);
      }
      console.log(chalk.dim('\nUsage: linksy unblock <MAC>'));
    } else {
      console.log(chalk.dim('\nNo devices are currently blocked.'));
    }
    process.exit(1);
  }

  const result = unblockDevice(identifier);
  if (!result.success) {
    logger.error(result.error);
    process.exit(1);
  }

  logger.success(`Unblocked device ${chalk.bold.green(result.mac)}. It can now reconnect to Linksy.`);
}

export async function whitelistCommand(identifier) {
  if (!identifier) {
    logger.error('Please specify a device to whitelist (MAC address, IP address, or device name).');
    process.exit(1);
  }

  const result = whitelistDevice(identifier);
  if (!result.success) {
    logger.error(result.error);
    process.exit(1);
  }

  logger.success(`Whitelisted device ${chalk.bold.green(result.mac)}.`);
}

export async function unwhitelistCommand(identifier) {
  if (!identifier) {
    logger.error('Please specify a device to remove from the whitelist.');
    process.exit(1);
  }

  const result = unwhitelistDevice(identifier);
  if (!result.success) {
    logger.error(result.error);
    process.exit(1);
  }

  logger.success(`Removed device ${chalk.bold.green(result.mac)} from the whitelist.`);
}

export async function devicesCommand() {
  const devices = getConnectedDevices('ap0');
  const blocked = getBlocklist();
  const whitelisted = getWhitelist();

  console.log(chalk.bold('\n📱 Linksy Connected Devices\n'));

  if (devices.length === 0) {
    console.log(chalk.dim('  No devices currently connected to Linksy-Hotspot.\n'));
  } else {
    for (const dev of devices) {
      const rxMb = (dev.rxBytes / (1024 * 1024)).toFixed(1);
      const txMb = (dev.txBytes / (1024 * 1024)).toFixed(1);
      const signalStr = dev.signal ? `Signal: ${dev.signal} dBm` : 'Signal: N/A';
      console.log(`  • ${chalk.bold.cyan(dev.hostname)} (${chalk.yellow(dev.ip)})`);
      console.log(`    MAC: ${chalk.green(dev.mac)} | ${chalk.magenta(signalStr)}`);
      if (dev.txBitrate) {
        console.log(`    Speed: ${chalk.dim(dev.txBitrate)} | Data: ⬇ ${rxMb} MB / ⬆ ${txMb} MB`);
      }
      console.log('');
    }
  }

  if (blocked.length > 0) {
    console.log(chalk.bold('🚫 Blocked Devices:'));
    for (const mac of blocked) {
      console.log(`  • ${chalk.red(mac)}`);
    }
    console.log('');
  }

  if (whitelisted.length > 0) {
    console.log(chalk.bold('✔ Whitelisted Devices:'));
    for (const mac of whitelisted) {
      console.log(`  • ${chalk.green(mac)}`);
    }
    console.log('');
  }
}
