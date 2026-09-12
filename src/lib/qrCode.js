import QRCode from 'qrcode';
import { getWifiHotspotStatus, getDefaultHotspotSsid } from './wifiHotspot.js';
import { getSavedConfig } from './config.js';

/**
 * Escapes special characters for standard Wi-Fi QR code format (ZXing).
 * Special characters: \ ; , : "
 * @param {string} str
 * @returns {string}
 */
export function escapeWifiField(str) {
  if (!str) return '';
  return String(str).replace(/([\\;,":])/g, '\\$1');
}

/**
 * Generates standard Wi-Fi configuration string for QR codes.
 * Format: WIFI:T:<WPA|WEP|nopass>;S:<SSID>;P:<password>;H:<true|false>;;
 * @param {{ ssid: string, password?: string, security?: string, hidden?: boolean }} params
 * @returns {string}
 */
export function generateWifiQrString({ ssid, password, security = 'WPA', hidden = false }) {
  if (!ssid || typeof ssid !== 'string' || !ssid.trim()) {
    throw new Error('SSID is required to generate Wi-Fi QR code');
  }

  const cleanSsid = ssid.trim();
  const wantsOpen =
    !password ||
    security === 'nopass' ||
    security === 'open' ||
    (typeof password === 'string' && ['none', 'open', 'false', 'no'].includes(password.toLowerCase()));

  const authType = wantsOpen ? 'nopass' : (security.toUpperCase().includes('WEP') ? 'WEP' : 'WPA');

  let qr = `WIFI:T:${authType};S:${escapeWifiField(cleanSsid)};`;
  if (!wantsOpen && password) {
    qr += `P:${escapeWifiField(password)};`;
  }
  if (hidden) {
    qr += 'H:true;';
  }
  qr += ';';

  return qr;
}

/**
 * Resolves Wi-Fi credentials from CLI options, active hotspot, or saved configuration.
 * @param {{ ssid?: string, name?: string, password?: string, noPassword?: boolean, open?: boolean }} options
 * @returns {{ ssid: string, password: string|null, isOpen: boolean, isActive: boolean, isCustom: boolean }}
 */
export function resolveWifiCredentials(options = {}) {
  const wantsOpen =
    options.noPassword === true ||
    options.open === true ||
    options.password === '' ||
    (typeof options.password === 'string' && ['none', 'open', 'false', 'no'].includes(options.password.toLowerCase()));

  const requestedSsid = options.name || options.ssid;
  const isCustom = Boolean(requestedSsid || options.password !== undefined || options.noPassword !== undefined || options.open !== undefined);

  // 1. If custom options explicitly provided
  if (isCustom) {
    const saved = getSavedConfig();
    const ssid = requestedSsid || saved.wifiSsid || getDefaultHotspotSsid();
    const password = wantsOpen ? null : (options.password || saved.wifiPassword || 'linksy12345');
    return {
      ssid,
      password,
      isOpen: wantsOpen,
      isActive: false,
      isCustom: true
    };
  }

  // 2. Check active hotspot
  const status = getWifiHotspotStatus();
  if (status.running && status.ssid) {
    const isOpen = !status.password;
    return {
      ssid: status.ssid,
      password: status.password || null,
      isOpen,
      isActive: true,
      isCustom: false
    };
  }

  // 3. Fallback to saved configuration or defaults
  const saved = getSavedConfig();
  const ssid = (saved.wifiSsid && saved.wifiSsid !== 'Linksy-Hotspot') ? saved.wifiSsid : getDefaultHotspotSsid();

  let password;
  if (saved.wifiPassword === null || saved.wifiPassword === 'none' || saved.wifiPassword === '') {
    password = null;
  } else if (saved.wifiPassword) {
    password = saved.wifiPassword;
  } else {
    password = 'linksy12345';
  }

  return {
    ssid,
    password,
    isOpen: password === null,
    isActive: false,
    isCustom: false
  };
}

/**
 * Renders text as a compact terminal-friendly QR code using Unicode half blocks.
 * @param {string} text
 * @param {import('qrcode').QRCodeToStringOptions} [options]
 * @returns {Promise<string>}
 */
export async function renderTerminalQr(text, options = {}) {
  return QRCode.toString(text, {
    type: 'terminal',
    small: true,
    ...options
  });
}
