import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname);
const fixtureRoot = resolve(root, '.wdio-fixtures');
const fixturePath = resolve(fixtureRoot, 'Arrow navigation', 'presentation.md');
const appBinaryPath = resolve(root, 'src-tauri/target/debug/elef');

export const config = {
  runner: 'local',
  specs: ['./tests/e2e/**/*.spec.ts'],
  maxInstances: 1,
  services: [[
    '@wdio/tauri-service',
    {
      driverProvider: 'embedded',
      appBinaryPath,
      startTimeout: 120000,
      commandTimeout: 30000,
    },
  ]],
  capabilities: [{
    browserName: 'tauri',
    'tauri:options': {
      application: appBinaryPath,
    },
  }],
  framework: 'mocha',
  reporters: ['spec'],
  mochaOpts: {
    ui: 'bdd',
    timeout: 120000,
  },
  before: async () => {
    await browser.setWindowSize(1280, 800);
  },
  onPrepare: () => {
    mkdirSync(resolve(fixtureRoot, 'Arrow navigation'), { recursive: true });
    writeFileSync(fixturePath, '<!-- elef-id: e2e-arrow-navigation -->\n# Arrow navigation\n\nfixture\n');
    if (process.env.WDIO_BUILD === '1' || !existsSync(appBinaryPath)) {
      console.log(`[wdio] Building Tauri app (${process.env.WDIO_BUILD === '1' ? 'WDIO_BUILD=1' : 'debug binary missing'})`);
      execFileSync('npm', ['run', 'tauri', '--', 'build', '--debug', '--features', 'wdio'], { cwd: root, stdio: 'inherit' });
    } else {
      console.log(`[wdio] Reusing existing Tauri app at ${appBinaryPath}`);
    }
  },
  onComplete: () => {
    rmSync(fixtureRoot, { recursive: true, force: true });
  },
};
