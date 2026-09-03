import fs from 'node:fs';
import chalk from 'chalk';
import { LINKSY_DIR } from '../lib/paths.js';
import { offCommand } from './off.js';
import { logger } from '../utils/logger.js';

export async function uninstallCommand() {
  logger.banner();
  logger.info('Starting Linksy uninstallation...');

  // 1. Stop any active tethering session
  try {
    await offCommand();
  } catch (err) {
    logger.debug(`Error stopping daemon during uninstall: ${err.message}`);
  }

  // 2. Remove ~/.linksy/
  if (fs.existsSync(LINKSY_DIR)) {
    try {
      fs.rmSync(LINKSY_DIR, { recursive: true, force: true });
      logger.success(`Removed Linksy directory: ${LINKSY_DIR}`);
    } catch (err) {
      logger.error(`Failed to remove ${LINKSY_DIR}: ${err.message}`, err);
      process.exit(1);
    }
  } else {
    logger.info(`Directory ${LINKSY_DIR} does not exist. Nothing to remove.`);
  }

  console.log('\n' + chalk.bold.green('Linksy local files uninstalled cleanly.'));
  console.log(chalk.dim('To remove the global CLI package, run:'));
  console.log(chalk.cyan('  npm uninstall -g linksy\n'));
}
