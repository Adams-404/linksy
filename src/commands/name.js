import chalk from 'chalk';
import { getSavedConfig, saveConfig } from '../lib/config.js';
import { getDefaultHotspotSsid, isHotspotRunning } from '../lib/wifiHotspot.js';
import { logger } from '../utils/logger.js';

/**
 * CLI command handler to view or change the default Wi-Fi hotspot name (SSID).
 * @param {string} [newName]
 */
export async function nameCommand(newName) {
  const saved = getSavedConfig();
  const current = saved.wifiSsid && saved.wifiSsid !== 'Linksy-Hotspot'
    ? saved.wifiSsid
    : getDefaultHotspotSsid();

  if (!newName) {
    console.log(chalk.bold('\n📡 Linksy Wi-Fi Hotspot Name\n'));
    console.log(`  Current Hotspot Name: ${chalk.bold.green(current)}`);
    console.log(chalk.dim('\nTo set a custom hotspot name:'));
    console.log(`  $ ${chalk.cyan('linksy name "My-Hotspot"')}`);
    console.log(chalk.dim('Or start the hotspot with a custom name directly:'));
    console.log(`  $ ${chalk.cyan('linksy on --wifi --name "My-Hotspot"')}\n`);
    return;
  }

  const trimmed = newName.trim();
  if (trimmed.length < 1 || trimmed.length > 32) {
    logger.error(`Invalid hotspot name length (${trimmed.length} characters).`);
    logger.info('Wi-Fi network names (SSID) must be between 1 and 32 characters long.');
    process.exit(1);
  }

  saveConfig({ wifiSsid: trimmed });
  logger.success(`Default hotspot name updated to: ${chalk.bold.green(trimmed)}`);

  if (isHotspotRunning()) {
    logger.info('Hotspot is currently active. To restart with your new name, run:');
    console.log(`  ${chalk.cyan('linksy on --wifi')}\n`);
  } else {
    logger.info(`Next time you run ${chalk.cyan('linksy on --wifi')}, it will broadcast "${chalk.bold.green(trimmed)}".`);
  }
}
