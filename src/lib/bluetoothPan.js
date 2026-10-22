import fs from 'node:fs';
import path from 'node:path';
import { execSync, spawnSync } from 'node:child_process';
import chalk from 'chalk';
import {
  BT_DIR,
  BT_PID_FILE,
  BT_LOG_FILE,
  BT_DNSMASQ_PID_FILE,
  BT_DNSMASQ_LEASES_FILE
} from './paths.js';
import { getActiveWifiConnection } from './wifiHotspot.js';
import {
  generateFirewallSetupScript,
  generateFirewallTeardownScript,
  generateDnsDiscoveryScript
} from './firewall.js';
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
 * Resolves the BlueZ D-Bus object path of the Bluetooth controller
 * (e.g. /org/bluez/hci0). Hardcoding hci0 broke machines whose adapter is
 * enumerated as hci1 or later (USB dongles, some laptops).
 * @param {string} [controllerLabel] Value returned by checkBluetoothAvailability().controller
 * @returns {string}
 */
export function getBluetoothControllerPath(controllerLabel = '') {
  const macMatch = String(controllerLabel).match(/([0-9a-f]{2}(?::[0-9a-f]{2}){5})/i);
  const wantedMac = macMatch ? macMatch[1].toLowerCase() : null;
  const candidates = [];

  try {
    for (const entry of fs.readdirSync('/sys/class/bluetooth')) {
      if (/^hci\d+$/.test(entry)) candidates.push(entry);
    }
  } catch {}

  candidates.sort((a, b) => parseInt(a.slice(3), 10) - parseInt(b.slice(3), 10));

  if (wantedMac) {
    for (const entry of candidates) {
      try {
        const address = fs.readFileSync(`/sys/class/bluetooth/${entry}/address`, 'utf8').trim().toLowerCase();
        if (address === wantedMac) return `/org/bluez/${entry}`;
      } catch {}
    }
  }

  if (candidates.length > 0) {
    return `/org/bluez/${candidates[0]}`;
  }

  // Fallback: ask BlueZ itself which controller objects exist.
  try {
    const tree = execSync('busctl tree org.bluez --no-pager', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore']
    });
    const match = tree.match(/\/org\/bluez\/hci\d+/);
    if (match) return match[0];
  } catch {}

  return '/org/bluez/hci0';
}

/**
 * Reads the PID of the running PAN dnsmasq daemon.
 * Checks the current /run/linksy location first, then the legacy ~/.linksy path
 * so an older Linksy install can still be detected (and stopped).
 * @returns {number|null}
 */
function readBluetoothPid() {
  for (const pidFile of [BT_DNSMASQ_PID_FILE, BT_PID_FILE]) {
    let raw;
    try {
      raw = fs.readFileSync(pidFile, 'utf8').trim();
    } catch {
      continue;
    }
    const pid = parseInt(raw, 10);
    if (!Number.isInteger(pid) || pid <= 0) continue;
    try {
      process.kill(pid, 0);
      return pid;
    } catch (err) {
      if (err.code === 'EPERM') return pid;
    }
  }
  return null;
}

/**
 * Checks if Bluetooth PAN tethering service is currently active.
 * @returns {boolean}
 */
export function isBluetoothPanRunning() {
  return readBluetoothPid() !== null;
}

/**
 * Generates the start-pan.sh bash script content.
 * @param {{ upstreamIface: string, bridge?: string, controllerPath?: string }} options
 * @returns {string}
 */
export function generateBluetoothStartScript({
  upstreamIface,
  bridge = 'pan0',
  controllerPath = '/org/bluez/hci0'
} = {}) {
  return `#!/usr/bin/env bash
set -e
export PATH="/usr/local/sbin:/usr/sbin:/sbin:$PATH"
IFACE="${upstreamIface}"
BRIDGE="${bridge}"
AP_IFACE="$BRIDGE"
DENY_FILE=""
PID_FILE="${BT_DNSMASQ_PID_FILE}"
LEGACY_PID_FILE="${BT_PID_FILE}"
LOG_FILE="${BT_LOG_FILE}"

: > "$LOG_FILE" 2>/dev/null || true

# 1. Make sure the adapter is powered and discoverable
rfkill unblock bluetooth 2>/dev/null || true
bluetoothctl power on 2>/dev/null || true
bluetoothctl discoverable on 2>/dev/null || true

# 2. Recreate the PAN bridge so stale addresses/routes do not linger
ip link set "$BRIDGE" down 2>/dev/null || true
ip link delete "$BRIDGE" type bridge 2>/dev/null || true
ip link add name "$BRIDGE" type bridge 2>/dev/null || true
ip addr flush dev "$BRIDGE" 2>/dev/null || true
ip addr add 10.42.0.1/24 dev "$BRIDGE"
ip link set "$BRIDGE" up

# 3. Register the BlueZ NAP server on the real controller path
busctl call org.bluez "${controllerPath}" org.bluez.NetworkServer1 Register ss "nap" "$BRIDGE" 2>/dev/null || true

# 4. Enable IP forwarding, open the firewall and set up NAT
${generateFirewallSetupScript({ subnet: '10.42.0.0/24' })}

# 5. Discover the real upstream DNS servers
${generateDnsDiscoveryScript()}

# dnsmasq drops privileges after startup, so its runtime files live in
# /run/linksy (mode 755) rather than inside the user's private home directory.
mkdir -p "$RUN_DIR" 2>/dev/null || true
chmod 755 "$RUN_DIR" 2>/dev/null || true
: > "${BT_DNSMASQ_LEASES_FILE}" 2>/dev/null || true
chmod 666 "${BT_DNSMASQ_LEASES_FILE}" 2>/dev/null || true
: > "$PID_FILE" 2>/dev/null || true
chmod 666 "$PID_FILE" 2>/dev/null || true

# Stop a dnsmasq left over from a previous or interrupted run; it would hold
# port 53 and make the new instance fail to start.
for _pid_file in "$PID_FILE" "$LEGACY_PID_FILE"; do
  if [ -f "$_pid_file" ]; then
    kill -9 "$(cat "$_pid_file" 2>/dev/null)" 2>/dev/null || true
    rm -f "$_pid_file"
  fi
done
pkill -9 -f "dnsmasq.*--interface=$AP_IFACE" 2>/dev/null || true

DNSMASQ_FALLBACK_SERVERS=""
if [ -z "$DNS_SERVERS" ]; then
  DNSMASQ_FALLBACK_SERVERS="--server=1.1.1.1 --server=8.8.8.8"
fi

DNSMASQ_RC=0
dnsmasq --conf-file=/dev/null --no-hosts --bind-interfaces \\
  --except-interface=lo --interface="$BRIDGE" \\
  --resolv-file="$RUN_DIR/upstream-dns.conf" \\
  $DNSMASQ_FALLBACK_SERVERS \\
  --dhcp-range=10.42.0.10,10.42.0.100,255.255.255.0,12h \\
  --dhcp-option=1,255.255.255.0 \\
  --dhcp-option=3,10.42.0.1 \\
  --dhcp-option=6,10.42.0.1 \\
  --dhcp-option=28,10.42.0.255 \\
  --dhcp-leasefile="${BT_DNSMASQ_LEASES_FILE}" \\
  --log-dhcp \\
  --pid-file="$PID_FILE" >> "$LOG_FILE" 2>&1 || DNSMASQ_RC=$?

if [ "$DNSMASQ_RC" -ne 0 ]; then
  echo "Linksy: dnsmasq failed to start (exit $DNSMASQ_RC), so your phone would get no IP address." >&2
  echo "Linksy: see $LOG_FILE for details. Port 53 may already be in use by another DNS server." >&2
  exit 1
fi

sleep 0.5
DNSMASQ_RUNNING=0
if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE" 2>/dev/null)" 2>/dev/null; then
  DNSMASQ_RUNNING=1
fi
if [ "$DNSMASQ_RUNNING" = "0" ] && pgrep -f "dnsmasq.*--interface=$AP_IFACE" >/dev/null 2>&1; then
  DNSMASQ_RUNNING=1
fi
if [ "$DNSMASQ_RUNNING" = "0" ]; then
  echo "Linksy: dnsmasq did not stay running, so your phone would get no IP address." >&2
  echo "Linksy: see $LOG_FILE for details." >&2
  exit 1
fi

if [ "$NAT_OK" != "1" ]; then
  echo "Linksy: warning - the NAT rule could not be verified, so your phone may connect without internet." >&2
  echo "Linksy: run 'linksy doctor' and make sure your firewall forwards traffic from 10.42.0.0/24." >&2
fi
`;
}

/**
 * Generates the stop-pan.sh bash script content.
 * @param {{ upstreamIface: string, bridge?: string, controllerPath?: string }} options
 * @returns {string}
 */
export function generateBluetoothStopScript({
  upstreamIface,
  bridge = 'pan0',
  controllerPath = '/org/bluez/hci0'
} = {}) {
  return `#!/usr/bin/env bash
export PATH="/usr/local/sbin:/usr/sbin:/sbin:$PATH"
IFACE="${upstreamIface}"
BRIDGE="${bridge}"
AP_IFACE="$BRIDGE"
DENY_FILE=""
PID_FILE="${BT_DNSMASQ_PID_FILE}"
LEGACY_PID_FILE="${BT_PID_FILE}"

for _pid_file in "$PID_FILE" "$LEGACY_PID_FILE"; do
  if [ -f "$_pid_file" ]; then
    kill "$(cat "$_pid_file" 2>/dev/null)" 2>/dev/null || true
    rm -f "$_pid_file"
  fi
done
pkill -9 -f "dnsmasq.*--interface=$AP_IFACE" 2>/dev/null || true

busctl call org.bluez "${controllerPath}" org.bluez.NetworkServer1 Unregister s "nap" 2>/dev/null || true

# Remove firewall/NAT rules for every uplink Linksy may have used
${generateFirewallTeardownScript()}

if command -v firewall-cmd >/dev/null 2>&1 && systemctl is-active --quiet firewalld >/dev/null 2>&1; then
  firewall-cmd --zone=trusted --remove-interface="$BRIDGE" 2>/dev/null || true
fi

ip link set "$BRIDGE" down 2>/dev/null || true
ip link delete "$BRIDGE" type bridge 2>/dev/null || true
`;
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
  const controllerPath = getBluetoothControllerPath(btCheck.controller);

  const startScript = generateBluetoothStartScript({ upstreamIface, bridge, controllerPath });
  const stopScript = generateBluetoothStopScript({ upstreamIface, bridge, controllerPath });

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
    for (const pidFile of [BT_DNSMASQ_PID_FILE, BT_PID_FILE]) {
      if (fs.existsSync(pidFile)) fs.unlinkSync(pidFile);
    }
  } catch {}

  logger.success('Bluetooth PAN service stopped.');
}

/**
 * Returns Bluetooth PAN status.
 * @returns {{ running: boolean, pid: number|null, bridge: string }}
 */
export function getBluetoothPanStatus() {
  const pid = readBluetoothPid();
  return { running: pid !== null, pid, bridge: 'pan0' };
}
