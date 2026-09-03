import { describe, it, expect } from 'vitest';
import { parseAdbDevices } from '../src/lib/adbHelpers.js';

describe('adbHelpers - parseAdbDevices', () => {
  it('parses a single connected and authorized device', () => {
    const output = `List of devices attached\n153772558Y000107\tdevice\n`;
    const devices = parseAdbDevices(output);
    expect(devices).toHaveLength(1);
    expect(devices[0]).toEqual({
      serial: '153772558Y000107',
      state: 'device',
      isAuthorized: true
    });
  });

  it('parses multiple devices with varied states', () => {
    const output = `
* daemon not running; starting now at tcp:5037
* daemon started successfully
List of devices attached
device_001\tdevice
device_002\tunauthorized
device_003\toffline
    `;
    const devices = parseAdbDevices(output);
    expect(devices).toHaveLength(3);
    expect(devices[0]).toEqual({ serial: 'device_001', state: 'device', isAuthorized: true });
    expect(devices[1]).toEqual({ serial: 'device_002', state: 'unauthorized', isAuthorized: false });
    expect(devices[2]).toEqual({ serial: 'device_003', state: 'offline', isAuthorized: false });
  });

  it('returns empty array when no devices are attached', () => {
    const output = `List of devices attached\n\n`;
    const devices = parseAdbDevices(output);
    expect(devices).toEqual([]);
  });

  it('handles null or non-string input safely', () => {
    expect(parseAdbDevices(null)).toEqual([]);
    expect(parseAdbDevices(undefined)).toEqual([]);
  });
});
