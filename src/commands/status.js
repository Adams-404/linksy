import fs from 'node:fs';
import chalk from 'chalk';
import { GNIREHTET_BIN, PID_FILE } from '../lib/paths.js';
import { checkDeviceStatus } from '../lib/adbHelpers.js';
import { isProcessRunning } from './on.js';
import { getWifiHotspotStatus, getDefaultHotspotSsid } from '../lib/wifiHotspot.js';
import { getBluetoothPanStatus } from '../lib/bluetoothPan.js';
import { getConnectedDevices, getBlocklist } from '../lib/deviceManager.js';
import { getCliVersion, notifyIfUpdateAvailable } from '../lib/updateNotifier.js';
import { logger } from '../utils/logger.js';

export async function statusCommand() {
  logger.banner();
  console.log(chalk.bold('--- Linksy System Status ---\n'));

  // 0. CLI Version
  const currentVersion = getCliVersion();
  console.log(chalk.green('✔') + ' Linksy CLI version:   ' + chalk.bold(`v${currentVersion}`));

  // 1. Gnirehtet installation
  const isGnirehtetInstalled = fs.existsSync(GNIREHTET_BIN);
  if (isGnirehtetInstalled) {
    console.log(chalk.green('✔') + ' Gnirehtet binary:     ' + chalk.bold('Installed') + chalk.dim(` (${GNIREHTET_BIN})`));
  } else {
    console.log(chalk.red('✖') + ' Gnirehtet binary:     ' + chalk.red('Not installed') + chalk.dim(' (Run `linksy setup` to install)'));
  }

  // 2. USB Tethering status
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
    console.log(chalk.green('✔') + ' USB Tethering:        ' + chalk.bold.green('ACTIVE') + chalk.dim(` (PID: ${activePid})`));
  } else {
    console.log(chalk.yellow('○') + ' USB Tethering:        ' + chalk.dim('Inactive'));
  }

  // 3. Wi-Fi Hotspot status
  const wifiStatus = getWifiHotspotStatus();
  if (wifiStatus.running) {
    console.log(chalk.green('✔') + ' Wi-Fi Hotspot:        ' + chalk.bold.green('ACTIVE'));
    console.log(chalk.dim('   • Network (SSID):   ') + chalk.bold.green(wifiStatus.ssid || getDefaultHotspotSsid()));
    if (wifiStatus.password) {
      console.log(chalk.dim('   • Password:         ') + chalk.bold.yellow(wifiStatus.password));
    } else {
      console.log(chalk.dim('   • Password:         ') + chalk.bold.magenta('None (Open Network)'));
    }
    console.log(chalk.dim('   • Channel / Band:   ') + chalk.cyan(`Channel ${wifiStatus.channel || '?'}`) + chalk.dim(` (PID: ${wifiStatus.pid})`));

    const devices = getConnectedDevices('ap0');
    if (devices.length > 0) {
      console.log(chalk.dim(`   • Connected Devices (${devices.length}):`));
      for (const dev of devices) {
        const signalStr = dev.signal ? ` [${dev.signal} dBm]` : '';
        const ipStr = dev.ip !== 'Assigning IP...' ? dev.ip : 'Acquiring IP...';
        console.log(
          chalk.dim('     - ') +
          chalk.bold.cyan(dev.hostname) +
          chalk.dim(` (${ipStr})`) +
          chalk.dim(` [MAC: ${dev.mac}]`) +
          chalk.green(signalStr)
        );
      }
    } else {
      console.log(chalk.dim('   • Connected Devices: ') + chalk.dim('None (Waiting for devices to connect)'));
    }

    const blocked = getBlocklist();
    if (blocked.length > 0) {
      console.log(chalk.dim(`   • Blocked Devices (${blocked.length}): `) + chalk.red(blocked.join(', ')));
    }
  } else {
    console.log(chalk.yellow('○') + ' Wi-Fi Hotspot:        ' + chalk.dim('Inactive (Run `linksy on --wifi` to start)'));
    const blocked = getBlocklist();
    if (blocked.length > 0) {
      console.log(chalk.dim(`   • Blocked Devices (${blocked.length}): `) + chalk.red(blocked.join(', ')));
    }
  }

  // 4. Bluetooth PAN status
  const btStatus = getBluetoothPanStatus();
  if (btStatus.running) {
    console.log(chalk.green('✔') + ' Bluetooth PAN:        ' + chalk.bold.green('ACTIVE') + chalk.dim(` (Bridge: ${btStatus.bridge}, PID: ${btStatus.pid})`));
  } else {
    console.log(chalk.yellow('○') + ' Bluetooth PAN:        ' + chalk.dim('Inactive (Run `linksy on --bluetooth` to start)'));
  }

  // 5. Android phone detection (USB)
  const deviceStatus = checkDeviceStatus();
  if (!deviceStatus.adbAvailable) {
    console.log(chalk.red('✖') + ' Android device (USB): ' + chalk.red('adb not available or failed'));
  } else if (!deviceStatus.hasAnyDevice) {
    console.log(chalk.yellow('○') + ' Android device (USB): ' + chalk.dim('No device connected over USB'));
  } else {
    for (const dev of deviceStatus.devices) {
      if (dev.isAuthorized) {
        console.log(chalk.green('✔') + ` Android device (USB): ${chalk.bold(dev.serial)} ` + chalk.green('(' + dev.state + ')'));
      } else {
        console.log(chalk.yellow('⚠') + ` Android device (USB): ${chalk.bold(dev.serial)} ` + chalk.yellow('(' + dev.state + ' - authorization required on phone)'));
      }
    }
  }

  console.log('\n' + chalk.dim('----------------------------'));
  if (isTetheringActive || wifiStatus.running || btStatus.running) {
    console.log(`Run ${chalk.cyan('linksy off')} to disconnect all active connections.`);
  } else {
    console.log(`To start sharing internet:`);
    console.log(`  • Wirelessly via Wi-Fi:     ${chalk.cyan('linksy on --wifi')}`);
    console.log(`  • Wirelessly via Bluetooth: ${chalk.cyan('linksy on --bluetooth')}`);
    console.log(`  • Over USB cable:           ${chalk.cyan('linksy on')}`);
  }
  console.log('');
  notifyIfUpdateAvailable(currentVersion);
}
