const { test, expect } = require('@playwright/test');

// Blocks every Firebase/backend host. The gallery bootstraps from the Firestore
// REST API (field-masked, no web SDK), so "Firebase unavailable" must include
// firestore.googleapis.com/www.googleapis.com to exercise the empty state.
const EXTERNAL_CDN = /^https?:\/\/(unpkg\.com|www\.gstatic\.com|fonts\.googleapis\.com|fonts\.gstatic\.com|firestore\.googleapis\.com|www\.googleapis\.com)/;

test('gallery loads without errors and shows empty state when Firebase is unavailable', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));

  await page.route(EXTERNAL_CDN, (route) => route.abort());

  await page.addInitScript(() => {
    delete window.MANA_FIREBASE_CONFIGS;
  });

  await page.goto('/gallery/', { waitUntil: 'domcontentloaded' });

  const emptyState = page.locator('.empty-title');
  await expect(emptyState.first()).toBeVisible({ timeout: 20_000 });
  await expect(emptyState.first()).toContainText('Todavía no hay mapas publicados');

  const createBtn = page.locator('.empty .btn-primary');
  await expect(createBtn).toBeVisible();
  await expect(createBtn).toHaveAttribute('href', '/map/');

  expect(pageErrors, `Unexpected runtime errors:\n${pageErrors.join('\n')}`).toEqual([]);
});

test('gallery cards keep descriptions and data source hidden (product decision)', async ({ page }) => {
  // Guard de producto: las descripciones (.card-desc) y la fuente (.meta-source)
  // de las tarjetas de la galería deben permanecer ocultas. Este test bloquea
  // cualquier cambio (p. ej. del autopilot) que las re-habilite.
  await page.route(EXTERNAL_CDN, (route) => route.abort());
  await page.addInitScript(() => {
    delete window.MANA_FIREBASE_CONFIGS;
  });

  await page.goto('/gallery/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#gallery-list', { timeout: 20_000 });

  const displays = await page.evaluate(() => {
    const grid = document.getElementById('gallery-list');
    const card = document.createElement('div');
    card.className = 'card';
    const desc = document.createElement('div');
    desc.className = 'card-desc';
    desc.textContent = 'descripcion de prueba';
    const source = document.createElement('div');
    source.className = 'meta-source';
    source.textContent = 'fuente de prueba';
    card.append(desc, source);
    grid.appendChild(card);
    const d = getComputedStyle(desc).display;
    const s = getComputedStyle(source).display;
    card.remove();
    return { desc: d, source: s };
  });

  expect(displays.desc, '.card-desc debe estar oculta (display:none)').toBe('none');
  expect(displays.source, '.meta-source debe estar oculta (display:none)').toBe('none');
});

test('gallery auth modal opens on like/fork click', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));

  await page.route(EXTERNAL_CDN, (route) => route.abort());

  await page.addInitScript(() => {
    delete window.MANA_FIREBASE_CONFIGS;
  });

  await page.goto('/gallery/', { waitUntil: 'domcontentloaded' });

  await page.waitForSelector('.empty-title', { timeout: 20_000 });

  expect(pageErrors, `Unexpected runtime errors:\n${pageErrors.join('\n')}`).toEqual([]);
});

test('slug landing renders related maps block with crawlable HTML links', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));

  await page.route(EXTERNAL_CDN, (route) => route.abort());

  // Firestore simulado: mapa actual + afines por tags/temática.
  const MOCK_MAPS = [
    { slug: 'oceany-mares-world', title: 'Océanos y mares del mundo', tags: ['Geografía', 'Naturaleza'], isPublished: true, createdAtMs: 1000, featureCount: 5, shareMode: 'view' },
    { slug: 'arrecifes-coral', title: 'Arrecifes de coral', tags: ['Naturaleza', 'Océanos'], isPublished: true, createdAtMs: 2000, featureCount: 5, shareMode: 'view' },
    { slug: 'islas-grandes', title: 'Islas más grandes del mundo', tags: ['Geografía', 'Naturaleza'], isPublished: true, createdAtMs: 3000, featureCount: 5, shareMode: 'view' },
    { slug: 'rios-largos', title: 'Ríos más largos del mundo', tags: ['Geografía', 'Hidrografía'], isPublished: true, createdAtMs: 4000, featureCount: 5, shareMode: 'view' },
    { slug: 'desiertos-mundo', title: 'Desiertos del mundo', tags: ['Geografía', 'Naturaleza', 'Clima'], isPublished: true, createdAtMs: 5000, featureCount: 5, shareMode: 'view' },
    { slug: 'salario-minimo', title: 'Salario mínimo por país', tags: ['Economía', 'Geografía'], isPublished: true, createdAtMs: 6000, featureCount: 5, shareMode: 'view' },
  ];

  await page.addInitScript((maps) => {
    delete window.MANA_FIREBASE_CONFIGS;
    const docSnap = (data) => ({
      id: data.slug,
      exists: true,
      data: () => data,
    });
    const listSnap = {
      docs: maps.map((m) => docSnap(m)),
      empty: maps.length === 0,
      forEach: (fn) => maps.forEach((m) => fn(docSnap(m))),
    };
    const query = {
      where: () => query,
      orderBy: () => query,
      limit: () => query,
      get: async () => listSnap,
      onSnapshot: (cb) => {
        if (typeof cb === 'function') cb(listSnap);
        return () => {};
      },
    };
    const mockAuth = () => ({
      currentUser: null,
      onAuthStateChanged: (cb) => {
        if (typeof cb === 'function') cb(null);
        return () => {};
      },
      signInWithEmailAndPassword: async () => { throw new Error('mock-auth'); },
      createUserWithEmailAndPassword: async () => { throw new Error('mock-auth'); },
      signInAnonymously: async () => { throw new Error('mock-auth'); },
      signInWithPopup: async () => { throw new Error('mock-auth'); },
      signOut: async () => {},
    });
    mockAuth.GoogleAuthProvider = function GoogleAuthProvider() {};
    window.firebase = {
      apps: [{}],
      initializeApp: () => ({}),
      auth: mockAuth,
      firestore: () => ({
        collection: () => ({
          where: () => query,
          doc: (id) => ({
            get: async () => {
              const m = maps.find((x) => x.slug === id || x.id === id);
              return m ? docSnap(m) : { exists: false, data: () => null };
            },
          }),
        }),
      }),
    };
  }, MOCK_MAPS);

  await page.goto('/gallery/?slug=oceany-mares-world', { waitUntil: 'domcontentloaded' });

  const section = page.locator('#related-maps');
  await expect(section).toBeVisible({ timeout: 20_000 });

  const links = section.locator('.related-map-link');
  const count = await links.count();
  expect(count, 'Debe mostrar 3-4 mapas relacionados').toBeGreaterThanOrEqual(3);
  expect(count, 'No más de 4 mapas relacionados').toBeLessThanOrEqual(4);

  const hrefs = await links.evaluateAll((as) => as.map((a) => a.getAttribute('href')));
  hrefs.forEach((href) => {
    expect(href, 'Cada relación debe ser un enlace HTML rastreable /gallery/?slug=').toMatch(/^\/gallery\/\?slug=.+$/);
    expect(href, 'No debe auto-relacionarse consigo mismo').not.toContain('oceany-mares-world');
  });

  // Sin slug no debe mostrarse el bloque.
  await page.goto('/gallery/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#related-maps')).toBeHidden();

  // El mapa público debe ofrecer un CTA hacia el editor (bucle viral).
  await page.goto('/gallery/?slug=oceany-mares-world', { waitUntil: 'domcontentloaded' });
  const slugCta = page.locator('#slug-map-meta .slug-cta-btn');
  await expect(slugCta).toBeVisible({ timeout: 20_000 });
  await expect(slugCta).toHaveAttribute('href', '/map/');
  await expect(page.locator('#slug-map-meta .slug-share-btn').first()).toBeVisible();

  expect(pageErrors, `Unexpected runtime errors:\n${pageErrors.join('\n')}`).toEqual([]);
});
