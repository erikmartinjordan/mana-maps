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

async function installCollaborativeFirebaseMock(page) {
  await page.route('https://www.gstatic.com/firebasejs/**', (route) => route.abort());
  await page.addInitScript((config) => {
    window.MANA_FIREBASE_CONFIGS = { pre: config, pro: config };
    window.MANA_FIREBASE_ENV = 'pre';

    const localUser = { uid: 'local-launch-user', isAnonymous: true };
    const listeners = [];
    const makeDoc = (id, data) => ({ id, data: () => data });
    const makeSnapshot = () => {
      const now = Date.now();
      const docs = [
        makeDoc(localUser.uid, {
          uid: localUser.uid,
          displayName: 'Launch Tester',
          color: '#0ea5e9',
          activity: 'Browsing map',
          lastSeenMs: now,
          updatedAtMs: now
        }),
        makeDoc('remote-reddit-user', {
          uid: 'remote-reddit-user',
          displayName: 'Reddit Guest',
          color: '#ef4444',
          activity: 'Reviewing launch map',
          cursor: { lat: 40.42, lng: -3.7, updatedAtMs: now },
          lastSeenMs: now,
          updatedAtMs: now
        })
      ];
      return { forEach: (callback) => docs.forEach(callback) };
    };

    function makeDocRef(path) {
      return {
        path,
        set: (payload) => {
          window.__manaFirestoreWrites = window.__manaFirestoreWrites || [];
          window.__manaFirestoreWrites.push({ path, payload });
          return Promise.resolve();
        },
        delete: () => Promise.resolve(),
        collection: (name) => makeCollection(path + '/' + name),
        get: () => Promise.resolve({ exists: false, data: () => null }),
        onSnapshot: (success) => {
          setTimeout(() => success({ data: () => null }), 0);
          return () => {};
        }
      };
    }

    function makeCollection(path) {
      const query = {
        get: () => Promise.resolve({ empty: true, docs: [], forEach: () => {} }),
        limit: () => query,
        orderBy: () => query,
        where: () => query,
        onSnapshot: (success) => {
          setTimeout(() => success({ empty: true, docs: [], forEach: () => {} }), 0);
          return () => {};
        }
      };
      return {
        doc: (id) => makeDocRef(path + '/' + id),
        get: query.get,
        limit: query.limit,
        orderBy: query.orderBy,
        where: query.where,
        onSnapshot: (success) => {
          listeners.push(success);
          setTimeout(() => success(makeSnapshot()), 100);
          return () => {};
        }
      };
    }

    window.firebase = {
      apps: [],
      initializeApp: () => {
        window.firebase.apps.push({ name: '[DEFAULT]' });
        return window.firebase.apps[0];
      },
      app: () => window.firebase.apps[0] || window.firebase.initializeApp(),
      auth: () => ({
        currentUser: localUser,
        onAuthStateChanged: (callback) => {
          setTimeout(() => callback(localUser), 0);
          return () => {};
        },
        signInAnonymously: () => Promise.resolve({ user: localUser })
      }),
      firestore: () => ({ collection: (name) => makeCollection(name) })
    };
    window.firebase.firestore.FieldValue = { serverTimestamp: () => ({ __serverTimestamp: true }) };
    window.__manaEmitPresence = () => listeners.forEach((listener) => listener(makeSnapshot()));
  }, firebaseSmokeConfig);
}

test('home page loads with expected title and main CTA', async ({ page }) => {
  await page.goto('/');

  await expect(page).toHaveTitle(/Maña Maps — Diseña mapas con claridad/i);
  await expect(page.getByRole('link', { name: /Empieza gratis/i })).toBeVisible();
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

test('shared edit session renders another collaborator as a cursor bubble with face', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));
  await installCollaborativeFirebaseMock(page);

  await page.goto('/map/?map=launch-room&room=launch-room&mode=edit');

  await expect(page.locator('#presence-avatars')).toBeVisible();
  await expect(page.locator('.presence-avatars-count')).toHaveText('2');
  await expect(page.locator('.presence-avatar[title="Reddit Guest"]')).toBeVisible();
  await expect(page.locator('.collab-live-cursor-bubble', { hasText: 'Reddit Guest' })).toBeVisible();
  await expect(page.locator('.collab-live-cursor-face[title="Reddit Guest"]')).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window.__manaFirestoreWrites || []).length)).toBeGreaterThan(0);

  expect(pageErrors, `Unexpected runtime errors:\n${pageErrors.join('\n')}`).toEqual([]);
});
