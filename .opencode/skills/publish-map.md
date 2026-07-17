# Publish Map to maña.com Gallery

Publish a GeoJSON map to the maña.com public gallery via Firestore.

## Prerequisites

- Node.js ≥ 18 with `playwright` (`npm install playwright`)
- Firebase project: `mana-maps` (configured in the web app)
- Scripts in `scripts/` directory

## Firestore Document Structure

Each published map is a Firestore document in the `maps` collection:

```
maps/{slug}
  id: string           // same as slug
  slug: string         // unique identifier (used in URL)
  title: string        // display title
  createdBy: string    // Firebase auth UID
  ownerUid: string     // owner Firebase auth UID
  authorHandle: string // display author (can be empty)
  lang: string         // 'en'
  featureCount: number // number of GeoJSON features
  visibility: string   // 'public'
  shareMode: string    // 'view' or 'edit'
  isPublished: boolean // true
  shareUrl: string     // full gallery URL
  geojsonText: string  // JSON-stringified FeatureCollection
  createdAtMs: number  // Date.now()
  updatedAtMs: number  // Date.now()
```

Security rules allow create if `createdBy == request.auth.uid`. Update requires `ownerUid == request.auth.uid` or shareMode rules.

## Publishing Flow

1. Prepare GeoJSON: `scripts/daily-map.js` generates topic-based GeoJSON with mixed geometry types
2. Publish via Playwright: `scripts/publish-map.js` opens the map editor, imports GeoJSON, creates a Firebase auth account, and writes to Firestore
3. The map appears at `https://maña.com/map/?gallery={slug}&mode=view` and on the gallery page `https://maña.com/gallery/`

## Auth Strategy

Each automated publish creates a fresh Firebase auth account via `createUserWithEmailAndPassword` with a random `mana-{prefix}{timestamp}@mailinator.com` email and a shared password. This is required because Firestore security rules require `signedIn()` and `createdBy == request.auth.uid` for create.

The account is ephemeral (one-time use per publish). Auth state is lost between sessions.

## Script Details

### `scripts/publish-map.js <geojson-file>`

Takes a GeoJSON file path as argument, opens the map editor page (`https://maña.com/map`) in headless Chromium, imports the GeoJSON, creates an auth account, and writes to Firestore with a unique slug (`map-{timestamp}`). Prints the published URL on success.

### `scripts/daily-map.js`

Generates a GeoJSON FeatureCollection with diverse geometry types (points, lines, polygons) based on a rotating topic. Topics cycle by day of week: rivers, air routes, mountains, shipping, deserts, railways, cultural regions. Prints GeoJSON to stdout.

### `scripts/daily-publish.sh`

Wrapper that pipes `daily-map.js | publish-map.js`. Runs daily at 8:00 AM via launchd.

## Example

```bash
# Generate a map and publish
node scripts/daily-map.js > /tmp/map.geojson
node scripts/publish-map.js /tmp/map.geojson
```

## Troubleshooting

- **Firestore permission denied**: The slug already exists with a different `ownerUid`. Use a unique slug (always done by the scripts via timestamp).
- **Playwright timeout**: The map page might be slow to load. Increase `waitForTimeout` values.
- **Missing or insufficient permissions**: The Firebase auth account might not be signed in. Verify `firebase.auth().currentUser` is set before writing.
