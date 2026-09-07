import fs from 'node:fs';
import { execSync } from 'node:child_process';
import chalk from 'chalk';
import { GNIREHTET_BIN, PID_FILE, WIFI_PID_FILE, BT_PID_FILE } from '../lib/paths.js';
import { isProcessRunning } from './on.js';
import { stopWifiHotspot, isHotspotRunning } from '../lib/wifiHotspot.js';
import { stopBluetoothPan, isBluetoothPanRunning } from '../lib/bluetoothPan.js';
import { logger } from '../utils/logger.js';

export async function offCommand() {
  logger.info('Stopping Linksy services...');
  let stoppedAny = false;

  // 1. Check and stop Wi-Fi hotspot
  if (isHotspotRunning() || fs.existsSync(WIFI_PID_FILE)) {
    logger.info('Stopping Wi-Fi hotspot...');
    stopWifiHotspot();
    stoppedAny = true;
  }

  // 2. Check and stop Bluetooth PAN
  if (isBluetoothPanRunning() || fs.existsSync(BT_PID_FILE)) {
    logger.info('Stopping Bluetooth reverse tethering...');
    stopBluetoothPan();
    stoppedAny = true;
  }

  // 3. Check PID file and terminate running USB gnirehtet daemon
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
        stoppedAny = true;
      } catch (err) {
        logger.debug(`Error terminating PID ${pid}: ${err.message}`);
      }
    }

    try {
      fs.unlinkSync(PID_FILE);
    } catch {}
  }

  // 4. Also run `gnirehtet stop` and remove adb reverse tunnels
  if (fs.existsSync(GNIREHTET_BIN)) {
    try {
      execSync(`"${GNIREHTET_BIN}" stop`, {
        stdio: 'ignore',
        env: { ...process.env, PATH: process.env.PATH }
      });
      stoppedAny = true;
    } catch (err) {
      logger.debug(`gnirehtet stop returned: ${err.message}`);
    }
  }

  try {
    execSync('adb reverse --remove-all', { stdio: 'ignore' });
  } catch {}

  if (stoppedAny) {
    logger.success(chalk.bold.green('All active Linksy connections stopped successfully.'));
  } else {
    logger.info('No active Linksy services were running.');
  }
}
