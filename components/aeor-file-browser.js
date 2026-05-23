'use strict';

import { AeorFileBrowserBase } from './aeor-file-browser-base.js';
import { escapeHtml, escapeAttr, directionArrow, openFolder } from './aeor-file-view-shared.js';
import { elements } from '../../aeor/elements.js';

const ENTRY_TYPE_DIR = 3;

const { button: btnEl, svg: svgEl, path: pathEl, span: spanEl } = elements;

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
  }

  connectedCallback() {
    super.connectedCallback();
    this._fetchRelationships();
  }

  // Called by aeor-app when this page becomes visible. The component
  // is kept mounted across navigation, so without this, relationships
  // created elsewhere (Sync page) wouldn't appear until full reload.
  refresh() {
    this._fetchRelationships();
  }

  // ---------------------------------------------------------------------------
  // Abstract method implementations
  // ---------------------------------------------------------------------------

  async browse(path, limit, offset) {
    const tab = this._activeTab();
    if (!tab) throw new Error('No active tab');
    const encodedPath = (path === '/') ? '' : encodeURIComponent(path);
    const baseUrl = encodedPath
      ? `/api/v1/browse/${tab.relationship_id}/${encodedPath}`
      : `/api/v1/browse/${tab.relationship_id}`;
    const url = `${baseUrl}?limit=${limit}&offset=${offset}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Request failed: ${response.status}`);
    return response.json();
  }

  fileUrl(path) {
    const tab = this._activeTab();
    if (!tab) return '#';
    return `/api/v1/files/${tab.relationship_id}/${encodeURIComponent(path)}`;
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
    const response = await fetch(`/api/v1/files/${tab.relationship_id}/${encodeURIComponent(path)}`);
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

  // Inject an "Open Locally" button into the directory toolbar, to
  // the left of Snapshot / New Folder / Upload. Reveals the current
  // tab path in the OS file manager (Nautilus / Finder / Explorer)
  // via the openFolder() helper (POST /api/v1/open-folder on the
  // local aeordb-client). That endpoint has its own absolute/exists/
  // is_dir guards, so we don't repeat them here.
  //
  // Skipped (returns null) when:
  //   - the tab has no relationship_id yet (e.g. the "pick a
  //     relationship" interstitial)
  //   - the cached relationship has no local_path (defensive — every
  //     real relationship has one, but the cache could be stale)
  //
  // We DON'T gate on whether the local folder exists — if a pull-only
  // relationship hasn't synced yet, the endpoint will 404 and the
  // openFolder helper logs to the console. We also don't gate on
  // Tauri being present: the HTTP endpoint runs server-side regardless,
  // and the aeordb-client always serves it. The portal subclass
  // doesn't override directoryActions and inherits the base's null
  // default, so this only renders for the desktop client.
  directoryActions(tab) {
    const localPath = _resolveLocalPath(this._relationships, tab);
    if (!localPath) return null;

    return btnEl
      .class('secondary small open-locally-button')
      .title(`Open ${localPath} in the system file manager`)
      .dataPath(localPath)
      .onClick((event) => {
        event.preventDefault();
        const path = event.currentTarget.dataset.path;
        if (path) openFolder(path);
      })(
        _folderIconSvg(),
        'Open Locally',
      ).build(document);
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
        relationship_id:   tab.relationship_id,
        relationship_name: tab.relationship_name,
      }));
      localStorage.setItem('aeordb-file-browser', JSON.stringify({
        tabs:          serializable_tabs,
        active_tab_id: this._active_tab_id,
        tab_counter:   this._tab_counter,
      }));
    } catch (error) {
      // localStorage unavailable
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
      selectedEntries:   new Set(),
      lastSelectedAnchor: null,
      relationship_id:   relationshipId,
      relationship_name: relationshipName,
    });
    this._active_tab_id = tabId;
    this._saveState();
    this.render();

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
        const entry = tab.entries.find((e) => e.name === el.dataset.name);
        if (!entry) return;

        const filePath = tab.path.replace(/\/$/, '') + '/' + entry.name;
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
    if (!response.ok) throw new Error(`${response.status}`);
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
    if (!response.ok) throw new Error(`${response.status}`);
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
      const filePath = tab.path.replace(/\/$/, '') + '/' + tab.preview_entry.name;
      fetch(`/api/v1/files/${tab.relationship_id}/open`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: filePath.replace(/^\//, '') }),
      });
      return;
    }
    super._handlePreviewAction(action);
  }
}

customElements.define('aeor-file-browser', AeorFileBrowser);
