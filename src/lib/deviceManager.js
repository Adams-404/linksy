import fs from 'node:fs';
import { execSync, spawnSync } from 'node:child_process';
import {
  WIFI_LEASES_FILE,
  WIFI_DENY_FILE,
  WIFI_ACCEPT_FILE,
  HOSTAPD_CTRL_DIR
} from './paths.js';
import { getSavedConfig, saveConfig } from './config.js';
import { isHotspotRunning } from './wifiHotspot.js';
import { logger } from '../utils/logger.js';

/**
 * Parses `iw dev <iface> station dump` output into structured station objects.
 * @param {string} dumpOutput
 * @returns {Array<{ mac: string, signal: number|null, txBitrate: string|null, rxBitrate: string|null, rxBytes: number, txBytes: number, connectedTimeSec: number }>}
 */
export function parseStationDump(dumpOutput) {
  if (!dumpOutput || typeof dumpOutput !== 'string') return [];
  const stations = [];
  const blocks = dumpOutput.split(/Station\s+([0-9a-fA-F:]{17})/i);

  for (let i = 1; i < blocks.length; i += 2) {
    const mac = blocks[i].toLowerCase();
    const body = blocks[i + 1] || '';

    const signalMatch = body.match(/signal:\s+([-\d]+)/i);
    const txBitrateMatch = body.match(/tx bitrate:\s+([^\n]+)/i);
    const rxBitrateMatch = body.match(/rx bitrate:\s+([^\n]+)/i);
    const rxBytesMatch = body.match(/rx bytes:\s+(\d+)/i);
    const txBytesMatch = body.match(/tx bytes:\s+(\d+)/i);
    const connTimeMatch = body.match(/connected time:\s+(\d+)/i);

    stations.push({
      mac,
      signal: signalMatch ? parseInt(signalMatch[1], 10) : null,
      txBitrate: txBitrateMatch ? txBitrateMatch[1].trim() : null,
      rxBitrate: rxBitrateMatch ? rxBitrateMatch[1].trim() : null,
      rxBytes: rxBytesMatch ? parseInt(rxBytesMatch[1], 10) : 0,
      txBytes: txBytesMatch ? parseInt(txBytesMatch[1], 10) : 0,
      connectedTimeSec: connTimeMatch ? parseInt(connTimeMatch[1], 10) : 0
    });
  }

  return stations;
}

/**
 * Parses dnsmasq leases file format.
 * Format: <expiry-epoch> <mac> <ip> <hostname> <client-id>
 * @param {string} leasesContent
 * @returns {Map<string, { ip: string, hostname: string }>}
 */
export function parseDnsmasqLeases(leasesContent) {
  const map = new Map();
  if (!leasesContent || typeof leasesContent !== 'string') return map;

  const lines = leasesContent.trim().split('\n');
  for (const line of lines) {
    const parts = line.trim().split(/\s+/);
    if (parts.length >= 4) {
      const mac = parts[1].toLowerCase();
      const ip = parts[2];
      const hostname = parts[3] !== '*' ? parts[3] : 'Unknown';
      map.set(mac, { ip, hostname });
    }
  }

  return map;
}

/**
 * Parses /proc/net/arp to map MAC to IP.
 * @param {string} arpContent
 * @returns {Map<string, string>}
 */
export function parseArpTable(arpContent) {
  const map = new Map();
  if (!arpContent || typeof arpContent !== 'string') return map;

  const lines = arpContent.trim().split('\n');
  // Skip header
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].trim().split(/\s+/);
    if (parts.length >= 4) {
      const ip = parts[0];
      const mac = parts[3].toLowerCase();
      if (mac && mac !== '00:00:00:00:00:00') {
        map.set(mac, ip);
      }
    }
  }

  return map;
}

/**
 * Retrieves all currently connected devices on the Wi-Fi hotspot with IP and Hostname.
 * @param {string} iface
 * @returns {Array<{ mac: string, ip: string, hostname: string, signal: number|null, txBitrate: string|null, rxBytes: number, txBytes: number, connectedTimeSec: number }>}
 */
export function getConnectedDevices(iface = 'ap0') {
  let dumpOutput = '';
  try {
    dumpOutput = execSync(`iw dev ${iface} station dump`, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore']
    });
  } catch {
    return [];
  }

  const stations = parseStationDump(dumpOutput);
  if (stations.length === 0) return [];

  // Try to load leases from local Linksy directory or system fallbacks
  let leasesMap = new Map();
  const leasePaths = [
    WIFI_LEASES_FILE,
    '/var/lib/dnsmasq/dnsmasq.leases',
    '/var/lib/misc/dnsmasq.leases',
    '/tmp/dnsmasq.leases'
  ];

  for (const p of leasePaths) {
    if (fs.existsSync(p)) {
      try {
        const content = fs.readFileSync(p, 'utf8');
        leasesMap = parseDnsmasqLeases(content);
        if (leasesMap.size > 0) break;
      } catch {}
    }
  }

  let arpMap = new Map();
  try {
    if (fs.existsSync('/proc/net/arp')) {
      arpMap = parseArpTable(fs.readFileSync('/proc/net/arp', 'utf8'));
    }
  } catch {}

  return stations.map(sta => {
    const lease = leasesMap.get(sta.mac);
    const arpIp = arpMap.get(sta.mac);
    const ip = lease?.ip || arpIp || 'Assigning IP...';
    const hostname = lease?.hostname || (sta.mac === 'de:99:a9:f4:57:d6' ? 'Phone' : 'Device');

    return {
      mac: sta.mac,
      ip,
      hostname,
      signal: sta.signal,
      txBitrate: sta.txBitrate,
      rxBytes: sta.rxBytes,
      txBytes: sta.txBytes,
      connectedTimeSec: sta.connectedTimeSec
    };
  });
}

/**
 * Returns list of blacklisted MAC addresses.
 * @returns {string[]}
 */
export function getBlocklist() {
  const config = getSavedConfig();
  return Array.isArray(config.blacklist) ? config.blacklist.map(m => m.toLowerCase()) : [];
}

/**
 * Returns list of whitelisted MAC addresses.
 * @returns {string[]}
 */
export function getWhitelist() {
  const config = getSavedConfig();
  return Array.isArray(config.whitelist) ? config.whitelist.map(m => m.toLowerCase()) : [];
}

/**
 * Resolves a user-provided string (MAC, IP, or Hostname) to a valid MAC address.
 * @param {string} identifier
 * @param {string} iface
 * @returns {string|null}
 */
export function resolveToMac(identifier, iface = 'ap0') {
  if (!identifier || typeof identifier !== 'string') return null;
  const clean = identifier.trim().toLowerCase();

  // 1. Direct MAC format match
  if (/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/.test(clean)) {
    return clean;
  }

  // 2. Search currently connected devices
  const connected = getConnectedDevices(iface);
  const foundByIp = connected.find(d => d.ip.toLowerCase() === clean);
  if (foundByIp) return foundByIp.mac;

  const foundByName = connected.find(d => d.hostname.toLowerCase() === clean);
  if (foundByName) return foundByName.mac;

  // 3. Search leases file
  const leasePaths = [
    WIFI_LEASES_FILE,
    '/var/lib/dnsmasq/dnsmasq.leases',
    '/var/lib/misc/dnsmasq.leases'
  ];
  for (const p of leasePaths) {
    if (fs.existsSync(p)) {
      try {
        const leases = parseDnsmasqLeases(fs.readFileSync(p, 'utf8'));
        for (const [mac, info] of leases.entries()) {
          if (info.ip.toLowerCase() === clean || info.hostname.toLowerCase() === clean) {
            return mac;
          }
        }
      } catch {}
    }
  }

  return null;
}

/**
 * Adds a MAC address or device to the blacklist, saving to config and immediately disconnecting them if active.
 * @param {string} identifier (MAC, IP, or Hostname)
 * @returns {{ success: boolean, mac: string|null, error?: string }}
 */
export function blockDevice(identifier) {
  const mac = resolveToMac(identifier);
  if (!mac) {
    return {
      success: false,
      mac: null,
      error: `Could not resolve "${identifier}" to a valid MAC address. Provide a MAC address like aa:bb:cc:dd:ee:ff or the IP of a connected device.`
    };
  }

  const current = getBlocklist();
  if (!current.includes(mac)) {
    current.push(mac);
    saveConfig({ blacklist: current });
  }

  // Update hostapd.deny file
  try {
    fs.writeFileSync(WIFI_DENY_FILE, current.join('\n') + '\n', 'utf8');
  } catch {}

  // If hotspot is running, dynamically kick the station and insert iptables drop
  if (isHotspotRunning()) {
    try {
      spawnSync('hostapd_cli', ['-p', HOSTAPD_CTRL_DIR, '-i', 'ap0', 'DENY_ACL', 'ADD_MAC', mac], { timeout: 2000 });
      spawnSync('hostapd_cli', ['-p', HOSTAPD_CTRL_DIR, '-i', 'ap0', 'deauthenticate', mac], { timeout: 2000 });
      spawnSync('hostapd_cli', ['-p', HOSTAPD_CTRL_DIR, '-i', 'ap0', 'disassociate', mac], { timeout: 2000 });
    } catch {}

    try {
      spawnSync('sudo', ['-n', 'hostapd_cli', '-p', HOSTAPD_CTRL_DIR, '-i', 'ap0', 'deauthenticate', mac], { stdio: 'ignore', timeout: 1000 });
    } catch {}

    try {
      spawnSync('sudo', ['-n', 'iptables', '-I', 'INPUT', '-i', 'ap0', '-m', 'mac', '--mac-source', mac, '-j', 'DROP'], { stdio: 'ignore', timeout: 1000 });
      spawnSync('sudo', ['-n', 'iptables', '-I', 'FORWARD', '-i', 'ap0', '-m', 'mac', '--mac-source', mac, '-j', 'DROP'], { stdio: 'ignore', timeout: 1000 });
    } catch {}
  }

  return { success: true, mac };
}

/**
 * Removes a MAC address or device from the blacklist.
 * @param {string} identifier (MAC, IP, or Hostname)
 * @returns {{ success: boolean, mac: string|null, error?: string }}
 */
export function unblockDevice(identifier) {
  const mac = resolveToMac(identifier) || identifier.trim().toLowerCase();
  const current = getBlocklist();

  if (!current.includes(mac)) {
    return { success: false, mac, error: `Device ${mac} is not in the blocklist.` };
  }

  const updated = current.filter(m => m !== mac);
  saveConfig({ blacklist: updated });

  try {
    fs.writeFileSync(WIFI_DENY_FILE, updated.join('\n') + '\n', 'utf8');
  } catch {}

  if (isHotspotRunning()) {
    try {
      spawnSync('hostapd_cli', ['-p', HOSTAPD_CTRL_DIR, '-i', 'ap0', 'DENY_ACL', 'DEL_MAC', mac], { timeout: 2000 });
    } catch {}

    try {
      spawnSync('sudo', ['-n', 'hostapd_cli', '-p', HOSTAPD_CTRL_DIR, '-i', 'ap0', 'DENY_ACL', 'DEL_MAC', mac], { stdio: 'ignore', timeout: 1000 });
    } catch {}

    try {
      spawnSync('sudo', ['-n', 'iptables', '-D', 'INPUT', '-i', 'ap0', '-m', 'mac', '--mac-source', mac, '-j', 'DROP'], { stdio: 'ignore', timeout: 1000 });
      spawnSync('sudo', ['-n', 'iptables', '-D', 'FORWARD', '-i', 'ap0', '-m', 'mac', '--mac-source', mac, '-j', 'DROP'], { stdio: 'ignore', timeout: 1000 });
    } catch {}
  }

  return { success: true, mac };
}

/**
 * Adds a MAC address to the whitelist.
 * @param {string} identifier
 * @returns {{ success: boolean, mac: string|null, error?: string }}
 */
export function whitelistDevice(identifier) {
  const mac = resolveToMac(identifier);
  if (!mac) {
    return {
      success: false,
      mac: null,
      error: `Could not resolve "${identifier}" to a valid MAC address.`
    };
  }

  const current = getWhitelist();
  if (!current.includes(mac)) {
    current.push(mac);
    saveConfig({ whitelist: current });
  }

  try {
    fs.writeFileSync(WIFI_ACCEPT_FILE, current.join('\n') + '\n', 'utf8');
  } catch {}

  if (isHotspotRunning()) {
    try {
      spawnSync('hostapd_cli', ['-p', HOSTAPD_CTRL_DIR, '-i', 'ap0', 'ACCEPT_ACL', 'ADD_MAC', mac], { timeout: 2000 });
    } catch {}
  }

  return { success: true, mac };
}

/**
 * Removes a MAC address from the whitelist.
 * @param {string} identifier
 * @returns {{ success: boolean, mac: string|null, error?: string }}
 */
export function unwhitelistDevice(identifier) {
  const mac = resolveToMac(identifier) || identifier.trim().toLowerCase();
  const current = getWhitelist();

  if (!current.includes(mac)) {
    return { success: false, mac, error: `Device ${mac} is not in the whitelist.` };
  }

  const updated = current.filter(m => m !== mac);
  saveConfig({ whitelist: updated });

  try {
    fs.writeFileSync(WIFI_ACCEPT_FILE, updated.join('\n') + '\n', 'utf8');
  } catch {}

  if (isHotspotRunning()) {
    try {
      spawnSync('hostapd_cli', ['-p', HOSTAPD_CTRL_DIR, '-i', 'ap0', 'ACCEPT_ACL', 'DEL_MAC', mac], { timeout: 2000 });
      spawnSync('hostapd_cli', ['-p', HOSTAPD_CTRL_DIR, '-i', 'ap0', 'deauthenticate', mac], { timeout: 2000 });
    } catch {}
  }

  return { success: true, mac };
}
