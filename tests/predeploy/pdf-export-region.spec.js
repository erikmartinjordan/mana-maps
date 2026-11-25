const { test, expect } = require('@playwright/test');

// Regresión de «el mapa de detrás se borra al seleccionar la región»: mientras
// se elige la zona con el rectángulo, la plantilla debe seguir visible como
// miniatura y repintarse con el recorte, y al aplicar/cancelar todo vuelve a su
// estado. El preview es una imagen (blob SVG), así que se comprueba de verdad
// que está pintado midiendo sus píxeles en un canvas 2D.

const EXTERNAL = /^https?:\/\/(fonts\.googleapis\.com|fonts\.gstatic\.com|unpkg\.com)/;

const GEO = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: { _manaName: 'Europa', _manaColor: '#7fb3d5', Superficie: 42, Dato: 'Zona de prueba', _manaGroupName: 'Regiones', _manaGroupId: 'regiones' },
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

async function bootPdfModal(page, beforeOpen) {
  await page.route(EXTERNAL, (route) => route.abort());
  await page.goto('/404.html', { waitUntil: 'domcontentloaded' });
  await page.addStyleTag({ url: '/css/pdf-export.css' });
  await page.evaluate((geo) => {
    window.LANG = 'es';
    window.getProjectName = () => 'Mapa de prueba';
    window.getEnrichedGeoJSON = () => JSON.parse(JSON.stringify(geo));
  }, GEO);
  if (beforeOpen) await page.evaluate(beforeOpen);
  await page.addScriptTag({ url: '/js/pdf-export.js' });
  await page.evaluate(() => window.openPdfExport());
  await expect(page.locator('#pdfx-modal')).toBeVisible();
  await expect(page.locator('#pdfx-preview img')).toHaveCount(1, { timeout: 15_000 });
}

// Instrumenta las blob URLs para detectar fugas: cada URL creada debe acabar
// revocada al cerrar el modal.
async function trackBlobUrls(page) {
  await page.evaluate(() => {
    window.__blob = { created: [], revoked: [] };
    const create = URL.createObjectURL.bind(URL);
    const revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = (blob) => {
      const url = create(blob);
      window.__blob.created.push(url);
      return url;
    };
    URL.revokeObjectURL = (url) => {
      window.__blob.revoked.push(url);
      return revoke(url);
    };
  });
}

async function liveBlobUrls(page) {
  return page.evaluate(() => window.__blob.created.filter((u) => window.__blob.revoked.indexOf(u) === -1));
}

async function dragSelection(page) {
  const mapBox = await page.locator('#pdfx-picker-map').boundingBox();
  const x1 = mapBox.x + mapBox.width * 0.25;
  const y1 = mapBox.y + mapBox.height * 0.3;
  const x2 = mapBox.x + mapBox.width * 0.62;
  const y2 = mapBox.y + mapBox.height * 0.72;
  await page.mouse.move(x1, y1);
  await page.mouse.down();
  await page.mouse.move(x2, y2, { steps: 12 });
  await page.mouse.up();
  await expect(page.locator('#pdfx-picker-note')).toHaveText('Zona seleccionada');
}

// Dibuja el preview real en un canvas y devuelve métricas de sus píxeles: si la
// página estuviera en blanco habría pocos colores y ningún píxel oscuro.
async function previewStats(page) {
  return page.evaluate(async () => {
    const img = document.querySelector('#pdfx-preview img');
    if (!img) return null;
    if (!img.complete || !img.naturalWidth) {
      await new Promise((resolve) => {
        img.addEventListener('load', resolve, { once: true });
        img.addEventListener('error', resolve, { once: true });
      });
    }
    const w = 180;
    const h = Math.max(1, Math.round((w * img.naturalHeight) / img.naturalWidth));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h).data;
    const colors = new Set();
    let dark = 0;
    let lum = 0;
    let n = 0;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i + 1], b = data[i + 2];
      colors.add((r << 16) | (g << 8) | b);
      const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      lum += l;
      n++;
      if (l < 220) dark++;
    }
    return {
      naturalWidth: img.naturalWidth,
      naturalHeight: img.naturalHeight,
      colors: colors.size,
      darkRatio: dark / n,
      meanLum: lum / n,
    };
  });
}

async function expectPainted(page) {
  const stats = await previewStats(page);
  expect(stats, 'no hay imagen de preview').not.toBeNull();
  expect(stats.naturalWidth).toBeGreaterThan(0);
  expect(stats.colors, 'el preview parece una página en blanco').toBeGreaterThan(10);
  expect(stats.darkRatio, 'el preview no tiene tinta').toBeGreaterThan(0.01);
  expect(stats.meanLum).toBeGreaterThan(120);
  expect(stats.meanLum).toBeLessThan(252);
}

test('the region picker keeps the template preview visible while framing', async ({ page }) => {
  await bootPdfModal(page);

  const preview = page.locator('#pdfx-preview');
  const picker = page.locator('#pdfx-picker');

  // Estado inicial: preview del encuadre «Todo».
  await expect(preview).toBeVisible();
  await expectPainted(page);

  // Al entrar en Región el preview no puede desaparecer (regresión).
  await page.locator('[data-frame="region"]').click();
  await expect(picker).toBeVisible();
  await expect(preview).toBeVisible();
  await expect(preview).toHaveAttribute('data-tag', 'Vista previa');
  await expectPainted(page);

  // La miniatura se aparta: ocupa menos de la mitad del área de trabajo.
  const wrapBox = await page.locator('.pdfx-preview-wrap').boundingBox();
  const pipBox = await preview.boundingBox();
  expect(pipBox.width).toBeLessThan(wrapBox.width * 0.5);
  expect(pipBox.height).toBeLessThan(wrapBox.height * 0.75);

  // Al arrastrar el rectángulo se ve el recorte antes de aplicar.
  const before = await page.locator('#pdfx-preview img').getAttribute('src');
  const mapBox = await page.locator('#pdfx-picker-map').boundingBox();
  const x1 = mapBox.x + mapBox.width * 0.25;
  const y1 = mapBox.y + mapBox.height * 0.3;
  const x2 = mapBox.x + mapBox.width * 0.62;
  const y2 = mapBox.y + mapBox.height * 0.72;
  await page.mouse.move(x1, y1);
  await page.mouse.down();
  await page.mouse.move(x2, y2, { steps: 12 });
  await page.mouse.up();

  await expect(page.locator('#pdfx-picker-note')).toHaveText('Zona seleccionada');
  await expect(page.locator('[data-picker-apply]')).toBeEnabled();
  await expect.poll(async () => page.locator('#pdfx-preview img').getAttribute('src'), { timeout: 10_000 })
    .not.toBe(before);
  await expectPainted(page);

  // Aplicar cierra el selector y deja el preview del recorte.
  await page.locator('[data-picker-apply]').click();
  await expect(picker).toBeHidden();
  await expect(preview).toBeVisible();
  await expect(preview).not.toHaveAttribute('data-tag', /.+/);
  await expect(page.locator('#pdfx-frame-hint')).toHaveText('Se usará la zona seleccionada.');
  await expectPainted(page);

  // Cancelar restaura el encuadre anterior (la región aplicada) y el preview
  // sigue pintado.
  await page.locator('[data-frame="region"]').click();
  await expect(picker).toBeVisible();
  await page.locator('[data-picker-cancel]').click();
  await expect(picker).toBeHidden();
  await expect(preview).toBeVisible();
  await expect(page.locator('#pdfx-frame-hint')).toHaveText('Se usará la zona seleccionada.');
  await expect(page.locator('[data-frame="region"]')).toHaveClass(/on/);
  await expectPainted(page);
});

test('closing the modal repaints the editor map and the 3D globe', async ({ page }) => {
  await bootPdfModal(page);

  // Sustituye Leaflet, el puente MapLibre y el globo por dobles que cuentan
  // los repintados: el modal debe devolverles el tamaño real al cerrarse.
  await page.evaluate(() => {
    window.__repaint = { leaflet: 0, gl: 0, glJump: null, glPaint: 0, globe: 0 };
    window.map = {
      invalidateSize() { window.__repaint.leaflet++; },
      getCenter() { return { lng: 3.7038, lat: 40.4168 }; },
      getZoom() { return 6; },
    };
    window.__gl = {
      resize() { window.__repaint.gl++; },
      jumpTo(o) { window.__repaint.glJump = o; },
      triggerRepaint() { window.__repaint.glPaint++; },
    };
    window._getActiveGLMap = () => window.__gl;
    window.globeMap = { resize() { window.__repaint.globe++; } };
  });

  await page.locator('[data-close]').click();
  await expect(page.locator('#pdfx-modal')).toBeHidden();
  await expect.poll(() => page.evaluate(() => window.__repaint.leaflet)).toBe(1);
  await expect.poll(() => page.evaluate(() => window.__repaint.gl)).toBe(1);
  await expect.poll(() => page.evaluate(() => window.__repaint.globe)).toBe(1);
  const repaint = await page.evaluate(() => window.__repaint);
  expect(repaint.glJump).toEqual({ center: [3.7038, 40.4168], zoom: 6 });
  expect(repaint.glPaint).toBe(1);

  // Escape cierra igual y vuelve a repintar; el globo nunca se escribe dos
  // veces por cierre aunque el puente y el globo sean el mismo objeto.
  await page.evaluate(() => {
    window._getActiveGLMap = () => window.globeMap;
    window.globeMap.jumpTo = () => { throw new Error('el globo no debe reencuadrarse'); };
    window.openPdfExport();
  });
  await expect(page.locator('#pdfx-modal')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#pdfx-modal')).toBeHidden();
  await expect.poll(() => page.evaluate(() => window.__repaint.leaflet)).toBe(2);
  await expect.poll(() => page.evaluate(() => window.__repaint.globe)).toBe(2);
});

test('closing the modal clears the picker state and the preview returns on reopen', async ({ page }) => {
  await bootPdfModal(page);

  await page.locator('[data-frame="region"]').click();
  await expect(page.locator('#pdfx-picker')).toBeVisible();

  await page.locator('[data-close]').click();
  await expect(page.locator('#pdfx-modal')).toBeHidden();
  await expect(page.locator('html')).not.toHaveClass(/pdfx-open/);

  await page.evaluate(() => window.openPdfExport());
  await expect(page.locator('#pdfx-modal')).toBeVisible();
  await expect(page.locator('#pdfx-picker')).toBeHidden();
  await expect(page.locator('.pdfx-preview-wrap')).not.toHaveClass(/is-picking/);
  await expect(page.locator('#pdfx-preview img')).toHaveCount(1);
  await expectPainted(page);
});

test('cancelling the region picker restores the previous template, frame and options', async ({ page }) => {
  await bootPdfModal(page);

  // Estado previo al selector: otra plantilla y la leyenda desactivada.
  await page.locator('.pdfx-card[data-id="atlas"]').click();
  await expect(page.locator('.pdfx-card[data-id="atlas"]')).toHaveClass(/on/);
  await page.locator('#pdfx-opt-legend').uncheck();
  await expect(page.locator('#pdfx-opt-legend')).not.toBeChecked();

  await page.locator('[data-frame="region"]').click();
  await expect(page.locator('#pdfx-picker')).toBeVisible();
  await dragSelection(page);

  // Mientras se elige la zona se puede cambiar de plantilla: cancelar también
  // debe deshacer ese cambio y volver al estado con el que se abrió.
  await page.locator('.pdfx-card[data-id="minimal"]').click();
  await expect(page.locator('.pdfx-card[data-id="minimal"]')).toHaveClass(/on/);

  await page.locator('[data-picker-cancel]').click();
  await expect(page.locator('#pdfx-picker')).toBeHidden();
  await expect(page.locator('.pdfx-card[data-id="atlas"]')).toHaveClass(/on/);
  await expect(page.locator('.pdfx-card[data-id="minimal"]')).not.toHaveClass(/on/);
  await expect(page.locator('#pdfx-opt-legend')).not.toBeChecked();
  await expect(page.locator('[data-frame="fit"]')).toHaveClass(/on/);
  await expect(page.locator('#pdfx-frame-hint')).toHaveText('Se usará todo el mapa.');
  await expect(page.locator('#pdfx-preview')).not.toHaveAttribute('data-tag', /.+/);
  await expectPainted(page);
});

test('closing the modal revokes every preview and thumbnail blob URL', async ({ page }) => {
  await bootPdfModal(page, () => {
    window.__blob = { created: [], revoked: [] };
    const create = URL.createObjectURL.bind(URL);
    const revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = (blob) => {
      const url = create(blob);
      window.__blob.created.push(url);
      return url;
    };
    URL.revokeObjectURL = (url) => {
      window.__blob.revoked.push(url);
      return revoke(url);
    };
  });

  await expect(page.locator('#pdfx-preview img')).toHaveCount(1);
  await expect(page.locator('.pdfx-thumb.has-img')).toHaveCount(5, { timeout: 10_000 });

  await page.locator('[data-close]').click();
  await expect(page.locator('#pdfx-modal')).toBeHidden();

  const created = await page.evaluate(() => window.__blob.created.length);
  expect(created).toBeGreaterThan(5);
  expect(await liveBlobUrls(page)).toEqual([]);
  // La imagen del preview apuntaba a una URL revocada: no debe quedar en el DOM
  // ni las miniaturas con fondos rotos.
  await expect(page.locator('#pdfx-preview img')).toHaveCount(0);
  await expect(page.locator('.pdfx-thumb.has-img')).toHaveCount(0);
});

test('closing the modal cancels an in-flight download and reopening starts clean', async ({ page }) => {
  await bootPdfModal(page);

  // Doble del descargador para contar PDFs sin tocar el disco.
  await page.evaluate(() => {
    window.__downloads = [];
    window.ManaShareCard = {
      downloadBlob(blob, filename) { window.__downloads.push(filename); },
    };
    document.getElementById('pdfx-download').click();
    document.querySelector('[data-close]').click();
  });
  await expect(page.locator('#pdfx-modal')).toBeHidden();
  await expect(page.locator('#pdfx-status')).toHaveText('');
  // Margen para que una generación no cancelada habría terminado y descargado.
  await page.waitForTimeout(600);
  expect(await page.evaluate(() => window.__downloads)).toEqual([]);

  // Al reabrir, el modal parte de los valores por defecto y descarga una vez.
  await page.evaluate(() => window.openPdfExport());
  await expect(page.locator('#pdfx-modal')).toBeVisible();
  await expect(page.locator('.pdfx-card[data-id="dossier"]')).toHaveClass(/on/);
  await expect(page.locator('#pdfx-opt-legend')).toBeChecked();
  await expect(page.locator('[data-frame="fit"]')).toHaveClass(/on/);
  await expect(page.locator('#pdfx-preview img')).toHaveCount(1, { timeout: 15_000 });
  await expectPainted(page);

  await page.locator('#pdfx-download').click();
  await expect.poll(() => page.evaluate(() => window.__downloads.length), { timeout: 15_000 }).toBe(1);
  expect(await page.evaluate(() => window.__downloads[0])).toMatch(/-mana-maps\.pdf$/);
});

test('opening and closing the modal ten times leaks no blob URLs', async ({ page }) => {
  await bootPdfModal(page);
  await trackBlobUrls(page);

  for (let i = 0; i < 10; i++) {
    if (i > 0) await page.evaluate(() => window.openPdfExport());
    await expect(page.locator('#pdfx-modal')).toBeVisible();
    await expect(page.locator('#pdfx-preview img')).toHaveCount(1, { timeout: 15_000 });
    if (i % 2 === 0) {
      await page.locator('[data-frame="region"]').click();
      await expect(page.locator('#pdfx-picker')).toBeVisible();
    }
    await page.keyboard.press('Escape');
    await expect(page.locator('#pdfx-modal')).toBeHidden();
    await expect(page.locator('html')).not.toHaveClass(/pdfx-open/);
  }

  expect(await liveBlobUrls(page)).toEqual([]);
  await expect(page.locator('#pdfx-picker')).toBeHidden();
  await expect(page.locator('.pdfx-preview-wrap')).not.toHaveClass(/is-picking/);
  await expect(page.locator('#pdfx-preview img')).toHaveCount(0);
});
