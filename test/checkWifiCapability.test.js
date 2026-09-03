import { describe, it, expect } from 'vitest';
import { parseWifiCombinations } from '../src/lib/checkWifiCapability.js';

describe('checkWifiCapability - parseWifiCombinations', () => {
  it('detects concurrent AP + managed mode when separate sets exist with total > 1', () => {
    const iwOutput = `
      valid interface combinations:
         * #{ managed } <= 1, #{ P2P-client, P2P-GO } <= 1, #{ P2P-device } <= 1,
           total <= 3, #channels <= 2
         * #{ managed } <= 1, #{ AP, P2P-client, P2P-GO } <= 1, #{ P2P-device } <= 1,
           total <= 3, #channels <= 1
      HT Capability overrides:
    `;

    const result = parseWifiCombinations(iwOutput);
    expect(result.supported).toBe(true);
    expect(result.details.length).toBeGreaterThan(0);
  });

  it('detects concurrent AP + managed mode with separate AP and managed brackets', () => {
    const iwOutput = `
      valid interface combinations:
         * #{ managed } <= 2, #{ AP } <= 1,
           total <= 2, #channels <= 1
    `;

    const result = parseWifiCombinations(iwOutput);
    expect(result.supported).toBe(true);
  });

  it('rejects combination when total is strictly <= 1 (mutually exclusive)', () => {
    const iwOutput = `
      valid interface combinations:
         * #{ managed, IBSS, AP } <= 1,
           total <= 1, #channels <= 1
    `;

    const result = parseWifiCombinations(iwOutput);
    expect(result.supported).toBe(false);
    expect(result.details).toEqual([]);
  });

  it('rejects combination when AP is not supported', () => {
    const iwOutput = `
      valid interface combinations:
         * #{ managed } <= 1, #{ monitor } <= 1,
           total <= 2, #channels <= 1
    `;

    const result = parseWifiCombinations(iwOutput);
    expect(result.supported).toBe(false);
  });

  it('handles empty or non-matching iw list output gracefully', () => {
    expect(parseWifiCombinations('')).toEqual({ supported: false, details: [] });
    expect(parseWifiCombinations(null)).toEqual({ supported: false, details: [] });
    expect(parseWifiCombinations('no combinations here')).toEqual({ supported: false, details: [] });
  });
});
