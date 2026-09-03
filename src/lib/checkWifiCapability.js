import { execSync } from 'node:child_process';
import { logger } from '../utils/logger.js';

/**
 * Parses raw `iw list` output to determine if simultaneous AP + Managed mode is supported.
 * @param {string} iwListOutput - Raw stdout from `iw list`.
 * @returns {{ supported: boolean, details: string[] }}
 */
export function parseWifiCombinations(iwListOutput) {
  if (!iwListOutput || typeof iwListOutput !== 'string') {
    return { supported: false, details: [] };
  }

  const sectionMatch = iwListOutput.match(/valid interface combinations:([\s\S]*?)(?:\n\s*\n\s*[A-Z]|\n\n[^\t\s]|$)/i);
  if (!sectionMatch) {
    return { supported: false, details: [] };
  }

  const combinationsText = sectionMatch[1];
  // Split into combination blocks (each starts with a bullet '*' or numbered item)
  const blocks = combinationsText.split(/\n\s*\*\s+/).filter(b => b.trim().length > 0);

  const matchingCombinations = [];

  for (const block of blocks) {
    // Check if total is explicitly limited to 1
    const totalMatch = block.match(/total\s*<=\s*(\d+)/i);
    const total = totalMatch ? parseInt(totalMatch[1], 10) : null;
    if (total !== null && total <= 1) {
      continue;
    }

    // Parse all #{ ... } <= N items
    const setRegex = /#\{\s*([^}]+)\s*\}\s*<=\s*(\d+)/g;
    let match;
    let hasManaged = false;
    let hasAp = false;
    let separateSets = false;

    while ((match = setRegex.exec(block)) !== null) {
      const types = match[1].split(',').map(t => t.trim());
      const maxCount = parseInt(match[2], 10);

      const containsManaged = types.includes('managed');
      const containsAp = types.includes('AP');

      if (containsManaged && containsAp) {
        // Both in the same group - only allows concurrent if maxCount >= 2
        if (maxCount >= 2) {
          hasManaged = true;
          hasAp = true;
        }
      } else {
        if (containsManaged && maxCount >= 1) {
          hasManaged = true;
        }
        if (containsAp && maxCount >= 1) {
          hasAp = true;
        }
        if (hasManaged && hasAp) {
          separateSets = true;
        }
      }
    }

    if (hasManaged && hasAp && (separateSets || (total === null || total >= 2))) {
      matchingCombinations.push(block.trim().replace(/\s+/g, ' '));
    }
  }

  return {
    supported: matchingCombinations.length > 0,
    details: matchingCombinations
  };
}

/**
 * Attempts to detect active Wi-Fi interface name via `iw dev`.
 * @returns {string} Interface name or fallback 'wlan0'.
 */
export function getWifiInterfaceName() {
  try {
    const output = execSync('iw dev', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
    const match = output.match(/Interface\s+([a-zA-Z0-9_-]+)/);
    if (match) {
      return match[1];
    }
  } catch {
    // Fall back to default
  }
  return 'wlan0';
}

/**
 * Checks if the Wi-Fi card supports simultaneous AP + Managed mode.
 * @returns {{ supported: boolean, iface: string, details: string[] }}
 */
export function checkWifiCapability() {
  try {
    const output = execSync('iw list', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
    const { supported, details } = parseWifiCombinations(output);
    const iface = getWifiInterfaceName();
    return { supported, iface, details };
  } catch (err) {
    logger.debug(`Could not run 'iw list': ${err.message}`);
    return { supported: false, iface: 'wlan0', details: [] };
  }
}
