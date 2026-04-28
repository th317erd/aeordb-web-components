'use strict';

import {
  formatSize, formatDate, fileIcon,
  escapeHtml, escapeAttr, isImageFile,
  ENTRY_TYPE_DIR,
} from './aeor-file-view-shared.js';
import './aeor-modal.js';

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
    if (!perms) return true; // no restrictions known — allow (server enforces)
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
    window.addEventListener('beforeunload', () => {
      this._sharedPathData = null;
    });
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
      html += `<div class="tab-content" id="tab-content-${tab.id}" style="${isActive ? '' : 'display:none'}">`;
      html += `<div class="tab-listing-area">${this._renderDirectoryViewFor(tab)}</div>`;
      html += this._renderPreviewPanel(tab);
      html += '</div>';
    }

    this.innerHTML = html;
    this._bindShellEvents();
    this._bindTabContentEvents(this._active_tab_id);
    this._hydratePreview();
  }

  _renderTabBar() {
    const tabs = this._tabs.map((tab) => {
      const isActive = (tab.id === this._active_tab_id);
      const label    = this._truncate(`${tab.name || tab.id} ${tab.path}`, 30);

      return `
        <div class="tab ${(isActive) ? 'active' : ''}" data-tab-id="${tab.id}">
          <span class="tab-label">${escapeHtml(label)}</span>
          <span class="tab-close" data-tab-close="${tab.id}">&times;</span>
        </div>
      `;
    }).join('');

    return `
      <div class="tab-bar">
        ${tabs}
        <div class="tab-new" title="Open new tab">+</div>
      </div>
    `;
  }

  _getVisibleEntries(tab) {
    if (this._showHidden) return tab.entries;
    return tab.entries.filter((e) => !e.name.startsWith('.'));
  }

  _getConfigActions(tab) {
    const path = tab.path || '';
    if (!path.includes('/.config'))
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
    const configBar = (configActions) ? `<div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap;">${configActions}</div>` : '';
    const header = `
      <div class="page-header">
        ${breadcrumbs}
        <div style="display: flex; gap: 8px; align-items: center;">
          ${configBar}
          ${this._hasPermission('c') ? `
          <button class="secondary small new-folder-button">New Folder</button>
          <button class="primary small upload-button">Upload</button>
          <input type="file" class="upload-input" style="display:none" multiple>` : ''}
        </div>
      </div>
    `;

    // Unified toolbar: selection actions on left, view controls on right (always visible)
    const toolbarHtml = `
      <div class="selection-bar">
        <div class="selection-actions-left"></div>
        <div style="display:flex;gap:8px;align-items:center;margin-left:auto;">
          <button class="small ${this._showHidden ? 'primary' : 'secondary'} toggle-hidden-btn" title="${this._showHidden ? 'Hide hidden files' : 'Show hidden files'}">&#128065;</button>
          <div class="view-toggle">
            <button class="small ${(viewMode === 'list') ? 'primary' : 'secondary'}" data-view="list" title="List view">&#9776;</button>
            <button class="small ${(viewMode === 'grid') ? 'primary' : 'secondary'}" data-view="grid" title="Grid view">&#9638;</button>
          </div>
        </div>
      </div>
    `;

    if (tab.loading) {
      return `${header}${toolbarHtml}<div class="tab-listing"><div class="loading">Loading...</div></div>`;
    }

    const visible = this._getVisibleEntries(tab);

    if (visible.length === 0 && tab.entries.length === 0) {
      return `${header}${toolbarHtml}<div class="tab-listing"><div class="empty-state">This directory is empty.</div></div>`;
    }

    if (visible.length === 0 && tab.entries.length > 0) {
      return `${header}${toolbarHtml}<div class="tab-listing"><div class="empty-state">All ${tab.entries.length} items are hidden. Click the eye icon to show them.</div></div>`;
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

    return `${header}${toolbarHtml}<div class="tab-listing">${listing}<div class="entry-count">${countText}</div>${loadingMore}</div>`;
  }

  _renderPreviewPanel(tab) {
    return `
      <div class="preview-panel" style="display:none; ${tab.preview_height ? 'height:' + tab.preview_height + 'px' : ''}">
        <div class="preview-resize-handle"></div>
        <div class="preview-header">
          <input type="text" class="preview-title" spellcheck="false">
          <div class="preview-actions"></div>
        </div>
        <div class="preview-content"></div>
        <div class="preview-meta"></div>
      </div>`;
  }

  _renderListRow(entry) {
    const isDir    = (entry.entry_type === ENTRY_TYPE_DIR);
    const icon     = fileIcon(entry.entry_type);
    const size     = (isDir) ? '\u2014' : formatSize(entry.size);
    const created  = formatDate(entry.created_at);
    const modified = formatDate(entry.updated_at);

    return `
      <tr class="file-entry" data-name="${escapeAttr(entry.name)}" data-type="${entry.entry_type}">
        <td><span class="file-icon">${icon}</span>${escapeHtml(entry.name)}</td>
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
      const icon  = fileIcon(entry.entry_type);
      const size  = (isDir) ? 'Folder' : formatSize(entry.size);

      let thumbnail = `<div class="grid-card-icon">${icon}</div>`;

      if (!isDir && isImageFile(entry.name)) {
        const filePath = tab.path.replace(/\/$/, '') + '/' + entry.name;
        const fileUrl  = this.fileUrl(filePath);
        thumbnail = `<div class="grid-card-thumbnail"><img src="${escapeAttr(fileUrl)}" alt="${escapeAttr(entry.name)}" loading="lazy"></div>`;
      }

      return `
        <div class="grid-card file-entry" data-name="${escapeAttr(entry.name)}" data-type="${entry.entry_type}">
          ${thumbnail}
          <div class="grid-card-name" title="${escapeAttr(entry.name)}">${escapeHtml(this._truncate(entry.name, 20))}</div>
          <div class="grid-card-meta">${size}</div>
        </div>
      `;
    }).join('');

    return `<div class="file-grid">${cards}</div>`;
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

    // Only replace the listing area — preserve the preview panel
    const listingArea = container.querySelector('.tab-listing-area');
    const listing = container.querySelector('.tab-listing');
    const scrollTop = (listing) ? listing.scrollTop : 0;

    if (listingArea) {
      listingArea.innerHTML = this._renderDirectoryViewFor(tab);
    } else {
      // Fallback: full rebuild (first render)
      container.innerHTML = `<div class="tab-listing-area">${this._renderDirectoryViewFor(tab)}</div>${this._renderPreviewPanel(tab)}`;
    }

    this._bindTabContentEvents(tabId);

    // Restore scroll position
    const newListing = container.querySelector('.tab-listing');
    if (newListing && scrollTop > 0) {
      newListing.scrollTop = scrollTop;
    }

    if (tabId === this._active_tab_id) {
      this._hydratePreview();
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

    if (!entry || !componentName) {
      panel.style.display = 'none';
      return;
    }

    // Update header — editable filename input
    const titleInput = panel.querySelector('.preview-title');
    titleInput.value = entry.name;
    titleInput.dataset.original = entry.name;
    const canRename = this._hasPermission('u', entry);
    titleInput.readOnly = !canRename;
    titleInput.tabIndex = canRename ? 0 : -1;
    titleInput.style.pointerEvents = canRename ? '' : 'none';

    // Update action buttons — subclasses can inject extra buttons via previewActions()
    const extraActions = this.previewActions(entry) || '';
    panel.querySelector('.preview-actions').innerHTML = `
      ${extraActions}
      ${this._hasPermission('d', entry) ? '<button class="danger small" data-action="delete">Delete</button>' : ''}
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

    // Bind action buttons
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
    panel.style.display = '';
  }

  // -------------------------------------------------------------------------
  // Event binding
  // -------------------------------------------------------------------------

  _bindShellEvents() {
    // Tab clicks
    this.querySelectorAll('.tab-label').forEach((label) => {
      const tabEl = label.closest('.tab');
      label.addEventListener('click', () => {
        this._switchTab(tabEl.dataset.tabId);
      });
    });

    // Tab close
    this.querySelectorAll('.tab-close').forEach((btn) => {
      btn.addEventListener('click', (event) => {
        event.stopPropagation();
        this._closeTab(btn.dataset.tabClose);
      });
    });

    // New tab
    const newTabBtn = this.querySelector('.tab-new');
    if (newTabBtn) {
      newTabBtn.addEventListener('click', () => {
        this.openNewTab();
      });
    }
  }

  _bindTabContentEvents(tabId) {
    const container = this.querySelector(`#tab-content-${tabId}`);
    if (!container) return;

    const tab = this._tabs.find((t) => t.id === tabId);
    if (!tab) return;

    // Toggle hidden files
    const toggleHiddenBtn = container.querySelector('.toggle-hidden-btn');
    if (toggleHiddenBtn) {
      toggleHiddenBtn.addEventListener('click', () => {
        this._showHidden = !this._showHidden;
        this._updateTabContent(tabId);
      });
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

    // View toggle
    container.querySelectorAll('[data-view]').forEach((btn) => {
      btn.addEventListener('click', () => {
        tab.view_mode = btn.dataset.view;
        this._saveState();
        this._updateTabContent(tabId);
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
        const entryIndex = tab.entries.findIndex((e) => e.name === entryName);
        const isCtrl = event.ctrlKey || event.metaKey;
        const isShift = event.shiftKey;

        if (!isCtrl && !isShift) {
          // Plain click — select (files and directories alike)
          tab.selectedEntries.clear();
          tab.selectedEntries.add(entryPath);
          tab.lastSelectedAnchor = entryPath;
          this._updateSelectionVisual(tab);

          // Preview for files only (directories don't have previews)
          if (entryType !== ENTRY_TYPE_DIR) {
            tab.preview_entry = tab.entries.find((e) => e.name === entryName) || null;
            tab.preview_component = null;
            this._loadPreview();
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
            ? tab.entries.findIndex((e) => tab.path.replace(/\/$/, '') + '/' + e.name === tab.lastSelectedAnchor)
            : 0;
          const anchor = (anchorIndex >= 0) ? anchorIndex : 0;
          const start = Math.min(anchor, entryIndex);
          const end = Math.max(anchor, entryIndex);

          for (let i = start; i <= end; i++) {
            if (tab.entries[i])
              tab.selectedEntries.add(tab.path.replace(/\/$/, '') + '/' + tab.entries[i].name);
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
      }
    };

    if (this._keydownHandler)
      this.removeEventListener('keydown', this._keydownHandler);

    this._keydownHandler = keydownHandler;
    this.addEventListener('keydown', keydownHandler);

    // New Folder button
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
    if (currentContainer) currentContainer.style.display = 'none';

    const currentTabEl = this.querySelector(`.tab[data-tab-id="${this._active_tab_id}"]`);
    if (currentTabEl) currentTabEl.classList.remove('active');

    // Show new tab content
    this._active_tab_id = tabId;

    const newContainer = this.querySelector(`#tab-content-${tabId}`);
    if (newContainer) newContainer.style.display = '';

    const newTabEl = this.querySelector(`.tab[data-tab-id="${tabId}"]`);
    if (newTabEl) newTabEl.classList.add('active');

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
    tab.path = path;
    tab.preview_entry = null;
    tab.selectedEntries.clear();
    tab.lastSelectedAnchor = null;
    this._saveState();
    // Update tab bar label (breadcrumb changed)
    this._updateTabBarLabel(tab);
    this._fetchListing();
  }

  _updateTabBarLabel(tab) {
    const tabEl = this.querySelector(`.tab[data-tab-id="${tab.id}"] .tab-label`);
    if (tabEl) {
      tabEl.textContent = this._truncate(`${tab.name || tab.id} ${tab.path}`, 30);
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

    // Update the left side of the unified toolbar (selection actions)
    const leftSlot = container.querySelector('.selection-actions-left');
    if (leftSlot) {
      if (tab.selectedEntries.size > 0) {
        const count = tab.selectedEntries.size;
        const extraActions = this.selectionActions(tab) || '';
        leftSlot.innerHTML =
          `<span class="selection-count">${count} selected</span>` +
          `${extraActions}` +
          '<button class="secondary small selection-clear">Clear Selection</button>' +
          (this._hasPermission('d') ? '<button class="danger small selection-delete">Delete Selected</button>' : '');

        leftSlot.querySelector('.selection-clear').addEventListener('click', () => {
          this._clearSelection(tab);
        });
        const delBtn = leftSlot.querySelector('.selection-delete');
        if (delBtn) delBtn.addEventListener('click', () => {
          this._deleteSelected();
        });
        this._bindSelectionBarExtra(leftSlot, tab);
      } else {
        leftSlot.innerHTML = '';
      }
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

    const count = tab.selectedEntries.size;
    const confirmed = await this._confirm(
      'Delete Files',
      `Delete ${count} item${(count > 1) ? 's' : ''}? Files can be recovered from a snapshot if needed.`,
    );
    if (!confirmed) return;

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
  // Data fetching (uses abstract methods)
  // -------------------------------------------------------------------------

  async _fetchListing() {
    const tab = this._activeTab();
    if (!tab) return;

    tab.entries = [];
    tab.total = null;
    tab.loading_more = false;
    tab.loading = true;
    this._updateTabContent(tab.id);

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
        const confirmed = await this._confirm(
          'Delete File',
          `Delete "${entry.name}"? Files can be recovered from a snapshot if needed.`,
        );
        if (!confirmed) break;
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
      <div style="margin-bottom: 16px;">
        <label style="display: block; font-size: 0.85rem; color: var(--text-secondary, #8b949e); margin-bottom: 6px;">Field Name</label>
        <input type="text" class="index-field-name" placeholder="e.g. email" style="
          width: 100%; padding: 8px 12px;
          background: var(--bg-primary, #0d1117); border: 1px solid var(--border, #30363d);
          border-radius: var(--radius, 6px); color: var(--text-primary, #e6edf3);
          font-size: 0.9rem; outline: none; font-family: var(--font-sans); box-sizing: border-box;
        ">
      </div>
      <div style="margin-bottom: 16px;">
        <label style="display: block; font-size: 0.85rem; color: var(--text-secondary, #8b949e); margin-bottom: 6px;">Index Type</label>
        <select class="index-field-type" style="
          width: 100%; padding: 8px 12px;
          background: var(--bg-primary, #0d1117); border: 1px solid var(--border, #30363d);
          border-radius: var(--radius, 6px); color: var(--text-primary, #e6edf3);
          font-size: 0.9rem; outline: none; font-family: var(--font-sans); box-sizing: border-box;
        ">
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
      <div style="margin-bottom: 16px;">
        <label style="display: block; font-size: 0.85rem; color: var(--text-secondary, #8b949e); margin-bottom: 6px;">Min Value (optional, numeric types)</label>
        <input type="number" class="index-field-min" placeholder="" style="
          width: 100%; padding: 8px 12px;
          background: var(--bg-primary, #0d1117); border: 1px solid var(--border, #30363d);
          border-radius: var(--radius, 6px); color: var(--text-primary, #e6edf3);
          font-size: 0.9rem; outline: none; font-family: var(--font-sans); box-sizing: border-box;
        ">
      </div>
      <div style="margin-bottom: 16px;">
        <label style="display: block; font-size: 0.85rem; color: var(--text-secondary, #8b949e); margin-bottom: 6px;">Max Value (optional, numeric types)</label>
        <input type="number" class="index-field-max" placeholder="" style="
          width: 100%; padding: 8px 12px;
          background: var(--bg-primary, #0d1117); border: 1px solid var(--border, #30363d);
          border-radius: var(--radius, 6px); color: var(--text-primary, #e6edf3);
          font-size: 0.9rem; outline: none; font-family: var(--font-sans); box-sizing: border-box;
        ">
      </div>
      <div style="display: flex; gap: 10px; justify-content: flex-end;">
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
      <div style="margin-bottom: 16px;">
        <label style="display: block; font-size: 0.85rem; color: var(--text-secondary, #8b949e); margin-bottom: 6px;">Content Type</label>
        <input type="text" class="parser-content-type" placeholder="e.g. application/pdf" style="
          width: 100%; padding: 8px 12px;
          background: var(--bg-primary, #0d1117); border: 1px solid var(--border, #30363d);
          border-radius: var(--radius, 6px); color: var(--text-primary, #e6edf3);
          font-size: 0.9rem; outline: none; font-family: var(--font-sans); box-sizing: border-box;
        ">
      </div>
      <div style="margin-bottom: 16px;">
        <label style="display: block; font-size: 0.85rem; color: var(--text-secondary, #8b949e); margin-bottom: 6px;">Parser Path</label>
        <input type="text" class="parser-path" placeholder="e.g. /parsers/pdf" style="
          width: 100%; padding: 8px 12px;
          background: var(--bg-primary, #0d1117); border: 1px solid var(--border, #30363d);
          border-radius: var(--radius, 6px); color: var(--text-primary, #e6edf3);
          font-size: 0.9rem; outline: none; font-family: var(--font-sans); box-sizing: border-box;
        ">
      </div>
      <div style="display: flex; gap: 10px; justify-content: flex-end;">
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
      <div style="margin-bottom: 16px;">
        <label style="display: block; font-size: 0.85rem; color: var(--text-secondary, #8b949e); margin-bottom: 6px;">Origins (comma-separated)</label>
        <input type="text" class="cors-origins" placeholder="e.g. https://example.com, https://app.example.com" style="
          width: 100%; padding: 8px 12px;
          background: var(--bg-primary, #0d1117); border: 1px solid var(--border, #30363d);
          border-radius: var(--radius, 6px); color: var(--text-primary, #e6edf3);
          font-size: 0.9rem; outline: none; font-family: var(--font-sans); box-sizing: border-box;
        ">
      </div>
      <div style="margin-bottom: 16px;">
        <label style="display: block; font-size: 0.85rem; color: var(--text-secondary, #8b949e); margin-bottom: 6px;">Methods (comma-separated)</label>
        <input type="text" class="cors-methods" value="GET,POST,PUT,DELETE" style="
          width: 100%; padding: 8px 12px;
          background: var(--bg-primary, #0d1117); border: 1px solid var(--border, #30363d);
          border-radius: var(--radius, 6px); color: var(--text-primary, #e6edf3);
          font-size: 0.9rem; outline: none; font-family: var(--font-sans); box-sizing: border-box;
        ">
      </div>
      <div style="margin-bottom: 16px;">
        <label style="display: block; font-size: 0.85rem; color: var(--text-secondary, #8b949e); margin-bottom: 6px;">Headers (comma-separated)</label>
        <input type="text" class="cors-headers" value="Content-Type,Authorization" style="
          width: 100%; padding: 8px 12px;
          background: var(--bg-primary, #0d1117); border: 1px solid var(--border, #30363d);
          border-radius: var(--radius, 6px); color: var(--text-primary, #e6edf3);
          font-size: 0.9rem; outline: none; font-family: var(--font-sans); box-sizing: border-box;
        ">
      </div>
      <div style="display: flex; gap: 10px; justify-content: flex-end;">
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
      <div style="margin-bottom: 16px;">
        <label style="display: block; font-size: 0.85rem; color: var(--text-secondary, #8b949e); margin-bottom: 6px;">Folder Name</label>
        <input type="text" class="new-folder-name" placeholder="my-folder" style="
          width: 100%;
          padding: 8px 12px;
          background: var(--bg-primary, #0d1117);
          border: 1px solid var(--border, #30363d);
          border-radius: var(--radius, 6px);
          color: var(--text-primary, #e6edf3);
          font-size: 0.9rem;
          outline: none;
          font-family: var(--font-sans);
          box-sizing: border-box;
        ">
      </div>
      <div style="display: flex; gap: 10px; justify-content: flex-end;">
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

    const updateProgress = (currentFile, fileLoaded, fileTotal) => {
      if (!progressPanel) return;
      const currentUploadedBytes = uploadedBytes + fileLoaded;
      const overallPercent = (totalBytes > 0) ? Math.round((currentUploadedBytes / totalBytes) * 100) : 0;
      const elapsed = (Date.now() - startTime) / 1000;
      const speed = (elapsed > 0) ? currentUploadedBytes / elapsed : 0;
      const speedText = this._formatSpeed(speed);
      const remaining = (speed > 0) ? (totalBytes - currentUploadedBytes) / speed : 0;
      const remainingText = (remaining > 0) ? this._formatDuration(remaining) : '';

      progressPanel.innerHTML = `
        <div class="upload-progress-header">
          <span class="upload-progress-title">Uploading ${completedFiles + 1} of ${totalFiles}</span>
          <span class="upload-progress-speed">${speedText}${(remainingText) ? ' \u00B7 ' + remainingText + ' remaining' : ''}</span>
        </div>
        <div class="upload-progress-filename">${escapeHtml(currentFile)}</div>
        <div class="upload-progress-bar-track">
          <div class="upload-progress-bar-fill" style="width: ${overallPercent}%"></div>
        </div>
        <div class="upload-progress-meta">
          ${completedFiles} of ${totalFiles} files complete${(failedCount > 0) ? ' \u00B7 ' + failedCount + ' failed' : ''}
        </div>
      `;
    };

    for (const file of files) {
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

    const updateProgress = (currentFile, fileLoaded, fileTotal) => {
      if (!progressPanel) return;

      const currentUploadedBytes = uploadedBytes + fileLoaded;
      const overallPercent = (totalBytes > 0) ? Math.round((currentUploadedBytes / totalBytes) * 100) : 0;
      const elapsed = (Date.now() - startTime) / 1000;
      const speed = (elapsed > 0) ? currentUploadedBytes / elapsed : 0;
      const speedText = this._formatSpeed(speed);
      const remaining = (speed > 0) ? (totalBytes - currentUploadedBytes) / speed : 0;
      const remainingText = (remaining > 0) ? this._formatDuration(remaining) : '';

      progressPanel.innerHTML = `
        <div class="upload-progress-header">
          <span class="upload-progress-title">Uploading ${completedFiles + 1} of ${totalFiles}</span>
          <span class="upload-progress-speed">${speedText}${(remainingText) ? ' \u00B7 ' + remainingText + ' remaining' : ''}</span>
        </div>
        <div class="upload-progress-filename">${escapeHtml(currentFile)}</div>
        <div class="upload-progress-bar-track">
          <div class="upload-progress-bar-fill" style="width: ${overallPercent}%"></div>
        </div>
        <div class="upload-progress-meta">
          ${completedFiles} of ${totalFiles} files complete${(failedCount > 0) ? ' \u00B7 ' + failedCount + ' failed' : ''}
        </div>
      `;
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
    modal.innerHTML = '<div style="color: var(--text-secondary, #8b949e);">Loading...</div>';
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

    const fileNames = paths.map((p) => p.split('/').pop()).join(', ');
    const inputStyle = `
      width: 100%; padding: 8px 12px;
      background: var(--bg-primary, #0d1117); border: 1px solid var(--border, #30363d);
      border-radius: var(--radius, 6px); color: var(--text-primary, #e6edf3);
      font-size: 0.9rem; outline: none; font-family: var(--font-sans); box-sizing: border-box;
    `;
    const labelStyle = 'display: block; font-size: 0.85rem; color: var(--text-secondary, #8b949e); margin-bottom: 6px;';

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
          <div style="display:flex;align-items:center;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border, #30363d);">
            <div>
              <span style="color:var(--text-primary, #e6edf3);">${escapeHtml(target)}</span>
              <span style="color:var(--text-secondary, #8b949e);font-size:0.8rem;margin-left:8px;">${escapeHtml(perm)}</span>
            </div>
            <button class="danger small share-revoke-btn" data-group="${escapeAttr(s.group || '')}" data-pattern="${escapeAttr(pattern)}">&times;</button>
          </div>
        `;
      }).join('');
      sharesHtml = `
        <div style="margin-top:16px;border-top:1px solid var(--border, #30363d);padding-top:12px;">
          <div style="${labelStyle}">Current Shares</div>
          ${shareRows}
        </div>
      `;
    }

    // Build active share links HTML for Link tab
    const linkSharesHtml = activeLinks.length > 0 ? activeLinks.map((l) => `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border, #30363d);">
        <div>
          <span style="color:var(--text-primary, #e6edf3);font-size:0.85rem;">${escapeHtml(l.label || 'Share link')}</span>
          <span style="color:var(--text-secondary, #8b949e);font-size:0.75rem;margin-left:8px;">${l.expires_at ? new Date(l.expires_at).toLocaleDateString() : 'Never expires'}</span>
        </div>
        <button class="danger small link-revoke-btn" data-key-id="${escapeAttr(l.key_id)}">&times;</button>
      </div>
    `).join('') : '<div style="color:var(--text-secondary, #8b949e);padding:8px 0;font-size:0.85rem;">No active links</div>';

    // Populate modal body
    const body = modal.querySelector('.aeor-modal__body');
    body.innerHTML = `
      <div style="margin-bottom:12px;color:var(--text-secondary, #8b949e);font-size:0.85rem;">
        Sharing: ${escapeHtml(fileNames)}${(paths.length > 1) ? ` (${paths.length} items)` : ''}
      </div>

      <div class="tab-bar" style="margin-bottom:16px;">
        <div class="tab active share-tab-btn" data-share-tab="people">People</div>
        <div class="tab share-tab-btn" data-share-tab="link">Link</div>
      </div>

      <div class="share-tab-people">
        <div style="margin-bottom:12px;">
          <label style="${labelStyle}">Users</label>
          <input type="text" class="share-users-filter" placeholder="Search users..." style="${inputStyle} margin-bottom:4px;">
          <select class="share-users-select" multiple style="${inputStyle} min-height:80px;">
            ${userOptions}
          </select>
          <div style="font-size:0.75rem;color:var(--text-secondary, #8b949e);margin-top:4px;">Hold Ctrl/Cmd to select multiple</div>
        </div>

        <div style="margin-bottom:12px;">
          <label style="${labelStyle}">Groups</label>
          <input type="text" class="share-groups-filter" placeholder="Search groups..." style="${inputStyle} margin-bottom:4px;">
          <select class="share-groups-select" multiple style="${inputStyle} min-height:80px;">
            ${groupOptions}
          </select>
        </div>

        <div style="margin-bottom:12px;">
          <label style="${labelStyle}">Permission Level</label>
          <select class="share-permission-select" style="${inputStyle}">
            <option value=".r..l...">View only</option>
            <option value="crudl...">Can edit</option>
            <option value="crudlify">Full access</option>
            <option value="custom">Custom</option>
          </select>
        </div>
        <div class="share-custom-flags" style="display:none;margin-bottom:16px;">
          <aeor-crudlify class="share-crudlify" value="--------"></aeor-crudlify>
        </div>

        <div style="display:flex;gap:10px;justify-content:flex-end;">
          <button class="secondary small share-cancel">Cancel</button>
          <button class="primary small share-submit">Share</button>
        </div>
      </div>

      <div class="share-tab-link" style="display:none;">
        <div style="margin-bottom:12px;">
          <label style="${labelStyle}">Permission Level</label>
          <select class="link-permission-select" style="${inputStyle}">
            <option value="-r--l---">View only</option>
            <option value="crudl..." selected>Can edit</option>
            <option value="crudlify">Full access</option>
            <option value="custom">Custom</option>
          </select>
        </div>
        <div class="link-custom-flags" style="display:none;margin-bottom:12px;">
          <aeor-crudlify class="link-crudlify" value="--------"></aeor-crudlify>
        </div>
        <div style="margin-bottom:12px;">
          <label style="${labelStyle}">Expiration</label>
          <select class="link-expiry-select" style="${inputStyle}">
            <option value="">Never</option>
            <option value="1">1 day</option>
            <option value="7">7 days</option>
            <option value="30">30 days</option>
            <option value="90">90 days</option>
            <option value="365">1 year</option>
          </select>
        </div>
        <div style="display:flex;gap:10px;justify-content:flex-end;margin-bottom:16px;">
          <button class="primary small link-create-btn">Create Link</button>
        </div>
        <div class="link-result" style="display:none;margin-bottom:16px;">
          <label style="${labelStyle}">Share URL</label>
          <div style="display:flex;gap:8px;">
            <input type="text" class="link-url-input" readonly style="${inputStyle} flex:1;" onfocus="this.select()">
            <button class="secondary small link-copy-btn" style="min-width:70px;transition:background 0.3s,color 0.3s;">Copy</button>
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
        if (peopleContent) peopleContent.style.display = tab === 'people' ? '' : 'none';
        if (linkContent) linkContent.style.display = tab === 'link' ? '' : 'none';
      });
    });

    // Bind events
    const usersSelect = body.querySelector('.share-users-select');
    const groupsSelect = body.querySelector('.share-groups-select');
    const permSelect = body.querySelector('.share-permission-select');
    const customFlags = body.querySelector('.share-custom-flags');

    // Toggle custom flags visibility
    permSelect.addEventListener('change', () => {
      customFlags.style.display = permSelect.value === 'custom' ? 'block' : 'none';
    });

    // Search filter for user select
    body.querySelector('.share-users-filter').addEventListener('input', (e) => {
      const q = e.target.value.toLowerCase();
      for (const opt of usersSelect.options) {
        opt.style.display = opt.text.toLowerCase().includes(q) ? '' : 'none';
      }
    });

    // Search filter for group select
    body.querySelector('.share-groups-filter').addEventListener('input', (e) => {
      const q = e.target.value.toLowerCase();
      for (const opt of groupsSelect.options) {
        opt.style.display = opt.text.toLowerCase().includes(q) ? '' : 'none';
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
        linkCustomFlags.style.display = linkPermSelect.value === 'custom' ? 'block' : 'none';
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
          resultDiv.style.display = '';
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
        const original = linkCopyBtn.textContent;
        const originalBg = linkCopyBtn.style.background;
        try {
          await navigator.clipboard.writeText(urlInput.value);
          linkCopyBtn.textContent = 'Copied';
          linkCopyBtn.style.background = 'var(--success, #2ea043)';
          linkCopyBtn.style.color = '#fff';
        } catch (e) {
          linkCopyBtn.textContent = 'Error';
          linkCopyBtn.style.background = 'var(--danger, #da3633)';
          linkCopyBtn.style.color = '#fff';
        }
        setTimeout(() => {
          linkCopyBtn.textContent = original;
          linkCopyBtn.style.background = originalBg;
          linkCopyBtn.style.color = '';
        }, 1500);
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

  _showContextMenu(x, y, entry) {
    const existing = this.querySelector('.context-menu');
    if (existing) existing.remove();

    const menu = document.createElement('div');
    menu.className = 'context-menu';
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';
    menu.innerHTML = `
      <div class="context-menu-item" data-context="preview">Preview</div>
      ${this._hasPermission('y') ? '<div class="context-menu-item" data-context="share">Share</div>' : ''}
      ${this._hasPermission('u') ? '<div class="context-menu-item" data-context="rename">Rename</div>' : ''}
      ${this._hasPermission('d') ? '<div class="context-menu-item context-menu-danger" data-context="delete">Delete</div>' : ''}
    `;

    this.appendChild(menu);

    menu.querySelectorAll('.context-menu-item').forEach((item) => {
      item.addEventListener('click', () => {
        menu.remove();
        const activeTab = this._activeTab();
        if (item.dataset.context === 'preview') {
          if (activeTab) {
            activeTab.preview_entry = entry;
            activeTab.preview_component = null;
          }
          this._loadPreview();
        } else if (item.dataset.context === 'share') {
          if (activeTab) {
            const filePath = activeTab.path.replace(/\/$/, '') + '/' + entry.name;
            this._showShareModal([filePath]);
          }
        } else {
          if (activeTab) activeTab.preview_entry = entry;
          this._handlePreviewAction(item.dataset.context);
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

  /**
   * Show a styled confirmation modal. Returns a Promise that resolves to
   * true (confirmed) or false (cancelled/dismissed).
   */
  _confirm(title, message) {
    return new Promise((resolve) => {
      const modal = document.createElement('aeor-modal');
      modal.title = title;
      modal.innerHTML = `
        <p style="color: var(--text-primary, #e6edf3); margin: 0 0 20px 0; font-size: 0.95rem;">${escapeHtml(message)}</p>
        <div style="display: flex; gap: 10px; justify-content: flex-end;">
          <button class="secondary small confirm-cancel">Cancel</button>
          <button class="danger small confirm-ok">Delete</button>
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
