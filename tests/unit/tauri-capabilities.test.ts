import { describe, expect, it } from 'vitest';
import capabilities from '../../src-tauri/capabilities/default.json';

describe('Tauri filesystem capabilities', () => {
  it('allows the filesystem operations required for World persistence', () => {
    expect(capabilities.permissions).toEqual(expect.arrayContaining([
      'fs:read-files',
      'fs:read-dirs',
      'fs:write-all',
    ]));
  });

  it('allows World persistence in Desktop folders', () => {
    const scope = capabilities.permissions.find((permission) => typeof permission === 'object' && permission.identifier === 'fs:scope');
    expect(scope && typeof scope === 'object' && 'allow' in scope
      ? scope.allow.some((entry) => entry.path === '$DESKTOP/**')
      : false).toBe(true);
  });
});
