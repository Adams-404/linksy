import fs from 'node:fs';
import chalk from 'chalk';
import { GNIREHTET_BIN } from '../lib/paths.js';
import { isAdbInstalled, getAdbVersion } from '../lib/installAdb.js';
import { checkDeviceStatus } from '../lib/adbHelpers.js';
import { checkWifiCapability } from '../lib/checkWifiCapability.js';
import { isHostapdInstalled, isDnsmasqInstalled, getActiveWifiConnection } from '../lib/wifiHotspot.js';
import { checkBluetoothAvailability } from '../lib/bluetoothPan.js';
import { getCliVersion, checkForUpdates } from '../lib/updateNotifier.js';
import { logger } from '../utils/logger.js';

export async function doctorCommand() {
  logger.banner();
  console.log(chalk.bold('--- Linksy Doctor Diagnostics ---\n'));

  let allChecksPassed = true;

  // Check 0: Linksy version & update status
  const currentVersion = getCliVersion();
  const updateInfo = await checkForUpdates({ currentVersion, timeoutMs: 2500, force: false });
  if (updateInfo.hasUpdate) {
    console.log(
      chalk.yellow('⚠') +
      ' ' +
      chalk.bold('Linksy version:       ') +
      chalk.yellow(` v${updateInfo.currentVersion}`) +
      chalk.dim(' (update available: ') +
      chalk.green.bold(`v${updateInfo.latestVersion}`) +
      chalk.dim(')')
    );
    console.log(
      chalk.yellow('  ↳ Fix:') +
      ' Run ' +
      chalk.cyan('linksy update') +
      ' to update to the latest version.\n'
    );
  } else {
    console.log(
      chalk.green('✔') +
      ' ' +
      chalk.bold('Linksy version:       ') +
      chalk.dim(` v${currentVersion} (up to date)`)
    );
  }

  // Check 1: adb installed and on PATH
  const adbOk = isAdbInstalled();
  if (adbOk) {
    const version = getAdbVersion();
    console.log(chalk.green('✔') + ' ' + chalk.bold('adb installed:        ') + chalk.dim(` Android Debug Bridge found (${version || 'ready'})`));
  } else {
    allChecksPassed = false;
    console.log(chalk.red('✖') + ' ' + chalk.bold('adb installed:        ') + chalk.red(' Not found on PATH'));
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
    console.log(chalk.green('✔') + ' ' + chalk.bold('Gnirehtet binary:     ') + chalk.dim(` Present and executable at ${GNIREHTET_BIN}`));
  } else {
    allChecksPassed = false;
    console.log(chalk.red('✖') + ' ' + chalk.bold('Gnirehtet binary:     ') + chalk.red(' Missing or not executable'));
    console.log(chalk.yellow('  ↳ Fix:') + ' Run ' + chalk.cyan('linksy setup') + ' to download and configure Gnirehtet.\n');
  }

  // Check 3: Phone detection via adb
  const deviceStatus = checkDeviceStatus();
  if (!adbOk) {
    console.log(chalk.dim('○') + ' ' + chalk.bold('USB Phone detection:  ') + chalk.dim(' Skipped (adb is missing)'));
    console.log(chalk.dim('○') + ' ' + chalk.bold('USB Authorization:    ') + chalk.dim(' Skipped (adb is missing)'));
  } else {
    if (deviceStatus.hasAnyDevice) {
      const deviceSerials = deviceStatus.devices.map(d => d.serial).join(', ');
      console.log(chalk.green('✔') + ' ' + chalk.bold('USB Phone detection:  ') + chalk.dim(` Device detected (${deviceSerials})`));
    } else {
      console.log(chalk.yellow('○') + ' ' + chalk.bold('USB Phone detection:  ') + chalk.dim(' No phone detected over USB (plug in cable for USB tethering)'));
    }

    // Check 4: USB debugging authorization
    if (deviceStatus.hasAnyDevice) {
      if (deviceStatus.hasAuthorizedDevice) {
        console.log(chalk.green('✔') + ' ' + chalk.bold('USB Authorization:    ') + chalk.dim(' USB debugging authorized and ready'));
      } else {
        allChecksPassed = false;
        console.log(chalk.red('✖') + ' ' + chalk.bold('USB Authorization:    ') + chalk.red(' Device state is "unauthorized"'));
        console.log(
          chalk.yellow('  ↳ Fix:') +
          ' Unlock your phone screen, check "Always allow from this computer", and tap OK on the prompt.\n'
        );
      }
    }
  }

  console.log(chalk.dim('\n--- Wireless Diagnostics ---'));

  // Check 5: Wi-Fi card capability and hotspot tools
  const wifiCap = checkWifiCapability();
  const hostapdOk = isHostapdInstalled();
  const dnsmasqOk = isDnsmasqInstalled();
  const activeWifi = getActiveWifiConnection();

  if (wifiCap.supported) {
    console.log(chalk.green('✔') + ' ' + chalk.bold('Wi-Fi AP+STA support: ') + chalk.dim(` Supported by hardware on ${wifiCap.iface}`));
  } else {
    console.log(chalk.yellow('○') + ' ' + chalk.bold('Wi-Fi AP+STA support: ') + chalk.dim(` Driver reports single interface mode`));
  }

  if (hostapdOk && dnsmasqOk) {
    console.log(chalk.green('✔') + ' ' + chalk.bold('Wi-Fi Hotspot tools:  ') + chalk.dim(' hostapd and dnsmasq installed'));
  } else {
    const missingTools = [];
    if (!hostapdOk) missingTools.push('hostapd');
    if (!dnsmasqOk) missingTools.push('dnsmasq');
    console.log(chalk.yellow('○') + ' ' + chalk.bold('Wi-Fi Hotspot tools:  ') + chalk.yellow(` Missing ${missingTools.join(', ')}`));
    console.log(chalk.dim(`  ↳ Run: sudo dnf install -y ${missingTools.join(' ')} (or apt/pacman equivalent) for linksy on --wifi\n`));
  }

  if (activeWifi) {
    console.log(chalk.green('✔') + ' ' + chalk.bold('Active Wi-Fi Link:    ') + chalk.dim(` Connected to ${activeWifi.ssid || 'network'} (Ch ${activeWifi.channel}, ${activeWifi.hwMode === 'a' ? '5 GHz' : '2.4 GHz'})`));
  } else {
    console.log(chalk.yellow('○') + ' ' + chalk.bold('Active Wi-Fi Link:    ') + chalk.dim(' Not connected to any Wi-Fi network currently'));
  }

  // Check 6: Bluetooth availability
  const btCheck = checkBluetoothAvailability();
  if (btCheck.available && btCheck.controller) {
    console.log(chalk.green('✔') + ' ' + chalk.bold('Bluetooth Adapter:    ') + chalk.dim(` Ready (${btCheck.controller})`));
  } else {
    console.log(chalk.yellow('○') + ' ' + chalk.bold('Bluetooth Adapter:    ') + chalk.dim(` ${btCheck.error || 'Not ready'}`));
  }

  console.log('\n' + chalk.dim('---------------------------------'));
  if (allChecksPassed) {
    console.log(chalk.bold.green('Core setup verified! Choose your preferred connection mode:'));
    console.log(`  • Wi-Fi (wireless):      ${chalk.cyan('linksy on --wifi')}`);
    console.log(`  • Bluetooth (wireless): ${chalk.cyan('linksy on --bluetooth')}`);
    console.log(`  • USB (wired):          ${chalk.cyan('linksy on')}`);
  } else {
    console.log(chalk.bold.yellow('Some checks need attention before all features are available.'));
  }
  console.log('');
}
