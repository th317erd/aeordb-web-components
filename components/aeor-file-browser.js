'use strict';

import { AeorFileBrowserBase } from './aeor-file-browser-base.js';
import { escapeHtml, escapeAttr, directionArrow } from './aeor-file-view-shared.js';

const ENTRY_TYPE_DIR = 3;

export class AeorFileBrowser extends AeorFileBrowserBase {
  constructor() {
    super();
    this._relationships = [];
  }

  connectedCallback() {
    super.connectedCallback();
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
