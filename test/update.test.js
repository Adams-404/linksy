import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { updateCommand } from '../src/commands/update.js';
import * as updateNotifier from '../src/lib/updateNotifier.js';
import { logger } from '../src/utils/logger.js';

describe('updateCommand', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('notifies user when already on the latest version', async () => {
    vi.spyOn(updateNotifier, 'getCliVersion').mockReturnValue('1.2.1');
    vi.spyOn(updateNotifier, 'checkForUpdates').mockResolvedValue({
      currentVersion: '1.2.1',
      latestVersion: '1.2.1',
      hasUpdate: false
    });

    const successSpy = vi.spyOn(logger, 'success').mockImplementation(() => {});

    await updateCommand();

    expect(successSpy).toHaveBeenCalledWith(expect.stringContaining('already up to date'));
  });

  it('handles network error gracefully', async () => {
    vi.spyOn(updateNotifier, 'getCliVersion').mockReturnValue('1.2.1');
    vi.spyOn(updateNotifier, 'checkForUpdates').mockRejectedValue(new Error('Network offline'));

    const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});

    await updateCommand();

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Could not reach NPM registry'));
  });
});
