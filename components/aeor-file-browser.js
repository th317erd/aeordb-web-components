'use strict';

import { AeorFileBrowserBase } from './aeor-file-browser-base.js';
import { escapeHtml, escapeAttr, directionArrow, openFolder } from './aeor-file-view-shared.js';
import { elements } from '../../aeor/elements.js';
import '../../aeor/components/aeor-split-button.js';
import { getPref, mergePrefs } from '../preferences.js';

const ENTRY_TYPE_DIR = 3;

const { button: btnEl, svg: svgEl, path: pathEl, span: spanEl } = elements;
const splitBtnEl = elements['aeor-split-button'];

// Open Locally vs Open Remotely default — stored in preferences.yaml
// under `file_browser.open_default` so every front-end pointed at this
// daemon (Tauri webview, browser at localhost:9400, future CLI) agrees.
// Two valid values: 'local' (default) | 'remote'.
function _loadOpenDefault() {
  const v = getPref('file_browser.open_default', 'local');
  return (v === 'local' || v === 'remote') ? v : 'local';
}

function _saveOpenDefault(value) {
  mergePrefs({ file_browser: { open_default: value } });
}

function _encodeWildcardPath(path) {
  const clean = (path || '/').replace(/^\/+/, '');
  if (!clean) return '';
  return clean
    .split('/')
    .map((segment) => segment ? encodeURIComponent(segment) : '')
    .join('/');
}

async function _responseError(response, fallback = 'Request failed') {
  const body = await response.json().catch(() => null);
  const error = body?.error;
  if (error) {
    const upstream = error.match(/^upstream rejected \(HTTP \d+\): engine refused [^:]+:\s*(.+)$/);
    return upstream ? upstream[1] : error;
  }
  return `${fallback}: ${response.status}`;
}

// Resolve the engine-side absolute path for the tab's current view.
// Joins the relationship's remote_path with the tab's relative path,
// collapsing any redundant slashes. Returns null when the relationship
// isn't cached yet.
function _resolveRemotePath(relationships, tab) {
  if (!tab || !tab.relationship_id) return null;
  const rel = relationships.find((r) => r.id === tab.relationship_id);
  if (!rel || !rel.remote_path) return null;

  const base = rel.remote_path.replace(/\/+$/, '');
  const rest = (tab.path || '/').replace(/^\/+/, '').replace(/\/+$/, '');
  return rest ? `${base}/${rest}/` : `${base}/`;
}

function _joinRelationshipPath(basePath, relativePath, isDirectory = false) {
  const base = (basePath || '/').replace(/\/+$/, '');
  const rest = (relativePath || '/').replace(/^\/+/, '').replace(/\/+$/, '');
  const joined = rest ? `${base}/${rest}` : `${base || '/'}`;
  return isDirectory ? `${joined.replace(/\/+$/, '')}/` : joined;
}

// Mint a pre-authenticated portal URL for the given connection + engine
// path, then hand the URL to Tauri's open_external_url. The endpoint
// exchanges the connection's API key for a short-lived JWT and embeds it
// in the URL, so the browser lands already logged in.
async function _openRemotely(connectionId, remotePath) {
  if (!connectionId || !remotePath) return;
  try {
    const url = `/api/v1/connections/${encodeURIComponent(connectionId)}`
              + `/portal-url?path=${encodeURIComponent(remotePath)}`;
    const response = await fetch(url);
    if (!response.ok) {
      console.error('portal-url request failed:', response.status);
      return;
    }
    const body = await response.json();
    if (!body.url) {
      console.error('portal-url response missing url field');
      return;
    }
    const invoke = window.__TAURI_INTERNALS__?.invoke
                || window.__TAURI__?.core?.invoke;
    if (invoke) {
      invoke('open_external_url', { url: body.url })
        .catch((error) => console.warn('open_external_url failed:', error));
    } else {
      window.open(body.url, '_blank', 'noopener,noreferrer');
    }
  } catch (error) {
    console.error('Failed to open remotely:', error);
  }
}

async function _openLocalRelationshipPath(relationshipId, relationshipPath) {
  if (!relationshipId || !relationshipPath) return;
  try {
    const response = await fetch(`/api/v1/files/${encodeURIComponent(relationshipId)}/open`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: relationshipPath.replace(/^\/+/, '') }),
    });
    if (!response.ok) {
      const message = await _responseError(response, 'Open locally failed');
      throw new Error(message);
    }
  } catch (error) {
    if (window.aeorToast) {
      window.aeorToast(`Open locally failed: ${error.message}`, 'error');
    } else {
      console.error('Open locally failed:', error);
    }
  }
}

// Per-entry sync state → CSS modifier class + tooltip. Centralized so
// the dot's color and hover-text stay in lockstep when a new state is
// added (or a state is renamed in the engine's API serialization).
const _SYNC_DOT_MAP = {
  synced:       { cls: 'aeor-sync-dot--synced',     title: 'Synced'             },
  pending_push: { cls: 'aeor-sync-dot--pending',    title: 'Waiting to upload'  },
  pending_pull: { cls: 'aeor-sync-dot--pending',    title: 'Waiting to download'},
  error:        { cls: 'aeor-sync-dot--error',      title: 'Sync error'         },
  not_synced:   { cls: 'aeor-sync-dot--not-synced', title: 'Not synced'         },
};

// Feather-style folder glyph. Inline SVG so the button stays readable
// across themes (stroke=currentColor tracks the .secondary button's
// text color) and at any font scale (sized in em).
function _folderIconSvg() {
  return svgEl
    .width('1em').height('1em').viewBox('0 0 24 24')
    .fill('none').stroke('currentColor').strokeWidth('2')
    .strokeLinecap('round').strokeLinejoin('round')(
      pathEl.d('M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z')(),
    );
}

// Resolve the active relationship's local_path + the tab's current
// in-browser path to an absolute local filesystem path. Returns null
// when the relationship isn't cached yet or has no local_path. The
// tab.path is the relationship-relative path the user is viewing
// ("/" → the sync root; "/photos/2026" → that subdir).
function _resolveLocalPath(relationships, tab) {
  if (!tab || !tab.relationship_id) return null;
  const rel = relationships.find((r) => r.id === tab.relationship_id);
  if (!rel || !rel.local_path) return null;

  const base = rel.local_path.replace(/\/+$/, '');  // strip trailing slashes
  const rest = (tab.path || '/').replace(/^\/+/, '').replace(/\/+$/, '');
  return rest ? `${base}/${rest}` : base;
}

export class AeorFileBrowser extends AeorFileBrowserBase {
  constructor() {
    super();
    this._relationships = [];
    this._relationshipFileEventSources = new Map();
  }

  async connectedCallback() {
    await super.connectedCallback();
    await this._fetchRelationships();
    this._syncRelationshipFileEventStreams();
    this._connectSyncActivityStream();
    // SSE only fires on state CHANGES. If the engine recovered before we
    // subscribed (or before we mounted), no "up" event will ever arrive
    // and the error tab would stay stuck. Probe once on mount to handle
    // that race.
    this._retryUnreachableTabs();
  }

  disconnectedCallback() {
    if (super.disconnectedCallback) super.disconnectedCallback();
    if (this._syncActivitySource) {
      this._syncActivitySource.close();
      this._syncActivitySource = null;
    }
    for (const source of this._relationshipFileEventSources.values()) {
      source.close();
    }
    this._relationshipFileEventSources.clear();
  }

  // Called by aeor-app when this page becomes visible. The component
  // is kept mounted across navigation, so without this, relationships
  // created elsewhere (Sync page) wouldn't appear until full reload.
  refresh() {
    this._fetchRelationships();
    this._syncRelationshipFileEventStreams();
    // Page becoming visible is also a good moment to retry — the user
    // may have started the engine while looking at a different page.
    this._retryUnreachableTabs();
  }

  // Re-fetch any tab stuck on an upstream_unreachable banner. Called on
  // mount and on page becoming visible. The SSE listener handles ongoing
  // up/down flips; this just covers the race where the recovery already
  // happened before we were listening.
  _retryUnreachableTabs() {
    for (const tab of this._tabs || []) {
      if (tab._fetchError?.category !== 'upstream_unreachable') continue;
      if (tab.id === this._active_tab_id) {
        this._fetchListing();
      } else {
        tab._needsRefresh = true;
      }
    }
  }

  // Subscribe to the client's sync-activity SSE stream so a push or
  // pull that affected files surfaces in the open tab without a manual
  // reload. Without this, dropping files into the local sync folder
  // pushes them to the remote (good), shows a toast (good), but the
  // file-browser listing keeps showing the pre-push snapshot until the
  // user clicks back into the folder. The toast tells the user
  // something happened — the listing has to follow.
  //
  // aeor-toasts.js also subscribes to the same endpoint; we take a
  // separate connection rather than route through a shared bus because
  // EventSource auto-reconnects per instance and there's no existing
  // pub/sub layer between the two consumers. If we ever grow more
  // listeners, factor out a single shared subscription.
  _connectSyncActivityStream() {
    if (this._syncActivitySource) return;
    try {
      this._syncActivitySource = new EventSource('/api/v1/events');

      // Connection health pinger (crate::health) broadcasts on every
      // up<->down flip. We use it to auto-refresh tabs that are stuck on
      // a "Cannot reach the server" banner when the engine comes back —
      // the user doesn't have to navigate or reload.
      //
      // Only tabs in the `upstream_unreachable` error state get refreshed:
      // - upstream_server / upstream_protocol → engine reachable but
      //   something else is wrong; a connection-back signal is irrelevant.
      // - upstream_rejected → 4xx, doesn't surface a banner anyway.
      // - no error → user is browsing fine; don't churn the listing on
      //   every health-check tick.
      this._syncActivitySource.addEventListener('connection_health', (event) => {
        let data;
        try { data = JSON.parse(event.data); } catch (_) { return; }
        if (!data || !data.connection_id || data.status !== 'up') return;

        for (const tab of this._tabs || []) {
          if (!tab._fetchError) continue;
          if (tab._fetchError.category !== 'upstream_unreachable') continue;
          const rel = this._relationships.find((r) => r.id === tab.relationship_id);
          if (!rel || rel.remote_connection_id !== data.connection_id) continue;

          if (tab.id === this._active_tab_id) {
            this._fetchListing();
          } else {
            // Background tab: mark stale; it re-fetches on activation.
            tab._needsRefresh = true;
          }
        }
      });

      this._syncActivitySource.addEventListener('sync_activity', (event) => {
        let data;
        try { data = JSON.parse(event.data); } catch (_) { return; }
        if (!data || !data.relationship_id) return;

        // Refresh only when files actually moved. A "0 pulled, 0 pushed"
        // heartbeat-style event would otherwise re-fetch every cycle for
        // no UI change. The numeric field reflects pulled + deleted +
        // symlinks-affected on the backend (sync/activity.rs::log_pull
        // and log_full_sync), so non-zero means the listing has new
        // content to show.
        if ((data.files_affected || 0) === 0) return;
        if (this._relationshipFileEventSources.has(data.relationship_id)) return;

        // Refresh every open tab matching the affected relationship. Active
        // tabs get a coalesced background refresh that diffs rows/cards in
        // place; background tabs are marked stale and refresh on activation.
        for (const tab of this._tabs || []) {
          if (tab.relationship_id !== data.relationship_id) continue;
          if (tab.id === this._active_tab_id) {
            this._scheduleBackgroundListingRefresh(tab);
          } else {
            // Background tab: mark stale; it'll re-fetch on activation.
            tab._needsRefresh = true;
          }
        }
      });
      // EventSource reconnects automatically on transient failures.
      // The onerror handler exists only to suppress noisy console
      // warnings during normal reconnects — log nothing.
      this._syncActivitySource.onerror = () => {};
    } catch (error) {
      console.warn('sync-activity stream unavailable:', error);
    }
  }

  _syncRelationshipFileEventStreams() {
    const relationshipIds = new Set(
      (this._tabs || [])
        .map((tab) => tab.relationship_id)
        .filter(Boolean),
    );

    for (const relationshipId of relationshipIds) {
      this._ensureRelationshipFileEventStream(relationshipId);
    }

    for (const [relationshipId, source] of this._relationshipFileEventSources.entries()) {
      if (relationshipIds.has(relationshipId)) continue;
      source.close();
      this._relationshipFileEventSources.delete(relationshipId);
    }
  }

  _ensureRelationshipFileEventStream(relationshipId) {
    if (!relationshipId || this._relationshipFileEventSources.has(relationshipId)) return;

    try {
      const url = `/api/v1/sync/${encodeURIComponent(relationshipId)}/file-events`;
      const source = new EventSource(url);
      source.addEventListener('entries_created', (event) => {
        this._handleRelationshipFileEvent(relationshipId, event);
      });
      source.addEventListener('entries_deleted', (event) => {
        this._handleRelationshipFileEvent(relationshipId, event);
      });
      source.addEventListener('upstream_error', () => {
        // EventSource reconnects automatically; keep sync_activity as a
        // coarse fallback only if this stream could not be established.
      });
      source.onerror = () => {};
      this._relationshipFileEventSources.set(relationshipId, source);
    } catch (error) {
      console.warn('relationship file-event stream unavailable:', error);
    }
  }

  _handleRelationshipFileEvent(relationshipId, event) {
    let data;
    try { data = JSON.parse(event.data); } catch (_) { return; }
    if (!data || data.relationship_id !== relationshipId || !data.path) return;

    for (const tab of this._tabs || []) {
      if (tab.relationship_id !== relationshipId) continue;
      if (!this._fileEventAffectsTab(tab, data.path)) continue;

      if (tab.id === this._active_tab_id) {
        this._scheduleBackgroundListingRefresh(tab, 250);
      } else {
        tab._needsRefresh = true;
      }
    }
  }

  _fileEventAffectsTab(tab, path) {
    const eventPath = this._normalizeFileEventPath(path);
    const tabPath = this._normalizeDirectoryPath(tab && tab.path);
    if (!eventPath || !tabPath) return false;
    if (tabPath === '/') return eventPath.startsWith('/');
    return eventPath === tabPath.slice(0, -1) || eventPath.startsWith(tabPath);
  }

  _normalizeFileEventPath(path) {
    let normalized = String(path || '').trim();
    if (!normalized) return null;
    if (!normalized.startsWith('/')) normalized = '/' + normalized;
    return normalized.replace(/\/+/g, '/');
  }

  _normalizeDirectoryPath(path) {
    let normalized = String(path || '/').trim();
    if (!normalized) normalized = '/';
    if (!normalized.startsWith('/')) normalized = '/' + normalized;
    normalized = normalized.replace(/\/+/g, '/');
    if (!normalized.endsWith('/')) normalized += '/';
    return normalized;
  }

  // ---------------------------------------------------------------------------
  // Abstract method implementations
  // ---------------------------------------------------------------------------

  async browse(path, limit, offset) {
    const tab = this._activeTab();
    if (!tab) throw new Error('No active tab');
    const encodedPath = _encodeWildcardPath(path);
    const baseUrl = encodedPath
      ? `/api/v1/browse/${tab.relationship_id}/${encodedPath}`
      : `/api/v1/browse/${tab.relationship_id}`;
    const url = `${baseUrl}?limit=${limit}&offset=${offset}`;
    const response = await fetch(url);
    if (!response.ok) {
      // Parse the structured error body so the render path can branch
      // on `category` (upstream_unreachable / upstream_server /
      // upstream_protocol / upstream_rejected) and show an accurate
      // message instead of conflating connection-refused with "server
      // denied access." Body shape comes from ClientError::into_response
      // in aeordb-client-lib/src/error.rs.
      let body = null;
      try { body = await response.json(); } catch (_) { /* non-JSON */ }
      const err = new Error(
        (body && body.error) || `Request failed: ${response.status}`,
      );
      err.status   = response.status;
      err.category = (body && body.category) || null;
      throw err;
    }
    return response.json();
  }

  async search(query, limit, offset) {
    const tab = this._activeTab();
    if (!tab) throw new Error('No active tab');
    const response = await fetch(`/api/v1/search/${tab.relationship_id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query,
        limit: limit || 100,
        offset: offset || 0,
      }),
    });
    if (!response.ok) {
      let body = null;
      try { body = await response.json(); } catch (_) { /* non-JSON */ }
      const err = new Error(
        (body && body.error) || `Search failed: ${response.status}`,
      );
      err.status   = response.status;
      err.category = (body && body.category) || null;
      throw err;
    }
    const data = await response.json();
    return {
      entries: (data.entries || []).map((entry) => ({
        ...entry,
        _actual_path: entry.path,
        _search_path_label: entry.display_path,
      })),
      total: (data.total != null) ? data.total : (data.entries || []).length,
    };
  }

  fileUrl(path) {
    const tab = this._activeTab();
    if (!tab) return '#';
    const encodedPath = _encodeWildcardPath(path);
    return encodedPath
      ? `/api/v1/files/${tab.relationship_id}/${encodedPath}`
      : `/api/v1/files/${tab.relationship_id}`;
  }

  async upload(path, body, contentType) {
    const response = await fetch(this.fileUrl(path), {
      method: 'PUT',
      headers: { 'Content-Type': contentType },
      body,
    });
    if (!response.ok) throw new Error(`Upload failed: ${response.status}`);
  }

  async deletePath(path) {
    const response = await fetch(this.fileUrl(path), { method: 'DELETE' });
    if (!response.ok) throw new Error(`Delete failed: ${response.status}`);
  }

  async renamePath(fromPath, toPath) {
    const tab = this._activeTab();
    if (!tab) throw new Error('No active tab');
    const response = await fetch(`/api/v1/files/${tab.relationship_id}/rename`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: fromPath, to: toPath }),
    });
    if (!response.ok) throw new Error(`Rename failed: ${response.status}`);
  }

  async readFile(path) {
    const tab = this._activeTab();
    if (!tab) return null;
    const encodedPath = _encodeWildcardPath(path);
    const response = await fetch(
      encodedPath
        ? `/api/v1/files/${tab.relationship_id}/${encodedPath}`
        : `/api/v1/files/${tab.relationship_id}`,
    );
    if (!response.ok) return null;
    return response.text();
  }

  openNewTab() {
    // Show the relationship selector
    this._active_tab_id = null;
    this.render();
  }

  // ---------------------------------------------------------------------------
  // Hook overrides
  // ---------------------------------------------------------------------------

  renderNoTabContent() {
    return this._renderRelationshipSelector();
  }

  rootLabel() {
    const tab = this._activeTab();
    return (tab && tab.relationship_name) ? tab.relationship_name : 'Database';
  }

  // Render a small colored sync-state dot for each entry. Desktop
  // client only; the portal subclass inherits the base's null default
  // so its file rows stay dot-free.
  //
  // For DIRECTORIES, entry.sync_status comes back from the backend as
  // a rollup of all descendants (see folder_rollup_status in
  // aeordb-client-lib/src/api/routes/files.rs). So a directory whose
  // subtree has any erroring file shows red; any in-flight file shows
  // yellow; otherwise the directory follows the most accurate
  // synced/not-synced state available. No client-side branching
  // needed — the same _SYNC_DOT_MAP entry serves both.
  //
  // Colors (driven by entry.sync_status from the backend):
  //   green  → synced
  //   yellow → pending_push / pending_pull (queued for sync)
  //   red    → error
  //   gray   → not_synced  (also the unknown-state fallback)
  //
  // The dot is a single span; CSS in main.css gives it size and the
  // per-state background color. The `title` attribute supplies the
  // hover tooltip so the meaning is discoverable without a legend.
  syncStatusIndicator(entry) {
    if (!entry) return null;
    const key  = entry.sync_status;
    const meta = _SYNC_DOT_MAP[key] || _SYNC_DOT_MAP.not_synced;
    return spanEl
      .class(`aeor-sync-dot ${meta.cls}`)
      .title(meta.title)
      .ariaLabel(meta.title)()
      .build(document);
  }

  // Inject an "Open Locally / Open Remotely" split-button into the
  // directory toolbar (to the left of Snapshot / New Folder / Upload).
  // The chevron opens a dropdown with two mutually-exclusive radios; the
  // primary button executes the currently-selected mode and its label
  // tracks the selection. Default mode persists in localStorage under
  // `aeor-file-browser:open-default`.
  //
  //   Open Locally  — POST /api/v1/open-folder, which reveals the path
  //                   in Nautilus / Finder / Explorer. Endpoint has its
  //                   own absolute/exists/is_dir guards, so we don't
  //                   repeat them.
  //   Open Remotely — GET /api/v1/connections/{id}/portal-url?path=…,
  //                   then Tauri open_external_url. The endpoint mints
  //                   a short-lived JWT from the connection's API key,
  //                   so the browser lands already logged in.
  //
  // Skipped (returns null) when the tab has no relationship_id yet
  // (e.g. the "pick a relationship" interstitial). The portal subclass
  // doesn't override directoryActions and inherits the base's null
  // default, so this only renders in the desktop client.
  directoryActions(tab) {
    if (!tab || !tab.relationship_id) return null;
    const rel = this._relationships.find((r) => r.id === tab.relationship_id);
    if (!rel) return null;

    const connectionId = rel.remote_connection_id || null;

    const initial = _loadOpenDefault();

    const btn = splitBtnEl
      .class('directory-actions-open')
      .title('Open the current folder (Locally or Remotely)')
      .build(document);

    btn.setItems([
      { id: 'local',  label: 'Open Locally',  type: 'radio', checked: initial === 'local'  },
      { id: 'remote', label: 'Open Remotely', type: 'radio', checked: initial === 'remote' },
    ]);

    btn.addEventListener('item-change', (event) => {
      const id = event.detail?.id;
      if (id === 'local' || id === 'remote') _saveOpenDefault(id);
    });

    btn.addEventListener('primary-click', (event) => {
      const id = event.detail?.id || _loadOpenDefault();
      const target = this._openTargetForTab(tab);
      if (id === 'remote') {
        const remotePath = target
          ? _joinRelationshipPath(rel.remote_path, target.path, target.isDirectory)
          : _resolveRemotePath(this._relationships, tab);
        _openRemotely(connectionId, remotePath);
      } else {
        if (target) {
          _openLocalRelationshipPath(tab.relationship_id, target.path);
        } else {
          const localPath = _resolveLocalPath(this._relationships, tab);
          if (localPath) openFolder(localPath);
        }
      }
    });

    return btn;
  }

  _openTargetForTab(tab) {
    if (!tab) return null;
    const allEntries = [...(tab.entries || []), ...(tab._deletedEntries || [])];
    const selectedPaths = [...(tab.selectedEntries || [])];
    let selectedPath = null;

    if (selectedPaths.length === 1) {
      selectedPath = selectedPaths[0];
    } else if (selectedPaths.length === 0 && tab.preview_entry) {
      selectedPath = this._entryPath(tab, tab.preview_entry);
    }

    if (!selectedPath) return null;
    const entry = allEntries.find((candidate) => this._entryPath(tab, candidate) === selectedPath)
      || (tab.preview_entry && this._entryPath(tab, tab.preview_entry) === selectedPath ? tab.preview_entry : null);
    if (!entry) return null;
    return {
      entry,
      path: selectedPath,
      isDirectory: entry.entry_type === ENTRY_TYPE_DIR,
    };
  }

  // Override _saveState to persist relationship metadata
  _saveState() {
    try {
      const serializable_tabs = this._tabs.map((tab) => ({
        id:                tab.id,
        name:              tab.name,
        path:              tab.path,
        view_mode:         tab.view_mode,
        page_size:         tab.page_size,
        preview_height:    tab.preview_height,
        search_query:      tab.search_query || '',
        search_origin_path: tab.search_origin_path || null,
        relationship_id:   tab.relationship_id,
        relationship_name: tab.relationship_name,
      }));
      mergePrefs({
        file_browser: {
          tabs:          serializable_tabs,
          active_tab_id: this._active_tab_id,
          tab_counter:   this._tab_counter,
        },
      });
    } catch (error) {
      // preferences unavailable
    }
  }

  // ---------------------------------------------------------------------------
  // Client-specific: relationship selector
  // ---------------------------------------------------------------------------

  async _fetchRelationships() {
    try {
      const response = await fetch('/api/v1/sync');
      if (!response.ok) throw new Error(`Request failed: ${response.status}`);
      this._relationships = await response.json();
      this._syncRelationshipFileEventStreams();
      if (!this._active_tab_id) this.render();
    } catch (error) {
      console.error('Failed to fetch relationships:', error);
    }
  }

  _renderRelationshipSelector() {
    if (this._relationships.length === 0) {
      return '<div class="empty-state">No sync relationships configured. Set up a sync first.</div>';
    }

    const cards = this._relationships.map((rel) => {
      const remoteName = rel.remote_path.replace(/\/$/, '').split('/').pop() || rel.remote_path;
      const localName = rel.local_path.split('/').pop() || rel.local_path;
      const arrow = directionArrow(rel.direction);
      const displayName = rel.name || `${remoteName} ${arrow} ${localName}`;

      return `
        <div class="relationship-card" data-id="${rel.id}" data-name="${escapeAttr(displayName)}">
          <div class="relationship-card-name">${escapeHtml(displayName)}</div>
          <div class="relationship-card-paths">${escapeHtml(rel.remote_path)} ${arrow} ${escapeHtml(rel.local_path)}</div>
        </div>
      `;
    }).join('');

    return `<div class="relationship-grid">${cards}</div>`;
  }

  // Override _bindShellEvents to add relationship card click handlers
  _bindShellEvents() {
    super._bindShellEvents();

    this.querySelectorAll('.relationship-card').forEach((card) => {
      card.addEventListener('click', () => {
        this._openTab(card.dataset.id, card.dataset.name);
      });
    });
  }

  // Override _openTab to set relationship_id BEFORE _fetchListing runs.
  // The base class creates the tab and immediately calls _fetchListing(),
  // which needs relationship_id to build the API URL. So we inject it
  // into the tab object right after creation, before the fetch.
  _openTab(relationshipId, relationshipName) {
    this._tab_counter++;
    const tabId = 'tab-' + this._tab_counter;
    this._tabs.push({
      id:                tabId,
      name:              relationshipName || tabId,
      path:              '/',
      view_mode:         'list',
      entries:           [],
      total:             null,
      loading:           false,
      loading_more:      false,
      page_size:         100,
      preview_entry:     null,
      preview_component: null,
      preview_height:    null,
      search_query:      '',
      search_origin_path: null,
      selectedEntries:   new Set(),
      lastSelectedAnchor: null,
      relationship_id:   relationshipId,
      relationship_name: relationshipName,
    });
    this._active_tab_id = tabId;
    this._saveState();
    this.render();
    this._syncRelationshipFileEventStreams();

    // Fetch directly using raw fetch() instead of this.browse() or
    // this._fetchListing(). Both of those hang when called from a
    // click handler context that just triggered render() (innerHTML
    // destruction breaks the async promise resolution chain).
    const newTab = this._activeTab();
    if (newTab) {
      const rid = newTab.relationship_id;
      const url = `/api/v1/browse/${rid}?limit=${newTab.page_size || 100}&offset=0`;
      const self = this;
      fetch(url)
        .then(function (response) { return response.json(); })
        .then(function (data) {
          newTab.entries = data.entries || [];
          newTab.total = (data.total != null) ? data.total : newTab.entries.length;
          newTab.loading = false;
          self._updateTabContent(newTab.id);
          self._attachScrollListener();
        })
        .catch(function (error) {
          console.error('Failed to fetch listing:', error);
          newTab.entries = [];
          newTab.loading = false;
          self._updateTabContent(newTab.id);
        });
    }
  }

  _closeTab(tabId) {
    super._closeTab(tabId);
    this._syncRelationshipFileEventStreams();
  }

  // ---------------------------------------------------------------------------
  // Client-specific: drag-out to OS
  // ---------------------------------------------------------------------------

  _bindTabContentEvents(tabId) {
    super._bindTabContentEvents(tabId);

    const container = this.querySelector(`#tab-content-${tabId}`);
    if (!container) return;
    const tab = this._tabs.find((t) => t.id === tabId);
    if (!tab) return;

    // Make file entries draggable
    container.querySelectorAll('.file-entry').forEach((el) => {
      const entryType = parseInt(el.dataset.type, 10);
      if (entryType === ENTRY_TYPE_DIR) return;

      el.setAttribute('draggable', 'true');
      el.addEventListener('dragstart', (event) => {
        const entryPath = this._entryPathFromElement(tab, el);
        const entry = tab.entries.find((e) => this._entryPath(tab, e) === entryPath)
          || tab.entries.find((e) => e.name === el.dataset.name);
        if (!entry) return;

        const filePath = this._entryPath(tab, entry);
        const fullUrl = `${window.location.origin}${this.fileUrl(filePath)}`;
        const mimeType = entry.content_type || 'application/octet-stream';

        event.dataTransfer.setData('DownloadURL', `${mimeType}:${entry.name}:${fullUrl}`);
        event.dataTransfer.setData('text/uri-list', fullUrl);
        event.dataTransfer.effectAllowed = 'copy';

        this.dispatchEvent(new CustomEvent('file-drag-start', {
          bubbles: true,
          detail: {
            entry,
            path: filePath,
            url: fullUrl,
            isDirectory: false,
          },
        }));
      });
    });
  }

  // ---------------------------------------------------------------------------
  // Share method implementations
  // ---------------------------------------------------------------------------

  async getShares(path) {
    const tab = this._activeTab();
    if (!tab) return { shares: [] };
    const response = await fetch(`/api/v1/shares/${tab.relationship_id}?path=${encodeURIComponent(path)}`);
    if (!response.ok) throw new Error(`${response.status}`);
    return response.json();
  }

  async share(paths, users, groups, permissions) {
    const tab = this._activeTab();
    if (!tab) throw new Error('No active tab');
    const response = await fetch(`/api/v1/shares/${tab.relationship_id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paths, users, groups, permissions }),
    });
    if (!response.ok) throw new Error(`${response.status}`);
  }

  async unshare(path, group, pathPattern) {
    const tab = this._activeTab();
    if (!tab) throw new Error('No active tab');
    const response = await fetch(`/api/v1/shares/${tab.relationship_id}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, group, path_pattern: pathPattern }),
    });
    if (!response.ok) throw new Error(`${response.status}`);
  }

  async getShareableUsers() {
    const tab = this._activeTab();
    if (!tab) return [];
    const response = await fetch(`/api/v1/shares/${tab.relationship_id}/users`);
    if (!response.ok) return [];
    const data = await response.json();
    return data.items || [];
  }

  async getShareableGroups() {
    const tab = this._activeTab();
    if (!tab) return [];
    const response = await fetch(`/api/v1/shares/${tab.relationship_id}/groups`);
    if (!response.ok) return [];
    const data = await response.json();
    return data.items || [];
  }

  async createShareLink(paths, permissions, expiresInDays) {
    const tab = this._activeTab();
    if (!tab) throw new Error('No active tab');
    // Note: base_url is injected server-side by the proxy from connection config
    const response = await fetch(`/api/v1/shares/${tab.relationship_id}/link`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paths, permissions, expires_in_days: expiresInDays }),
    });
    if (!response.ok) throw new Error(await _responseError(response, 'Create link failed'));
    return response.json();
  }

  async getShareLinks(path) {
    const tab = this._activeTab();
    if (!tab) return { links: [] };
    const response = await fetch(`/api/v1/shares/${tab.relationship_id}/links?path=${encodeURIComponent(path)}`);
    if (!response.ok) return { links: [] };
    return response.json();
  }

  async revokeShareLink(keyId) {
    const tab = this._activeTab();
    if (!tab) throw new Error('No active tab');
    const response = await fetch(`/api/v1/shares/${tab.relationship_id}/links/${encodeURIComponent(keyId)}`, {
      method: 'DELETE',
    });
    if (!response.ok) throw new Error(await _responseError(response, 'Revoke link failed'));
  }

  // ---------------------------------------------------------------------------
  // Hook overrides for share UI
  // ---------------------------------------------------------------------------

  previewActions(entry) {
    return `
      ${this._hasPermission('y', entry) ? '<button class="secondary small" data-action="share">Share</button>' : ''}
      <button class="secondary small" data-action="open-local">Open Locally</button>
      <button class="primary small" data-action="download">Download</button>
    `;
  }

  selectionActions(tab) {
    return `
      ${this._hasPermission('y') ? '<button class="secondary small selection-share">Share</button>' : ''}
    `;
  }

  _bindSelectionBarExtra(selectionBar, tab) {
    const shareBtn = selectionBar.querySelector('.selection-share');
    if (shareBtn) {
      shareBtn.addEventListener('click', () => {
        const paths = [...tab.selectedEntries];
        if (paths.length > 0) this._showShareModal(paths);
      });
    }
  }

  // Client-specific: "Open Locally" in preview actions
  _handlePreviewAction(action) {
    if (action === 'open-local') {
      const tab = this._activeTab();
      if (!tab || !tab.preview_entry) return;
      const filePath = this._entryPath(tab, tab.preview_entry);
      _openLocalRelationshipPath(tab.relationship_id, filePath);
      return;
    }
    super._handlePreviewAction(action);
  }

  // ---------------------------------------------------------------------------
  // Engine UI parity — methods the portal subclass implements that the
  // client subclass also needs. Each forwards to a client-lib proxy route
  // (`/api/v1/...`) which resolves the relationship_id to a connection +
  // absolute remote path before hitting the engine. See
  // aeordb-client-lib/src/api/routes/files.rs (handlers) and
  // aeordb-client-lib/src/remote/mod.rs (engine calls).
  //
  // All calls go through `_relApi` below, which handles the active-tab
  // guard, body serialization, and error→Error mapping. Read methods that
  // want a "return [] on error" semantic wrap the call in try/catch;
  // write methods let the throw propagate.
  // ---------------------------------------------------------------------------

  /**
   * Fetch a relationship-scoped client API.
   *
   * - Throws `Error('no active tab')` if there's no relationship_id on the
   *   active tab (no relationship picked yet, or no tabs at all).
   * - Sets Content-Type and JSON.stringifies `body` when provided.
   * - Throws `Error(msg)` on non-2xx, preferring the server's `error`
   *   field from a JSON body, falling back to `HTTP {status}`.
   * - Returns parsed JSON, or `{}` for empty 2xx responses.
   *
   * `urlBuilder` is a function (relationship_id) → URL — callers compose
   * the URL with the rel_id at whatever path position the route uses.
   */
  async _relApi(method, urlBuilder, body) {
    const tab = this._activeTab();
    if (!tab || !tab.relationship_id) throw new Error('no active tab');

    const init = { method, headers: {} };
    if (body !== undefined && body !== null) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }

    const response = await fetch(urlBuilder(tab.relationship_id), init);
    if (!response.ok) {
      let msg = `HTTP ${response.status}`;
      try {
        const err = await response.json();
        if (err && err.error) msg = err.error;
      } catch (_) { /* non-JSON */ }
      throw new Error(msg);
    }

    const text = await response.text();
    if (!text) return {};
    try { return JSON.parse(text); }
    catch (_) { return {}; }
  }

  async _fetchDeleted(dirPath) {
    try {
      const data = await this._relApi('GET',
        (rel) => `/api/v1/browse/${rel}/deleted?path=${encodeURIComponent(dirPath)}`);
      return data.items || [];
    } catch (_) { return []; }
  }

  async _restoreFile(filePath) {
    await this._relApi('POST',
      (rel) => `/api/v1/files/${rel}/restore`,
      { path: filePath });
  }

  async _fetchVersionHistory(filePath) {
    try {
      const cleanPath = filePath.replace(/^\//, '');
      const data = await this._relApi('GET',
        (rel) => `/api/v1/versions/${rel}/history/${cleanPath}`);
      return data.history || [];
    } catch (_) { return []; }
  }

  async _fetchSnapshotList() {
    try {
      const data = await this._relApi('GET',
        (rel) => `/api/v1/snapshots/${rel}`);
      const items = data.items || [];
      // Same shape as the portal returns — version-history-style entries
      // sorted newest-first.
      return items
        .sort((a, b) => b.created_at - a.created_at)
        .map((s, idx) => ({
          snapshot:     s.name,
          id:           s.id,
          timestamp:    s.created_at,
          change_type:  idx === 0 ? 'added' : 'modified',
          size:         null,
          content_type: null,
          content_hash: s.root_hash,
        }));
    } catch (_) { return []; }
  }

  async _createSnapshot(name) {
    await this._relApi('POST',
      (rel) => `/api/v1/snapshots/${rel}`,
      { name });
  }

  async _restoreFromSnapshot(filePath, snapshotId) {
    await this._relApi('POST',
      (rel) => `/api/v1/snapshots/${rel}/${encodeURIComponent(snapshotId)}/restore`,
      { path: filePath });
  }

  async _pasteAsCopy(paths, destination) {
    await this._relApi('POST',
      (rel) => `/api/v1/files/${rel}/copy`,
      { paths, destination });
  }

  // Move = rename one at a time. Mirrors the portal's approach exactly so
  // a future engine-side bulk-move endpoint can be wired into both
  // subclasses by the same diff.
  async _pasteAsMove(paths, destination) {
    for (const srcPath of paths) {
      const name = srcPath.split('/').pop();
      const toPath = destination.replace(/\/$/, '') + '/' + name;
      await this.renamePath(srcPath, toPath);
    }
  }

  async _createSymlink(path, target) {
    await this._relApi('POST',
      (rel) => `/api/v1/files/${rel}/symlink`,
      { path, target });
  }
}

customElements.define('aeor-file-browser', AeorFileBrowser);
