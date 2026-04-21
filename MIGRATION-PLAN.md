# AeorDB Shared Web Components — Migration Plan

**Date:** 2026-04-20
**Status:** In Progress
**Repo:** `aeordb-web-components/`

## Overview

We're consolidating duplicated web components and utilities from the server portal (`aeordb/aeordb-lib/src/portal/`) and the client app (`aeordb-client/`) into a single shared library at `aeordb-web-components/`.

Both projects access the shared library via **symlinks**:
- Server: `aeordb-lib/src/portal/shared → aeordb-web-components/`
- Client: `aeordb-client/static/shared → aeordb-web-components/`

## How to Import

```javascript
// From the client:
import { escapeHtml, formatBytes } from '/static/shared/utils.js';
import { AeorCrudlify } from '/static/shared/components/aeor-crudlify.js';

// CSS (link in HTML or @import):
<link rel="stylesheet" href="/static/shared/styles/tokens.css">
<link rel="stylesheet" href="/static/shared/styles/components.css">
```

## Directory Structure

```
aeordb-web-components/
  components/
    aeor-crudlify.js        ← Phase 1 (done)
    aeor-toasts.js           ← Phase 1 (done)
    aeor-login.js            ← Phase 4
    aeor-dashboard.js        ← Phase 2
    aeor-file-browser.js     ← Phase 3
    aeor-modal.js            ← Phase 2
    previews/
      aeor-preview-default.js  ← Phase 3
      aeor-preview-text.js     ← Phase 3
      aeor-preview-image.js    ← Phase 3
      aeor-preview-audio.js    ← Phase 3
      aeor-preview-video.js    ← Phase 3
  styles/
    tokens.css               ← Phase 1 (done)
    components.css           ← Phase 1 (done)
  utils.js                   ← Phase 1
  api.js                     ← Phase 4
```

---

## Phase 1: Shared Utilities ← NEXT

**Goal:** Eliminate all duplicated helper functions.

### What's moving to `utils.js`:

| Function | Currently in | Copies |
|----------|-------------|--------|
| `escapeHtml(text)` | portal app.mjs, dashboard.mjs, users.mjs, groups.mjs; client file-view-shared.js | **5** |
| `escapeAttr(text)` | client file-view-shared.js | 1 |
| `formatBytes(bytes)` | portal dashboard.mjs; client file-view-shared.js | 2 |
| `formatNumber(n)` | portal dashboard.mjs | 1 |
| `formatRate(value)` | portal dashboard.mjs | 1 |
| `formatBytesRate(bytesPerSec)` | portal dashboard.mjs | 1 |
| `formatPercent(value)` | portal dashboard.mjs | 1 |
| `formatUptime(seconds)` | portal dashboard.mjs; client dashboard.js | 2 |
| `formatDate(timestamp)` | client file-view-shared.js | 1 |

### Client action items:
1. Replace `import { escapeHtml, formatBytes, ... } from './aeor-file-view-shared.js'` with `import { ... } from '/static/shared/utils.js'`
2. Remove duplicated functions from `aeor-file-view-shared.js` (keep only file-specific helpers)
3. Adopt `formatRate()`, `formatBytesRate()`, `formatPercent()` if displaying metrics

### Breaking changes: None. Same function signatures, same behavior.

---

## Phase 2: Shared Dashboard

**Goal:** Unify the portal and client dashboards into one shared component.

### What's moving:
- Dashboard web component (`<aeor-dashboard>`) with:
  - Identity bar (version, db path, uptime, hash algorithm)
  - Count cards (files, directories, symlinks, chunks, snapshots, forks)
  - Size cards (disk total, logical data, chunk data, dedup savings, void space)
  - Throughput display (writes/sec, reads/sec, bytes written/read)
  - Health indicators (disk usage, dedup hit rate, write buffer depth)
  - Dual-line SVG charts with hover tooltips (ops/sec + bytes/sec)
- Modal component (`<aeor-modal>`) extracted from portal users/groups

### Client action items:
1. Replace `aeor-dashboard.js` with import from shared
2. The shared dashboard subscribes to `?events=metrics` SSE and falls back to `GET /system/stats`
3. Client's existing dashboard connection-specific features (sync status, peer list) stay in the client — only the metrics dashboard is shared

### Breaking changes:
- Dashboard expects the new `/system/stats` response shape (identity/counts/sizes/throughput/health)
- Dashboard subscribes to `metrics` SSE event, not `heartbeat`

---

## Phase 3: File Browser + Previews

**Goal:** Move the client's file browser and preview system to shared so the portal can embed it.

### What's moving:
- `aeor-file-browser.js` — tabbed file browser with breadcrumbs, grid/list view, context menu, infinite scroll
- `aeor-file-view-shared.js` — file-specific utilities (after Phase 1 extracts the generic ones)
- `previews/aeor-preview-default.js` — binary/unknown file type preview
- `previews/aeor-preview-text.js` — text/markdown preview with syntax highlighting
- `previews/aeor-preview-image.js` — image preview with zoom
- `previews/aeor-preview-audio.js` — audio player
- `previews/aeor-preview-video.js` — video player

### Client action items:
1. Replace local component imports with shared imports
2. File-specific API calls remain — the browser calls `/files/` endpoints which both the server and client expose

### Breaking changes: None expected. Same component API.

---

## Phase 4: Auth + API Wrapper

**Goal:** Shared authentication handling and API client.

### What's moving:
- `api.js` — fetch wrapper with Bearer token injection, 401 handling, token refresh
- `aeor-login.js` — login form web component (API key input)
- Auth state management (localStorage-backed token storage)

### Client action items:
1. Adopt the shared `api()` wrapper instead of raw `fetch()`
2. Import `<aeor-login>` for authentication UI
3. All API calls go through the shared wrapper — automatic auth header injection

### Breaking changes:
- Client needs to switch from raw `fetch()` to `import { api } from '/static/shared/api.js'`
- API wrapper expects JWT token in localStorage under key `aeordb_token`

---

## Design Tokens

The shared `styles/tokens.css` is the **single source of truth** for all visual constants. Both projects should import this instead of defining their own `:root` variables.

| Token | Value | Usage |
|-------|-------|-------|
| `--bg-primary` | `#0d1117` | Page background |
| `--bg-secondary` | `#161b22` | Card/panel background |
| `--bg-tertiary` | `#21262d` | Hover/active states |
| `--border` | `#30363d` | All borders |
| `--text-primary` | `#e6edf3` | Primary text |
| `--text-secondary` | `#8b949e` | Secondary/label text |
| `--text-muted` | `#484f58` | Disabled/hint text |
| `--accent` | `#f97316` | Brand orange |
| `--accent-hover` | `#fb923c` | Button hover |
| `--success` | `#3fb950` | Success states |
| `--warning` | `#d29922` | Warning states |
| `--error` | `#f85149` | Error states |
| `--font-sans` | Inter, system-ui | Body text |
| `--font-mono` | JetBrains Mono | Code, metrics |
| `--radius` | 6px | Border radius |

---

## Timeline

| Phase | What | Status |
|-------|------|--------|
| 1 | Shared utilities (`utils.js`) | **Next** |
| 2 | Shared dashboard + modal | Planned |
| 3 | File browser + previews | Planned |
| 4 | Auth wrapper + login | Planned |

---

## Questions for the Client Team

1. Are there any components we missed that should be shared?
2. Does the symlink approach work with your development/build setup?
3. Any concerns about the Phase 2 dashboard replacing your current one?
4. Do you need the auth wrapper (Phase 4) now, or can it wait?
