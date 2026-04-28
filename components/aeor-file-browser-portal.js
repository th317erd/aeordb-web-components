'use strict';

import { AeorFileBrowserBase } from './aeor-file-browser-base.js';

export class AeorFileBrowserPortal extends AeorFileBrowserBase {
  connectedCallback() {
    // For share sessions, clear saved state so we always start fresh
    // at the shared path (not wherever the user last navigated).
    if (window.AUTH && window.AUTH._isShareSession) {
      localStorage.removeItem('aeordb-file-browser');
    }

    super.connectedCallback();

    // Auto-open a tab if none were restored from localStorage
    if (!this._active_tab_id) {
      let initPath = '/';
      if (window.AUTH && window.AUTH._isShareSession) {
        const params = new URLSearchParams(window.location.search);
        const sharePath = params.get('path');
        if (sharePath) {
          initPath = sharePath.endsWith('/')
            ? sharePath
            : sharePath.substring(0, sharePath.lastIndexOf('/') + 1) || '/';
        }
      }
      this._openTab('portal', 'Database', initPath);
    }
  }

  /**
   * Navigate the active tab to the given path (used by share link routing).
   */
  navigateTo(path) {
    const tab = this._activeTab();
    if (!tab) return;
    if (path.endsWith('/')) {
      tab.path = path;
    } else {
      // File — navigate to parent directory
      const lastSlash = path.lastIndexOf('/');
      tab.path = lastSlash > 0 ? path.substring(0, lastSlash + 1) : '/';
    }
    // Must fetch listing (not just re-render) to load data from the new path
    this._fetchListing();
  }

  // ---------------------------------------------------------------------------
  // Abstract method implementations
  // ---------------------------------------------------------------------------

  async browse(path, limit, offset, sort, order) {
    // AeorDB route is /files/{*path} — root requires %2F
    // Strip leading slash to avoid double-slash in URL (e.g. /files//test/)
    const cleanPath = (path && path !== '/') ? path.replace(/^\//, '') : null;
    const filesPath = cleanPath ? `/files/${cleanPath}` : '/files/%2F';
    let qs = `?limit=${limit}&offset=${offset}`;
    if (sort) qs += `&sort=${sort}`;
    if (order) qs += `&order=${order}`;
    const response = await window.api(`${filesPath}${qs}`);
    if (!response.ok) throw new Error(`Browse failed: ${response.status}`);
    const data = await response.json();
    const items = data.items || [];
    return {
      entries: items.map((item) => ({
        name: item.name,
        path: item.path,
        entry_type: item.entry_type,
        size: item.size || 0,
        content_type: item.content_type || 'application/octet-stream',
        created_at: item.created_at,
        updated_at: item.updated_at,
        effective_permissions: item.effective_permissions || null,
      })),
      total: (data.total != null) ? data.total : items.length,
    };
  }

  fileUrl(path) {
    return `/files${path}`;
  }

  async upload(path, body, contentType) {
    const response = await window.api(`/files${path}`, {
      method: 'PUT',
      headers: { 'Content-Type': contentType },
      body,
    });
    if (!response.ok) throw new Error(`Upload failed: ${response.status}`);
  }

  async deletePath(path) {
    const response = await window.api(`/files${path}`, { method: 'DELETE' });
    if (!response.ok) throw new Error(`Delete failed: ${response.status}`);
  }

  async renamePath(fromPath, toPath) {
    const response = await window.api(`/files${fromPath}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: toPath }),
    });
    if (!response.ok) throw new Error(`Rename failed: ${response.status}`);
  }

  /**
   * Upload with XHR for byte-level progress reporting.
   */
  async uploadWithProgress(path, file, onProgress) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('PUT', this.fileUrl(path));

      // Auth header
      if (window.AUTH && window.AUTH.token)
        xhr.setRequestHeader('Authorization', `Bearer ${window.AUTH.token}`);

      xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');

      xhr.upload.addEventListener('progress', (event) => {
        if (event.lengthComputable)
          onProgress(event.loaded, event.total);
      });

      xhr.addEventListener('load', () => {
        if (xhr.status >= 200 && xhr.status < 300)
          resolve();
        else
          reject(new Error(`${xhr.status}`));
      });

      xhr.addEventListener('error', () => reject(new Error('Network error')));
      xhr.addEventListener('abort', () => reject(new Error('Upload aborted')));

      xhr.send(file);
    });
  }

  async readFile(path) {
    const response = await window.api(`/files${path}`);
    if (!response.ok) return null;
    return response.text();
  }

  async createDirectory(path) {
    const response = await window.api('/files/mkdir', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path }),
    });
    if (!response.ok) throw new Error(`Create folder failed: ${response.status}`);
  }

  openNewTab() {
    // Portal has no relationship selector — just open a new tab at root
    this._openTab('portal', 'Database');
  }

  // ---------------------------------------------------------------------------
  // Shared-with-me discovery
  // ---------------------------------------------------------------------------

  async getSharedWithMe() {
    const response = await window.api('/files/shared-with-me');
    if (!response.ok) return { paths: [] };
    return response.json();
  }

  // ---------------------------------------------------------------------------
  // Share method implementations
  // ---------------------------------------------------------------------------

  async getShares(path) {
    const response = await window.api(`/files/shares?path=${encodeURIComponent(path)}`);
    if (!response.ok) throw new Error(`${response.status}`);
    return response.json();
  }

  async share(paths, users, groups, permissions) {
    const response = await window.api('/files/share', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paths, users, groups, permissions }),
    });
    if (!response.ok) throw new Error(`${response.status}`);
  }

  async unshare(path, group, pathPattern) {
    const response = await window.api('/files/shares', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, group, path_pattern: pathPattern }),
    });
    if (!response.ok) throw new Error(`${response.status}`);
  }

  async getShareableUsers() {
    const response = await window.api('/auth/keys/users');
    if (!response.ok) return [];
    const data = await response.json();
    return data.items || [];
  }

  async getShareableGroups() {
    const response = await window.api('/system/groups');
    if (!response.ok) return [];
    const data = await response.json();
    return data.items || [];
  }

  async createShareLink(paths, permissions, expiresInDays) {
    const response = await window.api('/files/share-link', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        paths,
        permissions,
        expires_in_days: expiresInDays,
        base_url: window.location.origin,
      }),
    });
    if (!response.ok) throw new Error(`${response.status}`);
    return response.json();
  }

  async getShareLinks(path) {
    const response = await window.api(`/files/share-links?path=${encodeURIComponent(path)}`);
    if (!response.ok) return { links: [] };
    return response.json();
  }

  async revokeShareLink(keyId) {
    const response = await window.api(`/files/share-links/${encodeURIComponent(keyId)}`, {
      method: 'DELETE',
    });
    if (!response.ok) throw new Error(`${response.status}`);
  }

  // ---------------------------------------------------------------------------
  // Hook overrides
  // ---------------------------------------------------------------------------

  rootLabel() {
    return 'Database';
  }

  /**
   * Fetch the file with auth headers and return a blob URL for the preview
   * component. Preview components use plain fetch() which has no auth —
   * blob URLs bypass that since the data is already fetched.
   */
  async getPreviewSrc(path, contentType) {
    try {
      const response = await window.api(this.fileUrl(path));
      if (!response.ok)
        return this.fileUrl(path);

      const blob = await response.blob();
      return URL.createObjectURL(blob);
    } catch (error) {
      return this.fileUrl(path);
    }
  }

  previewActions(entry) {
    return `
      ${this._hasPermission('y', entry) ? '<button class="secondary small" data-action="share">Share</button>' : ''}
      <button class="primary small" data-action="download">Download</button>
    `;
  }

  selectionActions(tab) {
    return `
      ${this._hasPermission('y') ? '<button class="secondary small selection-share">Share</button>' : ''}
      <button class="primary small selection-download-zip">Download ZIP</button>
    `;
  }

  _bindSelectionBarExtra(selectionBar, tab) {
    const zipBtn = selectionBar.querySelector('.selection-download-zip');
    if (zipBtn) {
      zipBtn.addEventListener('click', () => this._downloadSelectedAsZip());
    }
    const shareBtn = selectionBar.querySelector('.selection-share');
    if (shareBtn) {
      shareBtn.addEventListener('click', () => {
        const paths = [...tab.selectedEntries];
        if (paths.length > 0) this._showShareModal(paths);
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Override: prevent closing the last tab
  // ---------------------------------------------------------------------------

  _closeTab(tabId) {
    if (this._tabs.length <= 1) return;
    super._closeTab(tabId);
  }

  render() {
    super.render();

    // Hide close button when only one tab remains
    if (this._tabs.length <= 1) {
      this.querySelectorAll('.tab-close').forEach((btn) => {
        btn.style.display = 'none';
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Portal-specific: download button instead of drag-out
  // ---------------------------------------------------------------------------

  async _handlePreviewAction(action) {
    if (action === 'share') {
      const tab = this._activeTab();
      if (!tab || !tab.preview_entry) return;
      const filePath = tab.path.replace(/\/$/, '') + '/' + tab.preview_entry.name;
      this._showShareModal([filePath]);
      return;
    }
    if (action === 'download') {
      const tab = this._activeTab();
      if (!tab || !tab.preview_entry) return;
      const filePath = tab.path.replace(/\/$/, '') + '/' + tab.preview_entry.name;
      try {
        // Fetch with auth, then download via blob URL
        const response = await window.api(this.fileUrl(filePath));
        if (!response.ok) throw new Error(`${response.status}`);
        const blob = await response.blob();
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = tab.preview_entry.name;
        link.click();
        URL.revokeObjectURL(link.href);
      } catch (error) {
        if (window.aeorToast)
          window.aeorToast('Download failed: ' + error.message, 'error');
      }
      return;
    }
    if (action === 'download-zip') {
      this._downloadSelectedAsZip();
      return;
    }
    super._handlePreviewAction(action);
  }

  async _downloadSelectedAsZip() {
    const tab = this._activeTab();
    if (!tab) return;

    // selectedEntries already contains full paths
    const paths = [...tab.selectedEntries];

    if (paths.length === 0) return;

    try {
      const response = await window.api('/files/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paths }),
      });
      if (!response.ok) throw new Error(`Download failed: ${response.status}`);

      const blob = await response.blob();
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = 'aeordb-download.zip';
      link.click();
      URL.revokeObjectURL(link.href);
    } catch (error) {
      if (window.aeorToast) {
        window.aeorToast('Download failed: ' + error.message, 'error');
      }
    }
  }
}

customElements.define('aeor-file-browser-portal', AeorFileBrowserPortal);
