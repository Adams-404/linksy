import { describe, it, expect } from 'vitest';
import {
  checkBluetoothAvailability,
  getBluetoothPanStatus,
  isBluetoothPanRunning
} from '../src/lib/bluetoothPan.js';

describe('bluetoothPan - status checks', () => {
  it('returns valid status structure for getBluetoothPanStatus', () => {
    const status = getBluetoothPanStatus();
    expect(status).toHaveProperty('running');
    expect(typeof status.running).toBe('boolean');
    expect(status).toHaveProperty('bridge', 'pan0');
  });

  it('checks bluetooth availability cleanly without throwing', () => {
    const check = checkBluetoothAvailability();
    expect(check).toHaveProperty('available');
    expect(typeof check.available).toBe('boolean');
    expect(check).toHaveProperty('powered');
    expect(typeof check.powered).toBe('boolean');
  });

  it('isBluetoothPanRunning returns false by default', () => {
    expect(isBluetoothPanRunning()).toBe(false);
  });
});
