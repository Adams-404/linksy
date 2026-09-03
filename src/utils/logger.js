import chalk from 'chalk';

let verboseMode = false;

export function setVerbose(enabled) {
  verboseMode = Boolean(enabled);
}

export function isVerbose() {
  return verboseMode;
}

export const logger = {
  info(message) {
    console.log(chalk.cyan('ℹ ') + message);
  },

  success(message) {
    console.log(chalk.green('✔ ') + message);
  },

  warn(message) {
    console.log(chalk.yellow('⚠ ') + message);
  },

  error(message, error = null) {
    console.error(chalk.red('✖ ') + chalk.red(message));
    if (error && verboseMode) {
      console.error(chalk.dim(error.stack || error.message || error));
    }
  },

  step(title) {
    console.log('\n' + chalk.bold.blue('==>') + ' ' + chalk.bold(title));
  },

  substep(message) {
    console.log(chalk.dim('  • ') + message);
  },

  debug(message) {
    if (verboseMode) {
      console.log(chalk.dim('[DEBUG] ' + message));
    }
  },

  log(message) {
    console.log(message);
  },

  banner() {
    console.log(chalk.bold.hex('#3498db')('\n╭───────────────────────────────────────────────────╮'));
    console.log(chalk.bold.hex('#3498db')('│') + chalk.bold.white('  📱 Linksy PhoneNet — Reverse USB Tethering       ') + chalk.bold.hex('#3498db')('│'));
    console.log(chalk.bold.hex('#3498db')('│') + chalk.dim('  Share your Wi-Fi connection over USB effortlessly') + chalk.bold.hex('#3498db')('│'));
    console.log(chalk.bold.hex('#3498db')('╰───────────────────────────────────────────────────╯\n'));
  }
};
