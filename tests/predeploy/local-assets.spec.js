const { test, expect } = require('@playwright/test');
const { checkLocalAssets } = require('../../scripts/check-local-assets');

test('every local asset referenced by HTML exists', async () => {
  const { checked, missing } = checkLocalAssets();
  const detail = missing.map(({ file, ref }) => `${file}: ${ref}`).join('\n');

  expect(missing, `Missing local asset references:\n${detail}`).toEqual([]);
  expect(checked).toBeGreaterThan(0);
});
