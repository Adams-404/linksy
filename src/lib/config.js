import fs from 'node:fs';
import { CONFIG_FILE, LINKSY_DIR } from './paths.js';

/**
 * Loads user settings from ~/.linksy/config.json.
 * @returns {Record<string, any>}
 */
export function getSavedConfig() {
  if (fs.existsSync(CONFIG_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    } catch {
      return {};
    }
  }
  return {};
}

/**
 * Merges and saves user settings into ~/.linksy/config.json.
 * @param {Record<string, any>} updates
 * @returns {Record<string, any>}
 */
export function saveConfig(updates = {}) {
  try {
    if (!fs.existsSync(LINKSY_DIR)) {
      fs.mkdirSync(LINKSY_DIR, { recursive: true });
    }
    const current = getSavedConfig();
    const merged = { ...current, ...updates };
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(merged, null, 2), 'utf8');
    return merged;
  } catch {
    return {};
  }
}
