# Route Interaction Refactor: Seamless 2-Point Routing

This guide proposes a small state machine + optimistic rendering pipeline to make the “pick 2 points → get route” flow feel instant.

## 1) State management for smooth start/end selection

Use a dedicated controller instead of ad-hoc click handlers.

```js
// js/route-interaction.js
const RouteState = Object.freeze({
  idle: 'idle',
  selectingStart: 'selecting-start',
  selectingEnd: 'selecting-end',
  fetching: 'fetching',
  ready: 'ready',
  error: 'error'
});

const routeSelection = {
  phase: RouteState.idle,
  start: null,
  end: null,
  requestId: 0,
  activeAbort: null
};

function beginRouteSelection() {
  routeSelection.phase = RouteState.selectingStart;
  routeSelection.start = null;
  routeSelection.end = null;
  showRouteHint('Click to place START point');
}

function onRouteMapClick(latlng) {
  if (routeSelection.phase === RouteState.selectingStart) {
    routeSelection.start = latlng;
    routeSelection.phase = RouteState.selectingEnd;
    renderStartMarker(latlng);
    showRouteHint('Now click END point');
    return;
  }

  if (routeSelection.phase === RouteState.selectingEnd) {
    routeSelection.end = latlng;
    renderEndMarker(latlng);
    fetchRouteOptimistic();
  }
}

function resetRouteSelection() {
  if (routeSelection.activeAbort) routeSelection.activeAbort.abort();
  routeSelection.phase = RouteState.idle;
  routeSelection.start = null;
  routeSelection.end = null;
  routeSelection.activeAbort = null;
  clearRoutePreview();
}
```

### Why this helps
- Removes ambiguous tool state.
- Guarantees predictable transitions (`start -> end -> fetching -> ready/error`).
- Makes cancel/retry trivial.

---

## 2) Optimistic UI updates (instant feedback)

Draw a temporary dashed preview line immediately after the 2nd click, then replace it with the real route.

```js
let previewLine = null;
let finalRouteLine = null;

function drawOptimisticPreview(start, end) {
  if (previewLine) map.removeLayer(previewLine);

  previewLine = L.polyline([start, end], {
    color: '#0ea5e9',
    weight: 4,
    opacity: 0.7,
    dashArray: '8 8',
    className: 'route-loading'
  }).addTo(map);

  showRouteHint('Calculating route…');
}

function commitFinalRoute(coords, color = '#0ea5e9') {
  if (previewLine) {
    map.removeLayer(previewLine);
    previewLine = null;
  }
  if (finalRouteLine) map.removeLayer(finalRouteLine);

  finalRouteLine = L.polyline(coords, {
    color,
    weight: 4,
    opacity: 0.9
  }).addTo(map);

  map.fitBounds(finalRouteLine.getBounds(), { padding: [32, 32] });
  showRouteHint('Route ready ✓');
}

function showRouteErrorFallback(start, end) {
  // Keep the dashed preview visible but red to signal degraded fallback
  if (previewLine) previewLine.setStyle({ color: '#ef4444', dashArray: '4 8' });
  showRouteHint('Could not fetch full route; showing straight preview');
}
```

Optional CSS polish:

```css
/* styles.css */
.route-loading {
  animation: routeDash 0.8s linear infinite;
}
@keyframes routeDash {
  from { stroke-dashoffset: 16; }
  to { stroke-dashoffset: 0; }
}
```

---

## 3) Debounce + API optimization (feels instant)

For click-to-click routing, **debounce is mainly for drag/reposition cases**. More important:
1. cancel stale requests,
2. dedupe identical requests,
3. cache recent routes,
4. issue lower-latency optimistic rendering first.

```js
const routeCache = new Map(); // key -> { coords, distance, duration }

function routeKey(a, b) {
  // Round to reduce key explosion while preserving route quality
  const p = (x) => Number(x).toFixed(5);
  return `${p(a.lat)},${p(a.lng)}|${p(b.lat)},${p(b.lng)}`;
}

function debounce(fn, wait = 120) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

const fetchRouteOptimistic = debounce(async function () {
  const { start, end } = routeSelection;
  if (!start || !end) return;

  routeSelection.phase = RouteState.fetching;
  drawOptimisticPreview(start, end);

  const key = routeKey(start, end);
  if (routeCache.has(key)) {
    const cached = routeCache.get(key);
    commitFinalRoute(cached.coords);
    routeSelection.phase = RouteState.ready;
    return;
  }

  // cancel prior request if user re-picked endpoint quickly
  if (routeSelection.activeAbort) routeSelection.activeAbort.abort();
  const aborter = new AbortController();
  routeSelection.activeAbort = aborter;

  const requestId = ++routeSelection.requestId;

  try {
    const url =
      `https://router.project-osrm.org/route/v1/driving/` +
      `${start.lng},${start.lat};${end.lng},${end.lat}?overview=full&geometries=geojson`;

    const resp = await fetch(url, { signal: aborter.signal });
    if (!resp.ok) throw new Error(`Routing HTTP ${resp.status}`);

    const data = await resp.json();
    const route = data?.routes?.[0];
    if (!route) throw new Error('No route');

    // Ignore stale response
    if (requestId !== routeSelection.requestId) return;

    const coords = route.geometry.coordinates.map(([lng, lat]) => [lat, lng]);
    routeCache.set(key, { coords, distance: route.distance, duration: route.duration });

    commitFinalRoute(coords);
    routeSelection.phase = RouteState.ready;
  } catch (err) {
    if (err?.name === 'AbortError') return;
    routeSelection.phase = RouteState.error;
    showRouteErrorFallback(start, end);
  } finally {
    if (routeSelection.activeAbort === aborter) routeSelection.activeAbort = null;
  }
}, 120);
```

## Integration notes with your current codebase

- Your current route generation (`toolActions.draw_route`) waits for geocoding + routing before drawing anything. The above pattern draws instantly first, then refines.
- Apply the same optimistic pattern there too (temporary line before OSRM fetch resolves).
- Keep `requestId` checks even with aborting; some environments can still return late responses.

## UX micro-improvements that make it feel “seamless”

- Show tiny labels near points: “Start” and “End”.
- Auto-reset to “selectingStart” after a successful route, so users can create next route immediately.
- On mobile: add subtle haptic/tactile feedback per point pick.
- Save last used mode and color.
- If route fails, keep straight line and show “Tap to retry” instead of removing feedback.
