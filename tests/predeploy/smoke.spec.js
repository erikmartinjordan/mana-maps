const { test, expect } = require('@playwright/test');

const firebaseSmokeConfig = {
  apiKey: 'smoke-test-api-key',
  authDomain: 'smoke-test.firebaseapp.com',
  projectId: 'smoke-test',
  appId: '1:123456789:web:smoketest'
};

async function installFirebaseSmokeConfig(page) {
  await page.addInitScript((config) => {
    window.MANA_FIREBASE_CONFIGS = { pre: config, pro: config };
    window.MANA_FIREBASE_ENV = 'pre';
  }, firebaseSmokeConfig);
}

test('home page loads with expected title, main CTA and PWA download prompt', async ({ page }) => {
  await page.goto('/');

  await expect(page).toHaveTitle(/Maña Maps — Diseña mapas con claridad/i);
  await expect(page.getByRole('link', { name: /Empieza gratis/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /Descargar app/i })).toBeVisible();
  await expect(page.locator('link[rel=\"manifest\"]')).toHaveAttribute('href', '/manifest.webmanifest');
});

test('PWA manifest exposes installable app metadata', async ({ request }) => {
  const response = await request.get('/manifest.webmanifest');
  expect(response.ok()).toBeTruthy();

  const manifest = await response.json();
  expect(manifest.name).toBe('Maña Maps');
  expect(manifest.start_url).toBe('/map/');
  expect(manifest.display).toBe('standalone');
  expect(manifest.icons).toEqual(expect.arrayContaining([
    expect.objectContaining({ src: '/icons/icon.svg', sizes: 'any', type: 'image/svg+xml' }),
    expect.objectContaining({ src: '/icons/maskable-icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' })
  ]));
});

test('map editor shell loads core UI containers', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));
  await installFirebaseSmokeConfig(page);

  await page.goto('/map');

  await expect(page.locator('#topbar')).toBeVisible();
  await expect(page.locator('#map')).toBeVisible();
  await expect(page.locator('#chat-panel')).toBeVisible();

  expect(pageErrors, `Unexpected runtime errors:\n${pageErrors.join('\n')}`).toEqual([]);
});
