const { defineConfig } = require('@playwright/test');
const fs = require('fs');
const os = require('os');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..', '..');
const siteRoot = path.join(repoRoot, 'site');
const legacyChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const isCatalina = process.platform === 'darwin' && os.release().startsWith('19.');
const chromePath = process.env.PLAYWRIGHT_CHROME_PATH ||
  (isCatalina && fs.existsSync(legacyChrome) ? legacyChrome : '');
const launchOptions = chromePath ? { executablePath: chromePath } : undefined;

module.exports = defineConfig({
  testDir: __dirname,
  testMatch: /(smoke|gallery-smoke|local-assets|logo-consistency|seo-metadata)\.spec\.js/,
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:4175',
    headless: true,
    launchOptions,
  },
  webServer: {
    command: `python3 -m http.server 4175 --bind 127.0.0.1 --directory "${siteRoot}"`,
    url: 'http://127.0.0.1:4175',
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
