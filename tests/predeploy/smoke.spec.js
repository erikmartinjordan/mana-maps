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
  test.setTimeout(90_000);
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
    features: page.locator('.stats'),
    showcase: page.locator('.showcase'),
    cta: page.locator('.cta-band')
  };
  await expect(sections.features).toHaveAttribute('aria-label', 'Características');
  await expect(sections.showcase).toHaveAttribute('aria-label', 'Vista previa de la galería');
  await expect(sections.cta).toHaveAttribute('aria-label', 'Llamada a la acción');

  await page.locator('#lang-btn').click();

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

test('site footer stays consistent and readable on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');

  const footer = page.locator('.site-footer').first();
  await expect(footer).toBeVisible();
  await expect(footer.locator('.site-footer__group h2')).toHaveText(['Producto', 'Recursos', 'Compañía']);
  await expect(footer.locator('.site-footer__group a')).toHaveCount(9);

  const firstLink = await footer.locator('.site-footer__group a').first().boundingBox();
  expect(firstLink.height).toBeGreaterThanOrEqual(44);

  const companyLinks = footer.locator('.site-footer__group--wide a');
  const aboutBox = await companyLinks.nth(0).boundingBox();
  const githubBox = await companyLinks.nth(1).boundingBox();
  expect(Math.abs(aboutBox.x - githubBox.x)).toBeLessThanOrEqual(1);
  expect(githubBox.y).toBeGreaterThanOrEqual(aboutBox.y + aboutBox.height - 1);

  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor)).toBe('rgb(255, 255, 255)');
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor)).toBe('rgb(251, 252, 253)');
});

test('iPhone 16 Pro footer covers the screen edges on every page template', async ({ page }) => {
  // Viewports lógicos del iPhone 16 Pro (vertical y horizontal) y del 16 Pro Max.
  const viewports = [
    { width: 402, height: 874 },
    { width: 440, height: 956 },
    { width: 874, height: 402 }
  ];
  // Plantillas con `.frame` (home, galería, news, artículo, 404) y páginas que
  // montan el pie directamente sobre el body (about, pricing, landing de mapa).
  const templates = [
    '/',
    '/gallery/',
    '/news/',
    '/kilauea-episodio-56/',
    '/404.html',
    '/about/',
    '/pricing/',
    '/gallery/airports-world/'
  ];

  for (const viewport of viewports) {
    await page.setViewportSize(viewport);

    for (const path of templates) {
      await page.goto(path, { waitUntil: 'domcontentloaded' });
      const footer = page.locator('.site-footer').first();
      await expect(footer, path).toBeVisible();

      const result = await page.evaluate(() => {
        const footerEl = document.querySelector('.site-footer');
        const frameEl = document.querySelector('.frame');
        const footerRect = footerEl.getBoundingClientRect();
        const footerStyle = getComputedStyle(footerEl);
        const frameStyle = frameEl ? getComputedStyle(frameEl) : null;
        const frameRect = frameEl ? frameEl.getBoundingClientRect() : null;
        return {
          footerLeft: Math.round(footerRect.left),
          footerWidth: Math.round(footerRect.width),
          footerBackground: footerStyle.backgroundColor,
          gapBelowFooter: Math.round(document.documentElement.scrollHeight - (footerRect.bottom + window.scrollY)),
          viewportWidth: window.innerWidth,
          noHorizontalScroll: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
          frame: frameStyle ? {
            shadow: frameStyle.boxShadow,
            borderWidth: parseFloat(frameStyle.borderTopWidth),
            radius: parseFloat(frameStyle.borderTopLeftRadius),
            marginLeft: parseFloat(frameStyle.marginLeft),
            marginRight: parseFloat(frameStyle.marginRight),
            width: Math.round(frameRect.width)
          } : null
        };
      });

      // Sin scroll horizontal y con el pie pegado al borde inferior del documento.
      expect(result.noHorizontalScroll, path).toBe(true);
      expect(result.gapBelowFooter, path).toBeLessThanOrEqual(1);

      // El fondo del pie llega de borde a borde de la pantalla.
      expect(result.footerBackground, path).toBe('rgb(251, 252, 253)');
      expect(result.footerLeft, path).toBe(0);
      expect(result.footerWidth, path).toBe(result.viewportWidth);

      if (result.frame) {
        // El frame pierde sombra, borde, radio y márgenes: ocupa toda la pantalla.
        expect(result.frame.shadow, path).toBe('none');
        expect(result.frame.borderWidth, path).toBe(0);
        expect(result.frame.radius, path).toBe(0);
        expect(result.frame.marginLeft, path).toBe(0);
        expect(result.frame.marginRight, path).toBe(0);
        expect(result.frame.width, path).toBe(result.viewportWidth);

        // Al llegar al final el color de overscroll coincide con el fondo del pie,
        // de modo que iOS no muestra una banda gris que parezca una sombra.
        await expect
          .poll(async () => {
            await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
            return page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor);
          })
          .toBe('rgb(251, 252, 253)');
      }
    }
  }
});
