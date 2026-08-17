const { defineConfig } = require('@playwright/test');
const repoRoot = '/home/erik/autopilot/workspaces/mana-maps';
module.exports = defineConfig({
  testDir: repoRoot + '/tests/probe',
  timeout: 120_000,
  retries: 0,
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:4173',
    headless: true,
  },
  webServer: {
    command: `python3 -m http.server 4173 --bind 127.0.0.1 --directory "${repoRoot}"`,
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
