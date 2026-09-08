import fs from 'node:fs';
import path from 'node:path';
import { execSync, spawnSync } from 'node:child_process';
import chalk from 'chalk';
import {
  LINKSY_DIR,
  WIFI_DIR,
  WIFI_PID_FILE,
  WIFI_LOG_FILE,
  WIFI_CONFIG_FILE,
  WIFI_LEASES_FILE,
  WIFI_DENY_FILE,
  WIFI_ACCEPT_FILE,
  HOSTAPD_CTRL_DIR
} from './paths.js';
import { getSavedConfig, saveConfig } from './config.js';
import { detectPackageManager } from './detectPackageManager.js';
import { logger } from '../utils/logger.js';

/**
 * Parses raw iw link and info text to extract active Wi-Fi connection parameters.
 * @param {string} iwOutput
 * @returns {{ connected: boolean, channel: number|null, freq: number|null, hwMode: 'a'|'g'|null, ssid: string|null, width: number|null }}
 */
export function parseActiveWifiInfo(iwOutput) {
  if (!iwOutput || typeof iwOutput !== 'string') {
    return { connected: false, channel: null, freq: null, hwMode: null, ssid: null, width: null };
  }

  const channelMatch = iwOutput.match(/channel\s+(\d+)\s*(?:\(([\d.]+)\s*MHz\))?/i);
  const freqMatch = iwOutput.match(/freq:\s*([\d.]+)/i);
  const ssidMatch = iwOutput.match(/ssid[:\s]+([^\n\r]+)/i);
  const widthMatch = iwOutput.match(/width:\s*(\d+)\s*MHz/i);

  const channel = channelMatch ? parseInt(channelMatch[1], 10) : null;
  let freq = channelMatch && channelMatch[2] ? parseFloat(channelMatch[2]) : null;
  if (!freq && freqMatch) {
    freq = parseFloat(freqMatch[1]);
  }

  const ssid = ssidMatch ? ssidMatch[1].trim() : null;
  const connected = Boolean(channel !== null && (freq !== null || channel > 0));
  const width = connected ? (widthMatch ? parseInt(widthMatch[1], 10) : 20) : null;
  const hwMode = connected ? (freq ? (freq > 4000 ? 'a' : 'g') : (channel && channel > 14 ? 'a' : 'g')) : null;

  return {
    connected,
    channel,
    freq,
    hwMode,
    ssid,
    width
  };
}

/**
 * Identifies the currently active/connected Wi-Fi interface and its radio parameters.
 * @returns {{ iface: string, ssid: string, channel: number, freq: number, hwMode: 'a'|'g', width: number }|null}
 */
export function getActiveWifiConnection() {
  try {
    const devOutput = execSync('iw dev', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
    const ifaceMatches = [...devOutput.matchAll(/Interface\s+([a-zA-Z0-9_-]+)/g)];

    for (const match of ifaceMatches) {
      const iface = match[1];
      if (iface.startsWith('ap') || iface.includes('_ap') || iface.startsWith('p2p-')) {
        continue;
      }

      try {
        const linkOutput = execSync(`iw dev ${iface} link`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
        const infoOutput = execSync(`iw dev ${iface} info`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
        const combined = `${linkOutput}\n${infoOutput}`;
        const parsed = parseActiveWifiInfo(combined);

        if (parsed.connected && parsed.channel) {
          return {
            iface,
            ...parsed
          };
        }
      } catch {
        // Try next interface
      }
    }
  } catch (err) {
    logger.debug(`getActiveWifiConnection failed: ${err.message}`);
  }
  return null;
}

/**
 * Checks if hostapd binary is available.
 * @returns {boolean}
 */
export function isHostapdInstalled() {
  try {
    execSync('command -v hostapd', { stdio: 'ignore' });
    return true;
  } catch {
    return fs.existsSync('/usr/sbin/hostapd') || fs.existsSync('/usr/bin/hostapd');
  }
}

/**
 * Checks if dnsmasq binary is available.
 * @returns {boolean}
 */
export function isDnsmasqInstalled() {
  try {
    execSync('command -v dnsmasq', { stdio: 'ignore' });
    return true;
  } catch {
    return fs.existsSync('/usr/sbin/dnsmasq') || fs.existsSync('/usr/bin/dnsmasq');
  }
}

/**
 * Attempts to detect system regulatory country code from iw reg get.
 * @returns {string|null}
 */
export function getRegulatoryCountry() {
  try {
    const output = execSync('iw reg get', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
    const match = output.match(/country\s+([A-Z]{2})/);
    if (match) return match[1];
  } catch {}
  return null;
}

/**
 * Detects the system admin group for control socket permissions (wheel on Fedora/Arch, sudo/adm on Debian).
 * @returns {string}
 */
export function getAdminGroup() {
  try {
    const groups = execSync('groups', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim().split(/\s+/);
    for (const g of ['wheel', 'sudo', 'adm']) {
      if (groups.includes(g)) return g;
    }
  } catch {}
  return 'wheel';
}

/**
 * Generates hostapd configuration matching the upstream Wi-Fi channel.
 * @param {{ apIface: string, ssid: string, password?: string, channel: number, hwMode: 'a'|'g', countryCode?: string }} params
 * @returns {string}
 */
export function generateHostapdConfig({
  apIface = 'ap0',
  ssid = 'Linksy-Hotspot',
  password = 'linksy12345',
  channel = 157,
  hwMode = 'a',
  countryCode = null,
  ctrlInterface = HOSTAPD_CTRL_DIR,
  ctrlGroup = 'wheel',
  denyMacFile = WIFI_DENY_FILE,
  acceptMacFile = WIFI_ACCEPT_FILE,
  whitelistMode = false
}) {
  const code = countryCode || getRegulatoryCountry();
  const lines = [
    `interface=${apIface}`,
    'driver=nl80211',
    `ssid=${ssid}`,
    `hw_mode=${hwMode}`,
    `channel=${channel}`,
    'ieee80211n=1',
    'wmm_enabled=1'
  ];

  if (ctrlInterface) {
    lines.push(`ctrl_interface=${ctrlInterface}`);
    if (ctrlGroup) {
      lines.push(`ctrl_interface_group=${ctrlGroup}`);
    }
  }

  if (whitelistMode && acceptMacFile && fs.existsSync(acceptMacFile)) {
    lines.push('macaddr_acl=1', `accept_mac_file=${acceptMacFile}`);
  } else if (denyMacFile && fs.existsSync(denyMacFile)) {
    lines.push('macaddr_acl=0', `deny_mac_file=${denyMacFile}`);
  }

  if (code) {
    lines.push(`country_code=${code}`, 'ieee80211d=1');
  }

  if (hwMode === 'a') {
    lines.push('ieee80211ac=1');
  }

  if (password && password.length >= 8) {
    lines.push(
      'auth_algs=1',
      'wpa=2',
      `wpa_passphrase=${password}`,
      'wpa_key_mgmt=WPA-PSK',
      'rsn_pairwise=CCMP'
    );
  } else {
    lines.push('auth_algs=1');
  }

  return lines.join('\n') + '\n';
}

/**
 * Checks if the hotspot process is currently running.
 * @returns {boolean}
 */
export function isHotspotRunning() {
  if (!fs.existsSync(WIFI_PID_FILE)) {
    return false;
  }
  try {
    const rawPid = fs.readFileSync(WIFI_PID_FILE, 'utf8').trim();
    const pid = parseInt(rawPid, 10);
    if (!isNaN(pid) && pid > 0) {
      try {
        process.kill(pid, 0);
        return true;
      } catch (err) {
        return err.code === 'EPERM';
      }
    }
  } catch {
    // Process not running
  }
  return false;
}

/**
 * Ensures required packages (hostapd, dnsmasq) are installed, auto-installing if missing.
 * @returns {boolean}
 */
export function ensureWifiDependencies() {
  const missing = [];
  if (!isHostapdInstalled()) missing.push('hostapd');
  if (!isDnsmasqInstalled()) missing.push('dnsmasq');

  if (missing.length === 0) {
    return true;
  }

  const pm = detectPackageManager();
  logger.warn(`Missing required package(s) for concurrent Wi-Fi hotspot: ${missing.join(', ')}`);

  if (!pm) {
    logger.error('Could not automatically detect a supported package manager (supported: DNF, APT, Pacman, Zypper).');
    logger.info(`Please install ${missing.join(', ')} manually using your distribution package manager.`);
    return false;
  }

  logger.info(`Detected package manager: ${pm.name}`);
  logger.info(`Linksy will now automatically install ${chalk.cyan(missing.join(', '))}...`);
  logger.info('This operation requires elevated privileges (sudo).\n');

  try {
    let commandArray = [];
    if (pm.type === 'dnf') {
      commandArray = ['dnf', 'install', '-y', ...missing];
    } else if (pm.type === 'apt') {
      if (pm.preCommandArray) {
        logger.info('Updating package lists...');
        spawnSync('sudo', pm.preCommandArray, { stdio: 'inherit' });
      }
      commandArray = ['apt-get', 'install', '-y', ...missing];
    } else if (pm.type === 'pacman') {
      commandArray = ['pacman', '-S', '--noconfirm', ...missing];
    } else if (pm.type === 'zypper') {
      commandArray = ['zypper', 'install', '-y', ...missing];
    }

    const result = spawnSync('sudo', commandArray, { stdio: 'inherit' });
    if (result.status !== 0) {
      logger.error(`Package manager exited with status code ${result.status}`);
      return false;
    }

    const hostapdReady = !missing.includes('hostapd') || isHostapdInstalled();
    const dnsmasqReady = !missing.includes('dnsmasq') || isDnsmasqInstalled();

    if (hostapdReady && dnsmasqReady) {
      logger.success(`Successfully installed ${missing.join(', ')}!`);
      return true;
    } else {
      logger.error('Installation finished, but dependencies could not be verified on PATH.');
      return false;
    }
  } catch (err) {
    logger.error('Failed to install dependencies automatically:', err);
    return false;
  }
}

/**
 * Starts concurrent AP+STA Wi-Fi hotspot on the matching channel.
 * @param {{ ssid?: string, password?: string, apIface?: string }} options
 */
export async function startWifiHotspot(options = {}) {
  if (process.platform !== 'linux') {
    logger.error('Linksy Wi-Fi hotspot currently supports Linux only.');
    process.exit(1);
  }

  const wantsOpen =
    options.noPassword === true ||
    options.open === true ||
    options.password === '' ||
    (typeof options.password === 'string' && ['none', 'open', 'false', 'no'].includes(options.password.toLowerCase()));

  const hasCredentialChange =
    options.password !== undefined ||
    options.ssid !== undefined ||
    options.noPassword !== undefined ||
    options.open !== undefined;

  if (isHotspotRunning()) {
    if (hasCredentialChange) {
      logger.info('Hotspot is currently active. Updating credentials and restarting hotspot...');
      stopWifiHotspot();
      await new Promise(resolve => setTimeout(resolve, 1000));
    } else {
      logger.warn('Wi-Fi hotspot is already active.');
      logger.info(`Run ${chalk.bold.cyan('linksy off')} to stop it, or ${chalk.bold.cyan('linksy status')} for details.`);
      return;
    }
  }

  const saved = getSavedConfig();
  const apIface = options.apIface || 'ap0';
  const ssid = options.ssid || saved.wifiSsid || 'Linksy-Hotspot';

  let password;
  if (wantsOpen) {
    password = null;
  } else if (options.password) {
    password = options.password;
  } else if (saved.wifiPassword === null || saved.wifiPassword === 'none' || saved.wifiPassword === '') {
    password = null;
  } else if (saved.wifiPassword) {
    password = saved.wifiPassword;
  } else {
    password = 'linksy12345';
  }

  if (password) {
    if (password.length < 8 || password.length > 63) {
      logger.error(`Invalid Wi-Fi password length (${password.length} characters).`);
      logger.info('WPA2-PSK passphrases must be between 8 and 63 characters long (or use --no-password for an open network).');
      process.exit(1);
    }
  }

  if (hasCredentialChange) {
    saveConfig({
      wifiSsid: ssid,
      wifiPassword: password || 'none'
    });
  }

  if (!ensureWifiDependencies()) {
    process.exit(1);
  }

  const activeWifi = getActiveWifiConnection();
  if (!activeWifi) {
    logger.error('No active Wi-Fi connection detected on your laptop.');
    logger.info('To share internet via concurrent Wi-Fi hotspot, your laptop must be connected to a Wi-Fi network first.');
    logger.info('Linksy will match your hotspot to the same channel as your connection.');
    process.exit(1);
  }

  logger.info(`Detected active Wi-Fi: ${chalk.green(activeWifi.ssid || 'connected')} on ${chalk.cyan(activeWifi.iface)}`);
  logger.info(`Frequency: ${chalk.yellow(activeWifi.freq ? `${activeWifi.freq} MHz` : '')} (Channel ${chalk.yellow(activeWifi.channel)}, ${activeWifi.hwMode === 'a' ? '5 GHz' : '2.4 GHz'})`);
  if (!fs.existsSync(WIFI_DIR)) {
    fs.mkdirSync(WIFI_DIR, { recursive: true });
  }

  // Write deny and accept files if configured
  if (Array.isArray(saved.blacklist) && saved.blacklist.length > 0) {
    try { fs.writeFileSync(WIFI_DENY_FILE, saved.blacklist.join('\n') + '\n', 'utf8'); } catch {}
  }
  if (Array.isArray(saved.whitelist) && saved.whitelist.length > 0) {
    try { fs.writeFileSync(WIFI_ACCEPT_FILE, saved.whitelist.join('\n') + '\n', 'utf8'); } catch {}
  }

  const adminGroup = getAdminGroup();

  const configContent = generateHostapdConfig({
    apIface,
    ssid,
    password,
    channel: activeWifi.channel,
    hwMode: activeWifi.hwMode,
    ctrlGroup: adminGroup,
    whitelistMode: saved.whitelistMode === true
  });

  fs.writeFileSync(WIFI_CONFIG_FILE, configContent, 'utf8');

  const startScriptPath = path.join(WIFI_DIR, 'start-hotspot.sh');
  const stopScriptPath = path.join(WIFI_DIR, 'stop-hotspot.sh');

  const startScript = `#!/usr/bin/env bash
set -e
IFACE="${activeWifi.iface}"
AP_IFACE="${apIface}"
CONF="${WIFI_CONFIG_FILE}"
PID_FILE="${WIFI_PID_FILE}"
LOG_FILE="${WIFI_LOG_FILE}"
LEASES_FILE="${WIFI_LEASES_FILE}"
DENY_FILE="${WIFI_DENY_FILE}"
ADMIN_GROUP="${adminGroup}"

# Clear previous log
: > "$LOG_FILE"

# 0. Pre-emptively tell NetworkManager to ignore ap0 before interface creation
mkdir -p /run/NetworkManager/conf.d
cat << 'NMEOF' > /run/NetworkManager/conf.d/99-linksy.conf
[keyfile]
unmanaged-devices=interface-name:ap0;interface-name:pan0
NMEOF
nmcli general reload conf 2>/dev/null || true

mkdir -p /run/hostapd
chgrp "$ADMIN_GROUP" /run/hostapd 2>/dev/null || true
chmod 775 /run/hostapd 2>/dev/null || true

# 1. Clean up stale ap interface if existing
iw dev "$AP_IFACE" del 2>/dev/null || true

# 2. Add virtual AP interface
iw dev "$IFACE" interface add "$AP_IFACE" type __ap

# 3. Tell NetworkManager not to interfere with virtual AP interface
nmcli device set "$AP_IFACE" managed no 2>/dev/null || true

# 4. Bring up interface and assign private IP
ip addr flush dev "$AP_IFACE" 2>/dev/null || true
ip addr add 192.168.42.1/24 dev "$AP_IFACE"
ip link set "$AP_IFACE" up 2>/dev/null || true

# 5. Enable IP forwarding and firewall/NAT rules
sysctl -w net.ipv4.ip_forward=1 >/dev/null

# If firewalld is active, assign AP interface to trusted zone so DHCP, DNS, and traffic forwarding are permitted
if command -v firewall-cmd >/dev/null 2>&1 && systemctl is-active firewalld >/dev/null 2>&1; then
  firewall-cmd --zone=trusted --add-interface="$AP_IFACE" 2>/dev/null || true
fi

# Apply any blacklist drop rules
if [ -f "$DENY_FILE" ]; then
  while read -r mac; do
    mac=$(echo "$mac" | tr -d '\r\n ')
    if [ -n "$mac" ]; then
      iptables -I INPUT -i "$AP_IFACE" -m mac --mac-source "$mac" -j DROP 2>/dev/null || true
      iptables -I FORWARD -i "$AP_IFACE" -m mac --mac-source "$mac" -j DROP 2>/dev/null || true
    fi
  done < "$DENY_FILE"
fi

# Insert explicit iptables rules for DHCP, DNS, and NAT routing
iptables -I INPUT -i "$AP_IFACE" -p udp --dport 67:68 --sport 67:68 -j ACCEPT 2>/dev/null || true
iptables -I INPUT -i "$AP_IFACE" -p udp --dport 53 -j ACCEPT 2>/dev/null || true
iptables -I INPUT -i "$AP_IFACE" -p tcp --dport 53 -j ACCEPT 2>/dev/null || true
iptables -I FORWARD -i "$AP_IFACE" -o "$IFACE" -j ACCEPT 2>/dev/null || true
iptables -I FORWARD -i "$IFACE" -o "$AP_IFACE" -m state --state RELATED,ESTABLISHED -j ACCEPT 2>/dev/null || true
iptables -t nat -C POSTROUTING -o "$IFACE" -j MASQUERADE 2>/dev/null || \\
  iptables -t nat -A POSTROUTING -o "$IFACE" -j MASQUERADE

# 6. Start hostapd in daemon mode with PID file
hostapd -B -P "$PID_FILE" "$CONF" >> "$LOG_FILE" 2>&1
sleep 1

# Ensure interface is UP with IP after hostapd binding
ip link set "$AP_IFACE" up 2>/dev/null || true
ip addr add 192.168.42.1/24 dev "$AP_IFACE" 2>/dev/null || true

# 7. Start dnsmasq with dynamic binding and designated leases file
dnsmasq --conf-file=/dev/null --no-hosts --bind-dynamic \\
  --interface="$AP_IFACE" \\
  --dhcp-range=192.168.42.10,192.168.42.100,255.255.255.0,12h \\
  --dhcp-option=3,192.168.42.1 \\
  --dhcp-option=6,1.1.1.1,8.8.8.8 \\
  --dhcp-leasefile="$LEASES_FILE" \\
  --log-dhcp \\
  --pid-file="\${PID_FILE}.dnsmasq" >> "$LOG_FILE" 2>&1
`;

  const stopScript = `#!/usr/bin/env bash
IFACE="${activeWifi.iface}"
AP_IFACE="${apIface}"
PID_FILE="${WIFI_PID_FILE}"
DENY_FILE="${WIFI_DENY_FILE}"

if [ -f "\${PID_FILE}.dnsmasq" ]; then
  kill "$(cat "\${PID_FILE}.dnsmasq")" 2>/dev/null || true
  rm -f "\${PID_FILE}.dnsmasq"
fi

if [ -f "$PID_FILE" ]; then
  kill "$(cat "$PID_FILE")" 2>/dev/null || true
  rm -f "$PID_FILE"
fi

killall hostapd 2>/dev/null || true

# Remove from firewalld trusted zone if present
if command -v firewall-cmd >/dev/null 2>&1 && systemctl is-active firewalld >/dev/null 2>&1; then
  firewall-cmd --zone=trusted --remove-interface="$AP_IFACE" 2>/dev/null || true
fi

# Clean up blacklist rules if existing
if [ -f "$DENY_FILE" ]; then
  while read -r mac; do
    mac=$(echo "$mac" | tr -d '\r\n ')
    if [ -n "$mac" ]; then
      iptables -D INPUT -i "$AP_IFACE" -m mac --mac-source "$mac" -j DROP 2>/dev/null || true
      iptables -D FORWARD -i "$AP_IFACE" -m mac --mac-source "$mac" -j DROP 2>/dev/null || true
    fi
  done < "$DENY_FILE"
fi

iptables -D INPUT -i "$AP_IFACE" -p udp --dport 67:68 --sport 67:68 -j ACCEPT 2>/dev/null || true
iptables -D INPUT -i "$AP_IFACE" -p udp --dport 53 -j ACCEPT 2>/dev/null || true
iptables -D INPUT -i "$AP_IFACE" -p tcp --dport 53 -j ACCEPT 2>/dev/null || true
iptables -D FORWARD -i "$AP_IFACE" -o "$IFACE" -j ACCEPT 2>/dev/null || true
iptables -D FORWARD -i "$IFACE" -o "$AP_IFACE" -m state --state RELATED,ESTABLISHED 2>/dev/null || true
iptables -t nat -D POSTROUTING -o "$IFACE" -j MASQUERADE 2>/dev/null || true

rm -f /run/NetworkManager/conf.d/99-linksy.conf 2>/dev/null || true
nmcli general reload conf 2>/dev/null || true

nmcli device set "$AP_IFACE" managed yes 2>/dev/null || true
iw dev "$AP_IFACE" del 2>/dev/null || true
`;

  fs.writeFileSync(startScriptPath, startScript, { mode: 0o755 });
  fs.writeFileSync(stopScriptPath, stopScript, { mode: 0o755 });

  logger.info('Starting concurrent Wi-Fi hotspot (elevated privileges required for virtual interface & routing)...');
  const result = spawnSync('sudo', ['bash', startScriptPath], { stdio: 'inherit' });

  if (result.status !== 0) {
    logger.error(`Failed to start Wi-Fi hotspot (exit status: ${result.status}).`);
    if (fs.existsSync(WIFI_LOG_FILE)) {
      const logs = fs.readFileSync(WIFI_LOG_FILE, 'utf8').trim().split('\n').slice(-15).join('\n');
      if (logs) {
        console.log(chalk.dim('\nRecent logs:\n' + logs + '\n'));
      }
    }
    process.exit(1);
  }

  // Brief pause to ensure hostapd started
  await new Promise(resolve => setTimeout(resolve, 1500));

  if (!isHotspotRunning()) {
    logger.error('Hotspot started but exited unexpectedly.');
    if (fs.existsSync(WIFI_LOG_FILE)) {
      const logs = fs.readFileSync(WIFI_LOG_FILE, 'utf8').trim().split('\n').slice(-15).join('\n');
      if (logs) {
        console.log(chalk.dim('\nRecent logs:\n' + logs + '\n'));
      }
    }
    process.exit(1);
  }

  logger.success(chalk.bold.green('Concurrent Wi-Fi Hotspot is now active!'));
  console.log(
    '\n' + chalk.bold.cyan('📡 Wi-Fi Hotspot Details:\n') +
    `  • Network Name (SSID): ${chalk.bold.green(ssid)}\n` +
    `  • Password:            ${password ? chalk.bold.yellow(password) : chalk.bold.magenta('None (Open Network)')}\n` +
    `  • Channel:             ${chalk.cyan(activeWifi.channel)} (${activeWifi.hwMode === 'a' ? '5 GHz' : '2.4 GHz'})\n` +
    `  • Subnet:              192.168.42.1/24 (DHCP enabled)\n\n` +
    `Connect your phone, tablet, or another laptop to "${chalk.bold.green(ssid)}".\n` +
    `Run ${chalk.bold.cyan('linksy off')} at any time to stop the hotspot.\n`
  );
}

/**
 * Stops concurrent Wi-Fi hotspot and restores interface state.
 */
export function stopWifiHotspot() {
  const stopScriptPath = path.join(WIFI_DIR, 'stop-hotspot.sh');
  if (fs.existsSync(stopScriptPath)) {
    try {
      spawnSync('sudo', ['bash', stopScriptPath], { stdio: 'inherit' });
    } catch (err) {
      logger.debug(`Error running stop script: ${err.message}`);
    }
  }

  try {
    if (fs.existsSync(WIFI_PID_FILE)) fs.unlinkSync(WIFI_PID_FILE);
  } catch {}

  logger.success('Wi-Fi hotspot stopped and virtual interface cleaned up.');
}

/**
 * Returns diagnostic status of the Wi-Fi hotspot.
 * @returns {{ running: boolean, pid: number|null, ssid: string|null, channel: number|null }}
 */
export function getWifiHotspotStatus() {
  const running = isHotspotRunning();
  let pid = null;
  let ssid = null;
  let channel = null;
  let password = null;

  if (fs.existsSync(WIFI_PID_FILE)) {
    try {
      pid = parseInt(fs.readFileSync(WIFI_PID_FILE, 'utf8').trim(), 10) || null;
    } catch {}
  }

  if (fs.existsSync(WIFI_CONFIG_FILE)) {
    try {
      const conf = fs.readFileSync(WIFI_CONFIG_FILE, 'utf8');
      const ssidMatch = conf.match(/^ssid=(.*)$/m);
      const chMatch = conf.match(/^channel=(.*)$/m);
      const passMatch = conf.match(/^wpa_passphrase=(.*)$/m);
      if (ssidMatch) ssid = ssidMatch[1];
      if (chMatch) channel = parseInt(chMatch[1], 10);
      if (passMatch) password = passMatch[1];
    } catch {}
  }

  return { running, pid, ssid, channel, password };
}
