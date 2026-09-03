import fs from 'node:fs';
import { execSync } from 'node:child_process';
import chalk from 'chalk';
import { GNIREHTET_BIN, PID_FILE } from '../lib/paths.js';
import { isProcessRunning } from './on.js';
import { logger } from '../utils/logger.js';

export async function offCommand() {
  logger.info('Stopping reverse tethering...');
  let stoppedProcess = false;

  // 1. Check PID file and terminate running daemon
  if (fs.existsSync(PID_FILE)) {
    const rawPid = fs.readFileSync(PID_FILE, 'utf8').trim();
    const pid = parseInt(rawPid, 10);

    if (!isNaN(pid) && isProcessRunning(pid)) {
      try {
        process.kill(pid, 'SIGTERM');
        // Wait up to 2 seconds for graceful shutdown
        for (let i = 0; i < 20; i++) {
          if (!isProcessRunning(pid)) break;
          await new Promise(r => setTimeout(r, 100));
        }

        // If still alive, force kill
        if (isProcessRunning(pid)) {
          process.kill(pid, 'SIGKILL');
        }
        stoppedProcess = true;
      } catch (err) {
        logger.debug(`Error terminating PID ${pid}: ${err.message}`);
      }
    }

    try {
      fs.unlinkSync(PID_FILE);
    } catch {}
  }

  // 2. Also run `gnirehtet stop` to signal the phone app to close the VPN tunnel cleanly
  if (fs.existsSync(GNIREHTET_BIN)) {
    try {
      execSync(`"${GNIREHTET_BIN}" stop`, {
        stdio: 'ignore',
        env: { ...process.env, PATH: process.env.PATH }
      });
      stoppedProcess = true;
    } catch (err) {
      logger.debug(`gnirehtet stop returned: ${err.message}`);
    }
  }

  if (stoppedProcess) {
    logger.success(chalk.bold.green('Reverse USB tethering stopped successfully.'));
  } else {
    logger.info('Tethering was not actively running.');
  }
}
