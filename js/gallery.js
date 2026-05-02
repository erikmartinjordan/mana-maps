// ── gallery.js ─ share modal + gallery publish ─

(function() {
  const MAPS_COLLECTION = 'maps';
  const FIRESTORE_FIELD_MAX_BYTES = 1048487;
  const firebaseConfig = {
    apiKey: 'AIzaSyBjtW1SUhgnLyagREHESEl4Vb4zI5yHgDg',
    authDomain: 'mana-maps-pro.firebaseapp.com',
    databaseURL: 'https://mana-maps-pro-default-rtdb.firebaseio.com',
    projectId: 'mana-maps-pro',
    storageBucket: 'mana-maps-pro.firebasestorage.app',
    messagingSenderId: '212469378297',
    appId: '1:212469378297:web:83e17ed0e38dd202944628',
    measurementId: 'G-F1Z7C21BZ6'
  };

  function getGalleryDb() {
    if (typeof firebase === 'undefined') return null;
    try {
      if (!firebase.apps || !firebase.apps.length) firebase.initializeApp(firebaseConfig);
      return firebase.firestore();
    } catch (e) {
      console.warn('gallery db unavailable:', e);
      return null;
    }
  }

  function waitForAuthUser(timeoutMs) {
    return new Promise(function(resolve) {
      if (!firebase || !firebase.auth || typeof firebase.auth !== 'function') {
        resolve(null);
        return;
      }
      var auth = firebase.auth();
      if (auth.currentUser && auth.currentUser.uid) {
        resolve(auth.currentUser);
        return;
      }
      var settled = false;
      var timer = setTimeout(function() {
        if (settled) return;
        settled = true;
        if (typeof unsubscribe === 'function') unsubscribe();
        resolve(auth.currentUser || null);
      }, timeoutMs || 5000);
      var unsubscribe = auth.onAuthStateChanged(function(user) {
        if (settled || !user) return;
        settled = true;
        clearTimeout(timer);
        unsubscribe();
        resolve(user);
      }, function() {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        unsubscribe();
        resolve(null);
      });
    });
  }

  function getCurrentGeo() {
    if (typeof getEnrichedGeoJSON !== 'function') return null;
    const geo = getEnrichedGeoJSON();
    if (!geo || !geo.features || !geo.features.length) return null;
    return geo;
  }

  function sanitizeFirestorePayload(value) {
    try {
      return JSON.parse(JSON.stringify(value));
    } catch (e) {
      console.warn('sanitizeFirestorePayload failed:', e);
      return null;
    }
  }

  function toGeoJSONString(geo) {
    try {
      return JSON.stringify(geo);
    } catch (e) {
      console.warn('toGeoJSONString failed:', e);
      return '';
    }
  }

  

  function compactGeoForPublish(geo) {
    function roundNum(n) {
      return typeof n === 'number' && isFinite(n) ? Number(n.toFixed(6)) : n;
    }
    function roundCoords(coords) {
      if (!Array.isArray(coords)) return coords;
      if (coords.length >= 2 && typeof coords[0] === 'number' && typeof coords[1] === 'number') {
        return [roundNum(coords[0]), roundNum(coords[1])];
      }
      return coords.map(roundCoords);
    }
    try {
      return {
        type: 'FeatureCollection',
        features: (geo.features || []).map(function(feature) {
          var props = feature && feature.properties ? feature.properties : {};
          var compactProps = {};
          Object.keys(props).forEach(function(k) {
            if (/^_mana/.test(k)) compactProps[k] = props[k];
          });
          return {
            type: 'Feature',
            geometry: feature && feature.geometry ? {
              type: feature.geometry.type,
              coordinates: roundCoords(feature.geometry.coordinates)
            } : null,
            properties: compactProps
          };
        })
      };
    } catch (e) {
      console.warn('compactGeoForPublish failed:', e);
      return geo;
    }
  }

  function payloadByteSize(value) {
    try {
      var text = JSON.stringify(value);
      if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(text).length;
      return unescape(encodeURIComponent(text)).length;
    } catch (e) {
      console.warn('payloadByteSize failed:', e);
      return Infinity;
    }
  }

  function splitTextIntoChunks(text, chunkSize) {
    if (typeof text !== 'string' || !text) return [];
    const chunks = [];
    let i = 0;
    while (i < text.length) {
      chunks.push(text.slice(i, i + chunkSize));
      i += chunkSize;
    }
    return chunks;
  }

  function getMapMeta() {
    const input = document.getElementById('project-name-input');
    const value = (input && input.value ? input.value : '').trim();
    return {
      name: value || (typeof t === 'function' ? t('map_name_placeholder') : 'Mapa sin título'),
      lang: (typeof LANG !== 'undefined' ? LANG : 'es')
    };
  }

  async function getCurrentUserUid() {
    try {
      // Firestore write metadata: prefer authenticated uid when available.
      if (firebase && firebase.auth && firebase.auth().currentUser && firebase.auth().currentUser.uid) {
        return firebase.auth().currentUser.uid;
      }
      if (firebase && firebase.auth && typeof firebase.auth === 'function') {
        await firebase.auth().signInAnonymously();
        var authUser = await waitForAuthUser(6000);
        if (authUser && authUser.uid) return authUser.uid;
      }
    } catch (e) {
      console.warn('auth uid unavailable:', e);
    }
    return null;
  }

  function getFirestoreErrorMessage(err) {
    var code = err && (err.code || err.errorCode || '');
    var message = err && err.message ? String(err.message) : '';
    if (code === 'permission-denied' || code === 'auth/operation-not-allowed') {
      return LANG === 'en'
        ? 'Publish blocked by Firebase permissions. Enable Authentication (anonymous or signed-in user) and allow writes to /maps.'
        : 'Publicación bloqueada por permisos de Firebase. Activa Authentication (anónimo o usuario autenticado) y permite escritura en /maps.';
    }
    if (code === 'unauthenticated' || code === 'auth/network-request-failed') {
      return LANG === 'en'
        ? 'Authentication failed while publishing. Check Firebase Auth and try again.'
        : 'Falló la autenticación al publicar. Revisa Firebase Auth y vuelve a intentarlo.';
    }
    if (code === 'invalid-argument' || /invalid|unsupported field value|undefined/i.test(message)) {
      return LANG === 'en'
        ? 'Firestore rejected map data (invalid field value). Remove unsupported values and try again.'
        : 'Firestore rechazó los datos del mapa (valor de campo inválido). Elimina valores no compatibles y vuelve a intentarlo.';
    }
    return LANG === 'en'
      ? 'Publish failed in Firestore. Please try again.'
      : 'Error al publicar en Firestore. Vuelve a intentarlo.';
  }

  function slugifyMapName(name) {
    const base = (name || 'mapa')
      .toString()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
      .slice(0, 40);
    const rnd = Math.random().toString(36).slice(2, 8);
    return (base || 'mapa') + '-' + rnd;
  }

  function buildGalleryURL(slug) {
    return window.location.origin + '/gallery/?slug=' + encodeURIComponent(slug);
  }

  function buildMapPreview(geo) {
    if (!geo || !Array.isArray(geo.features) || !geo.features.length) return null;
    var points = [];
    function collectCoordPairs(coords, out) {
      if (!Array.isArray(coords)) return;
      if (coords.length >= 2 && typeof coords[0] === 'number' && typeof coords[1] === 'number') {
        out.push([coords[0], coords[1]]);
        return;
      }
      coords.forEach(function(child) {
        collectCoordPairs(child, out);
      });
    }

    function buildGeometrySummary(geom) {
      if (!geom) return { type: null, centerLng: null, centerLat: null, vertexCount: 0 };
      var coords = [];
      collectCoordPairs(geom.coordinates, coords);
      if (!coords.length) {
        return { type: geom.type || null, centerLng: null, centerLat: null, vertexCount: 0 };
      }
      var sumX = 0; var sumY = 0;
      coords.forEach(function(c) {
        sumX += Number(c[0]) || 0;
        sumY += Number(c[1]) || 0;
      });
      return {
        type: geom.type || null,
        centerLng: Number((sumX / coords.length).toFixed(6)),
        centerLat: Number((sumY / coords.length).toFixed(6)),
        vertexCount: coords.length
      };
    }

    geo.features.forEach(function(feature) {
      var geom = feature && feature.geometry;
      if (!geom || !Array.isArray(geom.coordinates)) return;
      var type = geom.type;
      if (type === 'Point') {
        points.push(geom.coordinates);
      } else if (type === 'LineString' || type === 'MultiPoint') {
        geom.coordinates.forEach(function(c) { points.push(c); });
      } else if (type === 'Polygon' || type === 'MultiLineString') {
        geom.coordinates.forEach(function(ring) {
          if (Array.isArray(ring)) ring.forEach(function(c) { points.push(c); });
        });
      } else if (type === 'MultiPolygon') {
        geom.coordinates.forEach(function(poly) {
          if (!Array.isArray(poly)) return;
          poly.forEach(function(ring) {
            if (Array.isArray(ring)) ring.forEach(function(c) { points.push(c); });
          });
        });
      }
    });
    if (!points.length) return null;
    var minX = Infinity; var maxX = -Infinity; var minY = Infinity; var maxY = -Infinity;
    points.forEach(function(c) {
      var x = Number(c[0]); var y = Number(c[1]);
      if (!isFinite(x) || !isFinite(y)) return;
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    });
    if (!isFinite(minX) || !isFinite(maxX) || !isFinite(minY) || !isFinite(maxY)) return null;
    return {
      bbox: [minX, minY, maxX, maxY],
      features: geo.features.slice(0, 40).map(function(feature) {
        var props = feature && feature.properties ? feature.properties : {};
        var geomSummary = buildGeometrySummary(feature ? feature.geometry : null);
        return {
          geometryType: geomSummary.type,
          centerLng: geomSummary.centerLng,
          centerLat: geomSummary.centerLat,
          vertexCount: geomSummary.vertexCount,
          color: props._manaColor || props.color || '#0ea5e9'
        };
      })
    };
  }

  function setPublishButtonState(isSaving, errorMessage) {
    const publishBtn = document.querySelector('#share-modal .share-action-btn-primary');
    if (!publishBtn) return;
    publishBtn.disabled = !!isSaving;
    publishBtn.style.opacity = isSaving ? '0.7' : '';
    publishBtn.style.pointerEvents = isSaving ? 'none' : '';
    publishBtn.setAttribute('aria-busy', isSaving ? 'true' : 'false');
    if (!publishBtn.dataset.defaultLabel) {
      const labelEl = publishBtn.querySelector('.share-action-title');
      publishBtn.dataset.defaultLabel = labelEl ? labelEl.textContent : 'Publish map';
    }
    const labelEl = publishBtn.querySelector('.share-action-title');
    if (labelEl) {
      labelEl.textContent = isSaving
        ? (LANG === 'en' ? 'Publishing…' : 'Publicando…')
        : publishBtn.dataset.defaultLabel;
    }
    if (errorMessage && typeof manaAlert === 'function') {
      manaAlert(errorMessage, 'error');
    }
  }

  function copyToClipboard(text, okMessage) {
    return navigator.clipboard.writeText(text).then(function() {
      if (typeof showToast === 'function') showToast(okMessage);
    }).catch(function() {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      if (typeof showToast === 'function') showToast(okMessage);
    });
  }

  window.closeShareModal = function() {
    const modal = document.getElementById('share-modal');
    if (!modal) return;
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
  };

  window.publishMapToGallery = async function() {
    const rawGeo = getCurrentGeo();
    if (!rawGeo) {
      manaAlert(LANG === 'en' ? 'No elements to publish.' : t('persist_no_elements'), 'warning');
      return;
    }
    const geo = sanitizeFirestorePayload(rawGeo);
    if (!geo || !geo.features || !geo.features.length) {
      setPublishButtonState(false, LANG === 'en'
        ? 'Invalid map data for Firestore publish.'
        : 'Datos de mapa no válidos para publicar en Firestore.');
      return;
    }

    const meta = getMapMeta();
    const slug = slugifyMapName(meta.name);
    const userUid = await getCurrentUserUid();
    if (!userUid) {
      setPublishButtonState(false, LANG === 'en'
        ? 'You must be authenticated to publish. Enable Firebase anonymous auth or sign in.'
        : 'Debes autenticarte para publicar. Activa auth anónima de Firebase o inicia sesión.');
      return;
    }
    const preview = buildMapPreview(geo);
    const shareUrl = buildGalleryURL(slug);
    var geoToPublish = geo;
    var geoString = toGeoJSONString(geoToPublish);
    if (!geoString) {
      setPublishButtonState(false, LANG === 'en'
        ? 'Invalid map data for Firestore publish.'
        : 'Datos de mapa no válidos para publicar en Firestore.');
      return;
    }
    const FIRESTORE_REQ_SOFT_LIMIT = 9.5 * 1024 * 1024;
    var geoFieldSize = payloadByteSize({ geojsonText: geoString });
    if (geoFieldSize > FIRESTORE_FIELD_MAX_BYTES) {
      geoToPublish = compactGeoForPublish(geo);
      geoString = toGeoJSONString(geoToPublish);
      geoFieldSize = payloadByteSize({ geojsonText: geoString });
    }
    const payload = {
      id: slug,
      title: meta.name,
      name: meta.name,
      createdBy: userUid || 'anonymous',
      lang: meta.lang || 'es',
      featureCount: geo.features.length,
      // Store the full map only once; duplicating in mapDataText + geojsonText can exceed Firestore request size.
      mapPreview: preview || null,
      isPublished: true,
      shareUrl: shareUrl,
      createdAtMs: Date.now()
    };
    var useChunkedGeo = geoFieldSize > FIRESTORE_FIELD_MAX_BYTES;
    if (!useChunkedGeo) {
      payload.geojsonText = geoString;
    } else {
      payload.geojsonChunked = {
        collection: 'geoChunks',
        chunkCount: 0
      };
    }

    var payloadSize = payloadByteSize(payload);
    if (payloadSize > FIRESTORE_REQ_SOFT_LIMIT && payload.mapPreview) {
      delete payload.mapPreview;
      payloadSize = payloadByteSize(payload);
    }
    if (payloadSize > FIRESTORE_REQ_SOFT_LIMIT) {
      setPublishButtonState(false, LANG === 'en'
        ? 'Map too large to publish in gallery. Export GeoJSON or simplify geometry.'
        : 'Mapa demasiado grande para publicar en galería. Exporta GeoJSON o simplifica la geometría.');
      return;
    }

    const db = getGalleryDb();
    if (!db) {
      setPublishButtonState(false, LANG === 'en'
        ? 'Firestore unavailable. Map was not published.'
        : 'Firestore no disponible. El mapa no se ha publicado.');
      return;
    }

    setPublishButtonState(true);
    try {
      // Firestore write: persist the published map as a public record in /maps.
      const docRef = db.collection(MAPS_COLLECTION).doc(slug);
      const writePayload = {
        slug: slug,
        ...payload,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      };
      Object.keys(writePayload).forEach(function(key) {
        if (typeof writePayload[key] === 'undefined') delete writePayload[key];
      });
      await docRef.set(writePayload);

      if (useChunkedGeo) {
        var chunks = splitTextIntoChunks(geoString, 900000);
        if (!chunks.length) {
          throw new Error('Unable to split oversized GeoJSON for chunked publish');
        }
        writePayload.geojsonChunked.chunkCount = chunks.length;
        await docRef.set({ geojsonChunked: writePayload.geojsonChunked }, { merge: true });

        var oldChunksSnap = await docRef.collection(writePayload.geojsonChunked.collection).get();
        var deleteOps = [];
        oldChunksSnap.forEach(function(chunkDoc) {
          deleteOps.push(chunkDoc.ref.delete());
        });
        if (deleteOps.length) await Promise.all(deleteOps);

        var writeOps = chunks.map(function(chunkText, index) {
          return docRef.collection(writePayload.geojsonChunked.collection).doc(String(index)).set({
            index: index,
            text: chunkText
          });
        });
        await Promise.all(writeOps);
      }
    } catch (e) {
      console.warn('gallery publish failed:', e);
      setPublishButtonState(false, getFirestoreErrorMessage(e));
      return;
    } finally {
      setPublishButtonState(false);
    }

    const shareURL = buildGalleryURL(slug);
    try {
      await copyToClipboard(
        shareURL,
        LANG === 'en'
          ? 'Gallery URL copied ✓'
          : 'URL de galería copiada ✓'
      );
    } catch (copyErr) {
      console.warn('copy share URL failed:', copyErr);
    }
    if (typeof showToast === 'function') {
      showToast(LANG === 'en' ? 'Map published ✓' : 'Mapa publicado ✓');
    }

    closeShareModal();
    window.location.href = shareURL;
  };

  document.addEventListener('click', function(e) {
    const modal = document.getElementById('share-modal');
    if (!modal || !modal.classList.contains('open')) return;
    if (e.target === modal) closeShareModal();
  });

  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') closeShareModal();
  });
})();
