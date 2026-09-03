import fs from 'node:fs';
import chalk from 'chalk';
import { GNIREHTET_BIN } from '../lib/paths.js';
import { isAdbInstalled, getAdbVersion } from '../lib/installAdb.js';
import { checkDeviceStatus } from '../lib/adbHelpers.js';
import { logger } from '../utils/logger.js';

export async function doctorCommand() {
  logger.banner();
  console.log(chalk.bold('--- Linksy Doctor Diagnostics ---\n'));

  let allChecksPassed = true;

  // Check 1: adb installed and on PATH
  const adbOk = isAdbInstalled();
  if (adbOk) {
    const version = getAdbVersion();
    console.log(chalk.green('✔') + ' ' + chalk.bold('adb installed:') + chalk.dim(` Android Debug Bridge found (${version || 'ready'})`));
  } else {
    allChecksPassed = false;
    console.log(chalk.red('✖') + ' ' + chalk.bold('adb installed:') + chalk.red(' Not found on PATH'));
    console.log(chalk.yellow('  ↳ Fix:') + ' Run ' + chalk.cyan('linksy setup') + ' to install adb, or install it via your package manager.\n');
  }

  // Check 2: Gnirehtet binary present and executable
  let gnirehtetOk = false;
  if (fs.existsSync(GNIREHTET_BIN)) {
    try {
      fs.accessSync(GNIREHTET_BIN, fs.constants.X_OK);
      gnirehtetOk = true;
    } catch {
      gnirehtetOk = false;
    }
  }

  if (gnirehtetOk) {
    console.log(chalk.green('✔') + ' ' + chalk.bold('Gnirehtet binary:') + chalk.dim(` Present and executable at ${GNIREHTET_BIN}`));
  } else {
    allChecksPassed = false;
    console.log(chalk.red('✖') + ' ' + chalk.bold('Gnirehtet binary:') + chalk.red(' Missing or not executable'));
    console.log(chalk.yellow('  ↳ Fix:') + ' Run ' + chalk.cyan('linksy setup') + ' to download and configure Gnirehtet.\n');
  }

  // Check 3: Phone detection via adb
  const deviceStatus = checkDeviceStatus();
  if (!adbOk) {
    console.log(chalk.dim('○') + ' ' + chalk.bold('Phone detection:') + chalk.dim(' Skipped (adb is missing)'));
    console.log(chalk.dim('○') + ' ' + chalk.bold('Phone authorization:') + chalk.dim(' Skipped (adb is missing)'));
  } else {
    if (deviceStatus.hasAnyDevice) {
      const deviceSerials = deviceStatus.devices.map(d => d.serial).join(', ');
      console.log(chalk.green('✔') + ' ' + chalk.bold('Phone detection:') + chalk.dim(` Device detected (${deviceSerials})`));
    } else {
      allChecksPassed = false;
      console.log(chalk.red('✖') + ' ' + chalk.bold('Phone detection:') + chalk.red(' No phone detected over USB'));
      console.log(
        chalk.yellow('  ↳ Fix:') +
        ' Connect phone with a USB data cable and enable Developer options → USB debugging.\n'
      );
    }

    // Check 4: USB debugging authorization
    if (deviceStatus.hasAnyDevice) {
      if (deviceStatus.hasAuthorizedDevice) {
        console.log(chalk.green('✔') + ' ' + chalk.bold('Phone authorization:') + chalk.dim(' USB debugging authorized and ready'));
      } else {
        allChecksPassed = false;
        console.log(chalk.red('✖') + ' ' + chalk.bold('Phone authorization:') + chalk.red(' Device state is "unauthorized"'));
        console.log(
          chalk.yellow('  ↳ Fix:') +
          ' Unlock your phone screen, check "Always allow from this computer", and tap OK on the prompt.\n'
        );
      }
    } else {
      console.log(chalk.yellow('○') + ' ' + chalk.bold('Phone authorization:') + chalk.dim(' Cannot test without a connected device'));
    }
  }

  console.log('\n' + chalk.dim('---------------------------------'));
  if (allChecksPassed) {
    console.log(chalk.bold.green('All diagnostics passed! Everything is ready for `linksy on`.'));
  } else {
    console.log(chalk.bold.yellow('Some checks need attention before reverse tethering can start.'));
  }
  console.log('');
}
