# Server Portal Integration Guide — Shared Components

**Date:** 2026-04-21
**For:** AeorDB server team
**From:** Client team

---

## Overview

The shared component library (`aeordb-web-components/`) now includes a pluggable file browser and a configurable dashboard that the server portal can embed directly. Both components are designed to work across different backends without modification — you provide an adapter or a `base-url`, and the component handles the rest.

---

## 1. File Browser

The file browser uses an **adapter pattern** — a class you implement that tells the component how to talk to your backend. The component never constructs URLs or makes fetch calls itself.

### What you need to build

Create `PortalFileBrowserAdapter` that extends `FileBrowserAdapter`:

```javascript
import { FileBrowserAdapter } from '/shared/components/aeor-file-browser-adapter.js';

class PortalFileBrowserAdapter extends FileBrowserAdapter {
  constructor(basePath = '') {
    super();
    this._basePath = basePath;
  }

  async browse(path, limit, offset) {
    const fullPath = this._basePath + path;
    const response = await api(`/files${fullPath}?limit=${limit}&offset=${offset}`);
    if (!response.ok) throw new Error(`${response.status}`);
    return response.json();
    // Must return: { entries: [...], total: N }
    // Each entry: { name, entry_type, size, content_type, created_at, updated_at }
  }

  fileUrl(path) {
    return `/files${this._basePath}${path}`;
  }

  async upload(path, body, contentType) {
    const response = await api(`/files${this._basePath}${path}`, {
      method: 'PUT',
      headers: { 'Content-Type': contentType },
      body,
    });
    if (!response.ok) throw new Error(`${response.status}`);
  }

  async delete(path) {
    const response = await api(`/files${this._basePath}${path}`, { method: 'DELETE' });
    if (!response.ok) throw new Error(`${response.status}`);
  }

  async rename(fromPath, toPath) {
    const response = await api('/files/rename', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: this._basePath + fromPath,
        to: this._basePath + toPath,
      }),
    });
    if (!response.ok) throw new Error(`${response.status}`);
  }

  // Portal doesn't have native OS access
  get supportsOpenLocally() { return false; }

  // Portal doesn't have sync relationships
  get supportsTabs() { return false; }
  get supportsSync() { return false; }
}
```

### Required response shapes

**`browse()` must return:**
```json
{
  "entries": [
    {
      "name": "readme.md",
      "entry_type": 2,
      "size": 4096,
      "content_type": "text/markdown",
      "created_at": 1776627397714,
      "updated_at": 1776627397714
    }
  ],
  "total": 42
}
```

Entry type constants:
| Value | Type |
|-------|------|
| 2 | File |
| 3 | Directory |
| 8 | Symlink |

**`fileUrl()` must return** a relative URL that serves the file content. The browser uses this for image thumbnails, preview components, and drag-out `DownloadURL`.

### Feature flags

Override these getters to control what the component renders:

| Flag | Default | Effect when `false` |
|------|---------|-------------------|
| `supportsTabs` | `false` | No tab bar, no relationship selector — single-path browsing |
| `supportsSync` | `false` | No sync status badges on entries |
| `supportsOpenLocally` | `false` | No "Open Locally" button in preview |
| `supportsUpload` | `true` | Hides upload button and disables drop-to-upload |
| `supportsRename` | `true` | Hides the editable filename in preview header |
| `supportsDelete` | `true` | Hides delete buttons and bulk delete |

### Mounting the component

```html
<script type="module">
  import { AeorFileBrowser } from '/shared/components/aeor-file-browser.js';
  // ... your adapter class ...

  // The component reads its adapter from a property set after creation
  const browser = document.querySelector('aeor-file-browser');
  browser.setAdapter(new PortalFileBrowserAdapter('/docs'));
</script>

<aeor-file-browser></aeor-file-browser>
```

> **Note:** The component currently initializes in `connectedCallback`. The portal may need to set the adapter before the component attaches to the DOM, or the component should be updated to re-initialize when an adapter is set. Coordinate with the client team if timing is an issue.

### Drag and drop

The file browser supports:

1. **Drop files from OS** → calls `adapter.upload()` for each dropped file
2. **Drag entries to OS** → sets `DownloadURL` with `adapter.fullFileUrl()` and emits a `file-drag-start` custom event
3. **Drag entries onto folders** → calls `adapter.rename()` to move them

The `file-drag-start` event bubbles and includes:
```javascript
event.detail = {
  adapter,     // Your adapter instance
  entry,       // The primary dragged entry object
  entries,     // All dragged entries (multi-select)
  path,        // Primary entry path
  paths,       // All dragged paths
  urls,        // Absolute URLs for all dragged entries
  url,         // Primary entry absolute URL
  isDirectory, // Boolean
};
```

Listen for this event if you need to customize drag behavior (e.g., add auth headers to download URLs).

### Preview components

The file browser dynamically loads preview components from `./previews/`:

| Component | Handles |
|-----------|---------|
| `aeor-preview-image` | png, jpg, gif, webp, svg, etc. |
| `aeor-preview-video` | mp4, webm, mov, etc. |
| `aeor-preview-audio` | mp3, wav, flac, etc. |
| `aeor-preview-text` | txt, md, json, yaml, rs, py, etc. |
| `aeor-preview-default` | Everything else (metadata display) |

Each preview component receives `src`, `filename`, `size`, and `content-type` attributes. The `src` comes from `adapter.fileUrl()`. These components are in the shared library — no action needed from the portal.

---

## 2. Dashboard

The shared dashboard component already works. You just need to mount it.

### Mounting (portal — same origin)

```html
<script type="module">
  import '/shared/components/aeor-dashboard.js';
</script>

<aeor-dashboard></aeor-dashboard>
```

No `base-url` needed — it defaults to the current origin.

### Mounting (remote — different server)

```html
<aeor-dashboard base-url="http://other-server:6830"></aeor-dashboard>
```

The `base-url` attribute prepends to all API calls and SSE connections. Changing `base-url` at runtime tears down the existing connection and re-initializes.

### Required endpoints

**`GET /system/stats`** — returns:
```json
{
  "identity": {
    "version": "0.9.0",
    "database_path": "/data/my.aeordb",
    "uptime_seconds": 86400,
    "hash_algorithm": "blake3"
  },
  "counts": {
    "files": 1234,
    "directories": 56,
    "symlinks": 0,
    "chunks": 7890,
    "snapshots": 12,
    "forks": 0
  },
  "sizes": {
    "disk_total": 1073741824,
    "logical_data": 524288000,
    "chunk_data": 419430400,
    "dedup_savings": 104857600,
    "void_space": 10485760
  },
  "throughput": {
    "writes_sec": 12.5,
    "reads_sec": 45.2,
    "bytes_written_sec": 1048576,
    "bytes_read_sec": 5242880
  },
  "health": {
    "disk_usage_percent": 48.5,
    "dedup_hit_rate": 82.3,
    "write_buffer_depth": 0
  }
}
```

**`GET /events/stream?events=metrics`** — SSE stream. Each event:
```
event: metrics
data: {"identity":{...},"counts":{...},"sizes":{...},"throughput":{...},"health":{...}}
```

Same shape as `/system/stats`. The dashboard subscribes on connect and falls back to polling `/system/stats` every 15 seconds if SSE fails.

### What the dashboard displays

- Identity bar (version, db path, uptime, hash algorithm)
- Count cards (files, directories, symlinks, chunks, snapshots, forks)
- Size cards (disk total, logical data, chunk data, dedup savings, void space)
- Throughput rates (writes/sec, reads/sec, bytes/sec)
- Health gauges (disk usage %, dedup hit rate, write buffer depth)
- Live SVG line charts with hover tooltips

All rendering is self-contained. You provide the data, the component handles the rest.

---

## 3. Styling

Import the shared design tokens:

```html
<link rel="stylesheet" href="/shared/styles/tokens.css">
<link rel="stylesheet" href="/shared/styles/components.css">
```

The components use CSS custom properties from `tokens.css`. If your portal already defines its own `:root` variables with the same names, they'll be picked up automatically. The key tokens:

| Token | Value | Usage |
|-------|-------|-------|
| `--bg-primary` | `#0d1117` | Page background |
| `--bg-secondary` | `#161b22` | Card/panel backgrounds |
| `--bg-tertiary` | `#21262d` | Hover/active states |
| `--border` | `#30363d` | All borders |
| `--text-primary` | `#e6edf3` | Primary text |
| `--text-secondary` | `#8b949e` | Labels, secondary text |
| `--accent` | `#f97316` | Brand orange, CTAs |
| `--success` | `#3fb950` | Success states |
| `--warning` | `#d29922` | Warning states |
| `--error` | `#f85149` | Error states |
| `--font-sans` | Inter, system-ui | Body text |
| `--font-mono` | JetBrains Mono | Code, metrics |
| `--radius` | 6px | Border radius |

---

## 4. `window.api()` Deprecation

The shared dashboard previously used `window.api()` (the portal's fetch wrapper). It now uses `fetch()` directly with the `base-url` prefix. If your portal has CORS or auth requirements, you have two options:

1. **Set up CORS** on the server so `fetch()` works cross-origin
2. **Patch `window.fetch`** with your auth wrapper (not recommended)
3. **Set a service worker** to inject auth headers (cleanest for cross-origin + auth)

For same-origin portal embedding, none of this matters — `fetch()` works natively.

---

## Questions?

- Adapter timing (set before or after DOM attach): let us know if you need a `setAdapter()` method that triggers re-initialization
- Auth for file access: if files require Bearer tokens, we can add an `authHeaders` option to the adapter
- Custom preview components: subclass the existing ones or register new tag names
