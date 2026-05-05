'use strict';

import {
  formatSize, formatDate, fileIcon, fileExtension,
  escapeHtml, escapeAttr, isImageFile, isVideoFile, isAudioFile,
  flashButton, ENTRY_TYPE_DIR,
} from './aeor-file-view-shared.js';
import './aeor-modal.js';
import './aeor-confirm-button.js';
import './aeor-info-box.js';
import './aeor-tab-view.js';

// File type icon SVGs for grid view thumbnails (non-image files).
// Each returns an SVG string sized for the grid card icon area.
const _FILE_ICONS = {
  folder: '<span>&#128193;</span>',
  video: '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#8b5cf6" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="20" rx="2.18"/><path d="M10 8l6 4-6 4z"/></svg>',
  audio: '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#06b6d4" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>',
  pdf: '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><text x="8" y="17" font-size="6" fill="#ef4444" stroke="none" font-weight="bold">PDF</text></svg>',
  code: '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#3fb950" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>',
  text: '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#8b949e" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><line x1="10" y1="9" x2="8" y2="9"/></svg>',
  archive: '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#d29922" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/></svg>',
  file: '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#8b949e" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>',
};

function _fileTypeIcon(entry) {
  if (entry.entry_type === 3) return _FILE_ICONS.folder;
  if (entry.entry_type === 8) return _FILE_ICONS.file; // symlink
  const ext = fileExtension(entry.name);
  if (isVideoFile(entry.name)) return _FILE_ICONS.video;
  if (isAudioFile(entry.name)) return _FILE_ICONS.audio;
  if (ext === 'pdf') return _FILE_ICONS.pdf;
  if (['zip','tar','gz','bz2','7z','rar','xz','zst'].includes(ext)) return _FILE_ICONS.archive;
  if (['js','ts','py','rs','go','java','c','cpp','h','rb','php','sh','css','html','xml','json','yaml','yml','toml','md','sql'].includes(ext)) return _FILE_ICONS.code;
  if (['txt','log','csv','tsv','ini','cfg','conf'].includes(ext)) return _FILE_ICONS.text;
  return _FILE_ICONS.file;
}

// Content types that should be routed to an existing preview component
// instead of relying on the dynamic import cascade.
const PREVIEW_OVERRIDES = {
  'application/json':       'aeor-preview-text',
  'application/xml':        'aeor-preview-text',
  'application/yaml':       'aeor-preview-text',
  'application/javascript': 'aeor-preview-text',
  'application/typescript':  'aeor-preview-text',
  'application/x-sh':       'aeor-preview-text',
  'application/sql':        'aeor-preview-text',
  'application/toml':       'aeor-preview-text',
  'application/pdf':        'aeor-preview-pdf',
};

async function loadPreviewComponent(contentType) {
  if (!contentType) return 'aeor-preview-default';

  // Check explicit overrides first
  if (PREVIEW_OVERRIDES[contentType]) {
    const name = PREVIEW_OVERRIDES[contentType];
    try {
      await import(`./previews/${name}.js`);
      if (customElements.get(name)) return name;
    } catch (error) {
      // fall through to normal cascade
    }
  }

  const [group, subtype] = contentType.split('/');
  const sanitizedSubtype = (subtype || '').replace(/[^a-z0-9]/g, '-');
  const exact = `aeor-preview-${group}-${sanitizedSubtype}`;
  const grouped = `aeor-preview-${group}`;

  // Tier 1: exact mime type component
  try {
    await import(`./previews/${exact}.js`);
    if (customElements.get(exact)) return exact;
  } catch (error) {
    console.warn(`Preview component load failed for ${exact}:`, error);
  }

  // Tier 2: group component
  try {
    await import(`./previews/${grouped}.js`);
    if (customElements.get(grouped)) return grouped;
  } catch (error) {
    console.warn(`Preview component load failed for ${grouped}:`, error);
  }

  // Tier 3: default fallback
  try {
    await import('./previews/aeor-preview-default.js');
  } catch (error) {
    console.warn('Default preview component load failed:', error);
  }

  return 'aeor-preview-default';
}

// AeorFileBrowserBase — abstract base class for file browser components.
// All data access goes through abstract methods that subclasses must implement.
class AeorFileBrowserBase extends HTMLElement {
  constructor() {
    super();
    this._tabs = [];
    this._active_tab_id = null;
    this._tab_counter = 0;
    this._scroll_listener = null;
    this._showHidden = false;
    this._sortField = 'name';
    this._sortOrder = 'asc';
  }

  // -------------------------------------------------------------------------
  // Abstract methods — subclasses MUST implement these
  // -------------------------------------------------------------------------

  // browse(path, limit, offset) → { entries: [...], total: N }
  async browse(path, limit, offset) {
    throw new Error('AeorFileBrowserBase.browse() must be implemented by subclass');
  }

  // fileUrl(path) → string URL for thumbnails, preview src, etc.
  fileUrl(path) {
    throw new Error('AeorFileBrowserBase.fileUrl() must be implemented by subclass');
  }

  // upload(path, body, contentType)
  async upload(path, body, contentType) {
    throw new Error('AeorFileBrowserBase.upload() must be implemented by subclass');
  }

  // deletePath(path)
  async deletePath(path) {
    throw new Error('AeorFileBrowserBase.deletePath() must be implemented by subclass');
  }

  // renamePath(fromPath, toPath)
  async renamePath(fromPath, toPath) {
    throw new Error('AeorFileBrowserBase.renamePath() must be implemented by subclass');
  }

  // openNewTab() — what happens when "+" is clicked
  openNewTab() {
    throw new Error('AeorFileBrowserBase.openNewTab() must be implemented by subclass');
  }

  // createDirectory(path) — create an empty directory
  async createDirectory(path) {
    throw new Error('AeorFileBrowserBase.createDirectory() must be implemented by subclass');
  }

  // readFile(path) → string|null — read a file's text content
  async readFile(path) {
    throw new Error('AeorFileBrowserBase.readFile() must be implemented by subclass');
  }

  // getShares(path) → array of current share entries for a path
  async getShares(path) {
    throw new Error('AeorFileBrowserBase.getShares() must be implemented by subclass');
  }

  // share(paths, users, groups, permissions) — grant access
  async share(paths, users, groups, permissions) {
    throw new Error('AeorFileBrowserBase.share() must be implemented by subclass');
  }

  // unshare(path, group, pathPattern) — revoke access
  async unshare(path, group, pathPattern) {
    throw new Error('AeorFileBrowserBase.unshare() must be implemented by subclass');
  }

  // getShareableUsers() → array of users that can receive shares
  async getShareableUsers() { return []; }

  // getShareableGroups() → array of groups that can receive shares
  async getShareableGroups() { return []; }

  // createShareLink(paths, permissions, expiresInDays) → { url, key_id, ... }
  async createShareLink(paths, permissions, expiresInDays) {
    throw new Error('AeorFileBrowserBase.createShareLink() must be implemented by subclass');
  }

  // getShareLinks(path) → { links: [...] }
  async getShareLinks(path) { return { links: [] }; }

  // revokeShareLink(keyId) — revoke a share link
  async revokeShareLink(keyId) {
    throw new Error('AeorFileBrowserBase.revokeShareLink() must be implemented by subclass');
  }

  // -------------------------------------------------------------------------
  // Permission helpers
  // -------------------------------------------------------------------------

  /** Check if a CRUDLIFY permission is available.
   *  Flags: c=create, r=read, u=update, d=delete, l=list, i=invoke, f=functions, y=configure
   *  If entry is provided, checks entry.effective_permissions (from server listing).
   *  If no entry or no effective_permissions, checks tab-level or defaults to all-allowed. */
  _hasPermission(flag, entry) {
    const perms = (entry && entry.effective_permissions)
      ? entry.effective_permissions
      : this._currentDirectoryPermissions();
    if (!perms) {
      // No permissions known yet. Root users get all permissions.
      // Non-root users default to hidden until listing loads with effective_permissions.
      const isRoot = typeof window !== 'undefined' && window.AUTH && window.AUTH.currentUserId
        && window.AUTH.currentUserId() === '00000000-0000-0000-0000-000000000000';
      return isRoot;
    }
    const idx = 'crudlify'.indexOf(flag);
    if (idx < 0 || idx >= perms.length) return false;
    return perms[idx] !== '-';
  }

  /** Get the effective permissions for the current directory.
   *  Checks: listing items' effective_permissions → share session fallback → null (full access). */
  _currentDirectoryPermissions() {
    const tab = this._activeTab ? this._activeTab() : null;
    if (tab && tab.entries && tab.entries.length > 0) {
      const first = tab.entries.find(e => e.effective_permissions);
      if (first) return first.effective_permissions;
    }
    // Fallback: share session URL perm param
    if (typeof window !== 'undefined' && window.AUTH && window.AUTH._sharePermissions) {
      return window.AUTH._sharePermissions;
    }
    return null; // normal session — all allowed, server enforces
  }

  // -------------------------------------------------------------------------
  // Hook methods — subclasses CAN override these
  // -------------------------------------------------------------------------

  renderNoTabContent() {
    return '<div class="empty-state">No tabs open.</div>';
  }

  rootLabel() {
    return 'Root';
  }

  /**
   * Get the preview source URL for a file. Override in subclasses that need
   * authenticated access (e.g. portal fetches with auth, returns blob URL).
   * Default: returns fileUrl(path) directly.
   */
  async getPreviewSrc(path, contentType) {
    return this.fileUrl(path);
  }

  /**
   * Extra HTML for preview action buttons. Override in subclasses to add
   * buttons like "Download" or "Open Locally". Default: none.
   */
  previewActions(entry) {
    return '';
  }

  // -------------------------------------------------------------------------
  // State management
  // -------------------------------------------------------------------------

  _saveState() {
    try {
      const serializable_tabs = this._tabs.map((tab) => ({
        id:             tab.id,
        name:           tab.name,
        path:           tab.path,
        view_mode:      tab.view_mode,
        page_size:      tab.page_size,
        preview_height: tab.preview_height,
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

  _loadState() {
    try {
      const raw = localStorage.getItem('aeordb-file-browser');
      if (!raw) return;

      const state         = JSON.parse(raw);
      this._active_tab_id = state.active_tab_id || null;
      this._tab_counter   = state.tab_counter || 0;

      this._tabs = (state.tabs || []).map((tab) => ({
        ...tab,
        name:              tab.name || this.rootLabel(),
        entries:           [],
        total:             null,
        loading:           false,
        loading_more:      false,
        page_size:         tab.page_size || 100,
        preview_entry:     null,
        preview_component: null,
        preview_height:    tab.preview_height || null,
        selectedEntries:   new Set(),
        lastSelectedAnchor: null,
      }));
    } catch (error) {
      // start fresh
    }
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  connectedCallback() {
    this._loadState();
    this.render();

    if (this._active_tab_id && this._activeTab()) {
      this._fetchListing();
    }

    // Clear caches on page unload to prevent stale data across sessions
    this._beforeUnloadHandler = () => { this._sharedPathData = null; };
    window.addEventListener('beforeunload', this._beforeUnloadHandler);
  }

  disconnectedCallback() {
    if (this._keydownHandler) {
      this.removeEventListener('keydown', this._keydownHandler);
    }
    if (this._scroll_listener && this._scroll_listener_target) {
      this._scroll_listener_target.removeEventListener('scroll', this._scroll_listener);
    }
    if (this._beforeUnloadHandler) {
      window.removeEventListener('beforeunload', this._beforeUnloadHandler);
    }
  }

  // -------------------------------------------------------------------------
  // Core rendering
  // -------------------------------------------------------------------------

  render() {
    let html = '<div class="page-header"><h1>Files</h1></div>';

    if (this._tabs.length > 0) {
      html += this._renderTabBar();
    }

    if (!this._active_tab_id) {
      html += this.renderNoTabContent();
      this.innerHTML = html;
      this._bindShellEvents();
      return;
    }

    // Render all tab content containers — only the active one is visible
    for (const tab of this._tabs) {
      const isActive = (tab.id === this._active_tab_id);
      html += `<div class="tab-content${isActive ? '' : ' hidden'}" id="tab-content-${tab.id}">`;
      html += `<div class="tab-listing-area">${this._renderDirectoryViewFor(tab)}</div>`;
      html += this._renderPreviewPanel(tab);
      html += '</div>';
    }

    this.innerHTML = html;
    this._bindShellEvents();
    // Bind events for ALL tab containers (not just active) since render()
    // rebuilds everything — inactive tabs need handlers for when switched to.
    for (const tab of this._tabs) {
      this._bindTabContentEvents(tab.id);
    }
    this._hydratePreview();
  }

  _renderTabBar() {
    return '<aeor-tab-view closable new-tab id="file-tab-view"></aeor-tab-view>';
  }

  _hydrateTabView() {
    const tabView = this.querySelector('#file-tab-view');
    if (!tabView) return;

    // Populate dynamic tabs from state
    for (const tab of this._tabs) {
      const label = this._truncate(`${tab.name || tab.id} ${tab.path}`, 30);
      tabView.addTab(tab.id, label);
    }

    // Activate current tab
    if (this._active_tab_id) {
      tabView.switchTo(this._active_tab_id);
    }

    // Event listeners
    tabView.addEventListener('tab-change', (event) => {
      this._switchTab(event.detail.tab);
    });
    tabView.addEventListener('tab-close', (event) => {
      this._closeTab(event.detail.tab);
    });
    tabView.addEventListener('tab-new', () => {
      this.openNewTab();
    });
  }

  _getVisibleEntries(tab) {
    const live = this._showHidden
      ? tab.entries
      : tab.entries.filter((e) => !e.name.startsWith('.'));
    const deleted = tab._deletedEntries || [];
    const all = [...live, ...deleted];

    // Directories always sort before files
    const dirs = all.filter((e) => e.entry_type === ENTRY_TYPE_DIR);
    const files = all.filter((e) => e.entry_type !== ENTRY_TYPE_DIR);
    return [...dirs, ...files];
  }

  _getConfigActions(tab) {
    const path = tab.path || '';
    if (!path.includes('/.aeordb-config'))
      return '';

    return `
      <button class="secondary small config-action-btn" data-action="add-index">Add Index</button>
      <button class="secondary small config-action-btn" data-action="add-parser">Add Parser</button>
      <button class="secondary small config-action-btn" data-action="cors-config">CORS Config</button>
    `;
  }

  _renderDirectoryViewFor(tab) {
    const viewMode    = tab.view_mode || 'list';
    const breadcrumbs = this._renderBreadcrumbs(tab);
    const configActions = this._getConfigActions(tab);
    const configBar = (configActions) ? `<div class="config-actions-bar">${configActions}</div>` : '';
    const header = `
      <div class="page-header">
        ${breadcrumbs}
        <div class="page-header-actions">
          ${configBar}
          <button class="secondary small header-paste-btn hidden">Paste</button>
          <button class="success small snapshot-button">Snapshot</button>
          ${this._hasPermission('c') ? `
          <button class="secondary small new-folder-button">New Folder</button>
          <button class="primary small upload-button">Upload</button>
          <input type="file" class="upload-input hidden" multiple>` : ''}
        </div>
      </div>
    `;

    // Unified toolbar: selection actions on left, view controls on right (always visible)
    const extraActions = this.selectionActions(tab) || '';
    const extraActionsRight = (this.selectionActionsRight ? this.selectionActionsRight(tab) : '') || '';
    const toolbarHtml = `
      <div class="selection-bar">
        <div class="selection-actions-left invisible">
          <span class="selection-count"></span>
          ${this._hasPermission('d') ? '<aeor-confirm-button class="selection-delete" label="Delete Selected" confirmed-text="Deleted!" duration="1000" style="--lpb-fill:var(--danger,#f85149);--lpb-text:var(--danger,#f85149);"></aeor-confirm-button>' : ''}
          ${extraActions}
          <button class="secondary small selection-clear">Clear Selection</button>
          ${extraActionsRight}
          <button class="primary small selection-restore hidden">Restore Selected</button>
        </div>
        <div class="toolbar-right">
          <button class="small ${this._showHidden ? 'primary' : 'secondary'} toggle-hidden-btn" title="${this._showHidden ? 'Hide hidden and deleted files' : 'Show hidden and deleted files'}">&#128065;</button>
          <div class="view-toggle">
            <button class="small ${(viewMode === 'list') ? 'primary' : 'secondary'}" data-view="list" title="List view">&#9776;</button>
            <button class="small ${(viewMode === 'grid') ? 'primary' : 'secondary'}" data-view="grid" title="Grid view">&#9638;</button>
          </div>
        </div>
      </div>
    `;

    return `<div class="tab-header">${header}</div><div class="tab-toolbar">${toolbarHtml}</div><div class="tab-listing">${this._renderListingContent(tab, viewMode)}</div>`;
  }

  _renderListingContent(tab, viewMode) {
    viewMode = viewMode || tab.view_mode || 'list';

    if (tab.loading && tab.entries.length === 0) {
      return '<div class="empty-state">&nbsp;</div>';
    }

    const visible = this._getVisibleEntries(tab);

    if (visible.length === 0 && tab.entries.length === 0) {
      return '<div class="empty-state">This directory is empty.</div>';
    }

    if (visible.length === 0 && tab.entries.length > 0) {
      return `<div class="empty-state">All ${tab.entries.length} items are hidden. Click the eye icon to show them.</div>`;
    }

    const hiddenCount = tab.entries.length - visible.length;
    const countText = (tab.total != null)
      ? `Showing ${visible.length} of ${tab.total}${(hiddenCount > 0) ? ` (${hiddenCount} hidden)` : ''}`
      : `${visible.length} items${(hiddenCount > 0) ? ` (${hiddenCount} hidden)` : ''}`;
    const loadingMore = (tab.loading_more)
      ? '<div class="scroll-loading">Loading more...</div>'
      : '';

    const listing = (viewMode === 'grid')
      ? this._renderGridViewFor(tab, visible)
      : this._renderListViewFor(tab, visible);

    return `${listing}<div class="entry-count">${countText}</div>${loadingMore}`;
  }

  _renderPreviewPanel(tab) {
    return `
      <div class="preview-panel hidden" translate="no"${tab.preview_height ? ` style="height:${tab.preview_height}px"` : ''}>
        <div class="preview-resize-handle"></div>
        <div class="preview-header">
          <input type="text" class="preview-title" spellcheck="false">
          <div class="preview-actions"></div>
        </div>
        <div class="preview-inner">
          <div class="preview-main">
            <div class="preview-content"></div>
            <div class="preview-meta"></div>
            <div class="preview-warning hidden"></div>
          </div>
          <div class="preview-versions hidden" translate="no">
            <div class="preview-versions-heading">Version History</div>
            <div class="preview-versions-list"></div>
          </div>
        </div>
      </div>`;
  }

  _renderListRow(entry) {
    const isDir    = (entry.entry_type === ENTRY_TYPE_DIR);
    const isDeleted = !!entry._deleted;
    const clipboard = this._getClipboard();
    const isCut = clipboard && clipboard.mode === 'cut' &&
      clipboard.paths.some((p) => p.endsWith('/' + entry.name));
    const icon     = fileIcon(entry.entry_type);
    const size     = (isDir) ? '\u2014' : formatSize(entry.size);
    const created  = formatDate(entry.created_at);
    const modified = isDeleted
      ? `<span class="text-danger">Deleted ${formatDate(entry._deleted_at)}</span>`
      : formatDate(entry.updated_at);
    const rowClass = isDeleted ? ' deleted-row' : isCut ? ' cut-row' : '';
    const nameClass = isDeleted ? ' class="deleted-file-name"' : '';

    return `
      <tr class="file-entry${rowClass}" data-name="${escapeAttr(entry.name)}" data-type="${entry.entry_type}" ${isDeleted ? 'data-deleted="true"' : ''}>
        <td><span class="file-icon">${icon}</span><span${nameClass}>${escapeHtml(entry.name)}</span></td>
        <td>${size}</td>
        <td>${created}</td>
        <td>${modified}</td>
      </tr>
    `;
  }

  _renderListViewFor(tab, entries) {
    const rows = entries.map((entry) => this._renderListRow(entry)).join('');

    return `
      <table>
        <thead>
          <tr>
            <th data-sort="name">Name ${this._sortIndicator('name')}</th>
            <th data-sort="size">Size ${this._sortIndicator('size')}</th>
            <th data-sort="created_at">Created ${this._sortIndicator('created_at')}</th>
            <th data-sort="updated_at">Modified ${this._sortIndicator('updated_at')}</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    `;
  }

  _renderGridViewFor(tab, entries) {
    const cards = entries.map((entry) => {
      const isDir = (entry.entry_type === ENTRY_TYPE_DIR);
      const size  = (isDir) ? 'Folder' : formatSize(entry.size);
      let thumbnail;

      if (!isDir && (isImageFile(entry.name) || isVideoFile(entry.name))) {
        // Image/video: show a loading placeholder, async-load with auth later
        const thumbType = isVideoFile(entry.name) ? 'video' : 'image';
        thumbnail = `<div class="grid-card-thumbnail" data-thumb-path="${escapeAttr(tab.path.replace(/\/$/, '') + '/' + entry.name)}" data-thumb-type="${thumbType}">
          <div class="grid-card-loading">\u23F3</div>
        </div>`;
      } else {
        // Non-image: show a file type icon
        thumbnail = `<div class="grid-card-icon">${_fileTypeIcon(entry)}</div>`;
      }

      const isDeleted = !!entry._deleted;

      return `
        <div class="grid-card file-entry${isDeleted ? ' deleted-card' : ''}" data-name="${escapeAttr(entry.name)}" data-type="${entry.entry_type}" ${isDeleted ? 'data-deleted="true"' : ''}>
          ${thumbnail}
          <div class="grid-card-name${isDeleted ? ' deleted-name' : ''}" title="${escapeAttr(entry.name)}">${escapeHtml(this._truncate(entry.name, 20))}</div>
          <div class="grid-card-meta">${isDeleted ? '<span class="text-danger">Deleted</span>' : size}</div>
        </div>
      `;
    }).join('');

    return `<div class="file-grid">${cards}</div>`;
  }

  /** Load image/video thumbnails with auth after grid renders. */
  _loadGridThumbnails(container) {
    if (!container || typeof this.getPreviewSrc !== 'function') return;
    const tab = this._activeTab();
    if (!tab) return;
    tab._gridBlobUrls = tab._gridBlobUrls || [];
    // Cache blob URLs by path so re-renders reuse them instantly
    tab._thumbCache = tab._thumbCache || {};

    const thumbs = container.querySelectorAll('.grid-card-thumbnail[data-thumb-path]');
    for (const el of thumbs) {
      const path = el.dataset.thumbPath;
      const type = el.dataset.thumbType || 'image';
      if (!path) continue;
      if (el.querySelector('img')) continue;

      // Use cached blob URL if available (survives re-renders)
      if (tab._thumbCache[path]) {
        el.innerHTML = `<img src="${escapeAttr(tab._thumbCache[path])}" alt="" loading="lazy">`;
        continue;
      }

      if (type === 'video') {
        this._loadVideoThumbnail(el, path);
      } else {
        this.getPreviewSrc(path, 'image/*', true).then((blobUrl) => {
          tab._thumbCache[path] = blobUrl;
          tab._gridBlobUrls.push(blobUrl);
          // Re-query the element in the current DOM (original may be gone)
          const current = container.querySelector(`.grid-card-thumbnail[data-thumb-path="${CSS.escape(path)}"]`);
          if (current && !current.querySelector('img')) {
            current.innerHTML = `<img src="${escapeAttr(blobUrl)}" alt="" loading="lazy">`;
          }
        }).catch(() => {});
      }
    }
  }

  /** Grab a single frame from a video for use as a thumbnail.
   *  Uses ?token= URL so the browser makes range requests — only downloads
   *  the video index + one keyframe (~100-500KB), not the entire file. */
  async _loadVideoThumbnail(el, path) {
    try {
      // Build URL with auth token in query param for browser range requests
      const token = (typeof window !== 'undefined' && window.AUTH) ? window.AUTH.token : null;
      const url = this.fileUrl(path) + (token ? `?token=${encodeURIComponent(token)}` : '');

      const video = document.createElement('video');
      video.crossOrigin = 'anonymous';
      video.muted = true;
      video.preload = 'metadata';
      video.src = url;

      await new Promise((resolve, reject) => {
        video.addEventListener('loadedmetadata', resolve, { once: true });
        video.addEventListener('error', reject, { once: true });
        setTimeout(() => reject(new Error('timeout')), 10000);
      });

      // Seek past intros/logos: 15% in or 90s, whichever is less.
      // For short videos (< 10s), use 1s. For very short (< 2s), use 0.
      const seekTo = video.duration < 2 ? 0
        : video.duration < 10 ? 1
        : Math.min(90, video.duration * 0.15);
      video.currentTime = seekTo;

      await new Promise((resolve, reject) => {
        video.addEventListener('seeked', resolve, { once: true });
        setTimeout(() => reject(new Error('seek timeout')), 10000);
      });

      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      canvas.getContext('2d').drawImage(video, 0, 0);

      const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
      el.innerHTML = `<img src="${dataUrl}" alt="" loading="lazy">`;

      // Play icon overlay
      el.insertAdjacentHTML('beforeend',
        '<div class="grid-card-play-overlay">\u25B6</div>');
      el.style.position = 'relative';

      // Release resources
      video.src = '';
      video.load();
    } catch (e) {
      el.innerHTML = `<div class="grid-card-icon">${_FILE_ICONS.video}</div>`;
    }
  }

  _renderBreadcrumbs(tab) {
    const path = tab.path;
    const label = this.rootLabel();
    const segments = path.split('/').filter((s) => s.length > 0);
    let html = `<div class="breadcrumbs"><span class="breadcrumb-segment" data-path="/">${escapeHtml(label)}</span>`;

    let accumulated = '/';
    for (const segment of segments) {
      accumulated += segment + '/';
      html += `<span class="breadcrumb-separator">/</span><span class="breadcrumb-segment" data-path="${escapeAttr(accumulated)}">${escapeHtml(segment)}</span>`;
    }

    html += '</div>';
    return html;
  }

  // Update only a single tab's content container — no structural DOM change.
  _updateTabContent(tabId) {
    const container = this.querySelector(`#tab-content-${tabId}`);
    const tab = this._tabs.find((t) => t.id === tabId);
    if (!container || !tab) return;

    const listingArea = container.querySelector('.tab-listing-area');

    if (!listingArea) {
      // First render: full build
      container.innerHTML = `<div class="tab-listing-area">${this._renderDirectoryViewFor(tab)}</div>${this._renderPreviewPanel(tab)}`;
      this._bindTabContentEvents(tabId);
    } else {
      // Selective update: only replace the file listing, preserve toolbar + header
      const listing = listingArea.querySelector('.tab-listing');
      const scrollTop = (listing) ? listing.scrollTop : 0;

      // Update breadcrumbs in place
      const headerEl = listingArea.querySelector('.tab-header');
      if (headerEl) {
        const breadcrumbs = this._renderBreadcrumbs(tab);
        const configActions = this._getConfigActions(tab);
        const configBar = (configActions) ? `<div class="config-actions-bar">${configActions}</div>` : '';
        headerEl.innerHTML = `
          <div class="page-header">
            ${breadcrumbs}
            <div class="page-header-actions">
              ${configBar}
              <button class="secondary small header-paste-btn hidden">Paste</button>
              <button class="success small snapshot-button">Snapshot</button>
              ${this._hasPermission('c') ? `
              <button class="secondary small new-folder-button">New Folder</button>
              <button class="primary small upload-button">Upload</button>
              <input type="file" class="upload-input hidden" multiple>` : ''}
            </div>
          </div>`;
      }

      // Update listing content only (toolbar is preserved)
      if (listing) {
        listing.innerHTML = this._renderListingContent(tab);
        // Clear any loading state class (dimming/cursor from _fetchListing)
        listing.classList.remove('loading');
      }

      // Re-bind events for the listing rows + header buttons (but toolbar stays intact)
      this._bindTabContentEvents(tabId);

      // Restore scroll position
      const newListing = listingArea.querySelector('.tab-listing');
      if (newListing && scrollTop > 0) {
        newListing.scrollTop = scrollTop;
      }
    }

    if (tabId === this._active_tab_id) {
      this._hydratePreview();
      if (tab.view_mode === 'grid') {
        this._loadGridThumbnails(container);
      }
    }
  }

  // Update the persistent preview panel's contents in place — no DOM destruction.
  async _showPreview(tab) {
    const container = this.querySelector(`#tab-content-${tab.id}`);
    if (!container) return;

    const panel = container.querySelector('.preview-panel');
    if (!panel) return;

    const entry = tab.preview_entry;
    const componentName = tab.preview_component;

    if (!entry) {
      panel.classList.add('hidden');
      return;
    }

    // Deleted file: check for snapshots first
    if (entry._deleted) {
      panel.classList.remove('hidden');
      const titleInput = panel.querySelector('.preview-title');
      titleInput.value = entry.name;
      titleInput.readOnly = true;
      titleInput.classList.add('no-pointer-events');

      // Fetch version history to determine if we have snapshots
      const filePath = tab.path.replace(/\/$/, '') + '/' + entry.name;
      let versions = [];
      try {
        versions = await this._fetchVersionHistory(filePath) || [];
      } catch (_) {}

      // Find the most recent snapshot where the file existed (not deleted)
      const latestVersion = versions.find((v) => v.change_type !== 'deleted');

      if (latestVersion) {
        // Has snapshots — show preview of the latest version
        panel.querySelector('.preview-actions').innerHTML = `
          <div class="preview-actions-row">
            <aeor-info-box compact>Any version can be safely restored.</aeor-info-box>
            <aeor-confirm-button class="restore-snapshot-btn" label="Restore Selected Snapshot" confirmed-text="File Restored!" duration="1000" style="--lpb-bg:var(--accent,#f97316);--lpb-text:#fff;--lpb-fill:var(--success,#3fb950);--lpb-border:var(--accent,#f97316);"></aeor-confirm-button>
            <button class="secondary small" data-action="close-preview">\u2715</button>
          </div>
        `;

        // Load the preview from the snapshot
        const contentType = latestVersion.content_type || 'application/octet-stream';
        const componentName = await loadPreviewComponent(contentType);
        const contentEl = panel.querySelector('.preview-content');
        if (componentName) {
          contentEl.innerHTML = `<${componentName}></${componentName}>`;
          const previewEl = contentEl.querySelector(componentName);
          if (previewEl) {
            const snapshotId = latestVersion.id || latestVersion.snapshot;
            const src = await this.getPreviewSrc(filePath + '?version=' + encodeURIComponent(snapshotId), contentType);
            previewEl.setAttribute('src', src);
            previewEl.setAttribute('filename', entry.name);
            previewEl.setAttribute('size', latestVersion.size || 0);
            previewEl.setAttribute('content-type', contentType);
            if (previewEl.load) previewEl.load();
          }
        }

        panel.querySelector('.preview-meta').textContent =
          `Deleted \u00B7 ${formatDate(entry._deleted_at)} \u00B7 Showing snapshot: ${latestVersion.snapshot}`;

        // Store the current snapshot id for the restore button
        panel._currentSnapshotId = latestVersion.id || latestVersion.snapshot;

        // Load version history sidebar
        this._loadVersionHistory(panel, tab, entry);

        // Bind restore long-press button
        const headerRestoreBtn = panel.querySelector('.restore-snapshot-btn');
        if (headerRestoreBtn) {
          headerRestoreBtn.addEventListener('confirm', () => {
            const snapId = panel._currentSnapshotId;
            this._confirmRestoreVersion(tab, entry, snapId);
          });
        }
        // Bind other action buttons (close)
        panel.querySelectorAll('[data-action]').forEach((button) => {
          button.addEventListener('click', (event) => {
            event.stopPropagation();
            this._handlePreviewAction(button.dataset.action);
          });
        });
      } else {
        // No snapshots — show trash can with "Restore Deleted File" button
        panel.querySelector('.preview-actions').innerHTML = `
          <button class="primary small" data-action="restore-deleted">Restore Deleted File</button>
          <button class="secondary small" data-action="close-preview">\u2715</button>
        `;

        const contentEl = panel.querySelector('.preview-content');
        contentEl.innerHTML = `
          <div class="deleted-file-placeholder">
            <div class="deleted-file-icon">&#128465;</div>
            <div class="deleted-file-title">File Deleted</div>
            <div class="deleted-file-info">
              Deleted on ${formatDate(entry._deleted_at)}
            </div>
            <div class="deleted-file-hint">
              No snapshots available. Click <strong>Restore Deleted File</strong> to recover from the database history.
            </div>
          </div>
        `;

        panel.querySelector('.preview-meta').textContent = `Deleted \u00B7 ${formatDate(entry._deleted_at)}`;

        const versionsPanel = panel.querySelector('.preview-versions');
        if (versionsPanel) versionsPanel.classList.add('hidden');

        // Bind action buttons
        panel.querySelectorAll('[data-action]').forEach((button) => {
          button.addEventListener('click', (event) => {
            event.stopPropagation();
            if (button.dataset.action === 'restore-deleted') {
              this._restoreDeletedFile(tab, entry);
            } else {
              this._handlePreviewAction(button.dataset.action);
            }
          });
        });
      }
      return;
    }

    if (!componentName) {
      panel.classList.add('hidden');
      return;
    }

    // Update header — editable filename input
    const titleInput = panel.querySelector('.preview-title');
    titleInput.value = entry.name;
    titleInput.dataset.original = entry.name;
    const canRename = this._hasPermission('u', entry);
    titleInput.readOnly = !canRename;
    titleInput.tabIndex = canRename ? 0 : -1;
    titleInput.classList.toggle('no-pointer-events', !canRename);

    // Update action buttons — subclasses can inject extra buttons via previewActions()
    const extraActions = this.previewActions(entry) || '';
    panel.querySelector('.preview-actions').innerHTML = `
      ${this._hasPermission('d', entry) ? '<aeor-confirm-button class="preview-delete-btn" label="Delete" confirmed-text="Deleted!" duration="1000" style="--lpb-fill:var(--danger,#f85149);--lpb-text:var(--danger,#f85149);"></aeor-confirm-button>' : ''}
      ${extraActions}
      <button class="secondary small" data-action="close-preview">\u2715</button>
    `;

    // Update preview component — only swap if the component type changed
    const contentEl = panel.querySelector('.preview-content');
    const existingPreview = contentEl.firstElementChild;
    if (!existingPreview || existingPreview.tagName.toLowerCase() !== componentName) {
      contentEl.innerHTML = `<${componentName}></${componentName}>`;
    }

    // Set attributes on the preview element
    const previewEl = contentEl.querySelector(componentName);
    if (previewEl) {
      const contentType = entry.content_type || 'application/octet-stream';
      const filePath = tab.path.replace(/\/$/, '') + '/' + entry.name;
      const previewSrc = await this.getPreviewSrc(filePath, contentType);
      previewEl.setAttribute('src', previewSrc);
      previewEl.setAttribute('filename', entry.name);
      previewEl.setAttribute('size', entry.size || 0);
      previewEl.setAttribute('content-type', contentType);
      if (previewEl.load) previewEl.load();
    }

    // Update meta
    panel.querySelector('.preview-meta').textContent =
      `${formatSize(entry.size)} \u00B7 ${entry.content_type || 'Unknown type'} \u00B7 ${formatDate(entry.created_at)}`;

    // System file warning
    const warningEl = panel.querySelector('.preview-warning');
    const filePath = tab.path.replace(/\/$/, '') + '/' + entry.name;
    if (warningEl) {
      const isSystemFile = /\/\.(config|system|indexes|permissions|functions|conflicts)(\/|$)/.test(filePath) || /^\.(config|system|indexes|permissions|functions|conflicts)(\/|$)/.test(entry.name);
      if (isSystemFile) {
        warningEl.classList.remove('hidden');
        warningEl.innerHTML = `
          <div class="system-file-warning">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#d29922" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
            <span class="system-file-warning-text">This is a system configuration file. Modifying or deleting it may affect database behavior and could cause instability.</span>
          </div>`;
      } else {
        warningEl.classList.add('hidden');
        warningEl.innerHTML = '';
      }
    }

    // Load version history
    this._loadVersionHistory(panel, tab, entry);

    // Bind delete long-press button
    const previewDelBtn = panel.querySelector('.preview-delete-btn');
    if (previewDelBtn) {
      previewDelBtn.addEventListener('confirm', () => {
        this._handlePreviewAction('delete');
      });
    }

    // Bind other action buttons
    panel.querySelectorAll('[data-action]').forEach((button) => {
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        this._handlePreviewAction(button.dataset.action);
      });
    });

    // Bind rename on Enter or blur
    const self = this;
    titleInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        titleInput.blur();
      } else if (event.key === 'Escape') {
        titleInput.value = titleInput.dataset.original;
        titleInput.blur();
      }
    });
    titleInput.addEventListener('blur', () => {
      const newName = titleInput.value.trim();
      const oldName = titleInput.dataset.original;
      if (newName && newName !== oldName) {
        self._renamePreviewFile(newName);
      }
    });

    // Show it
    panel.classList.remove('hidden');
  }

  /**
   * Show a minimal preview panel for directories — just the name and version history.
   */
  _showDirectoryPreview(tab) {
    const container = this.querySelector(`#tab-content-${tab.id}`);
    if (!container) return;
    const panel = container.querySelector('.preview-panel');
    if (!panel) return;
    const entry = tab.preview_entry;
    if (!entry) { panel.classList.add('hidden'); return; }

    // Editable folder name
    const titleInput = panel.querySelector('.preview-title');
    titleInput.value = entry.name;
    titleInput.dataset.original = entry.name;
    const canRename = this._hasPermission('u', entry);
    titleInput.readOnly = !canRename;
    titleInput.tabIndex = canRename ? 0 : -1;
    titleInput.classList.toggle('no-pointer-events', !canRename);

    // Action buttons — Delete, Download ZIP, Share, Close
    const dirActions = this.directoryPreviewActions(entry) || '';
    panel.querySelector('.preview-actions').innerHTML = `
      ${this._hasPermission('d', entry) ? '<aeor-confirm-button class="preview-delete-btn" label="Delete" confirmed-text="Deleted!" duration="1000" style="--lpb-fill:var(--danger,#f85149);--lpb-text:var(--danger,#f85149);"></aeor-confirm-button>' : ''}
      ${dirActions}
      <button class="secondary small" data-action="close-preview">\u2715</button>
    `;

    panel.querySelector('.preview-content').innerHTML =
      '<div class="directory-preview-icon">&#128193;</div>';

    panel.querySelector('.preview-meta').textContent =
      `Directory \u00B7 ${formatDate(entry.created_at)}`;

    // Version history
    this._loadVersionHistory(panel, tab, entry);

    // Bind delete long-press
    const previewDelBtn = panel.querySelector('.preview-delete-btn');
    if (previewDelBtn) {
      previewDelBtn.addEventListener('confirm', () => {
        this._handlePreviewAction('delete');
      });
    }

    // Bind action buttons
    panel.querySelectorAll('[data-action]').forEach((button) => {
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        this._handlePreviewAction(button.dataset.action);
      });
    });

    // Bind rename on Enter/blur (same as file preview)
    const self = this;
    titleInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') { event.preventDefault(); titleInput.blur(); }
      else if (event.key === 'Escape') { titleInput.value = titleInput.dataset.original; titleInput.blur(); }
    });
    titleInput.addEventListener('blur', () => {
      const newName = titleInput.value.trim();
      const oldName = titleInput.dataset.original;
      if (newName && newName !== oldName) {
        self._renamePreviewFile(newName);
      }
    });

    panel.classList.remove('hidden');
  }

  /**
   * Extra action buttons for directory preview. Override in subclasses.
   */
  directoryPreviewActions(entry) {
    return '';
  }

  // -------------------------------------------------------------------------
  // Event binding
  // -------------------------------------------------------------------------

  _bindShellEvents() {
    // Tab view handles tab clicks, close, and new-tab via events
    this._hydrateTabView();
  }

  _bindTabContentEvents(tabId) {
    const container = this.querySelector(`#tab-content-${tabId}`);
    if (!container) return;
    const tab = this._tabs.find((t) => t.id === tabId);
    if (!tab) return;

    // Toolbar events: bind once (idempotent via _toolbarBound flag)
    if (!container._toolbarBound) {
      this._bindToolbarEvents(container, tab, tabId);
      container._toolbarBound = true;
    }

    // Listing events: re-bind every content update
    this._bindListingEvents(container, tab, tabId);
  }

  _bindToolbarEvents(container, tab, tabId) {
    // Toggle hidden files
    const toggleHiddenBtn = container.querySelector('.toggle-hidden-btn');
    if (toggleHiddenBtn) {
      toggleHiddenBtn.addEventListener('click', async () => {
        this._showHidden = !this._showHidden;
        // Update button visual (toolbar is preserved, not rebuilt)
        toggleHiddenBtn.classList.toggle('primary', this._showHidden);
        toggleHiddenBtn.classList.toggle('secondary', !this._showHidden);
        toggleHiddenBtn.title = this._showHidden ? 'Hide hidden and deleted files' : 'Show hidden and deleted files';
        const tab = this._tabs.find((t) => t.id === tabId);
        if (this._showHidden && tab) {
          await this._fetchDeletedEntries(tab);
        } else if (tab) {
          tab._deletedEntries = [];
        }
        this._updateTabContent(tabId);
      });
    }

    // Selection bar button listeners (buttons are always in DOM, visibility toggled)
    const selClearBtn = container.querySelector('.selection-clear');
    if (selClearBtn) selClearBtn.addEventListener('click', () => this._clearSelection(tab));
    const selRestoreBtn = container.querySelector('.selection-restore');
    if (selRestoreBtn) selRestoreBtn.addEventListener('click', () => this._restoreSelected());
    const selDeleteBtn = container.querySelector('.selection-delete');
    if (selDeleteBtn) selDeleteBtn.addEventListener('confirm', () => this._deleteSelected());
    const selLeftSlot = container.querySelector('.selection-actions-left');
    if (selLeftSlot) this._bindSelectionBarExtra(selLeftSlot, tab);

    // View toggle
    container.querySelectorAll('[data-view]').forEach((btn) => {
      btn.addEventListener('click', () => {
        tab.view_mode = btn.dataset.view;
        // Update button highlight (toolbar is preserved, not rebuilt)
        container.querySelectorAll('[data-view]').forEach((b) => {
          b.classList.toggle('primary', b.dataset.view === tab.view_mode);
          b.classList.toggle('secondary', b.dataset.view !== tab.view_mode);
        });
        this._saveState();
        this._updateTabContent(tabId);
      });
    });
  }

  _bindListingEvents(container, tab, tabId) {
    // Background right-click anywhere in the tab content (not on a file entry)
    // Prevents default context menu and shows paste menu when clipboard has items
    container.addEventListener('contextmenu', (event) => {
      if (event.target.closest('.file-entry')) return;
      // Don't intercept context menu on inputs, textareas, or preview panel controls
      if (event.target.closest('input, textarea, select, .preview-panel button')) return;
      event.preventDefault();
      this._showBackgroundContextMenu(event.clientX, event.clientY);
    });

    // Header paste button (rebuilt with header, so bind each time)
    const headerPasteBtn = container.querySelector('.header-paste-btn');
    if (headerPasteBtn) {
      headerPasteBtn.classList.toggle('hidden', !this._getClipboard());
      headerPasteBtn.addEventListener('click', () => this._pasteClipboard());
    }

    // Sortable column headers
    container.querySelectorAll('th[data-sort]').forEach((th) => {
      th.addEventListener('click', () => {
        this._handleSort(th.dataset.sort);
      });
    });

    // Config action buttons
    container.querySelectorAll('.config-action-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        this._handleConfigAction(btn.dataset.action);
      });
    });

    // Breadcrumbs
    container.querySelectorAll('.breadcrumb-segment').forEach((segment) => {
      segment.addEventListener('click', () => {
        this._navigateTo(segment.dataset.path);
      });
    });

    // File entries — delegate to shared method
    this._bindFileEntryEvents(container, tab);

    // Keyboard, upload, drop zone, resize — delegate to shared method
    this._bindKeyboardAndControls(container, tab);
  }

  /**
   * Bind click and context menu handlers on file entry elements.
   * Separated so it can be called independently after a sort refresh
   * without rebinding sort headers or other controls.
   */
  _bindFileEntryEvents(container, tab) {
    container.querySelectorAll('.file-entry').forEach((el) => {
      el.addEventListener('click', (event) => {
        const entryName = el.dataset.name;
        const entryType = parseInt(el.dataset.type, 10);
        const entryPath = tab.path.replace(/\/$/, '') + '/' + entryName;
        const visibleEntries = this._getVisibleEntries(tab);
        const entryIndex = visibleEntries.findIndex((e) => e.name === entryName);
        const isCtrl = event.ctrlKey || event.metaKey;
        const isShift = event.shiftKey;

        if (!isCtrl && !isShift) {
          // Plain click — select (files and directories alike)
          tab.selectedEntries.clear();
          tab.selectedEntries.add(entryPath);
          tab.lastSelectedAnchor = entryPath;
          this._updateSelectionVisual(tab);

          // Preview: files get full preview, directories get version history only
          tab.preview_entry = visibleEntries.find((e) => e.name === entryName) || null;
          tab.preview_component = null;
          if (entryType !== ENTRY_TYPE_DIR) {
            this._loadPreview();
          } else {
            this._showDirectoryPreview(tab);
          }
        } else if (isCtrl) {
          // Ctrl+Click — toggle individual entry
          if (tab.selectedEntries.has(entryPath))
            tab.selectedEntries.delete(entryPath);
          else
            tab.selectedEntries.add(entryPath);

          tab.lastSelectedAnchor = entryPath;
          this._updateSelectionVisual(tab);
        } else if (isShift) {
          // Shift+Click — range select using current visible entries
          const anchorIndex = (tab.lastSelectedAnchor)
            ? visibleEntries.findIndex((e) => tab.path.replace(/\/$/, '') + '/' + e.name === tab.lastSelectedAnchor)
            : 0;
          const anchor = (anchorIndex >= 0) ? anchorIndex : 0;
          const start = Math.min(anchor, entryIndex);
          const end = Math.max(anchor, entryIndex);

          for (let i = start; i <= end; i++) {
            if (visibleEntries[i])
              tab.selectedEntries.add(tab.path.replace(/\/$/, '') + '/' + visibleEntries[i].name);
          }
          this._updateSelectionVisual(tab);
        }
      });

      // Double-click — navigate into directory
      el.addEventListener('dblclick', () => {
        const entryType = parseInt(el.dataset.type, 10);
        if (entryType === ENTRY_TYPE_DIR) {
          const entryPath = tab.path.replace(/\/$/, '') + '/' + el.dataset.name;
          this._navigateTo(entryPath + '/');
        }
      });

      // Context menu (files and directories)
      el.addEventListener('contextmenu', (event) => {
        event.preventDefault();
        const entry = tab.entries.find((e) => e.name === el.dataset.name);
        if (!entry) return;

        this._showContextMenu(event.clientX, event.clientY, entry);
      });
    });
  }

  _bindKeyboardAndControls(container, tab) {
    // Keyboard: Ctrl+A to select all, Escape to clear
    this.setAttribute('tabindex', '0');
    const keydownHandler = (event) => {
      if (tab.id !== this._active_tab_id) return;

      if ((event.ctrlKey || event.metaKey) && event.key === 'a') {
        event.preventDefault();
        for (const entry of tab.entries)
          tab.selectedEntries.add(tab.path.replace(/\/$/, '') + '/' + entry.name);

        if (tab.entries.length > 0)
          tab.lastSelectedAnchor = tab.path.replace(/\/$/, '') + '/' + tab.entries[tab.entries.length - 1].name;

        this._updateSelectionVisual(tab);
      } else if (event.key === 'Escape') {
        if (tab.selectedEntries.size > 0)
          this._clearSelection(tab);
      } else if ((event.ctrlKey || event.metaKey) && event.key === 'c' && !event.shiftKey) {
        if (tab.selectedEntries.size > 0) {
          event.preventDefault();
          this._setClipboard('copy', [...tab.selectedEntries]);
          if (window.aeorToast) window.aeorToast('Files copied!', 'success');
        }
      } else if ((event.ctrlKey || event.metaKey) && event.key === 'x') {
        if (tab.selectedEntries.size > 0) {
          event.preventDefault();
          this._setClipboard('cut', [...tab.selectedEntries]);
          this._updateTabContent(tab.id);
          if (window.aeorToast) window.aeorToast('Files cut!', 'success');
        }
      } else if ((event.ctrlKey || event.metaKey) && event.key === 'v' && event.shiftKey) {
        event.preventDefault();
        this._pasteAsSymlinks();
      } else if ((event.ctrlKey || event.metaKey) && event.key === 'v') {
        event.preventDefault();
        this._pasteClipboard();
      } else if (event.key === 'Delete') {
        if (tab.selectedEntries.size > 0) {
          this._deleteSelected();
        }
      }
    };

    if (this._keydownHandler)
      this.removeEventListener('keydown', this._keydownHandler);

    this._keydownHandler = keydownHandler;
    this.addEventListener('keydown', keydownHandler);

    // New Folder button
    const snapshotButton = container.querySelector('.snapshot-button');
    if (snapshotButton) {
      snapshotButton.addEventListener('click', () => this._takeSnapshot(snapshotButton));
    }

    const newFolderButton = container.querySelector('.new-folder-button');
    if (newFolderButton) {
      newFolderButton.addEventListener('click', () => this._promptNewFolder());
    }

    // Upload button
    const uploadButton = container.querySelector('.upload-button');
    const uploadInput = container.querySelector('.upload-input');
    if (uploadButton && uploadInput) {
      uploadButton.addEventListener('click', () => uploadInput.click());
      uploadInput.addEventListener('change', (event) => this._handleUpload(event));
    }

    // Drop zone — drag files from OS into the listing to upload
    const listing = container.querySelector('.tab-listing');
    if (listing) {
      let dragCounter = 0;

      listing.addEventListener('dragover', (event) => {
        if (event.dataTransfer.types.includes('Files')) {
          event.preventDefault();
          event.dataTransfer.dropEffect = 'copy';
        }
      });

      listing.addEventListener('dragenter', (event) => {
        if (event.dataTransfer.types.includes('Files')) {
          event.preventDefault();
          dragCounter++;
          listing.classList.add('drop-active');
        }
      });

      listing.addEventListener('dragleave', () => {
        dragCounter--;
        if (dragCounter <= 0) {
          dragCounter = 0;
          listing.classList.remove('drop-active');
        }
      });

      listing.addEventListener('drop', (event) => {
        event.preventDefault();
        dragCounter = 0;
        listing.classList.remove('drop-active');

        // Use webkitGetAsEntry for folder support, fall back to .files
        const items = event.dataTransfer.items;
        if (items && items.length > 0 && items[0].webkitGetAsEntry) {
          this._handleDroppedItems(items);
        } else if (event.dataTransfer.files.length > 0) {
          this._uploadFiles(event.dataTransfer.files);
        }
      });
    }

    // Preview panel resize handle
    const resizeHandle = container.querySelector('.preview-resize-handle');
    const previewPanel = container.querySelector('.preview-panel');
    if (resizeHandle && previewPanel) {
      resizeHandle.addEventListener('mousedown', (event) => {
        event.preventDefault();
        const startY      = event.clientY;
        const startHeight = previewPanel.offsetHeight;

        const self = this;
        const onMouseMove = (moveEvent) => {
          const delta     = startY - moveEvent.clientY;
          const newHeight = Math.max(150, Math.min(window.innerHeight * 0.8, startHeight + delta));
          previewPanel.style.height = newHeight + 'px';
          tab.preview_height = newHeight;
        };

        const onMouseUp = () => {
          document.removeEventListener('mousemove', onMouseMove);
          document.removeEventListener('mouseup', onMouseUp);
          self._saveState();
        };

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
      });
    }
  }

  // -------------------------------------------------------------------------
  // Tab lifecycle
  // -------------------------------------------------------------------------

  _openTab(id, name, initialPath) {
    this._tab_counter++;
    const tabId = 'tab-' + this._tab_counter;
    this._tabs.push({
      id:                tabId,
      name:              name || tabId,
      path:              initialPath || '/',
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
    });
    this._active_tab_id = tabId;
    this._saveState();
    this.render();
    this._fetchListing();
  }

  _switchTab(tabId) {
    if (this._active_tab_id === tabId) return;

    // Hide current tab content
    const currentContainer = this.querySelector(`#tab-content-${this._active_tab_id}`);
    if (currentContainer) currentContainer.classList.add('hidden');

    // Show new tab content
    this._active_tab_id = tabId;

    const newContainer = this.querySelector(`#tab-content-${tabId}`);
    if (newContainer) newContainer.classList.remove('hidden');

    // Keep tab-view in sync (if called programmatically)
    const tabView = this.querySelector('#file-tab-view');
    if (tabView && tabView.activeTab !== tabId) {
      tabView.switchTo(tabId);
    }

    this._saveState();

    // Load data if this tab hasn't been fetched yet
    const tab = this._activeTab();
    if (tab && tab.entries.length === 0 && !tab.loading) {
      this._fetchListing();
    } else {
      this._hydratePreview();
      this._attachScrollListener();
    }
  }

  _closeTab(tabId) {
    // Remove the tab's DOM container
    const container = this.querySelector(`#tab-content-${tabId}`);
    if (container) container.remove();

    // Remove from tab-view component
    const tabView = this.querySelector('#file-tab-view');
    if (tabView) tabView.removeTab(tabId);

    this._tabs = this._tabs.filter((t) => t.id !== tabId);

    if (this._active_tab_id === tabId) {
      if (this._tabs.length > 0) {
        this._active_tab_id = this._tabs[this._tabs.length - 1].id;
      } else {
        this._active_tab_id = null;
      }
    }

    this._saveState();
    this.render();
  }

  _navigateTo(path) {
    const tab = this._activeTab();
    if (!tab) return;
    (tab._gridBlobUrls || []).forEach(u => URL.revokeObjectURL(u));
    tab._gridBlobUrls = [];
    tab.path = path;
    tab.preview_entry = null;
    tab.selectedEntries.clear();
    tab.lastSelectedAnchor = null;
    this._updateSelectionVisual(tab);
    this._saveState();
    // Update tab bar label (breadcrumb changed)
    this._updateTabBarLabel(tab);
    this._fetchListing();
  }

  _updateTabBarLabel(tab) {
    const label = this._truncate(`${tab.name || tab.id} ${tab.path}`, 30);
    const tabView = this.querySelector('#file-tab-view');
    if (tabView) {
      tabView.updateLabel(tab.id, label);
    }
  }

  // -------------------------------------------------------------------------
  // Multi-select
  // -------------------------------------------------------------------------

  _updateSelectionVisual(tab) {
    const container = this.querySelector(`#tab-content-${tab.id}`);
    if (!container) return;

    // Toggle .selected class on file entries (match by full path)
    container.querySelectorAll('.file-entry').forEach((el) => {
      const entryPath = tab.path.replace(/\/$/, '') + '/' + el.dataset.name;
      if (tab.selectedEntries.has(entryPath))
        el.classList.add('selected');
      else
        el.classList.remove('selected');
    });

    // Toggle visibility of the selection actions (buttons are always in DOM)
    const leftSlot = container.querySelector('.selection-actions-left');
    if (leftSlot) {
      if (tab.selectedEntries.size > 0) {
        leftSlot.classList.remove('invisible');
        const countEl = leftSlot.querySelector('.selection-count');
        if (countEl) countEl.textContent = `${tab.selectedEntries.size} selected`;

        // Show/hide restore button based on whether deleted files are selected
        const restoreBtn = leftSlot.querySelector('.selection-restore');
        if (restoreBtn) {
          const allEntries = [...tab.entries, ...(tab._deletedEntries || [])];
          const hasDeletedSelected = [...tab.selectedEntries].some((path) => {
            const name = path.split('/').pop();
            return allEntries.some((e) => e.name === name && e._deleted);
          });
          restoreBtn.classList.toggle('hidden', !hasDeletedSelected);
        }

      } else {
        leftSlot.classList.add('invisible');
      }
    }

    // Header paste button — always visible when clipboard has items
    const headerPasteBtn = container.querySelector('.header-paste-btn');
    if (headerPasteBtn) {
      headerPasteBtn.classList.toggle('hidden', !this._getClipboard());
    }
  }

  _clearSelection(tab) {
    tab.selectedEntries.clear();
    tab.lastSelectedAnchor = null;
    this._updateSelectionVisual(tab);
  }

  async _deleteSelected() {
    const tab = this._activeTab();
    if (!tab || tab.selectedEntries.size === 0) return;

    // Long-press button already confirmed — just delete
    // selectedEntries contains full paths
    const paths = [...tab.selectedEntries];
    for (const filePath of paths) {
      try {
        await this.deletePath(filePath);
      } catch (error) {
        const name = filePath.split('/').pop();
        if (window.aeorToast)
          window.aeorToast(`Delete failed for ${name}: ${error.message}`, 'error');
      }
    }

    tab.selectedEntries.clear();
    tab.lastSelectedAnchor = null;
    tab.preview_entry = null;
    this._fetchListing();
  }

  async _deleteInstant(entry) {
    const tab = this._activeTab();
    if (!tab) return;
    const filePath = tab.path.replace(/\/$/, '') + '/' + entry.name;
    try {
      await this.deletePath(filePath);
      this._fetchListing();
    } catch (error) {
      if (window.aeorToast) window.aeorToast('Delete failed: ' + error.message, 'error');
    }
  }

  /**
   * Extra HTML for the selection bar. Override in subclasses to add buttons
   * like "Download ZIP". Default: none.
   */
  selectionActions(tab) {
    return '';
  }

  /**
   * Bind event handlers for extra selection bar buttons. Override in subclasses.
   */
  _bindSelectionBarExtra(selectionBar, tab) {
    // default: no extra bindings
  }

  // -------------------------------------------------------------------------
  // Clipboard helpers
  // -------------------------------------------------------------------------

  _getClipboard() {
    try {
      const raw = sessionStorage.getItem('aeordb-clipboard');
      return raw ? JSON.parse(raw) : null;
    } catch (_) { return null; }
  }

  _setClipboard(mode, paths) {
    sessionStorage.setItem('aeordb-clipboard', JSON.stringify({ mode, paths }));
  }

  _clearClipboard() {
    sessionStorage.removeItem('aeordb-clipboard');
  }

  _cutSelected(contextEntry) {
    const tab = this._activeTab();
    if (!tab) return;
    const paths = tab.selectedEntries.size > 0
      ? [...tab.selectedEntries]
      : [tab.path.replace(/\/$/, '') + '/' + contextEntry.name];
    this._setClipboard('cut', paths);
    this._updateTabContent(tab.id);
    if (window.aeorToast) window.aeorToast('Files cut!', 'success');
  }

  _copySelected(contextEntry) {
    const tab = this._activeTab();
    if (!tab) return;
    const paths = tab.selectedEntries.size > 0
      ? [...tab.selectedEntries]
      : [tab.path.replace(/\/$/, '') + '/' + contextEntry.name];
    this._setClipboard('copy', paths);
    if (window.aeorToast) window.aeorToast('Files copied!', 'success');
  }

  async _pasteClipboard() {
    const clipboard = this._getClipboard();
    if (!clipboard || !clipboard.paths.length) return;
    const tab = this._activeTab();
    if (!tab) return;

    try {
      if (clipboard.mode === 'copy') {
        await this._pasteAsCopy(clipboard.paths, tab.path);
      } else {
        await this._pasteAsMove(clipboard.paths, tab.path);
      }
      this._clearClipboard();
      this._fetchListing();
      if (window.aeorToast) window.aeorToast('Files pasted!', 'success');
    } catch (error) {
      if (window.aeorToast) window.aeorToast('Paste failed: ' + error.message, 'error');
    }
  }

  async _pasteAsSymlinks() {
    const clipboard = this._getClipboard();
    if (!clipboard || !clipboard.paths.length) return;
    const tab = this._activeTab();
    if (!tab) return;

    let errors = 0;
    for (const srcPath of clipboard.paths) {
      const name = srcPath.split('/').pop();
      const linkPath = tab.path.replace(/\/$/, '') + '/' + name;
      try {
        await this._createSymlink(linkPath, srcPath);
      } catch (_) { errors++; }
    }
    this._clearClipboard();
    this._fetchListing();
    if (errors > 0) {
      if (window.aeorToast) window.aeorToast(`${errors} symlink(s) failed`, 'error');
    } else {
      if (window.aeorToast) window.aeorToast('Symlinks created!', 'success');
    }
  }

  async _pasteAsCopy(paths, destination) {
    throw new Error('_pasteAsCopy must be implemented by subclass');
  }
  async _pasteAsMove(paths, destination) {
    throw new Error('_pasteAsMove must be implemented by subclass');
  }
  async _createSymlink(path, target) {
    throw new Error('_createSymlink must be implemented by subclass');
  }

  // -------------------------------------------------------------------------
  // Data fetching (uses abstract methods)
  // -------------------------------------------------------------------------

  async _fetchListing() {
    if (this._refreshSuppressed) return;
    const tab = this._activeTab();
    if (!tab) return;

    tab.entries = [];
    tab.total = null;
    tab.loading_more = false;
    tab.loading = true;
    // Non-destructive loading: dim existing content instead of wiping it
    const container = this.querySelector(`#tab-content-${tab.id}`);
    const listingArea = container && container.querySelector('.tab-listing-area');
    const listing = listingArea && listingArea.querySelector('.tab-listing');
    if (listing && listing.children.length > 0) {
      listing.classList.add('loading');
    } else {
      // No existing content to dim — ensure the DOM structure exists
      this._updateTabContent(tab.id);
    }

    try {
      const data = await this.browse(tab.path, tab.page_size || 100, 0, this._sortField, this._sortOrder);
      tab.entries = data.entries || [];
      tab.total = (data.total != null) ? data.total : tab.entries.length;
    } catch (error) {
      console.error('Failed to fetch listing:', error);
      tab.entries = [];
    }

    // Apply cached shared-with-me permissions to items that lack them
    if (tab.entries.length > 0) {
      this._applySharedPermissions(tab);
    }

    // Refresh deleted entries if eye toggle is on
    if (this._showHidden) {
      await this._fetchDeletedEntries(tab);
    } else {
      tab._deletedEntries = [];
    }

    tab.loading = false;
    this._updateTabContent(tab.id);
    this._attachScrollListener();

    // If listing is empty, check if the user has shared paths deeper in the
    // tree and show ancestor entries for navigation.
    if (tab.entries.length === 0 && typeof this.getSharedWithMe === 'function') {
      await this._showSharedAncestors(tab);
    }
  }

  /**
   * When a directory listing is empty (no permissions at this level), check
   * the user's shared-with-me paths and show virtual entries for child
   * directories that lead to shared content.
   */
  async _showSharedAncestors(tab) {
    try {
      // Cache shared-with-me for the session to avoid repeated scans.
      // Store both the path and its permissions for UI toggling.
      if (!this._sharedPathData) {
        const shared = await this.getSharedWithMe();
        this._sharedPathData = (shared.paths || []).map((s) => ({
          path: s.path.endsWith('/') ? s.path : s.path + '/',
          permissions: s.permissions || '-r--l---',
        }));
      }

      if (this._sharedPathData.length === 0) return;

      const currentPath = tab.path;

      // Find child directories at this level that are ancestors of shared paths.
      const childDirs = new Set();
      for (const sp of this._sharedPathData) {
        if (!sp.path.startsWith(currentPath)) continue;
        const remainder = sp.path.slice(currentPath.length);
        const nextSegment = remainder.split('/')[0];
        if (nextSegment) childDirs.add(nextSegment);
      }

      if (childDirs.size > 0) {
        tab.entries = [...childDirs].sort().map((name) => ({
          name,
          path: currentPath + name,
          entry_type: 3,
          size: 0,
          content_type: null,
          created_at: null,
          updated_at: null,
          // Ancestor directories are read+list only for navigation
          effective_permissions: '-r--l---',
        }));
        tab.total = tab.entries.length;
        this._updateTabContent(tab.id);
      }
    } catch (e) {
      // non-critical
    }
  }

  /**
   * For items returned by the server that don't have effective_permissions,
   * look up the cached shared-with-me data to determine permissions.
   * Called after _fetchListing when items exist but lack permission info.
   */
  _applySharedPermissions(tab) {
    if (!this._sharedPathData || this._sharedPathData.length === 0) return;
    const currentPath = tab.path;

    for (const entry of tab.entries) {
      if (entry.effective_permissions) continue; // already set by server

      // Check if this entry's path (or its parent directory) matches a shared path
      for (const sp of this._sharedPathData) {
        // Item is inside a shared directory
        if (currentPath.startsWith(sp.path) || (currentPath + '/').startsWith(sp.path)) {
          entry.effective_permissions = sp.permissions;
          break;
        }
        // Item IS the shared directory
        const entryFullPath = entry.path.endsWith('/') ? entry.path : entry.path + '/';
        if (entryFullPath === sp.path || sp.path.startsWith(entryFullPath)) {
          entry.effective_permissions = sp.permissions;
          break;
        }
      }
    }
  }

  async _fetchNextPage() {
    const tab = this._activeTab();
    if (!tab || tab.loading_more) return;
    if (tab.entries.length >= (tab.total || 0)) return;

    tab.loading_more = true;
    this._updateTabContent(tab.id);

    try {
      const data = await this.browse(tab.path, tab.page_size || 100, tab.entries.length, this._sortField, this._sortOrder);
      const newEntries = data.entries || [];
      for (const entry of newEntries) {
        tab.entries.push(entry);
      }
      tab.total = (data.total != null) ? data.total : tab.entries.length;
    } catch (error) {
      console.error('Failed to fetch next page:', error);
    }

    tab.loading_more = false;
    this._updateTabContent(tab.id);
    this._attachScrollListener();
  }

  _attachScrollListener() {
    const activeContainer = this.querySelector(`#tab-content-${this._active_tab_id}`);
    const listing = activeContainer && activeContainer.querySelector('.tab-listing');
    if (!listing) return;

    if (this._scroll_listener && this._scroll_listener_target) {
      this._scroll_listener_target.removeEventListener('scroll', this._scroll_listener);
    }

    this._scroll_listener_target = listing;
    this._scroll_listener = () => {
      const tab = this._activeTab();
      if (!tab || tab.loading_more) return;
      if (tab.total == null) return;
      if (tab.entries.length >= tab.total) return;

      const scrollBottom = listing.scrollHeight - listing.scrollTop - listing.clientHeight;
      if (scrollBottom < 200) {
        this._fetchNextPage();
      }
    };

    listing.addEventListener('scroll', this._scroll_listener);
  }

  // -------------------------------------------------------------------------
  // Preview
  // -------------------------------------------------------------------------

  async _loadPreview() {
    const tab = this._activeTab();
    if (!tab || !tab.preview_entry) return;

    const contentType = tab.preview_entry.content_type || 'application/octet-stream';
    tab.preview_component = await loadPreviewComponent(contentType);
    this._showPreview(tab);
  }

  _hydratePreview() {
    const tab = this._activeTab();
    if (!tab) return;
    this._showPreview(tab);
  }

  // -------------------------------------------------------------------------
  // Actions
  // -------------------------------------------------------------------------

  async _renamePreviewFile(newName) {
    const tab = this._activeTab();
    if (!tab || !tab.preview_entry) return;

    const oldName = tab.preview_entry.name;
    const fromPath = tab.path.replace(/\/$/, '') + '/' + oldName;
    const toPath = tab.path.replace(/\/$/, '') + '/' + newName;

    try {
      await this.renamePath(fromPath, toPath);
      tab.preview_entry.name = newName;
      // Update the input's original value to the new name
      const container = this.querySelector(`#tab-content-${tab.id}`);
      const titleInput = container && container.querySelector('.preview-title');
      if (titleInput) titleInput.dataset.original = newName;
      this._fetchListing();
    } catch (error) {
      if (window.aeorToast) {
        window.aeorToast('Rename failed: ' + error.message, 'error');
      }
      // Revert the input
      const container = this.querySelector(`#tab-content-${tab.id}`);
      const titleInput = container && container.querySelector('.preview-title');
      if (titleInput) titleInput.value = oldName;
    }
  }

  async _handlePreviewAction(action) {
    const tab = this._activeTab();
    if (!tab || !tab.preview_entry) return;

    const entry = tab.preview_entry;
    const filePath = tab.path.replace(/\/$/, '') + '/' + entry.name;

    switch (action) {
      case 'delete': {
        // If multiple files are selected, delete all of them
        if (tab.selectedEntries.size > 1) {
          // Context menu multi-delete needs confirmation
          const multiConfirmed = await this._confirm(
            'Delete Files',
            `Delete ${tab.selectedEntries.size} items? Files can be recovered from a snapshot if needed.`,
          );
          if (multiConfirmed) this._deleteSelected();
          break;
        }
        try {
          await this.deletePath(filePath);
          tab.preview_entry = null;
          this._fetchListing();
        } catch (error) {
          if (window.aeorToast) {
            window.aeorToast('Delete failed: ' + error.message, 'error');
          }
        }
        break;
      }

      case 'close-preview':
        tab.preview_entry = null;
        tab.preview_component = null;
        this._showPreview(tab);
        break;
    }
  }

  _handleConfigAction(action) {
    const tab = this._activeTab();
    if (!tab) return;

    const configPath = tab.path.replace(/\/$/, '');

    if (action === 'add-index') {
      this._showAddIndexModal(configPath);
    } else if (action === 'add-parser') {
      this._showAddParserModal(configPath);
    } else if (action === 'cors-config') {
      this._showCorsConfigModal(configPath);
    }
  }

  _showAddIndexModal(configPath) {
    const modal = document.createElement('aeor-modal');
    modal.title = 'Add Index';
    modal.innerHTML = `
      <div class="modal-field-group">
        <label class="modal-field-label">Field Name</label>
        <input type="text" class="index-field-name modal-field-input" placeholder="e.g. email">
      </div>
      <div class="modal-field-group">
        <label class="modal-field-label">Index Type</label>
        <select class="index-field-type modal-field-input">
          <option value="string">string</option>
          <option value="u64">u64</option>
          <option value="i64">i64</option>
          <option value="f64">f64</option>
          <option value="bool">bool</option>
          <option value="timestamp">timestamp</option>
          <option value="trigram">trigram</option>
          <option value="phonetic">phonetic</option>
        </select>
      </div>
      <div class="modal-field-group">
        <label class="modal-field-label">Min Value (optional, numeric types)</label>
        <input type="number" class="index-field-min modal-field-input" placeholder="">
      </div>
      <div class="modal-field-group">
        <label class="modal-field-label">Max Value (optional, numeric types)</label>
        <input type="number" class="index-field-max modal-field-input" placeholder="">
      </div>
      <div class="modal-footer-actions">
        <button class="secondary small modal-cancel">Cancel</button>
        <button class="primary small modal-save">Add Index</button>
      </div>
    `;
    document.body.appendChild(modal);

    const nameInput = modal.querySelector('.index-field-name');
    const typeSelect = modal.querySelector('.index-field-type');
    const minInput = modal.querySelector('.index-field-min');
    const maxInput = modal.querySelector('.index-field-max');

    setTimeout(() => nameInput.focus(), 100);

    let resolved = false;
    const done = () => {
      if (resolved) return;
      resolved = true;
      modal.remove();
    };

    const doSave = async () => {
      const fieldName = nameInput.value.trim();
      if (!fieldName) return;

      const fieldType = typeSelect.value;
      const fieldConfig = { name: fieldName, type: fieldType };

      const minVal = minInput.value.trim();
      const maxVal = maxInput.value.trim();
      if (minVal !== '') fieldConfig.min = Number(minVal);
      if (maxVal !== '') fieldConfig.max = Number(maxVal);

      const filePath = configPath + '/indexes.json';
      try {
        let existing = { indexes: [] };
        const raw = await this.readFile(filePath);
        if (raw) {
          try { existing = JSON.parse(raw); } catch (e) { /* start fresh */ }
        }
        if (!Array.isArray(existing.indexes))
          existing.indexes = [];

        existing.indexes.push(fieldConfig);

        const body = JSON.stringify(existing, null, 2);
        await this.upload(filePath, body, 'application/json');

        if (window.aeorToast)
          window.aeorToast(`Index "${fieldName}" added`, 'success');

        done();
        this._fetchListing();
      } catch (error) {
        if (window.aeorToast)
          window.aeorToast('Failed to save index: ' + error.message, 'error');
      }
    };

    modal.querySelector('.modal-save').addEventListener('click', doSave);
    modal.querySelector('.modal-cancel').addEventListener('click', done);
    modal.addEventListener('close', done);
    nameInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        doSave();
      }
    });
  }

  _showAddParserModal(configPath) {
    const modal = document.createElement('aeor-modal');
    modal.title = 'Add Parser';
    modal.innerHTML = `
      <div class="modal-field-group">
        <label class="modal-field-label">Content Type</label>
        <input type="text" class="parser-content-type modal-field-input" placeholder="e.g. application/pdf">
      </div>
      <div class="modal-field-group">
        <label class="modal-field-label">Parser Path</label>
        <input type="text" class="parser-path modal-field-input" placeholder="e.g. /parsers/pdf">
      </div>
      <div class="modal-footer-actions">
        <button class="secondary small modal-cancel">Cancel</button>
        <button class="primary small modal-save">Add Parser</button>
      </div>
    `;
    document.body.appendChild(modal);

    const contentTypeInput = modal.querySelector('.parser-content-type');
    const parserPathInput = modal.querySelector('.parser-path');

    setTimeout(() => contentTypeInput.focus(), 100);

    let resolved = false;
    const done = () => {
      if (resolved) return;
      resolved = true;
      modal.remove();
    };

    const doSave = async () => {
      const contentType = contentTypeInput.value.trim();
      const parserPath = parserPathInput.value.trim();
      if (!contentType || !parserPath) return;

      const filePath = configPath + '/parsers.json';
      try {
        let existing = {};
        const raw = await this.readFile(filePath);
        if (raw) {
          try { existing = JSON.parse(raw); } catch (e) { /* start fresh */ }
        }

        existing[contentType] = parserPath;

        const body = JSON.stringify(existing, null, 2);
        await this.upload(filePath, body, 'application/json');

        if (window.aeorToast)
          window.aeorToast(`Parser for "${contentType}" added`, 'success');

        done();
        this._fetchListing();
      } catch (error) {
        if (window.aeorToast)
          window.aeorToast('Failed to save parser: ' + error.message, 'error');
      }
    };

    modal.querySelector('.modal-save').addEventListener('click', doSave);
    modal.querySelector('.modal-cancel').addEventListener('click', done);
    modal.addEventListener('close', done);
    contentTypeInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        doSave();
      }
    });
  }

  _showCorsConfigModal(configPath) {
    const modal = document.createElement('aeor-modal');
    modal.title = 'CORS Config';
    modal.innerHTML = `
      <div class="modal-field-group">
        <label class="modal-field-label">Origins (comma-separated)</label>
        <input type="text" class="cors-origins modal-field-input" placeholder="e.g. https://example.com, https://app.example.com">
      </div>
      <div class="modal-field-group">
        <label class="modal-field-label">Methods (comma-separated)</label>
        <input type="text" class="cors-methods modal-field-input" value="GET,POST,PUT,DELETE">
      </div>
      <div class="modal-field-group">
        <label class="modal-field-label">Headers (comma-separated)</label>
        <input type="text" class="cors-headers modal-field-input" value="Content-Type,Authorization">
      </div>
      <div class="modal-footer-actions">
        <button class="secondary small modal-cancel">Cancel</button>
        <button class="primary small modal-save">Save CORS</button>
      </div>
    `;
    document.body.appendChild(modal);

    const originsInput = modal.querySelector('.cors-origins');
    const methodsInput = modal.querySelector('.cors-methods');
    const headersInput = modal.querySelector('.cors-headers');

    // Try to load existing config
    const filePath = configPath + '/cors.json';
    this.readFile(filePath).then((raw) => {
      if (!raw) return;
      try {
        const existing = JSON.parse(raw);
        if (existing.origins) originsInput.value = (Array.isArray(existing.origins)) ? existing.origins.join(', ') : existing.origins;
        if (existing.methods) methodsInput.value = (Array.isArray(existing.methods)) ? existing.methods.join(', ') : existing.methods;
        if (existing.headers) headersInput.value = (Array.isArray(existing.headers)) ? existing.headers.join(', ') : existing.headers;
      } catch (e) { /* ignore */ }
    });

    setTimeout(() => originsInput.focus(), 100);

    let resolved = false;
    const done = () => {
      if (resolved) return;
      resolved = true;
      modal.remove();
    };

    const doSave = async () => {
      const origins = originsInput.value.trim();
      const methods = methodsInput.value.trim();
      const headers = headersInput.value.trim();
      if (!origins) return;

      const config = {
        origins: origins.split(',').map((s) => s.trim()).filter((s) => s),
        methods: methods.split(',').map((s) => s.trim()).filter((s) => s),
        headers: headers.split(',').map((s) => s.trim()).filter((s) => s),
      };

      try {
        const body = JSON.stringify(config, null, 2);
        await this.upload(filePath, body, 'application/json');

        if (window.aeorToast)
          window.aeorToast('CORS config saved', 'success');

        done();
        this._fetchListing();
      } catch (error) {
        if (window.aeorToast)
          window.aeorToast('Failed to save CORS config: ' + error.message, 'error');
      }
    };

    modal.querySelector('.modal-save').addEventListener('click', doSave);
    modal.querySelector('.modal-cancel').addEventListener('click', done);
    modal.addEventListener('close', done);
  }

  _promptNewFolder() {
    const modal = document.createElement('aeor-modal');
    modal.title = 'New Folder';
    modal.innerHTML = `
      <div class="modal-field-group">
        <label class="modal-field-label">Folder Name</label>
        <input type="text" class="new-folder-name modal-field-input" placeholder="my-folder">
      </div>
      <div class="modal-footer-actions">
        <button class="secondary small modal-cancel">Cancel</button>
        <button class="primary small modal-create">Create</button>
      </div>
    `;
    document.body.appendChild(modal);

    const input = modal.querySelector('.new-folder-name');
    const createBtn = modal.querySelector('.modal-create');
    const cancelBtn = modal.querySelector('.modal-cancel');

    // Focus the input
    setTimeout(() => input.focus(), 100);

    let resolved = false;
    const done = () => {
      if (resolved) return;
      resolved = true;
      modal.remove();
    };

    const doCreate = async () => {
      const name = input.value.trim();
      if (!name) return;

      const tab = this._activeTab();
      if (!tab) return;

      const folderPath = tab.path.replace(/\/$/, '') + '/' + name;
      try {
        await this.createDirectory(folderPath);
        done();
        this._fetchListing();
      } catch (error) {
        if (window.aeorToast)
          window.aeorToast('Failed to create folder: ' + error.message, 'error');
      }
    };

    createBtn.addEventListener('click', doCreate);
    cancelBtn.addEventListener('click', done);
    modal.addEventListener('close', done);
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        doCreate();
      }
    });
  }

  /**
   * Handle dropped DataTransferItems — supports folders via webkitGetAsEntry.
   * Recursively reads folder contents and collects all files with their
   * relative paths preserved.
   */
  async _handleDroppedItems(items) {
    const files = [];

    const readEntry = (entry, pathPrefix) => {
      return new Promise((resolve) => {
        if (entry.isFile) {
          entry.file((file) => {
            // Attach the relative path so _uploadFiles can preserve folder structure
            file._relativePath = pathPrefix + file.name;
            files.push(file);
            resolve();
          }, () => resolve()); // skip on error
        } else if (entry.isDirectory) {
          const reader = entry.createReader();
          const readBatch = () => {
            reader.readEntries(async (entries) => {
              if (entries.length === 0) {
                resolve();
                return;
              }
              for (const child of entries) {
                await readEntry(child, pathPrefix + entry.name + '/');
              }
              // readEntries may not return all entries at once — keep reading
              readBatch();
            }, () => resolve());
          };
          readBatch();
        } else {
          resolve();
        }
      });
    };

    // Process all dropped items
    const promises = [];
    for (let i = 0; i < items.length; i++) {
      const entry = items[i].webkitGetAsEntry();
      if (entry) {
        promises.push(readEntry(entry, ''));
      }
    }
    await Promise.all(promises);

    if (files.length > 0) {
      this._uploadFilesWithPaths(files);
    }
  }

  /**
   * Upload files with relative paths preserved (from folder drops).
   * Each file has a `_relativePath` property with the folder-relative path.
   */
  async _uploadFilesWithPaths(files) {
    const tab = this._activeTab();
    if (!tab || !files || files.length === 0) return;

    const totalFiles = files.length;
    let completedFiles = 0;
    let totalBytes = 0;
    let uploadedBytes = 0;
    let failedCount = 0;
    let cancelled = false;
    const startTime = Date.now();

    for (const file of files) totalBytes += file.size;

    // Show progress panel
    const container = this.querySelector(`#tab-content-${tab.id}`);
    let progressPanel = container && container.querySelector('.upload-progress');
    if (!progressPanel && container) {
      progressPanel = document.createElement('div');
      progressPanel.className = 'upload-progress';
      container.appendChild(progressPanel);
    }

    // Build the progress panel DOM once, then update in place.
    // This prevents the cancel button from being destroyed mid-press.
    let progressInitialized = false;
    const updateProgress = (currentFile, fileLoaded, fileTotal) => {
      if (!progressPanel) return;
      const currentUploadedBytes = uploadedBytes + fileLoaded;
      const overallPercent = (totalBytes > 0) ? Math.round((currentUploadedBytes / totalBytes) * 100) : 0;
      const elapsed = (Date.now() - startTime) / 1000;
      const speed = (elapsed > 0) ? currentUploadedBytes / elapsed : 0;
      const speedText = this._formatSpeed(speed);
      const remaining = (speed > 0) ? (totalBytes - currentUploadedBytes) / speed : 0;
      const remainingText = (remaining > 0) ? this._formatDuration(remaining) : '';

      if (!progressInitialized) {
        progressInitialized = true;
        progressPanel.innerHTML = `
          <div class="upload-progress-header">
            <span class="upload-progress-title"></span>
            <span class="upload-progress-speed"></span>
          </div>
          <div class="upload-progress-filename"></div>
          <div class="upload-progress-bar-track">
            <div class="upload-progress-bar-fill" style="width: 0%"></div>
          </div>
          <div class="upload-progress-meta upload-progress-meta-flex">
            <span class="upload-progress-count"></span>
            <aeor-confirm-button label="Cancel" duration="1000"></aeor-confirm-button>
          </div>
        `;
        const cancelBtn = progressPanel.querySelector('aeor-confirm-button');
        if (cancelBtn) cancelBtn.addEventListener('confirm', () => { cancelled = true; });
      }

      // Update text nodes in place — no DOM destruction
      const title = progressPanel.querySelector('.upload-progress-title');
      const speedEl = progressPanel.querySelector('.upload-progress-speed');
      const filenameEl = progressPanel.querySelector('.upload-progress-filename');
      const fillEl = progressPanel.querySelector('.upload-progress-bar-fill');
      const countEl = progressPanel.querySelector('.upload-progress-count');
      if (title) title.textContent = `Uploading ${completedFiles + 1} of ${totalFiles}`;
      if (speedEl) speedEl.textContent = `${speedText}${(remainingText) ? ' \u00B7 ' + remainingText + ' remaining' : ''}`;
      if (filenameEl) filenameEl.textContent = currentFile;
      if (fillEl) fillEl.style.width = `${overallPercent}%`;
      if (countEl) countEl.textContent = `${completedFiles} of ${totalFiles} files complete${(failedCount > 0) ? ' \u00B7 ' + failedCount + ' failed' : ''}`;
    };

    for (const file of files) {
      if (cancelled) break;
      const relativePath = file._relativePath || file.name;
      const filePath = tab.path.replace(/\/$/, '') + '/' + relativePath;

      try {
        updateProgress(relativePath, 0, file.size);
        await this.uploadWithProgress(filePath, file, (loaded, total) => {
          updateProgress(relativePath, loaded, total);
        });
        uploadedBytes += file.size;
        completedFiles++;
      } catch (error) {
        uploadedBytes += file.size;
        completedFiles++;
        failedCount++;
        if (window.aeorToast) {
          window.aeorToast(`Upload failed for ${relativePath}: ${error.message}`, 'error');
        }
      }
    }

    if (progressPanel) {
      const statusTitle = cancelled ? 'Upload cancelled' : 'Upload complete';
      const skippedText = cancelled ? ` \u00B7 ${totalFiles - completedFiles} skipped` : '';
      progressPanel.innerHTML = `
        <div class="upload-progress-header">
          <span class="upload-progress-title">${statusTitle}</span>
        </div>
        <div class="upload-progress-bar-track">
          <div class="upload-progress-bar-fill" style="width: ${cancelled ? Math.round((completedFiles / totalFiles) * 100) : 100}%"></div>
        </div>
        <div class="upload-progress-meta">
          ${completedFiles} files uploaded${(failedCount > 0) ? ' \u00B7 ' + failedCount + ' failed' : ''}${skippedText}
        </div>
      `;
      setTimeout(() => { if (progressPanel.parentNode) progressPanel.remove(); }, 2000);
    }

    this._fetchListing();
  }

  async _handleUpload(event) {
    await this._uploadFiles(event.target.files);
    event.target.value = '';
  }

  async _uploadFiles(files) {
    const tab = this._activeTab();
    if (!tab || !files || files.length === 0) return;

    const totalFiles = files.length;
    let completedFiles = 0;
    let totalBytes = 0;
    let uploadedBytes = 0;
    let failedCount = 0;
    const startTime = Date.now();

    for (const file of files) totalBytes += file.size;

    // Show progress panel at the bottom of the tab content
    const container = this.querySelector(`#tab-content-${tab.id}`);
    let progressPanel = container && container.querySelector('.upload-progress');
    if (!progressPanel && container) {
      progressPanel = document.createElement('div');
      progressPanel.className = 'upload-progress';
      container.appendChild(progressPanel);
    }

    let progressInitialized = false;
    const updateProgress = (currentFile, fileLoaded, fileTotal) => {
      if (!progressPanel) return;

      const currentUploadedBytes = uploadedBytes + fileLoaded;
      const overallPercent = (totalBytes > 0) ? Math.round((currentUploadedBytes / totalBytes) * 100) : 0;
      const elapsed = (Date.now() - startTime) / 1000;
      const speed = (elapsed > 0) ? currentUploadedBytes / elapsed : 0;
      const speedText = this._formatSpeed(speed);
      const remaining = (speed > 0) ? (totalBytes - currentUploadedBytes) / speed : 0;
      const remainingText = (remaining > 0) ? this._formatDuration(remaining) : '';

      if (!progressInitialized) {
        progressInitialized = true;
        progressPanel.innerHTML = `
          <div class="upload-progress-header">
            <span class="upload-progress-title"></span>
            <span class="upload-progress-speed"></span>
          </div>
          <div class="upload-progress-filename"></div>
          <div class="upload-progress-bar-track">
            <div class="upload-progress-bar-fill" style="width: 0%"></div>
          </div>
          <div class="upload-progress-meta"></div>
        `;
      }

      // Update text nodes in place — no DOM destruction
      const title = progressPanel.querySelector('.upload-progress-title');
      const speedEl = progressPanel.querySelector('.upload-progress-speed');
      const filenameEl = progressPanel.querySelector('.upload-progress-filename');
      const fillEl = progressPanel.querySelector('.upload-progress-bar-fill');
      const countEl = progressPanel.querySelector('.upload-progress-meta');
      if (title) title.textContent = `Uploading ${completedFiles + 1} of ${totalFiles}`;
      if (speedEl) speedEl.textContent = `${speedText}${(remainingText) ? ' \u00B7 ' + remainingText + ' remaining' : ''}`;
      if (filenameEl) filenameEl.textContent = currentFile;
      if (fillEl) fillEl.style.width = `${overallPercent}%`;
      if (countEl) countEl.textContent = `${completedFiles} of ${totalFiles} files complete${(failedCount > 0) ? ' \u00B7 ' + failedCount + ' failed' : ''}`;
    };

    for (const file of files) {
      const filePath = tab.path.replace(/\/$/, '') + '/' + file.name;

      try {
        updateProgress(file.name, 0, file.size);
        await this.uploadWithProgress(filePath, file, (loaded, total) => {
          updateProgress(file.name, loaded, total);
        });
        uploadedBytes += file.size;
        completedFiles++;
      } catch (error) {
        uploadedBytes += file.size;
        completedFiles++;
        failedCount++;
        if (window.aeorToast) {
          window.aeorToast(`Upload failed for ${file.name}: ${error.message}`, 'error');
        }
      }
    }

    // Show completion briefly, then remove
    if (progressPanel) {
      progressPanel.innerHTML = `
        <div class="upload-progress-header">
          <span class="upload-progress-title">Upload complete</span>
        </div>
        <div class="upload-progress-bar-track">
          <div class="upload-progress-bar-fill" style="width: 100%"></div>
        </div>
        <div class="upload-progress-meta">
          ${completedFiles} files uploaded${(failedCount > 0) ? ' \u00B7 ' + failedCount + ' failed' : ''}
        </div>
      `;
      setTimeout(() => { if (progressPanel.parentNode) progressPanel.remove(); }, 2000);
    }

    this._fetchListing();
  }

  /**
   * Upload a file with progress callback. Override in subclasses for
   * byte-level progress (e.g. via XHR). Default: falls back to upload().
   */
  async uploadWithProgress(path, file, onProgress) {
    const arrayBuffer = await file.arrayBuffer();
    await this.upload(path, arrayBuffer, file.type || 'application/octet-stream');
    onProgress(file.size, file.size);
  }

  _formatSpeed(bytesPerSec) {
    if (bytesPerSec >= 1048576) return (bytesPerSec / 1048576).toFixed(1) + ' MB/s';
    if (bytesPerSec >= 1024) return (bytesPerSec / 1024).toFixed(0) + ' KB/s';
    return Math.round(bytesPerSec) + ' B/s';
  }

  _formatDuration(seconds) {
    if (seconds < 60) return Math.round(seconds) + 's';
    if (seconds < 3600) return Math.round(seconds / 60) + 'm ' + Math.round(seconds % 60) + 's';
    return Math.round(seconds / 3600) + 'h ' + Math.round((seconds % 3600) / 60) + 'm';
  }

  async _showShareModal(paths) {
    if (!paths || paths.length === 0) return;

    const modal = document.createElement('aeor-modal');
    modal.title = 'Share';

    // Show a loading state while we fetch data
    modal.innerHTML = '<div class="share-loading">Loading...</div>';
    document.body.appendChild(modal);

    // Fetch users, groups, and current shares in parallel
    let users = [];
    let groups = [];
    let currentShares = [];
    try {
      const [usersResult, groupsResult, sharesResult] = await Promise.allSettled([
        this.getShareableUsers(),
        this.getShareableGroups(),
        this.getShares(paths[0]),
      ]);
      if (usersResult.status === 'fulfilled') users = usersResult.value || [];
      if (groupsResult.status === 'fulfilled') groups = groupsResult.value || [];
      if (sharesResult.status === 'fulfilled') {
        const sharesData = sharesResult.value || {};
        currentShares = sharesData.shares || [];
      }
    } catch (error) {
      // continue with empty data
    }

    // Fetch active share links (non-critical)
    let activeLinks = [];
    try {
      const linksData = await this.getShareLinks(paths[0]);
      activeLinks = linksData.links || [];
    } catch (e) { /* non-critical */ }

    const fileNames = paths.length <= 3
      ? paths.map((p) => p.split('/').pop()).join(', ')
      : `${paths.length} files`;

    // Build user options (API returns { user_id, username })
    // Filter out root (already has access) and the current user (can't share with yourself)
    const ROOT_UUID = '00000000-0000-0000-0000-000000000000';
    const currentUserId = (typeof window !== 'undefined' && window.AUTH && window.AUTH.currentUserId)
      ? window.AUTH.currentUserId() : null;
    const filteredUsers = users.filter((u) => {
      const uid = String(u.user_id || u.id || '');
      if (uid === ROOT_UUID) return false;
      if (currentUserId && uid === currentUserId) return false;
      return true;
    });
    const userOptions = filteredUsers.map((u) => {
      const label = u.username || u.user_id || '';
      const value = u.user_id || u.id || '';
      return `<option value="${escapeAttr(value)}">${escapeHtml(label)}</option>`;
    }).join('');

    // Build group options — filter out user:UUID auto-groups (redundant with Users selector)
    const filteredGroups = groups.filter((g) => {
      const name = g.name || g.group || '';
      return !name.startsWith('user:');
    });
    const groupOptions = filteredGroups.map((g) => {
      const label = g.name || g.group || g.id || '';
      const value = g.name || g.group || g.id || '';
      return `<option value="${escapeAttr(value)}">${escapeHtml(label)}</option>`;
    }).join('');

    // Build current shares list
    let sharesHtml = '';
    if (Array.isArray(currentShares) && currentShares.length > 0) {
      const shareRows = currentShares.map((s) => {
        const target = s.username || s.display_name || s.group || 'Unknown';
        const perm = s.allow || s.permissions || '';
        const pattern = s.path_pattern || s.path || '';
        return `
          <div class="share-entry-row">
            <div>
              <span class="share-entry-name">${escapeHtml(target)}</span>
              <span class="share-entry-perm">${escapeHtml(perm)}</span>
            </div>
            <button class="danger small share-revoke-btn" data-group="${escapeAttr(s.group || '')}" data-pattern="${escapeAttr(pattern)}">&times;</button>
          </div>
        `;
      }).join('');
      sharesHtml = `
        <div class="current-shares-section">
          <div class="modal-field-label">Current Shares</div>
          ${shareRows}
        </div>
      `;
    }

    // Build active share links HTML for Link tab
    const linkSharesHtml = activeLinks.length > 0 ? activeLinks.map((l) => `
      <div class="link-entry-row">
        <div>
          <span class="link-entry-label">${escapeHtml(l.label || 'Share link')}</span>
          <span class="link-entry-expires">${l.expires_at ? new Date(l.expires_at).toLocaleDateString() : 'Never expires'}</span>
        </div>
        <button class="danger small link-revoke-btn" data-key-id="${escapeAttr(l.key_id)}">&times;</button>
      </div>
    `).join('') : '<div class="no-active-links">No active links</div>';

    // Populate modal body
    const body = modal.querySelector('.aeor-modal__body');
    body.innerHTML = `
      <div class="share-file-summary">
        Sharing: ${escapeHtml(fileNames)}${(paths.length > 1) ? ` (${paths.length} items)` : ''}
      </div>

      <div class="tab-bar share-tab-bar">
        <div class="tab active share-tab-btn" data-share-tab="people">People</div>
        <div class="tab share-tab-btn" data-share-tab="link">Link</div>
      </div>

      <div class="share-tab-people">
        <div class="share-section">
          <label class="modal-field-label">Users</label>
          <input type="text" class="share-users-filter modal-field-input share-filter-input" placeholder="Search users...">
          <select class="share-users-select modal-field-input share-multi-select" multiple>
            ${userOptions}
          </select>
          <div class="share-select-hint">Hold Ctrl/Cmd to select multiple</div>
        </div>

        <div class="share-section">
          <label class="modal-field-label">Groups</label>
          <input type="text" class="share-groups-filter modal-field-input share-filter-input" placeholder="Search groups...">
          <select class="share-groups-select modal-field-input share-multi-select" multiple>
            ${groupOptions}
          </select>
        </div>

        <div class="share-section">
          <label class="modal-field-label">Permission Level</label>
          <select class="share-permission-select modal-field-input">
            <option value=".r..l...">View only</option>
            <option value="crudl...">Can edit</option>
            <option value="crudlify">Full access</option>
            <option value="custom">Custom</option>
          </select>
        </div>
        <div class="share-custom-flags hidden custom-flags-section">
          <aeor-crudlify class="share-crudlify" value="--------"></aeor-crudlify>
        </div>

        <div class="modal-footer-actions">
          <button class="secondary small share-cancel">Cancel</button>
          <button class="primary small share-submit">Share</button>
        </div>
      </div>

      <div class="share-tab-link hidden">
        <div class="share-section">
          <label class="modal-field-label">Permission Level</label>
          <select class="link-permission-select modal-field-input">
            <option value="-r--l---">View only</option>
            <option value="crudl..." selected>Can edit</option>
            <option value="crudlify">Full access</option>
            <option value="custom">Custom</option>
          </select>
        </div>
        <div class="link-custom-flags hidden share-section">
          <aeor-crudlify class="link-crudlify" value="--------"></aeor-crudlify>
        </div>
        <div class="share-section">
          <label class="modal-field-label">Expiration</label>
          <select class="link-expiry-select modal-field-input">
            <option value="">Never</option>
            <option value="1">1 day</option>
            <option value="7">7 days</option>
            <option value="30">30 days</option>
            <option value="90">90 days</option>
            <option value="365">1 year</option>
          </select>
        </div>
        <div class="link-create-footer">
          <button class="primary small link-create-btn">Create Link</button>
        </div>
        <div class="link-result hidden link-result-section">
          <label class="modal-field-label">Share URL</label>
          <div class="link-result-row">
            <input type="text" class="link-url-input modal-field-input flex-1" readonly onfocus="this.select()">
            <button class="secondary small link-copy-btn">Copy</button>
          </div>
        </div>
        <div class="link-active-links">${linkSharesHtml}</div>
      </div>

      ${sharesHtml}
    `;

    // Tab switching
    body.querySelectorAll('.share-tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        body.querySelectorAll('.share-tab-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        const tab = btn.dataset.shareTab;
        const peopleContent = body.querySelector('.share-tab-people');
        const linkContent = body.querySelector('.share-tab-link');
        if (peopleContent) peopleContent.classList.toggle('hidden', tab !== 'people');
        if (linkContent) linkContent.classList.toggle('hidden', tab !== 'link');
      });
    });

    // Bind events
    const usersSelect = body.querySelector('.share-users-select');
    const groupsSelect = body.querySelector('.share-groups-select');
    const permSelect = body.querySelector('.share-permission-select');
    const customFlags = body.querySelector('.share-custom-flags');

    // Toggle custom flags visibility
    permSelect.addEventListener('change', () => {
      customFlags.classList.toggle('hidden', permSelect.value !== 'custom');
    });

    // Search filter for user select
    body.querySelector('.share-users-filter').addEventListener('input', (e) => {
      const q = e.target.value.toLowerCase();
      for (const opt of usersSelect.options) {
        opt.classList.toggle('hidden', !opt.text.toLowerCase().includes(q));
      }
    });

    // Search filter for group select
    body.querySelector('.share-groups-filter').addEventListener('input', (e) => {
      const q = e.target.value.toLowerCase();
      for (const opt of groupsSelect.options) {
        opt.classList.toggle('hidden', !opt.text.toLowerCase().includes(q));
      }
    });

    let resolved = false;
    const done = () => {
      if (resolved) return;
      resolved = true;
      modal.remove();
    };

    // Build permission string from crudlify component or preset
    const getPermissionString = () => {
      if (permSelect.value !== 'custom') return permSelect.value;
      const crudlify = body.querySelector('.share-crudlify');
      return crudlify ? crudlify.value : '--------';
    };

    // Submit share
    body.querySelector('.share-submit').addEventListener('click', async () => {
      const selectedUsers = Array.from(usersSelect.selectedOptions).map((o) => o.value);
      const selectedGroups = Array.from(groupsSelect.selectedOptions).map((o) => o.value);
      const permLevel = getPermissionString();

      if (selectedUsers.length === 0 && selectedGroups.length === 0) {
        if (window.aeorToast)
          window.aeorToast('Select at least one user or group', 'error');
        return;
      }

      try {
        await this.share(paths, selectedUsers, selectedGroups, permLevel);
        if (window.aeorToast)
          window.aeorToast('Shared successfully', 'success');
        done();
      } catch (error) {
        if (window.aeorToast)
          window.aeorToast('Share failed: ' + error.message, 'error');
      }
    });

    // Cancel
    body.querySelector('.share-cancel').addEventListener('click', done);
    modal.addEventListener('close', done);

    // Revoke buttons (People tab)
    body.querySelectorAll('.share-revoke-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const group = btn.dataset.group;
        const pattern = btn.dataset.pattern;
        try {
          await this.unshare(paths[0], group, pattern);
          if (window.aeorToast)
            window.aeorToast('Share revoked', 'success');
          // Remove the row from DOM
          btn.closest('div[style]').remove();
        } catch (error) {
          if (window.aeorToast)
            window.aeorToast('Revoke failed: ' + error.message, 'error');
        }
      });
    });

    // Create Link button
    // Link tab: Custom permission toggle
    const linkPermSelect = body.querySelector('.link-permission-select');
    const linkCustomFlags = body.querySelector('.link-custom-flags');
    if (linkPermSelect && linkCustomFlags) {
      linkPermSelect.addEventListener('change', () => {
        linkCustomFlags.classList.toggle('hidden', linkPermSelect.value !== 'custom');
      });
    }

    const getLinkPermissionString = () => {
      if (!linkPermSelect || linkPermSelect.value !== 'custom') return linkPermSelect ? linkPermSelect.value : '-r--l---';
      const crudlify = body.querySelector('.link-crudlify');
      return crudlify ? crudlify.value : '--------';
    };

    // Create Link button
    const linkCreateBtn = body.querySelector('.link-create-btn');
    if (linkCreateBtn) {
      linkCreateBtn.addEventListener('click', async () => {
        const permLevel = getLinkPermissionString();
        const expiryDays = body.querySelector('.link-expiry-select').value;
        const expires = expiryDays ? parseInt(expiryDays) : null;
        try {
          const result = await this.createShareLink(paths, permLevel, expires);
          const resultDiv = body.querySelector('.link-result');
          const urlInput = body.querySelector('.link-url-input');
          resultDiv.classList.remove('hidden');
          urlInput.value = result.url;
          if (window.aeorToast) window.aeorToast('Share link created', 'success');
        } catch (error) {
          if (window.aeorToast) window.aeorToast('Failed: ' + error.message, 'error');
        }
      });
    }

    // Copy button with flash feedback
    const linkCopyBtn = body.querySelector('.link-copy-btn');
    if (linkCopyBtn) {
      linkCopyBtn.addEventListener('click', async () => {
        const urlInput = body.querySelector('.link-url-input');
        try {
          await navigator.clipboard.writeText(urlInput.value);
          flashButton(linkCopyBtn, true, 'Copied!');
        } catch (e) {
          flashButton(linkCopyBtn, false, 'Error');
        }
      });
    }

    // Revoke buttons (Link tab)
    body.querySelectorAll('.link-revoke-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        try {
          await this.revokeShareLink(btn.dataset.keyId);
          btn.closest('div[style]').remove();
          if (window.aeorToast) window.aeorToast('Link revoked', 'success');
        } catch (error) {
          if (window.aeorToast) window.aeorToast('Revoke failed: ' + error.message, 'error');
        }
      });
    });
  }

  _showBackgroundContextMenu(x, y) {
    const existing = this.querySelector('.context-menu');
    if (existing) existing.remove();

    const clipboard = this._getClipboard();
    if (!clipboard) return; // Nothing to paste — no menu needed

    const isMac = navigator.platform.includes('Mac');
    const mod = isMac ? 'Cmd' : 'Ctrl';

    const menu = document.createElement('div');
    menu.className = 'context-menu';
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';
    menu.innerHTML = `
      <div class="context-menu-item" data-context="paste">Paste <span class="context-menu-hotkey">${mod}+V</span></div>
    `;
    this.appendChild(menu);

    const rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth) menu.style.left = (x - rect.width) + 'px';
    if (rect.bottom > window.innerHeight) menu.style.top = (y - rect.height) + 'px';

    menu.querySelectorAll('.context-menu-item').forEach((item) => {
      item.addEventListener('click', () => {
        menu.remove();
        if (item.dataset.context === 'paste') this._pasteClipboard();
      });
    });

    const closeMenu = (event) => {
      if (!menu.contains(event.target)) {
        menu.remove();
        document.removeEventListener('click', closeMenu);
      }
    };
    setTimeout(() => document.addEventListener('click', closeMenu), 0);
  }

  _showContextMenu(x, y, entry) {
    const existing = this.querySelector('.context-menu');
    if (existing) existing.remove();

    const isMac = navigator.platform.includes('Mac');
    const mod = isMac ? 'Cmd' : 'Ctrl';
    const clipboard = this._getClipboard();
    const tab = this._activeTab();

    const menu = document.createElement('div');
    menu.className = 'context-menu';
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';
    menu.innerHTML = `
      <div class="context-menu-item" data-context="preview">Preview</div>
      ${this._hasPermission('y') ? `<div class="context-menu-item" data-context="share">Share</div>` : ''}
      ${this._hasPermission('u') ? `<div class="context-menu-item" data-context="cut">Cut <span class="context-menu-hotkey">${mod}+X</span></div>` : ''}
      <div class="context-menu-item" data-context="copy">Copy <span class="context-menu-hotkey">${mod}+C</span></div>
      ${clipboard ? `<div class="context-menu-item" data-context="paste">Paste <span class="context-menu-hotkey">${mod}+V</span></div>` : ''}
      ${this._hasPermission('d') ? '<hr class="context-menu-separator">' : ''}
      ${this._hasPermission('d') ? `<div class="context-menu-item context-menu-danger" data-context="delete-instant">Delete <span class="context-menu-hotkey">Del</span></div>` : ''}
    `;

    this.appendChild(menu);

    const rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth) menu.style.left = (x - rect.width) + 'px';
    if (rect.bottom > window.innerHeight) menu.style.top = (y - rect.height) + 'px';

    menu.querySelectorAll('.context-menu-item').forEach((item) => {
      item.addEventListener('click', () => {
        menu.remove();
        const action = item.dataset.context;
        if (action === 'preview') {
          if (tab) {
            tab.preview_entry = entry;
            tab.preview_component = null;
          }
          this._loadPreview();
        } else if (action === 'share') {
          if (tab) {
            let filePath = tab.path.replace(/\/$/, '') + '/' + entry.name;
            if (entry.entry_type === ENTRY_TYPE_DIR) filePath += '/';
            this._showShareModal([filePath]);
          }
        } else if (action === 'cut') {
          this._cutSelected(entry);
        } else if (action === 'copy') {
          this._copySelected(entry);
        } else if (action === 'paste') {
          this._pasteClipboard();
        } else if (action === 'delete-instant') {
          this._deleteInstant(entry);
        }
      });
    });

    const closeMenu = (event) => {
      if (!menu.contains(event.target)) {
        menu.remove();
        document.removeEventListener('click', closeMenu);
      }
    };
    setTimeout(() => document.addEventListener('click', closeMenu), 0);
  }

  // -------------------------------------------------------------------------
  // Utilities
  // -------------------------------------------------------------------------

  _activeTab() {
    return this._tabs.find((t) => t.id === this._active_tab_id) || null;
  }

  _truncate(str, max) {
    if (str.length <= max) return str;
    return str.substring(0, max - 1) + '\u2026';
  }

  _sortIndicator(field) {
    if (this._sortField !== field) return '';
    const arrow = (this._sortOrder === 'asc') ? '\u25B2' : '\u25BC';
    return `<span class="sort-indicator active">${arrow}</span>`;
  }

  async _handleSort(field) {
    // Prevent re-entrancy from stacked event handlers
    if (this._sorting) return;
    this._sorting = true;

    if (this._sortField === field) {
      this._sortOrder = (this._sortOrder === 'asc') ? 'desc' : 'asc';
    } else {
      this._sortField = field;
      this._sortOrder = 'asc';
    }

    const tab = this._activeTab();
    if (!tab) { this._sorting = false; return; }

    // Save preview state so it survives the re-render
    const savedPreview = tab.preview_entry;
    const savedComponent = tab.preview_component;

    // Fetch sorted data
    try {
      const data = await this.browse(tab.path, tab.page_size || 100, 0, this._sortField, this._sortOrder);
      tab.entries = data.entries || [];
      tab.total = (data.total != null) ? data.total : tab.entries.length;
    } catch (error) {
      console.error('Failed to fetch sorted listing:', error);
      this._sorting = false;
      return;
    }

    // Restore preview state before re-render
    tab.preview_entry = savedPreview;
    tab.preview_component = savedComponent;

    // Re-render tab content (this rebuilds the listing + preserves preview)
    this._updateTabContent(tab.id);

    this._sorting = false;
  }

  // ---------------------------------------------------------------------------
  // Deleted files
  // ---------------------------------------------------------------------------

  /**
   * Fetch deleted files for the current directory and store them on the tab.
   * Override _fetchDeleted() in subclasses to provide the API call.
   */
  async _fetchDeletedEntries(tab) {
    try {
      const items = await this._fetchDeleted(tab.path);
      // Filter out entries that still exist in the live listing (re-created after delete)
      const liveNames = new Set(tab.entries.map((e) => e.name));
      tab._deletedEntries = items
        .filter((d) => !liveNames.has(d.name))
        .map((d) => ({
          name: d.name,
          path: d.path,
          entry_type: 2, // file
          size: 0,
          content_type: null,
          created_at: null,
          updated_at: d.deleted_at,
          _deleted: true,
          _deleted_at: d.deleted_at,
        }));
    } catch (_) {
      tab._deletedEntries = [];
    }
  }

  async _restoreSelected() {
    const tab = this._activeTab();
    if (!tab) return;

    const allEntries = [...tab.entries, ...(tab._deletedEntries || [])];
    const toRestore = [...tab.selectedEntries]
      .map((path) => {
        const name = path.split('/').pop();
        return allEntries.find((e) => e.name === name && e._deleted);
      })
      .filter(Boolean);

    if (toRestore.length === 0) return;

    let restored = 0;
    let failed = 0;
    for (const entry of toRestore) {
      try {
        await this._restoreFile(entry.path);
        restored++;
      } catch (_) {
        failed++;
      }
    }

    if (window.aeorToast) {
      const msg = failed > 0
        ? `Restored ${restored} files, ${failed} failed`
        : `Restored ${restored} file${restored > 1 ? 's' : ''}`;
      window.aeorToast(msg, failed > 0 ? 'warning' : 'success');
    }

    tab.selectedEntries.clear();
    tab.preview_entry = null;
    const container = this.querySelector(`#tab-content-${tab.id}`);
    if (container) {
      const panel = container.querySelector('.preview-panel');
      if (panel) panel.classList.add('hidden');
    }
    this._fetchListing();
  }

  /**
   * Fetch deleted file records for a directory. Override in subclasses.
   * Should return an array of { name, path, deleted_at }.
   */
  async _fetchDeleted(dirPath) {
    return [];
  }

  /**
   * Restore a deleted file. Override _restoreFile() in subclasses.
   */
  async _restoreDeletedFile(tab, entry) {
    try {
      await this._restoreFile(entry.path);
      if (window.aeorToast) window.aeorToast(`Restored: ${entry.name}`, 'success');
      // Refresh listing, then select the restored file for preview
      const restoredName = entry.name;
      await this._fetchListing();
      const restored = tab.entries.find((e) => e.name === restoredName);
      if (restored) {
        const restoredPath = tab.path.replace(/\/$/, '') + '/' + restoredName;
        tab.selectedEntries.clear();
        tab.selectedEntries.add(restoredPath);
        tab.preview_entry = restored;
        tab.preview_component = null;
        this._updateTabContent(tab.id);
        this._loadPreview();
      }
    } catch (error) {
      if (window.aeorToast) window.aeorToast(`Restore failed: ${error.message}`, 'error');
    }
  }

  /**
   * Restore a deleted file by path. Override in subclasses.
   */
  async _restoreFile(filePath) {
    throw new Error('Restore not implemented');
  }

  // ---------------------------------------------------------------------------
  // Version history panel
  // ---------------------------------------------------------------------------

  async _loadVersionHistory(panel, tab, entry) {
    const versionsPanel = panel.querySelector('.preview-versions');
    const versionsList = panel.querySelector('.preview-versions-list');
    if (!versionsPanel || !versionsList) return;

    versionsPanel.classList.remove('hidden');
    versionsList.innerHTML = '<div class="text-muted">Loading...</div>';

    const isDir = entry.entry_type === ENTRY_TYPE_DIR;
    let versions;

    if (isDir) {
      // Directories: show all snapshots (no per-file resolution)
      try {
        versions = await this._fetchSnapshotList();
      } catch (_) {
        versions = [];
      }
    } else {
      const filePath = tab.path.replace(/\/$/, '') + '/' + entry.name;
      try {
        versions = await this._fetchVersionHistory(filePath);
      } catch (_) {
        versions = [];
      }
    }

    try {
      if (!versions || versions.length === 0) {
        versionsList.innerHTML = '<div class="text-muted">No snapshots</div>';
        return;
      }

      // Current version is the first entry (newest-first from API)
      const currentHash = entry.hash || '';

      versionsList.innerHTML = versions.map((v, idx) => {
        const date = formatDate(v.timestamp);
        const icon = v.change_type === 'added' ? '+'
          : v.change_type === 'deleted' ? '\u2212'
          : v.change_type === 'modified' ? '\u2022'
          : '\u2013';
        const colorClass = v.change_type === 'added' ? 'version-change-added'
          : v.change_type === 'deleted' ? 'version-change-deleted'
          : v.change_type === 'modified' ? 'version-change-modified'
          : 'version-change-other';
        const size = v.size ? formatSize(v.size) : '';
        const isCurrent = idx === 0; // newest version = current

        return `
          <div class="version-entry${isCurrent ? ' current' : ''}" data-snapshot-id="${escapeAttr(v.id || v.snapshot)}" data-snapshot-name="${escapeAttr(v.snapshot)}" data-content-hash="${escapeAttr(v.content_hash || '')}">
            <div class="version-entry-header">
              <div class="version-entry-info">
                <span class="version-change-icon ${colorClass}">${icon}</span>
                <span class="version-snapshot-name">${escapeHtml(v.snapshot)}</span>
              </div>
              ${!isCurrent && v.change_type !== 'deleted' ? '<aeor-confirm-button class="version-restore-btn" label="Restore" confirmed-text="Restored!" duration="1000" style="--lpb-bg:var(--accent,#f97316);--lpb-text:#fff;--lpb-fill:var(--success,#3fb950);--lpb-border:var(--accent,#f97316);font-size:0.7rem;"></aeor-confirm-button>' : ''}
              ${isCurrent ? '<span class="version-current-badge">current</span>' : ''}
            </div>
            <div class="version-entry-id">
              <span>${escapeHtml(v.id || '')}</span>
              <span class="copy-id-btn version-copy-btn" data-copy-id="${escapeAttr(v.id || '')}" title="Copy ID">&#128203;</span>
            </div>
            <div class="version-entry-meta">
              ${date}${size ? ' \u00B7 ' + size : ''}
            </div>
          </div>`;
      }).join('');

      // Bind click (preview version) and double-click (restore)
      versionsList.querySelectorAll('.version-entry').forEach((el, idx) => {
        const snapshot = el.dataset.snapshotId;
        const isCurrent = idx === 0;

        el.addEventListener('click', (e) => {
          if (e.target.classList.contains('version-restore-btn')) return;
          // Highlight selected version
          versionsList.querySelectorAll('.version-entry').forEach((v) => {
            v.classList.remove('current');
          });
          el.classList.add('current');

          if (isCurrent && !entry._deleted) {
            // Current version — reload normal preview (no ?version= param)
            tab.preview_component = null;
            this._loadPreview();
          } else {
            // Historical version — load from snapshot
            const versionInfo = versions.find((v) => (v.id || v.snapshot) === snapshot);
            this._previewAtSnapshot(panel, tab, entry, snapshot, versionInfo);
          }
        });

        const restoreBtn = el.querySelector('.version-restore-btn');
        if (restoreBtn) {
          restoreBtn.addEventListener('confirm', (e) => {
            e.stopPropagation();
            this._confirmRestoreVersion(tab, entry, snapshot);
          });
        }
      });

      // Bind clipboard copy buttons
      versionsList.querySelectorAll('.copy-id-btn').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const id = btn.dataset.copyId;
          navigator.clipboard.writeText(id).then(() => {
            btn.textContent = '\u2705';
            setTimeout(() => { btn.textContent = '\uD83D\uDCCB'; }, 1500);
          });
        });
      });
    } catch (_) {
      versionsList.innerHTML = '<div class="text-muted">Unable to load</div>';
    }
  }

  /**
   * Update the preview to show a file at a specific snapshot version.
   */
  async _previewAtSnapshot(panel, tab, entry, snapshot, versionInfo) {
    const contentEl = panel.querySelector('.preview-content');
    if (!contentEl) return;
    const filePath = tab.path.replace(/\/$/, '') + '/' + entry.name;
    // Use version info's content_type if available (deleted files have null content_type)
    const contentType = (versionInfo && versionInfo.content_type) || entry.content_type || 'application/octet-stream';
    const componentName = await loadPreviewComponent(contentType);
    if (!componentName) return;

    const existingPreview = contentEl.firstElementChild;
    if (!existingPreview || existingPreview.tagName.toLowerCase() !== componentName) {
      contentEl.innerHTML = `<${componentName}></${componentName}>`;
    }
    const previewEl = contentEl.querySelector(componentName);
    if (previewEl) {
      // Load the file at this snapshot version (use version= with hex hash ID)
      const src = await this.getPreviewSrc(filePath + '?version=' + encodeURIComponent(snapshot), contentType);
      previewEl.setAttribute('src', src);
      previewEl.setAttribute('filename', entry.name);
      if (previewEl.load) previewEl.load();
    }
    panel.querySelector('.preview-meta').textContent =
      `Viewing snapshot: ${snapshot}`;

    // Update the stored snapshot ID so "Restore Selected Snapshot" uses the right one
    panel._currentSnapshotId = snapshot;
  }

  /**
   * Confirm and restore a file to a specific snapshot version.
   */
  async _confirmRestoreVersion(tab, entry, snapshot) {
    const filePath = tab.path.replace(/\/$/, '') + '/' + entry.name;
    try {
      await this._createSnapshot('auto-pre-restore ' + new Date().toISOString().replace('T', ' ').replace('Z', '')).catch(() => {});
      await this._restoreFromSnapshot(filePath, snapshot);
      if (window.aeorToast) window.aeorToast('Version restored', 'success');
      // Delay refresh to let the confirmed-state button show for its full duration
      this._refreshSuppressed = true;
      setTimeout(() => {
        this._refreshSuppressed = false;
        this._fetchListing();
      }, 5500);
    } catch (error) {
      if (window.aeorToast) window.aeorToast(`Restore failed: ${error.message}`, 'error');
    }
  }

  /**
   * Restore a file from a specific snapshot. Override in subclasses.
   */
  async _restoreFromSnapshot(filePath, snapshot) {
    throw new Error('Restore from snapshot not implemented');
  }

  /**
   * Take a snapshot immediately and flash the button text.
   */
  async _takeSnapshot(button) {
    const now = new Date();
    const pad = (n, d = 2) => String(n).padStart(d, '0');
    const name = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}.${pad(now.getMilliseconds(), 3)}`;

    const original = button.textContent;
    button.disabled = true;
    try {
      await this._createSnapshot(name);
      button.textContent = 'Saved!';
      button.classList.add('saved');
      setTimeout(() => {
        button.textContent = original;
        button.classList.remove('saved');
        button.disabled = false;
      }, 1500);
    } catch (error) {
      const msg = error.message || '';
      const isRateLimit = msg.includes('rate limit') || msg.includes('No changes') || msg.includes('Try again');
      button.textContent = isRateLimit ? 'No Changes' : 'Failed';
      button.classList.add(isRateLimit ? 'rate-limited' : 'failed');
      setTimeout(() => {
        button.textContent = original;
        button.classList.remove('saved', 'failed', 'rate-limited');
        button.disabled = false;
      }, isRateLimit ? 1500 : 2000);
      if (!isRateLimit && window.aeorToast) window.aeorToast('Snapshot failed: ' + msg, 'error');
    }
  }

  /**
   * Create a named snapshot. Override in subclasses.
   */
  async _createSnapshot(name) {
    throw new Error('Snapshot not implemented');
  }

  /**
   * Fetch version history for a file path. Override in subclasses.
   * Should return an array of { snapshot, timestamp, change_type, size }.
   */
  async _fetchVersionHistory(filePath) {
    return [];
  }

  async _fetchSnapshotList() {
    return [];
  }

  /**
   * Show a styled confirmation modal. Returns a Promise that resolves to
   * true (confirmed) or false (cancelled/dismissed).
   */
  _confirm(title, message, isHtml = false, confirmLabel = 'Delete', confirmStyle = 'danger') {
    return new Promise((resolve) => {
      const modal = document.createElement('aeor-modal');
      modal.title = title;
      const bodyText = isHtml ? message : escapeHtml(message);
      modal.innerHTML = `
        <p class="confirm-modal-text">${bodyText}</p>
        <div class="modal-footer-actions">
          <button class="secondary small confirm-cancel">Cancel</button>
          <button class="${confirmStyle} small confirm-ok">${escapeHtml(confirmLabel)}</button>
        </div>
      `;
      document.body.appendChild(modal);

      let resolved = false;
      const done = (result) => {
        if (resolved) return;
        resolved = true;
        modal.remove();
        resolve(result);
      };

      modal.querySelector('.confirm-cancel').addEventListener('click', () => done(false));
      modal.querySelector('.confirm-ok').addEventListener('click', () => done(true));
      modal.addEventListener('close', () => done(false));
    });
  }
}

export { AeorFileBrowserBase, loadPreviewComponent };
