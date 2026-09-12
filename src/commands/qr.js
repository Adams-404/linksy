import chalk from 'chalk';
import { resolveWifiCredentials, generateWifiQrString, renderTerminalQr } from '../lib/qrCode.js';
import { logger } from '../utils/logger.js';

/**
 * Handles `linksy qr` / `linksy qrcode` command.
 * Renders a scannable Wi-Fi QR code directly in the terminal for instant mobile connection.
 * @param {{ ssid?: string, name?: string, password?: string, noPassword?: boolean, open?: boolean }} options
 */
export async function qrCommand(options = {}) {
  logger.banner();

  const creds = resolveWifiCredentials(options);
  const qrString = generateWifiQrString({
    ssid: creds.ssid,
    password: creds.password,
    security: creds.isOpen ? 'nopass' : 'WPA'
  });

  const terminalQr = await renderTerminalQr(qrString);

  if (creds.isActive) {
    console.log(chalk.green('✔') + ' ' + chalk.bold.green('Active Wi-Fi Hotspot Detected\n'));
  } else if (creds.isCustom) {
    console.log(chalk.cyan('📡') + ' ' + chalk.bold.cyan('Custom Wi-Fi Network QR Code\n'));
  } else {
    console.log(
      chalk.yellow('○') + ' ' +
      chalk.bold('Wi-Fi hotspot is currently inactive') +
      chalk.dim(' (Showing saved hotspot configuration)\n')
    );
  }

  // Display QR Code
  console.log(terminalQr);

  // Display credential details
  console.log(chalk.bold.cyan('\n📡 Network Credentials:'));
  console.log(`  • Network (SSID): ${chalk.bold.green(creds.ssid)}`);
  console.log(`  • Security:       ${creds.isOpen ? chalk.dim('None (Open)') : chalk.cyan('WPA / WPA2')}`);
  if (creds.isOpen) {
    console.log(`  • Password:       ${chalk.bold.magenta('None (Open Network)')}`);
  } else {
    console.log(`  • Password:       ${chalk.bold.yellow(creds.password)}`);
  }

  console.log(
    '\n' + chalk.bold('📱 Point your phone\'s camera or Wi-Fi scanner at the QR code above to connect instantly!')
  );

  if (!creds.isActive && !creds.isCustom) {
    console.log(
      chalk.dim('\nTip: Run ') +
      chalk.cyan('linksy on --wifi') +
      chalk.dim(' to start broadcasting this hotspot.')
    );
  }
  console.log('');
}
