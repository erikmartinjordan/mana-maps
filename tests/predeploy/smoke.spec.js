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

test('home page loads with expected title and main CTA', async ({ page }) => {
  await page.goto('/');

  await expect(page).toHaveTitle(/Maña Maps — Diseña mapas con claridad/i);
  await expect(page.getByRole('link', { name: /Empieza gratis/i }).first()).toBeVisible();
});

test('landing page and task navigation remain usable on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto('/');

  await expect(page.getByRole('link', { name: /Empieza gratis/i }).first()).toBeVisible();
  expect(await page.locator('body').evaluate((body) => body.scrollWidth <= window.innerWidth)).toBe(true);

  await page.goto('/tasks.html');
  const actions = page.locator('.topbar-actions .btn');
  await expect(actions).toHaveCount(2);
  for (const action of await actions.all()) {
    await expect(action).toBeVisible();
    const buttonLayout = await action.evaluate((element) => ({
      rect: element.getBoundingClientRect().toJSON(),
      whiteSpace: getComputedStyle(element).whiteSpace
    }));
    expect(buttonLayout.rect.height).toBeLessThanOrEqual(38);
    expect(buttonLayout.rect.left).toBeGreaterThanOrEqual(0);
    expect(buttonLayout.rect.right).toBeLessThanOrEqual(320);
    expect(buttonLayout.whiteSpace).toBe('nowrap');
  }
  expect(await page.locator('body').evaluate((body) => body.scrollWidth <= window.innerWidth)).toBe(true);
});

test('landing and pricing pages load Google Fonts with swap', async ({ page }) => {
  for (const path of ['/', '/pricing/']) {
    await page.goto(path);
    const fontStylesheet = page.locator('link[rel="stylesheet"][href*="fonts.googleapis.com"]');

    await expect(fontStylesheet).toHaveCount(1);
    await expect(fontStylesheet).toHaveAttribute('href', /[?&]display=swap(?:&|$)/);
  }
});

test('public navigation bars stay inside the viewport on mobile', async ({ page }) => {
  const routes = [
    '/open/', '/pricing/', '/about/', '/changelog/', '/gallery/',
    '/my-maps/', '/profile/', '/tasks.html', '/404.html'
  ];

  for (const route of routes) {
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto(route);
    expect(await page.locator('body').evaluate((body) => body.scrollWidth <= window.innerWidth), route).toBe(true);

    const topbar = page.locator('#topbar, .topbar, .top').first();
    if (await topbar.count()) {
      const bounds = await topbar.boundingBox();
      expect(bounds, route).not.toBeNull();
      expect(bounds.x, route).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width, route).toBeLessThanOrEqual(320);
    }
  }
});

test('landing globe keeps a circular container on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto('/');

  const globe = await page.locator('#globe').boundingBox();
  expect(globe).not.toBeNull();
  expect(Math.abs(globe.width - globe.height)).toBeLessThanOrEqual(1);
});

test('language selector exposes the selected language to assistive technology', async ({ page }) => {
  await page.goto('/');

  const languageButton = page.locator('#lang-btn');
  await expect(languageButton).toHaveAttribute('aria-label', /Idioma actual: español/i);

  await languageButton.click();

  await expect(languageButton).toHaveAttribute('aria-label', /Current language: English.*Switch to Spanish/i);
  await expect(page.locator('#lang-status')).toHaveText('Language changed to English.');
});

test('landing section labels follow the selected language', async ({ page }) => {
  await page.goto('/');

  const sections = {
    comparison: page.locator('.comparison-grid'),
    features: page.locator('.stats'),
    showcase: page.locator('.showcase'),
    cta: page.locator('.cta-band')
  };
  await expect(sections.comparison).toHaveAttribute('aria-label', 'Comparación entre el plan gratuito y Pro');
  await expect(sections.features).toHaveAttribute('aria-label', 'Características');
  await expect(sections.showcase).toHaveAttribute('aria-label', 'Vista previa de la galería');
  await expect(sections.cta).toHaveAttribute('aria-label', 'Llamada a la acción');

  await page.locator('#lang-btn').click();

  await expect(sections.comparison).toHaveAttribute('aria-label', 'Comparison of the Free and Pro plans');
  await expect(sections.features).toHaveAttribute('aria-label', 'Features');
  await expect(sections.showcase).toHaveAttribute('aria-label', 'Gallery preview');
  await expect(sections.cta).toHaveAttribute('aria-label', 'Call to action');
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
