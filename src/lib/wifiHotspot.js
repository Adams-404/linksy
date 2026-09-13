import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
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
import { getWifiInterfaceName } from './checkWifiCapability.js';
import { logger } from '../utils/logger.js';

const PID_FILE = WIFI_PID_FILE;

/**
 * Detects the laptop model or host to build a unique, human-friendly default SSID (e.g. Linksy-ThinkPad-T490s).
 * Capped to standard 802.11 32-byte SSID limit.
 * @returns {string}
 */
export function getDefaultHotspotSsid() {
  const dmiPaths = [
    '/sys/devices/virtual/dmi/id/product_family',
    '/sys/devices/virtual/dmi/id/product_version',
    '/sys/devices/virtual/dmi/id/product_name'
  ];

  let rawModel = '';
  for (const p of dmiPaths) {
    try {
      if (fs.existsSync(p)) {
        const val = fs.readFileSync(p, 'utf8').trim();
        if (
          val &&
          !/^(to be filled|system product|default string|none|all series|o\.e\.m|type1product)/i.test(val) &&
          !/^[0-9a-zA-Z]{10,}$/.test(val)
        ) {
          rawModel = val;
          break;
        }
      }
    } catch {}
  }

  if (!rawModel) {
    try {
      const pName = '/sys/devices/virtual/dmi/id/product_name';
      if (fs.existsSync(pName)) {
        const val = fs.readFileSync(pName, 'utf8').trim();
        if (val && !/^(to be filled|system product|default string|none)/i.test(val)) {
          rawModel = val;
        }
      }
    } catch {}
  }

  const user = process.env.USER || '';

  if (!rawModel) {
    try {
      const h = os.hostname();
      if (h && h !== 'localhost' && !h.startsWith('localhost.')) {
        rawModel = h;
      }
    } catch {}
  }

  if (rawModel) {
    const isGenericDistro = /^(fedora|ubuntu|arch|debian|linux|manjaro|opensuse|gentoo)$/i.test(rawModel);
    let identifier = rawModel;
    if (isGenericDistro && user && user !== 'root') {
      identifier = `${user}-${rawModel}`;
    }
    const cleaned = identifier
      .replace(/[^a-zA-Z0-9_-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
    if (cleaned) {
      return `Linksy-${cleaned}`.slice(0, 32);
    }
  }

  if (user && user !== 'root') {
    const cleanedUser = user.replace(/[^a-zA-Z0-9_-]/g, '');
    if (cleanedUser) {
      return `Linksy-${cleanedUser}`.slice(0, 32);
    }
  }

  return 'Linksy-Hotspot';
}

/**
 * Converts a radio frequency in MHz to its standard 802.11 channel number.
 * Supports 2.4 GHz (1-14) and 5 GHz (32-177).
 * @param {number} freq
 * @returns {number|null}
 */
export function getChannelFromFrequency(freq) {
  if (!freq || typeof freq !== 'number' || isNaN(freq)) return null;
  const rounded = Math.round(freq);

  // 2.4 GHz: 2412 (Ch 1) to 2472 (Ch 13) spaced every 5 MHz
  if (rounded >= 2412 && rounded <= 2472) {
    return Math.round((rounded - 2407) / 5);
  }
  // 2.4 GHz: Channel 14 (Japan)
  if (rounded === 2484) {
    return 14;
  }

  // 5 GHz: 5160 MHz to 5885 MHz
  if (rounded >= 5160 && rounded <= 5885) {
    return Math.round((rounded - 5000) / 5);
  }

  return null;
}

/**
 * Converts a channel number and band hint to frequency in MHz.
 * @param {number} channel
 * @param {'a'|'g'|'2.4'|'5'|null} bandHint
 * @returns {number|null}
 */
export function getFrequencyFromChannel(channel, bandHint = null) {
  if (!channel || typeof channel !== 'number' || isNaN(channel)) return null;

  if (channel === 14) return 2484;
  if (channel >= 1 && channel <= 13) {
    return 2407 + (channel * 5);
  }
  if (channel >= 32 && channel <= 177) {
    return 5000 + (channel * 5);
  }

  return null;
}

/**
 * Parses raw iw link and info text to extract active Wi-Fi connection parameters.
 * Automatically derives channel from frequency (or frequency from channel) if either is omitted by driver/kernel.
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

  let channel = channelMatch ? parseInt(channelMatch[1], 10) : null;
  let freq = channelMatch && channelMatch[2] ? parseFloat(channelMatch[2]) : null;
  if (!freq && freqMatch) {
    freq = parseFloat(freqMatch[1]);
  }

  // Derive channel from frequency if omitted by driver (common on Intel iwlwifi AC 9560 / AX200)
  if (!channel && freq) {
    channel = getChannelFromFrequency(freq);
  }
  // Derive frequency from channel if omitted
  if (channel && !freq) {
    freq = getFrequencyFromChannel(channel);
  }

  const ssid = ssidMatch ? ssidMatch[1].trim() : null;
  const connected = Boolean((channel !== null && channel > 0) || (freq !== null && freq > 0));
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
 * Parses a single line from `nmcli -t -f IN-USE,SSID,CHAN,FREQ,DEVICE dev wifi list`.
 * @param {string} line
 * @returns {{ inUse: boolean, ssid: string, channel: number|null, freq: number|null, iface: string|null }|null}
 */
export function parseNmcliWifiLine(line) {
  if (!line || typeof line !== 'string') return null;
  const trimmed = line.trim();
  if (!trimmed) return null;

  const inUse = trimmed.startsWith('*');
  const colonParts = trimmed.split(':');
  if (colonParts.length < 5) return null;

  const iface = colonParts[colonParts.length - 1].trim();
  const rawFreq = colonParts[colonParts.length - 2].trim();
  const rawChan = colonParts[colonParts.length - 3].trim();
  const rawSsid = colonParts.slice(1, colonParts.length - 3).join(':').replace(/\\:/g, ':').trim();

  const channel = parseInt(rawChan, 10);
  const freqNum = parseFloat(rawFreq.replace(/[^0-9.]/g, ''));
  const freq = !isNaN(freqNum) && freqNum > 0 ? freqNum : (channel ? getFrequencyFromChannel(channel) : null);
  const finalChannel = !isNaN(channel) && channel > 0 ? channel : (freq ? getChannelFromFrequency(freq) : null);

  return {
    inUse,
    ssid: rawSsid,
    channel: finalChannel,
    freq,
    iface: iface || null
  };
}

/**
 * Queries NetworkManager via nmcli to detect the active Wi-Fi connection and its radio parameters.
 * @returns {{ iface: string, ssid: string, channel: number, freq: number, hwMode: 'a'|'g', width: number }|null}
 */
export function getActiveWifiFromNmcli() {
  try {
    // Fast path: nmcli dev wifi list --rescan no queries NM internal cache (~50ms)
    const wifiList = execSync('nmcli -t -f IN-USE,SSID,CHAN,FREQ,DEVICE dev wifi list --rescan no', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore']
    });

    const lines = wifiList.split('\n');
    for (const line of lines) {
      const parsed = parseNmcliWifiLine(line);
      if (parsed && parsed.inUse && parsed.iface && parsed.channel) {
        const hwMode = (parsed.freq && parsed.freq > 4000) || parsed.channel > 14 ? 'a' : 'g';
        return {
          iface: parsed.iface,
          ssid: parsed.ssid || 'Wi-Fi Network',
          channel: parsed.channel,
          freq: parsed.freq || (parsed.channel <= 14 ? 2407 + (parsed.channel * 5) : 5000 + (parsed.channel * 5)),
          hwMode,
          width: 20
        };
      }
    }
  } catch {}

  // Fallback: Check nmcli dev status for connected wifi interface
  try {
    const devStatus = execSync('nmcli -t -f DEVICE,TYPE,STATE dev', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore']
    });
    const devLines = devStatus.split('\n');
    for (const line of devLines) {
      const parts = line.split(':');
      if (parts.length >= 3 && parts[1] === 'wifi' && parts[2] === 'connected') {
        const dev = parts[0];
        try {
          const showOutput = execSync(`nmcli -t -f GENERAL.CONNECTION dev show ${dev}`, {
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'ignore']
          });
          const connMatch = showOutput.match(/GENERAL\.CONNECTION:(.+)/);
          const ssid = connMatch ? connMatch[1].trim() : 'Wi-Fi Network';

          // Check if iw can get link info for this device
          try {
            const linkOutput = execSync(`iw dev ${dev} link`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
            const parsedLink = parseActiveWifiInfo(linkOutput);
            if (parsedLink.channel) {
              return {
                iface: dev,
                ssid: parsedLink.ssid || ssid,
                channel: parsedLink.channel,
                freq: parsedLink.freq,
                hwMode: parsedLink.hwMode,
                width: parsedLink.width || 20
              };
            }
          } catch {}

          // Query wifi list for this specific interface
          const wifiListIface = execSync(`nmcli -t -f IN-USE,SSID,CHAN,FREQ,DEVICE dev wifi list ifname ${dev}`, {
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'ignore']
          });
          for (const wLine of wifiListIface.split('\n')) {
            const parsed = parseNmcliWifiLine(wLine);
            if (parsed && parsed.inUse && parsed.channel) {
              const hwMode = (parsed.freq && parsed.freq > 4000) || parsed.channel > 14 ? 'a' : 'g';
              return {
                iface: dev,
                ssid: parsed.ssid || ssid,
                channel: parsed.channel,
                freq: parsed.freq || (parsed.channel <= 14 ? 2407 + (parsed.channel * 5) : 5000 + (parsed.channel * 5)),
                hwMode,
                width: 20
              };
            }
          }
        } catch {}
      }
    }
  } catch {}

  return null;
}

/**
 * Identifies the currently active/connected Wi-Fi interface and its radio parameters.
 * Uses a multi-engine discovery pipeline:
 * 1. Queries iw dev and sysfs (/sys/class/net) for wireless interfaces and inspects their link status.
 * 2. Falls back to NetworkManager (nmcli) cache for instant detection across modern Linux desktops.
 * @returns {{ iface: string, ssid: string, channel: number, freq: number, hwMode: 'a'|'g', width: number }|null}
 */
export function getActiveWifiConnection() {
  try {
    const candidateIfaces = [];

    try {
      const devOutput = execSync('iw dev', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
      const ifaceMatches = [...devOutput.matchAll(/Interface\s+([a-zA-Z0-9_-]+)/g)];
      for (const match of ifaceMatches) {
        candidateIfaces.push(match[1]);
      }
    } catch {}

    // Augment candidate interfaces from /sys/class/net in case iw dev didn't find them
    try {
      if (fs.existsSync('/sys/class/net')) {
        const entries = fs.readdirSync('/sys/class/net');
        for (const entry of entries) {
          if (entry.startsWith('ap') || entry.includes('_ap') || entry.startsWith('p2p-') || entry.startsWith('pan') || entry === 'lo') continue;
          if (fs.existsSync(`/sys/class/net/${entry}/wireless`) || fs.existsSync(`/sys/class/net/${entry}/phy80211`)) {
            if (!candidateIfaces.includes(entry)) {
              candidateIfaces.push(entry);
            }
          }
        }
      }
    } catch {}

    for (const iface of candidateIfaces) {
      if (iface.startsWith('ap') || iface.includes('_ap') || iface.startsWith('p2p-')) {
        continue;
      }

      try {
        const linkOutput = execSync(`iw dev ${iface} link`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
        let infoOutput = '';
        try {
          infoOutput = execSync(`iw dev ${iface} info`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
        } catch {}

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
    logger.debug(`iw connection detection failed: ${err.message}`);
  }

  // Engine 2: Fall back to NetworkManager
  const nmcliResult = getActiveWifiFromNmcli();
  if (nmcliResult) {
    return nmcliResult;
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
    return fs.existsSync('/usr/sbin/hostapd') || fs.existsSync('/sbin/hostapd') || fs.existsSync('/usr/bin/hostapd');
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
    return fs.existsSync('/usr/sbin/dnsmasq') || fs.existsSync('/sbin/dnsmasq') || fs.existsSync('/usr/bin/dnsmasq');
  }
}

/**
 * Checks if iw binary is available.
 * @returns {boolean}
 */
export function isIwInstalled() {
  try {
    execSync('command -v iw', { stdio: 'ignore' });
    return true;
  } catch {
    return fs.existsSync('/usr/sbin/iw') || fs.existsSync('/sbin/iw') || fs.existsSync('/usr/bin/iw') || fs.existsSync('/bin/iw');
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
    if (match) return match[1].toUpperCase();
  } catch {}
  return null;
}

/**
 * Parses raw iw reg get output into country code and list of authorized frequency ranges.
 * @param {string} output
 * @returns {{ country: string|null, ranges: Array<{ start: number, end: number, bw: number }> }}
 */
export function parseRegulatoryBands(output) {
  if (!output || typeof output !== 'string') {
    return { country: null, ranges: [] };
  }

  const countryMatch = output.match(/country\s+([A-Z]{2})/i);
  const country = countryMatch ? countryMatch[1].toUpperCase() : null;

  const ranges = [];
  const rangeRegex = /\(\s*(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)\s*@\s*(\d+(?:\.\d+)?)\s*\)/g;
  let match;
  while ((match = rangeRegex.exec(output)) !== null) {
    ranges.push({
      start: parseFloat(match[1]),
      end: parseFloat(match[2]),
      bw: parseFloat(match[3])
    });
  }

  return { country, ranges };
}

/**
 * Returns fallback country code based on system timezone / locale.
 * @returns {string|null}
 */
export function getSystemCountryFallback() {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    if (tz.includes('Lagos') || tz.includes('Nigeria')) return 'NG';
    if (tz.includes('London') || tz.includes('Dublin')) return 'GB';
    if (tz.includes('New_York') || tz.includes('Chicago') || tz.includes('Los_Angeles')) return 'US';
    if (tz.includes('Tokyo')) return 'JP';
    if (tz.includes('Berlin') || tz.includes('Paris')) return 'DE';
  } catch {}
  return null;
}

/**
 * Retrieves regulatory information including detected country and authorized bands.
 * @returns {{ country: string|null, ranges: Array<{ start: number, end: number, bw: number }> }}
 */
export function getRegulatoryInfo() {
  try {
    const output = execSync('iw reg get', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
    const parsed = parseRegulatoryBands(output);
    if (!parsed.country) {
      parsed.country = getSystemCountryFallback();
    }
    return parsed;
  } catch {
    return { country: getSystemCountryFallback(), ranges: [] };
  }
}

/**
 * Evaluates whether a Wi-Fi channel and frequency are authorized and detectable by mobile clients
 * in the current regulatory region (with special handling for Nigeria / NCC / ETSI restrictions).
 * @param {{ channel: number, freq?: number, countryCode?: string, regRanges?: Array<{ start: number, end: number }> }} params
 * @returns {{ compatible: boolean, country: string|null, band: '2.4GHz'|'5GHz', reason?: string }}
 */
export function isChannelCompatibleWithRegion({
  channel,
  freq = null,
  countryCode = null,
  regRanges = null
}) {
  const code = (countryCode || getRegulatoryCountry() || getSystemCountryFallback() || '').toUpperCase();

  // 2.4 GHz channels 1 through 13 are universally supported across all jurisdictions
  if (channel >= 1 && channel <= 13) {
    return { compatible: true, country: code, band: '2.4GHz' };
  }

  // Channel 14 is legally permitted only in Japan
  if (channel === 14) {
    return {
      compatible: code === 'JP',
      country: code,
      band: '2.4GHz',
      reason: 'Channel 14 is only legally authorized in Japan.'
    };
  }

  // Nigeria (NG) mobile regulatory restrictions:
  // Under NCC / ETSI frequency allocations and carrier SIM MCC 621 rules,
  // Android and iOS devices restrict/disable scanning on U-NII-1 (channels 36-48)
  // and U-NII-2C (channels 100-144).
  // Only 2.4 GHz (channels 1-13), 5.2 GHz DFS (channels 52-64), and 5.8 GHz (channels 149-165)
  // are scanned and joinable by mobile devices.
  if (code === 'NG') {
    if ((channel >= 36 && channel <= 48) || (channel >= 100 && channel <= 144)) {
      return {
        compatible: false,
        country: 'NG',
        band: '5GHz',
        reason: `5 GHz Channel ${channel} (${freq ? `${freq} MHz` : 'U-NII-1/2C'}) is restricted in Nigeria (NG). Mobile devices with Nigerian SIM cards disable this frequency band.`
      };
    }
  }

  // General check against regulatory ranges from iw reg get if available
  const ranges = regRanges || (code ? getRegulatoryInfo().ranges : []);
  if (Array.isArray(ranges) && ranges.length > 0 && freq) {
    const inRange = ranges.some(r => freq >= r.start && freq <= r.end);
    if (!inRange) {
      return {
        compatible: false,
        country: code || 'UNKNOWN',
        band: freq > 4000 ? '5GHz' : '2.4GHz',
        reason: `Frequency ${freq} MHz (Channel ${channel}) falls outside authorized regulatory ranges for country ${code || 'local'}.`
      };
    }
  }

  return {
    compatible: true,
    country: code || null,
    band: (channel > 14 || (freq && freq > 4000)) ? '5GHz' : '2.4GHz'
  };
}

/**
 * Normalizes user-supplied band string to '2.4', '5', or null.
 * @param {string|number|null} band
 * @returns {'2.4'|'5'|null}
 */
export function normalizeBand(band) {
  if (!band) return null;
  const b = String(band).toLowerCase().trim();
  if (['2.4', '2.4ghz', '2', '2g', 'bg', 'g', 'b'].includes(b)) return '2.4';
  if (['5', '5ghz', '5g', 'a', 'ac', 'ax'].includes(b)) return '5';
  return null;
}

/**
 * Switches the active NetworkManager Wi-Fi connection to a specified frequency band (2.4 GHz or 5 GHz).
 * Uses nmcli to configure 802-11-wireless.band and re-activates the connection.
 * @param {string} iface - Network interface name (e.g. wlp0s20f3)
 * @param {{ ssid: string }} activeWifi - Active connection details
 * @param {'2.4'|'5'|'auto'} targetBand - Desired band ('2.4'/'bg', '5'/'a', or 'auto'/'')
 * @returns {{ iface: string, ssid: string, channel: number, freq: number, hwMode: 'a'|'g', width: number }|null}
 */
export function switchWifiBand(iface, activeWifi, targetBand = '2.4') {
  try {
    const norm = normalizeBand(targetBand);
    const bandParam = norm === '2.4' ? 'bg' : norm === '5' ? 'a' : '';

    let connectionName = null;
    try {
      const connOutput = execSync('nmcli -t -f NAME,DEVICE connection show --active', {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'ignore']
      });
      for (const line of connOutput.trim().split('\n')) {
        const parts = line.split(':');
        if (parts[1] === iface) {
          connectionName = parts[0];
          break;
        }
      }
    } catch {}

    if (!connectionName && activeWifi?.ssid) {
      connectionName = activeWifi.ssid;
    }

    if (!connectionName) {
      throw new Error(`Could not determine active NetworkManager connection name for interface ${iface}`);
    }

    // Set 802-11-wireless.band and clear hardcoded bssid to allow roaming across bands
    execSync(`nmcli connection modify "${connectionName}" 802-11-wireless.band "${bandParam}" 802-11-wireless.bssid ""`, {
      stdio: ['pipe', 'pipe', 'ignore']
    });

    // Re-activate connection so NetworkManager associates with the requested band
    execSync(`nmcli connection up "${connectionName}"`, {
      stdio: ['pipe', 'pipe', 'ignore'],
      timeout: 15000
    });

    // Wait up to 6 seconds for interface link and IP renewal
    const start = Date.now();
    let updated = null;
    while (Date.now() - start < 6000) {
      updated = getActiveWifiConnection();
      if (updated && updated.channel) {
        if (norm === '2.4' && updated.channel <= 14) break;
        if (norm === '5' && updated.channel > 14) break;
      }
      try { execSync('sleep 0.5'); } catch {}
    }

    return updated || getActiveWifiConnection();
  } catch (err) {
    logger.debug(`switchWifiBand failed: ${err.message}`);
    throw err;
  }
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
 * Generates a valid unicast locally administered address (LAA) MAC address based on physical MAC.
 * Prevents virtual AP interface from colliding with client station MAC on chipsets (e.g. Intel 8265)
 * that require unique BSSIDs for beaconing and RX filtering.
 * @param {string} baseMac - Physical MAC address (e.g. 82:66:e9:b9:4f:8c).
 * @returns {string|null} Derived distinct LAA MAC address.
 */
export function generateApMac(baseMac) {
  if (!baseMac || typeof baseMac !== 'string') return null;
  const parts = baseMac.trim().split(':');
  if (parts.length !== 6) return null;
  // Set locally administered bit (bit 1 of byte 0) and clear multicast bit (bit 0)
  const b0 = ((parseInt(parts[0], 16) | 0x02) & 0xfe).toString(16).padStart(2, '0');
  // Increment last byte by 1 (modulo 256) to ensure it does not collide with baseMac
  const b5 = ((parseInt(parts[5], 16) + 1) & 0xff).toString(16).padStart(2, '0');
  return [b0, parts[1], parts[2], parts[3], parts[4], b5].join(':').toLowerCase();
}

/**
 * Generates hostapd configuration matching the upstream Wi-Fi channel.
 * @param {{ apIface: string, ssid: string, password?: string, channel: number, hwMode: 'a'|'g', countryCode?: string }} params
 * @returns {string}
 */
export function generateHostapdConfig({
  apIface = 'ap0',
  ssid = null,
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
  const code = countryCode || null;
  const finalSsid = ssid || getDefaultHotspotSsid();
  const lines = [
    `interface=${apIface}`,
    'driver=nl80211',
    `ssid=${finalSsid}`,
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
  if (fs.existsSync(WIFI_PID_FILE)) {
    try {
      const rawPid = fs.readFileSync(WIFI_PID_FILE, 'utf8').trim();
      const pid = parseInt(rawPid, 10);
      if (!isNaN(pid) && pid > 0) {
        try {
          process.kill(pid, 0);
          return true;
        } catch (err) {
          if (err.code === 'EPERM') return true;
        }
      }
    } catch {}
  }

  if (fs.existsSync(`${WIFI_PID_FILE}.dnsmasq`)) {
    try {
      const rawPid = fs.readFileSync(`${WIFI_PID_FILE}.dnsmasq`, 'utf8').trim();
      const pid = parseInt(rawPid, 10);
      if (!isNaN(pid) && pid > 0) {
        try {
          process.kill(pid, 0);
          return true;
        } catch (err) {
          if (err.code === 'EPERM') return true;
        }
      }
    } catch {}
  }

  return false;
}

/**
 * Ensures required packages (iw, hostapd, dnsmasq) are installed, auto-installing if missing.
 * @returns {boolean}
 */
export function ensureWifiDependencies() {
  const missing = [];
  if (!isIwInstalled()) missing.push('iw');
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

    const iwReady = !missing.includes('iw') || isIwInstalled();
    const hostapdReady = !missing.includes('hostapd') || isHostapdInstalled();
    const dnsmasqReady = !missing.includes('dnsmasq') || isDnsmasqInstalled();

    if (iwReady && hostapdReady && dnsmasqReady) {
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
 * Generates the start-hotspot.sh bash script content.
 */
export function generateStartScript({ activeWifi, apIface, adminGroup }) {
  return `#!/usr/bin/env bash
set -e
export PATH="/usr/local/sbin:/usr/sbin:/sbin:$PATH"
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

# 1. Clean up stale ap interface and lingering daemon processes if existing
if [ -f "\${PID_FILE}.dnsmasq" ]; then
  kill -9 "$(cat "\${PID_FILE}.dnsmasq")" 2>/dev/null || true
  rm -f "\${PID_FILE}.dnsmasq"
fi
pkill -9 -f "dnsmasq.*--interface=\${AP_IFACE}" 2>/dev/null || true
pkill -9 -f "dnsmasq.*192\\.168\\.42\\." 2>/dev/null || true

if [ -f "$PID_FILE" ]; then
  kill -9 "$(cat "$PID_FILE")" 2>/dev/null || true
  rm -f "$PID_FILE"
fi
killall -9 hostapd 2>/dev/null || true

iw dev "$AP_IFACE" del 2>/dev/null || true

# 2. Add virtual AP interface
iw dev "$IFACE" interface add "$AP_IFACE" type __ap

# Ensure distinct MAC address if virtual AP inherited identical MAC to physical adapter
# (prevents duplicate BSSID beacon rejection on Intel 8265 and PCIe chipsets)
AP_MAC=$(cat /sys/class/net/"$AP_IFACE"/address 2>/dev/null || true)
PHY_MAC=$(cat /sys/class/net/"$IFACE"/address 2>/dev/null || true)
if [ -n "$AP_MAC" ] && [ "$AP_MAC" = "$PHY_MAC" ]; then
  FIRST_BYTE=$(printf '%02x' $(( (0x\${AP_MAC%%:*} | 2) & 254 )))
  LAST_BYTE=$(printf '%02x' $(( (0x\${AP_MAC##*:} + 1) % 256 )))
  NEW_MAC="\${FIRST_BYTE}\${AP_MAC#??}"
  NEW_MAC="\${NEW_MAC%??}\${LAST_BYTE}"
  ip link set dev "$AP_IFACE" address "$NEW_MAC" 2>/dev/null || true
fi

# 3. Tell NetworkManager not to interfere with virtual AP interface
nmcli device set "$AP_IFACE" managed no 2>/dev/null || true

# 4. Flush stale IP and keep interface DOWN so hostapd can bind the radio cleanly
ip link set "$AP_IFACE" down 2>/dev/null || true
ip addr flush dev "$AP_IFACE" 2>/dev/null || true

# 5. Enable IP forwarding and firewall/NAT rules
sysctl -w net.ipv4.ip_forward=1 >/dev/null

# If firewalld is active, assign AP interface to trusted zone so DHCP, DNS, and traffic forwarding are permitted
if command -v firewall-cmd >/dev/null 2>&1 && systemctl is-active firewalld >/dev/null 2>&1; then
  firewall-cmd --zone=trusted --add-interface="$AP_IFACE" 2>/dev/null || true
fi

# Apply any blacklist drop rules
if [ -f "$DENY_FILE" ]; then
  while read -r mac; do
    mac=$(echo "$mac" | tr -d '\\r\\n ')
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

# Bring interface UP and assign private IP after hostapd initializes radio and beaconing
ip link set "$AP_IFACE" up 2>/dev/null || true
ip addr add 192.168.42.1/24 dev "$AP_IFACE" 2>/dev/null || true

# 7. Start dnsmasq with dynamic binding and designated leases file
if [ -f "\${PID_FILE}.dnsmasq" ]; then
  kill -9 "$(cat "\${PID_FILE}.dnsmasq")" 2>/dev/null || true
  rm -f "\${PID_FILE}.dnsmasq"
fi
pkill -9 -f "dnsmasq.*--interface=\${AP_IFACE}" 2>/dev/null || true
pkill -9 -f "dnsmasq.*192\\.168\\.42\\." 2>/dev/null || true
sleep 0.5

dnsmasq --conf-file=/dev/null --no-hosts --bind-dynamic \\
  --interface="$AP_IFACE" \\
  --dhcp-range=192.168.42.10,192.168.42.100,255.255.255.0,12h \\
  --dhcp-option=3,192.168.42.1 \\
  --dhcp-option=6,1.1.1.1,8.8.8.8 \\
  --dhcp-leasefile="$LEASES_FILE" \\
  --log-dhcp \\
  --pid-file="\${PID_FILE}.dnsmasq" >> "$LOG_FILE" 2>&1
`;
}

/**
 * Generates the stop-hotspot.sh bash script content.
 */
export function generateStopScript({ iface, apIface }) {
  return `#!/usr/bin/env bash
export PATH="/usr/local/sbin:/usr/sbin:/sbin:$PATH"
IFACE="${iface}"
AP_IFACE="${apIface}"
PID_FILE="${WIFI_PID_FILE}"
DENY_FILE="${WIFI_DENY_FILE}"

if [ -f "\${PID_FILE}.dnsmasq" ]; then
  kill -9 "$(cat "\${PID_FILE}.dnsmasq")" 2>/dev/null || true
  rm -f "\${PID_FILE}.dnsmasq"
fi
pkill -9 -f "dnsmasq.*--interface=\${AP_IFACE}" 2>/dev/null || true
pkill -9 -f "dnsmasq.*192\\.168\\.42\\." 2>/dev/null || true

if [ -f "$PID_FILE" ]; then
  kill -9 "$(cat "$PID_FILE")" 2>/dev/null || true
  rm -f "$PID_FILE"
fi

killall -9 hostapd 2>/dev/null || true

# Remove from firewalld trusted zone if present
if command -v firewall-cmd >/dev/null 2>&1 && systemctl is-active firewalld >/dev/null 2>&1; then
  firewall-cmd --zone=trusted --remove-interface="$AP_IFACE" 2>/dev/null || true
fi

# Clean up blacklist rules if existing
if [ -f "$DENY_FILE" ]; then
  while read -r mac; do
    mac=$(echo "$mac" | tr -d '\\r\\n ')
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
iptables -D FORWARD -i "$IFACE" -o "$AP_IFACE" -m state --state RELATED,ESTABLISHED -j ACCEPT 2>/dev/null || true
iptables -t nat -D POSTROUTING -o "$IFACE" -j MASQUERADE 2>/dev/null || true

rm -f /run/NetworkManager/conf.d/99-linksy.conf 2>/dev/null || true
nmcli general reload conf 2>/dev/null || true

nmcli device set "$AP_IFACE" managed yes 2>/dev/null || true
iw dev "$AP_IFACE" del 2>/dev/null || true
`;
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

  const wantsCustomSsid = options.ssid !== undefined || options.name !== undefined;
  const requestedSsid = options.name || options.ssid;
  const hasCredentialChange =
    options.password !== undefined ||
    wantsCustomSsid ||
    options.noPassword !== undefined ||
    options.open !== undefined;

  const explicitBand = normalizeBand(options.band || (options['2ghz'] ? '2.4' : options['5ghz'] ? '5' : null));
  const autoBand = options.autoBand !== false;

  const currentStatus = getWifiHotspotStatus();
  const currentCompat = currentStatus.channel ? isChannelCompatibleWithRegion({ channel: currentStatus.channel }) : { compatible: true };

  if (isHotspotRunning()) {
    const needsBandChange = (explicitBand === '2.4' && currentStatus.channel && currentStatus.channel > 14) ||
      (explicitBand === '5' && currentStatus.channel && currentStatus.channel <= 14) ||
      (!explicitBand && autoBand && !currentCompat.compatible);

    if (hasCredentialChange || needsBandChange || options.restart) {
      if (!currentCompat.compatible && !explicitBand) {
        logger.warn(`Active hotspot is currently running on restricted Channel ${currentStatus.channel} for region ${currentCompat.country || 'local'}.`);
        logger.info('Restarting hotspot on a mobile-compatible frequency band...');
      } else if (needsBandChange) {
        logger.info(`Switching active hotspot band to ${explicitBand} GHz...`);
      } else {
        logger.info('Hotspot is currently active. Updating credentials and restarting hotspot...');
      }
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
  const defaultSsid = getDefaultHotspotSsid();
  const ssid = requestedSsid || (saved.wifiSsid && saved.wifiSsid !== 'Linksy-Hotspot' ? saved.wifiSsid : defaultSsid);

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
    const configUpdates = {
      wifiPassword: password || 'none'
    };
    if (wantsCustomSsid) {
      configUpdates.wifiSsid = ssid;
    }
    saveConfig(configUpdates);
  }

  if (!ensureWifiDependencies()) {
    process.exit(1);
  }

  let activeWifi = getActiveWifiConnection();
  if (!activeWifi) {
    logger.error('No active Wi-Fi connection detected on your laptop.');
    const ifaceName = getWifiInterfaceName();
    if (ifaceName && ifaceName !== 'wlan0') {
      logger.info(`Detected Wi-Fi adapter: ${chalk.cyan(ifaceName)} (currently disconnected or unassociated).`);
    }
    logger.info('To share internet via concurrent Wi-Fi hotspot, your laptop must be connected to a Wi-Fi network first.');
    logger.info('Linksy will match your hotspot to the same channel as your connection.');
    process.exit(1);
  }

  // Automatic Regulatory Domain & Regional Frequency Compatibility Check
  const compatCheck = isChannelCompatibleWithRegion({
    channel: activeWifi.channel,
    freq: activeWifi.freq
  });

  const shouldSwitchTo24 = (explicitBand === '2.4' && activeWifi.hwMode === 'a') ||
    (!explicitBand && autoBand && !compatCheck.compatible);
  const shouldSwitchTo5 = (explicitBand === '5' && activeWifi.hwMode === 'g');

  if (shouldSwitchTo24) {
    if (!compatCheck.compatible && !explicitBand) {
      logger.warn(chalk.yellow(`Regulatory domain check [${compatCheck.country || 'LOCAL'}]: ${compatCheck.reason}`));
      logger.info(`Automatically switching laptop Wi-Fi for "${chalk.green(activeWifi.ssid)}" to 2.4 GHz so phones can connect...`);
    } else {
      logger.info(`Switching upstream Wi-Fi connection to 2.4 GHz as requested...`);
    }

    try {
      try {
        execSync('hostapd_cli -p /run/hostapd disable', { stdio: 'ignore' });
      } catch {}

      const switched = switchWifiBand(activeWifi.iface, activeWifi, '2.4');
      if (switched && switched.connected) {
        activeWifi = switched;
        logger.success(`Upstream Wi-Fi adjusted to Channel ${chalk.cyan(activeWifi.channel)} (${activeWifi.freq ? `${activeWifi.freq} MHz, ` : ''}2.4 GHz).`);
      } else {
        logger.warn('Could not confirm 2.4 GHz switch from interface. Continuing on current channel.');
      }
    } catch (err) {
      logger.warn(`Could not automatically switch to 2.4 GHz band: ${err.message}`);
      logger.info('Proceeding with current channel. You can manually connect to a 2.4 GHz network or use USB tethering if mobile scanning fails.');
    }
  } else if (shouldSwitchTo5) {
    logger.info(`Switching upstream Wi-Fi connection to 5 GHz as requested...`);
    try {
      try {
        execSync('hostapd_cli -p /run/hostapd disable', { stdio: 'ignore' });
      } catch {}

      const switched = switchWifiBand(activeWifi.iface, activeWifi, '5');
      if (switched && switched.connected) {
        activeWifi = switched;
        logger.success(`Upstream Wi-Fi adjusted to Channel ${chalk.cyan(activeWifi.channel)} (${activeWifi.freq ? `${activeWifi.freq} MHz, ` : ''}5 GHz).`);
      }
    } catch (err) {
      logger.warn(`Could not switch to 5 GHz band: ${err.message}`);
    }
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

  const startScript = generateStartScript({ activeWifi, apIface, adminGroup });
  const stopScript = generateStopScript({ iface: activeWifi.iface, apIface });

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
    `Or scan the QR code to connect instantly: ${chalk.bold.cyan('linksy qr')}\n\n` +
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

  // Direct cleanup fallback via sudo in case stop script was outdated or failed
  try {
    spawnSync('sudo', ['bash', '-c', `
      if [ -f "${WIFI_PID_FILE}.dnsmasq" ]; then
        kill -9 "$(cat "${WIFI_PID_FILE}.dnsmasq")" 2>/dev/null || true
        rm -f "${WIFI_PID_FILE}.dnsmasq"
      fi
      pkill -9 -f "dnsmasq.*--interface=ap0" 2>/dev/null || true
      pkill -9 -f "dnsmasq.*192\\.168\\.42\\." 2>/dev/null || true
      if [ -f "${WIFI_PID_FILE}" ]; then
        kill -9 "$(cat "${WIFI_PID_FILE}")" 2>/dev/null || true
        rm -f "${WIFI_PID_FILE}"
      fi
      killall -9 hostapd 2>/dev/null || true
      iw dev ap0 del 2>/dev/null || true
    `], { stdio: 'ignore' });
  } catch {}

  try {
    if (fs.existsSync(WIFI_PID_FILE)) fs.unlinkSync(WIFI_PID_FILE);
  } catch {}
  try {
    if (fs.existsSync(`${WIFI_PID_FILE}.dnsmasq`)) fs.unlinkSync(`${WIFI_PID_FILE}.dnsmasq`);
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
