# Dalila Devtools Extension

Browser DevTools panel for inspecting Dalila's reactive runtime graph.

## Install (Chrome/Edge)

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select the `devtools-extension/` folder

## Install (Firefox)

1. Open `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on...**
3. Select `devtools-extension/manifest.json`
4. Open DevTools on your page and use the **Dalila** tab

## Run in Firefox (dev)

From project root:

```bash
npm run devtools:firefox:run
```

This launches Firefox with the extension loaded for the session.

## Build package

From project root:

```bash
npm run devtools:firefox:build
```

Artifact output:

- `devtools-extension/dist/*.zip`

## Runtime setup in app

In your Dalila app, enable the bridge:

```ts
import { initDevTools } from "dalila";

await initDevTools();
```

Then open DevTools and select the **Dalila** panel.

## Troubleshooting

- The extension reads data from `globalThis.__DALILA_DEVTOOLS__`.
- If the panel shows `missing_hook`, the app did not call `initDevTools()` yet.
