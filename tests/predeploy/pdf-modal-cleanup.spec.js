const { test, expect } = require('@playwright/test');

// Regresión de «Cancelar y cerrar deben dejar estado limpio» (BACKLOG):
// - «Cancelar» en el selector de región restaura plantilla, encuadre y opciones.
// - Cerrar el modal revoca sus blob URLs, descarta la generación en curso y no
//   deja selector, región ni timers vivos (10 aperturas/cierres sin fugas).
// - Reabrir tras cancelar una descarga deja el estudio y la descarga operativos.

const EXTERNAL = /^https?:\/\/(fonts\.googleapis\.com|fonts\.gstatic\.com|unpkg\.com)/;

const GEO = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: {
        _manaName: 'Europa',
        _manaColor: '#7fb3d5',
        Superficie: 42,
        Dato: 'Zona de prueba',
        _manaGroupName: 'Regiones',
        _manaGroupId: 'regiones',
        _manaLabelStyle: { enabled: true, field: '_manaName', haloWidth: 2 },
      },
      geometry: { type: 'Polygon', coordinates: [[[-10, 36], [30, 36], [30, 58], [-10, 58], [-10, 36]]] },
    },
    {
      type: 'Feature',
      properties: { _manaName: 'África', _manaColor: '#f0a868', Superficie: 31, Dato: 'Zona de prueba', _manaGroupName: 'Regiones', _manaGroupId: 'regiones' },
      geometry: { type: 'Polygon', coordinates: [[[-15, -30], [40, -30], [40, 30], [-15, 30], [-15, -30]]] },
    },
    {
      type: 'Feature',
      properties: { _manaName: 'Asia', _manaColor: '#c98474', Superficie: 27, Dato: 'Zona de prueba', _manaGroupName: 'Regiones', _manaGroupId: 'regiones' },
      geometry: { type: 'Polygon', coordinates: [[[45, -5], [140, -5], [140, 55], [45, 55], [45, -5]]] },
    },
  ],
};

async function bootPdfModal(page) {
  await page.route(EXTERNAL, (route) => route.abort());
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.goto('/404.html', { waitUntil: 'domcontentloaded' });
  await page.addStyleTag({ url: '/css/pdf-export.css' });
  await page.evaluate((geo) => {
    window.__events = [];
    window.trackEvent = (name, params) => window.__events.push({ name, params });
    window.LANG = 'es';
    window.getProjectName = () => 'Mapa de prueba';
    window.getEnrichedGeoJSON = () => JSON.parse(JSON.stringify(geo));
    // Contabilidad de blob URLs para detectar fugas entre aperturas.
    window.__urls = { created: 0, revoked: 0 };
    const create = URL.createObjectURL.bind(URL);
    const revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = (blob) => { window.__urls.created += 1; return create(blob); };
    URL.revokeObjectURL = (url) => { window.__urls.revoked += 1; return revoke(url); };
  }, GEO);
  await page.addScriptTag({ url: '/js/pdf-export.js' });
  await page.evaluate(() => window.openPdfExport());
  await expect(page.locator('#pdfx-modal')).toBeVisible();
  await expect(page.locator('#pdfx-preview img')).toHaveCount(1, { timeout: 15_000 });
}

async function drawRegion(page) {
  const box = await page.locator('#pdfx-picker-map').boundingBox();
  await page.mouse.move(box.x + box.width * 0.25, box.y + box.height * 0.3);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.62, box.y + box.height * 0.72, { steps: 10 });
  await page.mouse.up();
  await expect(page.locator('[data-picker-apply]')).toBeEnabled();
}

test('cancelling the region picker restores template, frame and options', async ({ page }) => {
  await bootPdfModal(page);

  // Punto de partida distinto del inicial: Atlas sin tabla.
  await page.locator('.pdfx-card[data-id="atlas"]').click();
  await page.locator('#pdfx-opt-table').uncheck();
  await expect(page.locator('.pdfx-card[data-id="atlas"]')).toHaveClass(/on/);

  await page.locator('[data-frame="region"]').click();
  await expect(page.locator('#pdfx-picker')).toBeVisible();

  // Mientras se elige la zona el usuario cambia plantilla y leyenda: al
  // cancelar debe volver exactamente al estado anterior.
  await page.locator('.pdfx-card[data-id="cartel"]').click();
  await page.locator('#pdfx-opt-legend').uncheck();
  await drawRegion(page);

  await page.locator('[data-picker-cancel]').click();

  await expect(page.locator('#pdfx-picker')).toBeHidden();
  await expect(page.locator('#pdfx-picker-sel')).toBeHidden();
  await expect(page.locator('[data-picker-apply]')).toBeDisabled();
  await expect(page.locator('#pdfx-picker-note')).toHaveText('Ninguna zona seleccionada');
  await expect(page.locator('.pdfx-preview-wrap')).not.toHaveClass(/is-picking/);

  await expect(page.locator('.pdfx-card[data-id="atlas"]')).toHaveClass(/on/);
  await expect(page.locator('.pdfx-card[data-id="atlas"]')).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('.pdfx-card[data-id="cartel"]')).not.toHaveClass(/on/);
  await expect(page.locator('#pdfx-opt-legend')).toBeChecked();
  await expect(page.locator('#pdfx-opt-table')).not.toBeChecked();
  await expect(page.locator('[data-frame="fit"]')).toHaveClass(/on/);
  await expect(page.locator('#pdfx-frame-hint')).toHaveText('Se usará todo el mapa.');
  await expect(page.locator('#pdfx-caption')).toContainText('Atlas');
  await expect(page.locator('#pdfx-preview img')).toHaveCount(1);
});

test('Escape cancels the region picker before closing the modal', async ({ page }) => {
  await bootPdfModal(page);

  await page.locator('[data-frame="region"]').click();
  await expect(page.locator('#pdfx-picker')).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(page.locator('#pdfx-picker')).toBeHidden();
  await expect(page.locator('#pdfx-modal')).toBeVisible();
  await expect(page.locator('#pdfx-preview img')).toHaveCount(1);
  await expect(page.locator('[data-frame="fit"]')).toHaveClass(/on/);

  await page.keyboard.press('Escape');
  await expect(page.locator('#pdfx-modal')).toBeHidden();
});

test('closing the modal releases blob URLs and leaves no picker or region state', async ({ page }) => {
  await bootPdfModal(page);

  // Deja una región aplicada para comprobar que el cierre la limpia.
  await page.locator('[data-frame="region"]').click();
  await drawRegion(page);
  await page.locator('[data-picker-apply]').click();
  await expect(page.locator('#pdfx-frame-hint')).toHaveText('Se usará la zona seleccionada.');

  for (let i = 0; i < 10; i++) {
    if (i === 0) await page.locator('.pdfx-close').click();
    await expect(page.locator('#pdfx-modal')).toBeHidden();
    await page.evaluate(() => window.openPdfExport());
    await expect(page.locator('#pdfx-preview img')).toHaveCount(1);
    await page.locator('.pdfx-close').click();
    await expect(page.locator('#pdfx-modal')).toBeHidden();
  }

  // Margen para que cualquier timer de miniaturas que hubiera quedado vivo
  // pudiera crear una blob URL nueva (no debe hacerlo).
  await page.waitForTimeout(900);

  const snapshot = await page.evaluate(() => {
    const preview = document.getElementById('pdfx-preview');
    const picker = document.getElementById('pdfx-picker');
    return {
      created: window.__urls.created,
      revoked: window.__urls.revoked,
      overlays: document.querySelectorAll('.pdfx-overlay').length,
      previewHtml: preview ? preview.innerHTML : 'sin preview',
      pickerHidden: picker ? picker.hidden : false,
      htmlClass: document.documentElement.className,
      picking: document.querySelector('.pdfx-preview-wrap').className,
    };
  });
  expect(snapshot.created - snapshot.revoked).toBe(0);
  expect(snapshot.overlays).toBe(1);
  expect(snapshot.previewHtml).toBe('');
  expect(snapshot.pickerHidden).toBe(true);
  expect(snapshot.htmlClass).not.toContain('pdfx-open');
  expect(snapshot.picking).not.toContain('is-picking');

  // Reabrir tras 10 ciclos vuelve al estado inicial: encuadre «Todo», sin región.
  await page.evaluate(() => window.openPdfExport());
  await expect(page.locator('[data-frame="fit"]')).toHaveClass(/on/);
  await expect(page.locator('#pdfx-frame-hint')).toHaveText('Se usará todo el mapa.');
  await expect(page.locator('#pdfx-picker')).toBeHidden();
  await expect(page.locator('#pdfx-preview img')).toHaveCount(1);
});

test('closing during generation discards the PDF and keeps the studio usable', async ({ page }) => {
  await bootPdfModal(page);

  let downloads = 0;
  page.on('download', () => { downloads += 1; });

  // Descarga y cierre en el mismo gesto: la generación pendiente (30 ms de
  // margen) no debe producir descarga, analítica ni estado residual.
  await page.evaluate(() => {
    document.getElementById('pdfx-download').click();
    document.querySelector('#pdfx-modal .pdfx-close').click();
  });
  await expect(page.locator('#pdfx-modal')).toBeHidden();
  await page.waitForTimeout(1200);
  expect(downloads).toBe(0);
  const events = await page.evaluate(() => window.__events.map((e) => e.name));
  expect(events).not.toContain('export');
  expect(events).not.toContain('pdf_error');

  // El estudio se puede reabrir y descargar con normalidad.
  await page.evaluate(() => window.openPdfExport());
  await expect(page.locator('#pdfx-preview img')).toHaveCount(1);
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#pdfx-download').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/-mana-maps\.pdf$/);
  await expect(page.locator('#pdfx-status')).toHaveText('PDF descargado ✓');
  expect(downloads).toBe(1);
});
