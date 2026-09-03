import os from 'node:os';
import { logger } from '../utils/logger.js';
import { ensureAdbInstalled } from '../lib/installAdb.js';
import { checkWifiCapability } from '../lib/checkWifiCapability.js';
import { fetchLatestGnirehtetRelease } from '../lib/fetchLatestGnirehtet.js';
import { downloadAndExtractGnirehtet } from '../lib/downloadAndExtract.js';
import chalk from 'chalk';

export async function setupCommand(options = {}) {
  logger.banner();
  logger.step('Step 1/4: Checking Operating System');

  if (process.platform !== 'linux') {
    logger.error('Linksy currently supports Linux only.');
    logger.info('Support for macOS and Windows is planned for a future release.');
    process.exit(1);
  }
  logger.success(`Linux detected (${os.type()} ${os.release()})`);

  // Step 2: Ensure adb is installed
  logger.step('Step 2/4: Checking Android Debug Bridge (adb)');
  const adbReady = await ensureAdbInstalled();
  if (!adbReady) {
    logger.error('Setup cannot continue without adb. Please install adb and run `linksy setup` again.');
    process.exit(1);
  }

  // Step 3: Wi-Fi card capability check (informational)
  logger.step('Step 3/4: Inspecting Wi-Fi Card Capabilities');
  const wifiCap = checkWifiCapability();
  if (wifiCap.supported) {
    logger.info(
      chalk.yellow('Note:') +
        ` Your Wi-Fi card may support running a hotspot while staying connected — you could try:\n` +
        `       ${chalk.cyan(`nmcli device wifi hotspot ifname ${wifiCap.iface} ssid <SSID> password <PASSWORD>`)}\n` +
        `       directly instead. Continuing with USB tethering setup anyway since it's more reliable.`
    );
  } else {
    logger.info('Single-radio Wi-Fi card detected (or concurrent AP mode not supported).');
    logger.info('Reverse USB tethering is the ideal solution for sharing your internet connection.');
  }

  // Step 4: Download and install latest Gnirehtet release
  logger.step('Step 4/4: Installing Gnirehtet Relay');
  try {
    const release = await fetchLatestGnirehtetRelease();
    logger.info(`Resolved latest release: ${chalk.bold(release.version)} (${release.assetName})`);
    await downloadAndExtractGnirehtet(release.downloadUrl, release.version);
  } catch (err) {
    logger.error(`Failed to install Gnirehtet: ${err.message}`, err);
    process.exit(1);
  }

  // Success summary
  console.log('\n' + chalk.bold.green('🎉 Linksy setup completed successfully!') + '\n');
  console.log(chalk.bold('Next steps to share your laptop internet with your phone:'));
  console.log(`  1. Connect your Android phone to this laptop via USB cable.`);
  console.log(`  2. Ensure USB debugging is enabled on your phone.`);
  console.log(`  3. Run ${chalk.bold.cyan('linksy on')} to start tethering.`);
  console.log(`  4. Accept the connection authorization prompt on your phone.`);
  console.log(`  5. Run ${chalk.bold.cyan('linksy off')} when you want to stop.`);
  console.log(`\nRun ${chalk.bold.cyan('linksy doctor')} at any time if you encounter connection issues.\n`);
}
