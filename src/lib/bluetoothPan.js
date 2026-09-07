import fs from 'node:fs';
import path from 'node:path';
import { execSync, spawnSync } from 'node:child_process';
import chalk from 'chalk';
import {
  LINKSY_DIR,
  BT_DIR,
  BT_PID_FILE,
  BT_LOG_FILE
} from './paths.js';
import { getActiveWifiConnection } from './wifiHotspot.js';
import { logger } from '../utils/logger.js';

/**
 * Checks if Bluetooth stack and controller are available.
 * @returns {{ available: boolean, powered: boolean, controller: string|null, error: string|null }}
 */
export function checkBluetoothAvailability() {
  try {
    execSync('command -v bluetoothctl', { stdio: 'ignore' });
  } catch {
    return { available: false, powered: false, controller: null, error: 'bluetoothctl is not installed.' };
  }

  // Ensure rfkill unblocked
  try {
    execSync('rfkill unblock bluetooth', { stdio: 'ignore' });
  } catch {}

  let listOutput = '';
  try {
    listOutput = execSync('bluetoothctl list', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
  } catch {}

  const match = listOutput.match(/Controller\s+([0-9A-Fa-f:]+)\s+(.*)/);
  if (!match) {
    return {
      available: true,
      powered: false,
      controller: null,
      error: 'No active Bluetooth controller found. Make sure Bluetooth is enabled in your system settings.'
    };
  }

  const controllerMac = match[1];
  const controllerName = match[2].trim();

  let powered = false;
  try {
    const showOutput = execSync('bluetoothctl show', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
    powered = /Powered:\s*yes/i.test(showOutput);
  } catch {}

  return {
    available: true,
    powered,
    controller: `${controllerName} (${controllerMac})`,
    error: null
  };
}

/**
 * Checks if Bluetooth PAN tethering service is currently active.
 * @returns {boolean}
 */
export function isBluetoothPanRunning() {
  if (!fs.existsSync(BT_PID_FILE)) {
    return false;
  }
  try {
    const rawPid = fs.readFileSync(BT_PID_FILE, 'utf8').trim();
    const pid = parseInt(rawPid, 10);
    if (!isNaN(pid) && pid > 0) {
      try {
        process.kill(pid, 0);
        return true;
      } catch (err) {
        return err.code === 'EPERM';
      }
    }
  } catch {}
  return false;
}

/**
 * Starts Bluetooth PAN Network Access Point (NAP) reverse tethering.
 * @param {{ bridge?: string }} options
 */
export async function startBluetoothPan(options = {}) {
  if (process.platform !== 'linux') {
    logger.error('Linksy Bluetooth reverse tethering currently supports Linux only.');
    process.exit(1);
  }

  if (isBluetoothPanRunning()) {
    logger.warn('Bluetooth reverse tethering is already active.');
    logger.info(`Run ${chalk.bold.cyan('linksy off')} to stop it, or ${chalk.bold.cyan('linksy status')} for details.`);
    return;
  }

  const btCheck = checkBluetoothAvailability();
  if (!btCheck.available) {
    logger.error(btCheck.error || 'Bluetooth is not available on this system.');
    process.exit(1);
  }

  if (!btCheck.controller) {
    logger.error('Bluetooth hardware controller not detected.');
    logger.info('Please verify Bluetooth is enabled in your system BIOS and settings.');
    process.exit(1);
  }

  logger.info(`Detected Bluetooth Controller: ${chalk.green(btCheck.controller)}`);

  // Try powering on adapter
  try {
    execSync('bluetoothctl power on', { stdio: 'ignore' });
  } catch {}

  // Find upstream internet interface
  let upstreamIface = 'wlp0s20f3';
  const activeWifi = getActiveWifiConnection();
  if (activeWifi?.iface) {
    upstreamIface = activeWifi.iface;
  } else {
    try {
      const routeOutput = execSync('ip route show default', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
      const devMatch = routeOutput.match(/dev\s+([a-zA-Z0-9_-]+)/);
      if (devMatch) upstreamIface = devMatch[1];
    } catch {}
  }

  logger.info(`Upstream internet interface for NAT: ${chalk.cyan(upstreamIface)}`);

  if (!fs.existsSync(BT_DIR)) {
    fs.mkdirSync(BT_DIR, { recursive: true });
  }

  const bridge = options.bridge || 'pan0';
  const startScriptPath = path.join(BT_DIR, 'start-bluetooth.sh');
  const stopScriptPath = path.join(BT_DIR, 'stop-bluetooth.sh');

  const startScript = `#!/usr/bin/env bash
set -e
IFACE="${upstreamIface}"
BRIDGE="${bridge}"
PID_FILE="${BT_PID_FILE}"
LOG_FILE="${BT_LOG_FILE}"

# 1. Ensure Bluetooth power
rfkill unblock bluetooth 2>/dev/null || true
bluetoothctl power on 2>/dev/null || true
bluetoothctl discoverable on 2>/dev/null || true

# 2. Setup network bridge
ip link add name "$BRIDGE" type bridge 2>/dev/null || true
ip addr flush dev "$BRIDGE" 2>/dev/null || true
ip addr add 10.42.0.1/24 dev "$BRIDGE"
ip link set "$BRIDGE" up

# 3. Register BlueZ NetworkServer NAP service
busctl call org.bluez /org/bluez/hci0 org.bluez.NetworkServer1 Register ss "nap" "$BRIDGE" 2>/dev/null || true

# 4. Enable IP forwarding and NAT
sysctl -w net.ipv4.ip_forward=1 >/dev/null
iptables -t nat -C POSTROUTING -o "$IFACE" -j MASQUERADE 2>/dev/null || \\
  iptables -t nat -A POSTROUTING -o "$IFACE" -j MASQUERADE
iptables -C FORWARD -i "$BRIDGE" -o "$IFACE" -j ACCEPT 2>/dev/null || \\
  iptables -A FORWARD -i "$BRIDGE" -o "$IFACE" -j ACCEPT
iptables -C FORWARD -i "$IFACE" -o "$BRIDGE" -m state --state RELATED,ESTABLISHED -j ACCEPT 2>/dev/null || \\
  iptables -A FORWARD -i "$IFACE" -o "$BRIDGE" -m state --state RELATED,ESTABLISHED -j ACCEPT

# 5. Start dnsmasq DHCP server for Bluetooth subnet
dnsmasq --conf-file=/dev/null --no-hosts --bind-interfaces \\
  --except-interface=lo --interface="$BRIDGE" \\
  --dhcp-range=10.42.0.10,10.42.0.100,255.255.255.0,12h \\
  --dhcp-option=3,10.42.0.1 \\
  --dhcp-option=6,1.1.1.1,8.8.8.8 \\
  --pid-file="$PID_FILE" >> "$LOG_FILE" 2>&1
`;

  const stopScript = `#!/usr/bin/env bash
IFACE="${upstreamIface}"
BRIDGE="${bridge}"
PID_FILE="${BT_PID_FILE}"

if [ -f "$PID_FILE" ]; then
  kill "$(cat "$PID_FILE")" 2>/dev/null || true
  rm -f "$PID_FILE"
fi

busctl call org.bluez /org/bluez/hci0 org.bluez.NetworkServer1 Unregister s "nap" 2>/dev/null || true

iptables -t nat -D POSTROUTING -o "$IFACE" -j MASQUERADE 2>/dev/null || true
iptables -D FORWARD -i "$BRIDGE" -o "$IFACE" -j ACCEPT 2>/dev/null || true
iptables -D FORWARD -i "$IFACE" -o "$BRIDGE" -m state --state RELATED,ESTABLISHED -j ACCEPT 2>/dev/null || true

ip link set "$BRIDGE" down 2>/dev/null || true
ip link delete "$BRIDGE" type bridge 2>/dev/null || true
`;

  fs.writeFileSync(startScriptPath, startScript, { mode: 0o755 });
  fs.writeFileSync(stopScriptPath, stopScript, { mode: 0o755 });

  logger.info('Starting Bluetooth PAN NAP server (elevated privileges required for bridge & NAT)...');
  const result = spawnSync('sudo', ['bash', startScriptPath], { stdio: 'inherit' });

  if (result.status !== 0) {
    logger.error(`Failed to initialize Bluetooth PAN (exit status: ${result.status}).`);
    process.exit(1);
  }

  await new Promise(resolve => setTimeout(resolve, 1000));

  logger.success(chalk.bold.green('Bluetooth Reverse Tethering (PAN NAP) is now active!'));
  console.log(
    '\n' + chalk.bold.cyan('📱 Connect Your Android Phone:\n') +
    '  1. On your phone, go to ' + chalk.bold('Settings → Bluetooth') + '.\n' +
    '  2. Pair with your laptop if not already paired.\n' +
    '  3. Tap the ' + chalk.bold.cyan('settings (gear)') + ' icon next to your laptop\'s name.\n' +
    '  4. Toggle ON ' + chalk.bold.green('"Internet access"') + '.\n\n' +
    'Your phone will route its internet connection through your laptop over Bluetooth!\n' +
    'Run ' + chalk.bold.cyan('linksy off') + ' at any time to stop the service.\n'
  );
}

/**
 * Stops Bluetooth PAN service and tears down bridge.
 */
export function stopBluetoothPan() {
  const stopScriptPath = path.join(BT_DIR, 'stop-bluetooth.sh');
  if (fs.existsSync(stopScriptPath)) {
    try {
      spawnSync('sudo', ['bash', stopScriptPath], { stdio: 'inherit' });
    } catch (err) {
      logger.debug(`Error stopping bluetooth PAN: ${err.message}`);
    }
  }

  try {
    if (fs.existsSync(BT_PID_FILE)) fs.unlinkSync(BT_PID_FILE);
  } catch {}

  logger.success('Bluetooth PAN service stopped.');
}

/**
 * Returns Bluetooth PAN status.
 * @returns {{ running: boolean, pid: number|null, bridge: string }}
 */
export function getBluetoothPanStatus() {
  const running = isBluetoothPanRunning();
  let pid = null;
  if (fs.existsSync(BT_PID_FILE)) {
    try {
      pid = parseInt(fs.readFileSync(BT_PID_FILE, 'utf8').trim(), 10) || null;
    } catch {}
  }
  return { running, pid, bridge: 'pan0' };
}
