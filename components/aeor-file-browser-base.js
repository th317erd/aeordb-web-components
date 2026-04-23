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
      html += this._renderDirectoryViewFor(tab);
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

  _renderDirectoryViewFor(tab) {
    const viewMode    = tab.view_mode || 'list';
    const breadcrumbs = this._renderBreadcrumbs(tab);
    const header = `
      <div class="page-header">
        ${breadcrumbs}
        <div style="display: flex; gap: 8px; align-items: center;">
          <div class="view-toggle">
            <button class="small ${(viewMode === 'list') ? 'primary' : 'secondary'}" data-view="list" title="List view">&#9776;</button>
            <button class="small ${(viewMode === 'grid') ? 'primary' : 'secondary'}" data-view="grid" title="Grid view">&#9638;</button>
          </div>
          <button class="secondary small new-folder-button">New Folder</button>
          <button class="primary small upload-button">Upload</button>
          <input type="file" class="upload-input" style="display:none" multiple>
        </div>
      </div>
    `;

    // Selection bar — always present to avoid layout shift, hidden when empty
    const selectionBarHtml = '<div class="selection-bar" style="visibility: hidden;">&nbsp;</div>';

    if (tab.loading) {
      return `${header}${selectionBarHtml}<div class="tab-listing"><div class="loading">Loading...</div></div>`;
    }

    if (tab.entries.length === 0) {
      return `${header}${selectionBarHtml}<div class="tab-listing"><div class="empty-state">This directory is empty.</div></div>`;
    }

    const countText = (tab.total != null)
      ? `Showing ${tab.entries.length} of ${tab.total}`
      : `${tab.entries.length} items`;
    const loadingMore = (tab.loading_more)
      ? '<div class="scroll-loading">Loading more...</div>'
      : '';

    const listing = (viewMode === 'grid')
      ? this._renderGridViewFor(tab)
      : this._renderListViewFor(tab);

    return `${header}${selectionBarHtml}<div class="tab-listing">${listing}<div class="entry-count">${countText}</div>${loadingMore}</div>
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

  _renderListViewFor(tab) {
    const rows = tab.entries.map((entry) => {
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
    }).join('');

    return `
      <table>
        <thead>
          <tr><th>Name</th><th>Size</th><th>Created</th><th>Modified</th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    `;
  }

  _renderGridViewFor(tab) {
    const cards = tab.entries.map((entry) => {
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

    // Preserve scroll position across re-render
    const listing = container.querySelector('.tab-listing');
    const scrollTop = (listing) ? listing.scrollTop : 0;

    container.innerHTML = this._renderDirectoryViewFor(tab);
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

    // Update action buttons — subclasses can inject extra buttons via previewActions()
    const extraActions = this.previewActions(entry) || '';
    panel.querySelector('.preview-actions').innerHTML = `
      ${extraActions}
      <button class="danger small" data-action="delete">Delete</button>
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

    // File entries (both list rows and grid cards) — with multi-select
    // Selection uses full paths (tab.path + name) so it works across pagination.
    container.querySelectorAll('.file-entry').forEach((el) => {
      el.addEventListener('click', (event) => {
        const entryName = el.dataset.name;
        const entryType = parseInt(el.dataset.type, 10);
        const entryPath = tab.path.replace(/\/$/, '') + '/' + entryName;
        const entryIndex = tab.entries.findIndex((e) => e.name === entryName);
        const isCtrl = event.ctrlKey || event.metaKey;
        const isShift = event.shiftKey;

        if (!isCtrl && !isShift) {
          // Plain click — navigate directory or single-select file
          if (entryType === ENTRY_TYPE_DIR) {
            this._navigateTo(entryPath + '/');
            return;
          }
          tab.selectedEntries.clear();
          tab.selectedEntries.add(entryPath);
          tab.lastSelectedAnchor = entryPath;
          this._updateSelectionVisual(tab);

          // Preview the single file
          tab.preview_entry = tab.entries.find((e) => e.name === entryName) || null;
          tab.preview_component = null;
          this._loadPreview();
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

      // Context menu
      el.addEventListener('contextmenu', (event) => {
        event.preventDefault();
        const entryType = parseInt(el.dataset.type, 10);
        if (entryType === ENTRY_TYPE_DIR) return;

        const entry = tab.entries.find((e) => e.name === el.dataset.name);
        if (!entry) return;

        this._showContextMenu(event.clientX, event.clientY, entry);
      });
    });

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

        if (event.dataTransfer.files.length > 0) {
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

  _openTab(id, name) {
    this._tab_counter++;
    const tabId = 'tab-' + this._tab_counter;
    this._tabs.push({
      id:                tabId,
      name:              name || tabId,
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

    // Selection bar — always in the DOM, toggle visibility
    const selectionBar = container.querySelector('.selection-bar');
    if (selectionBar) {
      if (tab.selectedEntries.size > 0) {
        const count = tab.selectedEntries.size;
        const extraActions = this.selectionActions(tab) || '';
        selectionBar.innerHTML =
          `<span class="selection-count">${count} selected</span>` +
          `${extraActions}` +
          '<button class="secondary small selection-clear">Clear</button>' +
          '<button class="danger small selection-delete">Delete Selected</button>';
        selectionBar.style.visibility = 'visible';

        selectionBar.querySelector('.selection-clear').addEventListener('click', () => {
          this._clearSelection(tab);
        });
        selectionBar.querySelector('.selection-delete').addEventListener('click', () => {
          this._deleteSelected();
        });
        this._bindSelectionBarExtra(selectionBar, tab);
      } else {
        selectionBar.innerHTML = '&nbsp;';
        selectionBar.style.visibility = 'hidden';
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
      const data = await this.browse(tab.path, tab.page_size || 100, 0);
      tab.entries = data.entries || [];
      tab.total = (data.total != null) ? data.total : tab.entries.length;
    } catch (error) {
      console.error('Failed to fetch listing:', error);
      tab.entries = [];
    }

    tab.loading = false;
    this._updateTabContent(tab.id);
    this._attachScrollListener();
  }

  async _fetchNextPage() {
    const tab = this._activeTab();
    if (!tab || tab.loading_more) return;
    if (tab.entries.length >= (tab.total || 0)) return;

    tab.loading_more = true;
    this._updateTabContent(tab.id);

    try {
      const data = await this.browse(tab.path, tab.page_size || 100, tab.entries.length);
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

  _showContextMenu(x, y, entry) {
    const existing = this.querySelector('.context-menu');
    if (existing) existing.remove();

    const menu = document.createElement('div');
    menu.className = 'context-menu';
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';
    menu.innerHTML = `
      <div class="context-menu-item" data-context="preview">Preview</div>
      <div class="context-menu-item context-menu-danger" data-context="delete">Delete</div>
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
