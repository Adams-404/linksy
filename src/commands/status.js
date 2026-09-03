import fs from 'node:fs';
import chalk from 'chalk';
import { GNIREHTET_BIN, PID_FILE } from '../lib/paths.js';
import { checkDeviceStatus } from '../lib/adbHelpers.js';
import { isProcessRunning } from './on.js';
import { logger } from '../utils/logger.js';

export async function statusCommand() {
  logger.banner();
  console.log(chalk.bold('--- Linksy System Status ---\n'));

  // 1. Gnirehtet installation
  const isGnirehtetInstalled = fs.existsSync(GNIREHTET_BIN);
  if (isGnirehtetInstalled) {
    console.log(chalk.green('✔') + ' Gnirehtet binary: ' + chalk.bold('Installed') + chalk.dim(` (${GNIREHTET_BIN})`));
  } else {
    console.log(chalk.red('✖') + ' Gnirehtet binary: ' + chalk.red('Not installed') + chalk.dim(' (Run `linksy setup` to install)'));
  }

  // 2. Tethering status
  let isTetheringActive = false;
  let activePid = null;
  if (fs.existsSync(PID_FILE)) {
    const rawPid = fs.readFileSync(PID_FILE, 'utf8').trim();
    const pid = parseInt(rawPid, 10);
    if (!isNaN(pid) && isProcessRunning(pid)) {
      isTetheringActive = true;
      activePid = pid;
    }
  }

  if (isTetheringActive) {
    console.log(chalk.green('✔') + ' Tethering state:   ' + chalk.bold.green('ACTIVE') + chalk.dim(` (PID: ${activePid})`));
  } else {
    console.log(chalk.yellow('○') + ' Tethering state:   ' + chalk.dim('Inactive'));
  }

  // 3. Android phone detection
  const deviceStatus = checkDeviceStatus();
  if (!deviceStatus.adbAvailable) {
    console.log(chalk.red('✖') + ' Android device:    ' + chalk.red('adb not available or failed'));
  } else if (!deviceStatus.hasAnyDevice) {
    console.log(chalk.yellow('○') + ' Android device:    ' + chalk.dim('No device connected over USB'));
  } else {
    for (const dev of deviceStatus.devices) {
      if (dev.isAuthorized) {
        console.log(chalk.green('✔') + ` Android device:    ${chalk.bold(dev.serial)} ` + chalk.green('(' + dev.state + ')'));
      } else {
        console.log(chalk.yellow('⚠') + ` Android device:    ${chalk.bold(dev.serial)} ` + chalk.yellow('(' + dev.state + ' - authorization required on phone)'));
      }
    }
  }

  console.log('\n' + chalk.dim('----------------------------'));
  if (isTetheringActive) {
    console.log(`Run ${chalk.cyan('linksy off')} to disconnect.`);
  } else if (isGnirehtetInstalled && deviceStatus.hasAuthorizedDevice) {
    console.log(`Ready! Run ${chalk.cyan('linksy on')} to begin reverse tethering.`);
  } else {
    console.log(`Run ${chalk.cyan('linksy doctor')} to troubleshoot any connection issues.`);
  }
  console.log('');
}
