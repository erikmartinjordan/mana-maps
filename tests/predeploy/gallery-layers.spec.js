const { test, expect } = require('@playwright/test');

// Regresión de «añadir capas desde la galería pública»: el listado usa la API
// REST con field mask y el GeoJSON completo se descarga solo al elegir un mapa.
// Aquí se aísla el módulo con dobles de Firestore y de loadGeoJSON.

const GEO = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: {
        _manaName: 'Zona de prueba',
        _manaColor: '#7fb3d5',
        _manaGroupName: 'Regiones',
        Superficie: 42,
      },
      geometry: {
        type: 'Polygon',
        coordinates: [[[-10, 36], [30, 36], [30, 58], [-10, 58], [-10, 36]]],
      },
    },
  ],
};

function runQueryResponse() {
  return [{
    document: {
      name: 'projects/demo/databases/(default)/documents/maps/mapa-prueba',
      fields: {
        slug: { stringValue: 'mapa-prueba' },
        title: { stringValue: 'Mapa de prueba' },
        tags: { arrayValue: { values: [{ stringValue: 'Geografía' }] } },
        featureCount: { integerValue: '1' },
      },
    },
  }];
}

async function bootPicker(page, { failList = false } = {}) {
  await page.route('https://firestore.googleapis.com/**', async (route) => {
    if (failList) {
      await route.fulfill({ status: 500, body: 'boom' });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(runQueryResponse()),
    });
  });

  await page.addInitScript((geo) => {
    window.__added = [];
    window.__toasts = [];
    window.__alerts = [];
    window._manaGroupMeta = {};
    window.loadGeoJSON = (collection, name) => {
      window.__added.push({ collection, name });
      return Promise.resolve({});
    };
    window.showToast = (message) => { window.__toasts.push(message); };
    window.manaAlert = (message) => { window.__alerts.push(message); };
    window.ManaFirebase = {
      getConfig: () => ({ projectId: 'demo', apiKey: 'demo-key' }),
      getDb: () => ({
        collection: () => ({
          doc: () => ({
            get: async () => ({
              exists: true,
              data: () => ({
                isPublished: true,
                title: 'Mapa de prueba',
                geojsonText: JSON.stringify(geo),
              }),
            }),
          }),
        }),
      }),
    };
  }, GEO);

  await page.goto('/changelog/', { waitUntil: 'domcontentloaded' });
  await page.addStyleTag({ url: '/css/main.css' });
  await page.addScriptTag({ url: '/js/i18n.js' });
  await page.evaluate(() => {
    document.body.insertAdjacentHTML('beforeend', `
      <div id="gallery-layers-modal" class="mk-modal-overlay" style="display:none">
        <div class="mk-modal-box gallery-layers-box">
          <div class="gallery-layers-header">
            <div><strong data-i18n="gallery_layers_title">Añadir capas de la galería</strong></div>
            <button type="button" class="mk-modal-close" onclick="closeGalleryLayersPicker()">×</button>
          </div>
          <input id="gallery-layers-search" class="mk-modal-search" type="search"/>
          <div id="gallery-layers-status" class="gallery-layers-status" role="status"></div>
          <div id="gallery-layers-list" class="gallery-layers-list"></div>
        </div>
      </div>
    `);
  });
  await page.addScriptTag({ url: '/js/gallery-layers.js' });
}

test('gallery layer picker lists published maps and adds the chosen one', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));

  await bootPicker(page);
  await page.evaluate(() => window.openGalleryLayersPicker());

  await expect(page.locator('#gallery-layers-modal')).toBeVisible();
  await expect(page.locator('.gallery-layer-row')).toHaveCount(1);
  await expect(page.locator('.gallery-layer-copy strong')).toHaveText('Mapa de prueba');
  await expect(page.locator('.gallery-layer-tag')).toHaveText('Geografía');

  await page.locator('[data-gallery-add]').click();

  await expect(page.locator('[data-gallery-add]')).toHaveText('Añadida');
  await expect(page.locator('[data-gallery-add]')).toBeDisabled();

  const added = await page.evaluate(() => window.__added);
  expect(added).toHaveLength(1);
  expect(added[0].name).toBe('Regiones');
  expect(added[0].collection.features).toHaveLength(1);

  const toasts = await page.evaluate(() => window.__toasts);
  expect(toasts).toEqual(['Capa añadida: Mapa de prueba']);

  expect(pageErrors, `Unexpected runtime errors:\n${pageErrors.join('\n')}`).toEqual([]);
});

test('gallery layer picker filters the list and reports loading errors', async ({ page }) => {
  await bootPicker(page);
  await page.evaluate(() => window.openGalleryLayersPicker());
  await expect(page.locator('.gallery-layer-row')).toHaveCount(1);

  await page.fill('#gallery-layers-search', 'inexistente');
  await expect(page.locator('.gallery-layer-row')).toHaveCount(0);
  await expect(page.locator('.gallery-layers-empty')).toHaveText('Ningún mapa coincide con la búsqueda.');

  await page.fill('#gallery-layers-search', 'prueba');
  await expect(page.locator('.gallery-layer-row')).toHaveCount(1);
});

test('gallery layer picker shows a retry action when the list fails', async ({ page }) => {
  await bootPicker(page, { failList: true });
  await page.evaluate(() => window.openGalleryLayersPicker());

  await expect(page.locator('.gallery-layers-empty')).toContainText('No se pudo cargar la galería');
  await expect(page.locator('[data-gallery-retry]')).toBeVisible();
});

test('the 3D globe only paints visible layer groups', async ({ page }) => {
  await page.goto('/changelog/', { waitUntil: 'domcontentloaded' });
  await page.addScriptTag({ url: '/js/globe.js' });

  const names = await page.evaluate(() => {
    const polygon = (name, hidden) => ({
      type: 'Feature',
      properties: {
        name,
        _manaName: name,
        _manaColor: '#7fb3d5',
        _manaFillOpacity: 0.3,
        _manaGroupHidden: hidden,
      },
      geometry: {
        type: 'Polygon',
        coordinates: [[[-10, 36], [10, 36], [10, 48], [-10, 48], [-10, 36]]],
      },
    });

    window.getEnrichedGeoJSON = () => ({
      type: 'FeatureCollection',
      features: [polygon('Visible', false), polygon('Oculta', true)],
    });
    window.isDarkMapTheme = () => true;

    const sources = {};
    window.globeMap = {
      getLayer: () => null,
      getSource: (id) => sources[id] || null,
      removeLayer: () => {},
      removeSource: (id) => { delete sources[id]; },
      addSource: (id, def) => { sources[id] = def; },
      addLayer: () => {},
      hasImage: () => true,
      addImage: () => {},
    };

    window.syncToGlobe();
    return sources.drawn.data.features.map((f) => f.properties.name);
  });

  expect(names).toEqual(['Visible']);
});
