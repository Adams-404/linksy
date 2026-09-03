import fs from 'node:fs';
import { spawn, execSync } from 'node:child_process';
import chalk from 'chalk';
import { GNIREHTET_BIN, PID_FILE, LOG_FILE } from '../lib/paths.js';
import { checkDeviceStatus } from '../lib/adbHelpers.js';
import { logger } from '../utils/logger.js';

/**
 * Checks if a process with the given PID is currently running.
 * @param {number} pid
 * @returns {boolean}
 */
export function isProcessRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return false;
  }
}

export async function onCommand(options = {}) {
  // 1. Check OS
  if (process.platform !== 'linux') {
    logger.error('Linksy currently supports Linux only.');
    process.exit(1);
  }

  // 2. Check if gnirehtet binary exists
  if (!fs.existsSync(GNIREHTET_BIN)) {
    logger.error('Gnirehtet binary not found.');
    logger.info('Please run ' + chalk.bold.cyan('linksy setup') + ' first to install required components.');
    process.exit(1);
  }

  // 3. Check if already running
  if (fs.existsSync(PID_FILE)) {
    const rawPid = fs.readFileSync(PID_FILE, 'utf8').trim();
    const pid = parseInt(rawPid, 10);
    if (!isNaN(pid) && isProcessRunning(pid)) {
      logger.warn(`Linksy is already running (PID: ${pid}).`);
      logger.info(`Run ${chalk.bold.cyan('linksy off')} to stop it, or ${chalk.bold.cyan('linksy status')} for details.`);
      return;
    } else {
      // Stale PID file
      try { fs.unlinkSync(PID_FILE); } catch {}
    }
  }

  // 4. Check connected Android devices
  const deviceStatus = checkDeviceStatus();
  if (!deviceStatus.adbAvailable) {
    logger.error('adb is not installed or not working properly.');
    logger.info('Please run ' + chalk.bold.cyan('linksy setup') + ' or ' + chalk.bold.cyan('linksy doctor') + ' to fix this.');
    process.exit(1);
  }

  if (!deviceStatus.hasAnyDevice) {
    logger.error('No phone detected.');
    console.log(
      chalk.yellow('\nTo connect your phone:\n') +
      '  1. Plug in your phone via USB cable.\n' +
      '  2. Make sure USB debugging is enabled on your phone:\n' +
      '     • Settings → About phone\n' +
      '     • Tap "Build number" 7 times (to enable Developer Options)\n' +
      '     • Settings → System (or Developer options) → Enable "USB debugging"\n' +
      '  3. Reconnect the cable and run ' + chalk.cyan('linksy on') + ' again.\n'
    );
    process.exit(1);
  }

  if (!deviceStatus.hasAuthorizedDevice) {
    logger.warn('A device was detected, but USB debugging is unauthorized.');
    console.log(
      chalk.yellow('\nAction needed on your phone:\n') +
      '  • Unlock your phone screen.\n' +
      '  • Look for the "Allow USB debugging?" dialog.\n' +
      '  • Check "Always allow from this computer" and tap OK.\n' +
      '  • Then re-run ' + chalk.cyan('linksy on') + '.\n'
    );
    process.exit(1);
  }

  const authorizedDevice = deviceStatus.devices.find(d => d.isAuthorized);
  logger.info(`Detected Android device: ${chalk.green(authorizedDevice.serial)}`);

  // 5. Start Gnirehtet
  if (options.foreground) {
    logger.info('Starting Gnirehtet in foreground mode (Ctrl+C to stop)...');
    try {
      const child = spawn(GNIREHTET_BIN, ['run'], {
        stdio: 'inherit',
        env: { ...process.env, PATH: process.env.PATH }
      });

      fs.writeFileSync(PID_FILE, String(child.pid));

      const cleanup = () => {
        try {
          if (fs.existsSync(PID_FILE)) fs.unlinkSync(PID_FILE);
          execSync(`"${GNIREHTET_BIN}" stop`, { stdio: 'ignore' });
        } catch {}
        process.exit(0);
      };

      process.on('SIGINT', cleanup);
      process.on('SIGTERM', cleanup);

      child.on('exit', (code) => {
        try {
          if (fs.existsSync(PID_FILE)) fs.unlinkSync(PID_FILE);
        } catch {}
        if (code !== 0 && code !== null) {
          logger.warn(`Gnirehtet exited with code ${code}`);
        }
      });
    } catch (err) {
      logger.error('Failed to start Gnirehtet in foreground:', err);
      process.exit(1);
    }
  } else {
    // Detached background mode
    logger.info('Starting reverse tethering in background...');
    const logFd = fs.openSync(LOG_FILE, 'a');

    try {
      const child = spawn(GNIREHTET_BIN, ['run'], {
        detached: true,
        stdio: ['ignore', logFd, logFd],
        env: { ...process.env, PATH: process.env.PATH }
      });

      const pid = child.pid;
      fs.writeFileSync(PID_FILE, String(pid));
      child.unref();

      // Wait 1.5 seconds to ensure the process didn't die immediately on startup
      await new Promise(resolve => setTimeout(resolve, 1500));

      if (!isProcessRunning(pid)) {
        logger.error('Gnirehtet failed to start.');
        if (fs.existsSync(LOG_FILE)) {
          const logs = fs.readFileSync(LOG_FILE, 'utf8').trim().split('\n').slice(-10).join('\n');
          if (logs) {
            console.log(chalk.dim('\nRecent logs:\n' + logs + '\n'));
          }
        }
        try { fs.unlinkSync(PID_FILE); } catch {}
        process.exit(1);
      }

      logger.success(chalk.bold.green('Reverse USB tethering is now active! (PID: ' + pid + ')'));
      console.log('\n' + chalk.bold('Important:') + ' Check your phone screen now and ' + chalk.bold.cyan('approve the connection prompt') + ' (VPN request).');
      console.log('Run ' + chalk.bold.cyan('linksy off') + ' to stop tethering at any time.\n');
    } catch (err) {
      logger.error('Failed to launch Gnirehtet:', err);
      process.exit(1);
    }
  }
}
