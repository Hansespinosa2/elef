// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { confirmPresentationDeletion } from '../../src/application/world/delete-confirmation';

vi.mock('@tauri-apps/plugin-dialog', () => ({
  confirm: vi.fn(async () => true),
}));

describe('presentation deletion confirmation', () => {
  afterEach(() => vi.restoreAllMocks());

  it('uses the Tauri dialog API instead of the browser confirmation API', async () => {
    const browserConfirm = vi.spyOn(window, 'confirm').mockImplementation(() => {
      throw new Error('dialog.confirm not allowed. Command not found');
    });

    await expect(confirmPresentationDeletion(true, 'Delete this presentation?')).resolves.toBe(true);
    expect(browserConfirm).not.toHaveBeenCalled();
  });
});
