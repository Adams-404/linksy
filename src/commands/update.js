import { spawnSync } from 'node:child_process';
import chalk from 'chalk';
import { logger } from '../utils/logger.js';
import { getCliVersion, checkForUpdates, saveUpdateCache } from '../lib/updateNotifier.js';

/**
 * Checks for updates and installs the latest version of linksy-phonenet via npm.
 */
export async function updateCommand() {
  const currentVersion = getCliVersion();
  logger.info(`Checking for Linksy updates (current: v${currentVersion})...`);

  let updateInfo;
  try {
    updateInfo = await checkForUpdates({
      currentVersion,
      force: true,
      timeoutMs: 6000
    });
  } catch (err) {
    logger.error(`Could not reach NPM registry: ${err.message}`);
    return;
  }

  if (updateInfo.error && !updateInfo.latestVersion) {
    logger.error('Failed to reach NPM registry. Please check your internet connection.');
    return;
  }

  if (!updateInfo.hasUpdate) {
    logger.success(`Linksy is already up to date (v${currentVersion})!`);
    return;
  }

  console.log('\n' + chalk.bold.yellow(`★ New version available: v${currentVersion} → v${updateInfo.latestVersion}`));
  logger.step(`Upgrading Linksy to v${updateInfo.latestVersion} via npm...`);

  const res = spawnSync('npm', ['install', '-g', 'linksy-phonenet@latest'], {
    stdio: 'inherit'
  });

  if (res.status === 0) {
    saveUpdateCache({
      lastChecked: Date.now(),
      latestVersion: updateInfo.latestVersion
    });
    console.log('');
    logger.success(`Linksy has been successfully updated to v${updateInfo.latestVersion}! 🎉`);
    logger.info(`Run ${chalk.cyan('linksy --version')} or ${chalk.cyan('linksy status')} to get started.`);
  } else {
    console.log('');
    logger.error('NPM encountered an error while updating Linksy.');
    logger.warn('If npm requires elevated permissions on your system, try:');
    logger.log(`   ${chalk.cyan('sudo npm install -g linksy-phonenet@latest')}\n`);
  }
}
