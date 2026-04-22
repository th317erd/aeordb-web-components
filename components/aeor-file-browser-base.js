'use strict';

import {
  formatSize, formatDate, fileIcon,
  escapeHtml, escapeAttr, isImageFile,
  ENTRY_TYPE_DIR,
} from './aeor-file-view-shared.js';

async function loadPreviewComponent(contentType) {
  if (!contentType) return 'aeor-preview-default';

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

  // -------------------------------------------------------------------------
  // Hook methods — subclasses CAN override these
  // -------------------------------------------------------------------------

  renderNoTabContent() {
    return '<div class="empty-state">No tabs open.</div>';
  }

  rootLabel() {
    return 'Root';
  }

  // -------------------------------------------------------------------------
  // State management
  // -------------------------------------------------------------------------

  _saveState() {
    try {
      const serializable_tabs = this._tabs.map((tab) => ({
        id:             tab.id,
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
        entries:           [],
        total:             null,
        loading:           false,
        loading_more:      false,
        page_size:         tab.page_size || 100,
        preview_entry:     null,
        preview_component: null,
        preview_height:    tab.preview_height || null,
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
      const label    = this._truncate(`${tab.id} ${tab.path}`, 30);

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
          <button class="primary small upload-button">Upload</button>
          <input type="file" class="upload-input" style="display:none" multiple>
        </div>
      </div>
    `;

    if (tab.loading) {
      return `${header}<div class="tab-listing"><div class="loading">Loading...</div></div>`;
    }

    if (tab.entries.length === 0) {
      return `${header}<div class="tab-listing"><div class="empty-state">This directory is empty.</div></div>`;
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

    return `${header}<div class="tab-listing">${listing}<div class="entry-count">${countText}</div>${loadingMore}</div>
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

    container.innerHTML = this._renderDirectoryViewFor(tab);
    this._bindTabContentEvents(tabId);

    if (tabId === this._active_tab_id) {
      this._hydratePreview();
    }
  }

  // Update the persistent preview panel's contents in place — no DOM destruction.
  _showPreview(tab) {
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

    // Update action buttons
    panel.querySelector('.preview-actions').innerHTML = `
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
      const fileUrl = this.fileUrl(filePath);
      previewEl.setAttribute('src', fileUrl);
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

    // File entries (both list rows and grid cards)
    container.querySelectorAll('.file-entry').forEach((el) => {
      el.addEventListener('click', () => {
        const entryType = parseInt(el.dataset.type, 10);
        if (entryType === ENTRY_TYPE_DIR) {
          const newPath = tab.path.replace(/\/$/, '') + '/' + el.dataset.name + '/';
          this._navigateTo(newPath);
        } else {
          tab.preview_entry = tab.entries.find((e) => e.name === el.dataset.name) || null;
          tab.preview_component = null;
          this._loadPreview();
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

    // Upload
    const uploadButton = container.querySelector('.upload-button');
    const uploadInput = container.querySelector('.upload-input');
    if (uploadButton && uploadInput) {
      uploadButton.addEventListener('click', () => uploadInput.click());
      uploadInput.addEventListener('change', (event) => this._handleUpload(event));
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
    this._saveState();
    // Update tab bar label (breadcrumb changed)
    this._updateTabBarLabel(tab);
    this._fetchListing();
  }

  _updateTabBarLabel(tab) {
    const tabEl = this.querySelector(`.tab[data-tab-id="${tab.id}"] .tab-label`);
    if (tabEl) {
      tabEl.textContent = this._truncate(`${tab.id} ${tab.path}`, 30);
    }
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
      case 'delete':
        if (!confirm(`Delete "${entry.name}"? This cannot be undone.`)) break;
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

      case 'close-preview':
        tab.preview_entry = null;
        tab.preview_component = null;
        this._showPreview(tab);
        break;
    }
  }

  async _handleUpload(event) {
    const tab = this._activeTab();
    if (!tab) return;

    const files = event.target.files;
    for (const file of files) {
      const filePath = tab.path.replace(/\/$/, '') + '/' + file.name;

      try {
        const arrayBuffer = await file.arrayBuffer();
        await this.upload(filePath, arrayBuffer, file.type || 'application/octet-stream');
      } catch (error) {
        if (window.aeorToast) {
          window.aeorToast(`Upload failed for ${file.name}: ${error.message}`, 'error');
        }
      }
    }

    event.target.value = '';
    this._fetchListing();
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
}

export { AeorFileBrowserBase, loadPreviewComponent };
