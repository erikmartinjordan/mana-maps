# Self-hosted basemaps

Maña Maps uses local styles based on OpenFreeMap by default:

- Light: `/styles/mana-positron.json`
- Dark: `/styles/mana-dark.json`
- Alternative view: `/styles/mana-openfreemap-alt.json`

To switch the app to self-hosted MapLibre/OpenMapTiles-compatible styles, serve these URLs:

- `/tiles/styles/positron/style.json`
- `/tiles/styles/dark/style.json`
- `/tiles/styles/alternative/style.json`
- optional thumbnail: `/tiles/previews/positron.png`

Then select the self-hosted provider in the browser:

```js
localStorage.setItem('mana_basemap_provider', 'selfHosted')
location.reload()
```

You can also preview it with `?basemap=selfHosted`.

If your self-hosted paths are different, edit `js/basemap-config.js` and change the `selfHosted.lightStyle`, `selfHosted.darkStyle`, `selfHosted.satelliteStyle`, and `selfHosted.thumb` values.
