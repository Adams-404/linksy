import { describe, it, expect } from 'vitest';
import { detectPackageManager } from '../src/lib/detectPackageManager.js';

describe('detectPackageManager', () => {
  it('detects dnf when dnf binary exists', () => {
    const mockCheck = (bin) => bin === 'dnf';
    const pm = detectPackageManager(mockCheck);
    expect(pm).not.toBeNull();
    expect(pm.type).toBe('dnf');
    expect(pm.installCmd).toContain('dnf install');
  });

  it('detects apt when apt-get binary exists', () => {
    const mockCheck = (bin) => bin === 'apt-get';
    const pm = detectPackageManager(mockCheck);
    expect(pm).not.toBeNull();
    expect(pm.type).toBe('apt');
    expect(pm.installCmd).toContain('apt-get');
  });

  it('detects pacman when pacman binary exists', () => {
    const mockCheck = (bin) => bin === 'pacman';
    const pm = detectPackageManager(mockCheck);
    expect(pm).not.toBeNull();
    expect(pm.type).toBe('pacman');
    expect(pm.installCmd).toContain('pacman -S');
  });

  it('detects zypper when zypper binary exists', () => {
    const mockCheck = (bin) => bin === 'zypper';
    const pm = detectPackageManager(mockCheck);
    expect(pm).not.toBeNull();
    expect(pm.type).toBe('zypper');
    expect(pm.installCmd).toContain('zypper install');
  });

  it('returns null when no supported package manager is found', () => {
    const mockCheck = () => false;
    const pm = detectPackageManager(mockCheck);
    expect(pm).toBeNull();
  });
});
