'use strict';

import { AeorFileBrowserBase } from './aeor-file-browser-base.js';
import { ENTRY_TYPE_DIR } from './aeor-file-view-shared.js';

export class AeorFileBrowserPortal extends AeorFileBrowserBase {
  connectedCallback() {
    // For share sessions, clear saved state so we always start fresh
    // at the shared path (not wherever the user last navigated).
    if (window.AUTH && window.AUTH._isShareSession) {
      localStorage.removeItem('aeordb-file-browser');
    }

    super.connectedCallback();
    this._connectSSE();

    // Auto-open a tab if none were restored from localStorage
    if (!this._active_tab_id) {
      let initPath = '/';
      let initPreviewName = null;
      if (window.AUTH && window.AUTH._isShareSession) {
        const params = new URLSearchParams(window.location.search);
        const sharePath = params.get('path');
        if (sharePath) {
          // A share link may target a single file (no trailing slash) or
          // an entire directory (trailing slash). For a file: open the
          // parent directory and queue the file for auto-preview. For a
          // directory: open it directly.
          if (sharePath.endsWith('/')) {
            initPath = sharePath;
          } else {
            const lastSlash = sharePath.lastIndexOf('/');
            initPath = lastSlash > 0 ? sharePath.slice(0, lastSlash + 1) : '/';
            initPreviewName = sharePath.slice(lastSlash + 1);
          }
        }
      }
      this._openTab('portal', 'Database', initPath);
      if (initPreviewName) {
        // After the tab loads its listing, auto-open the file's preview.
        this._pendingSharePreview = initPreviewName;
        // Mark the tab so directory-level actions (New Folder, Upload,
        // Snapshot) stay hidden. The share grants permissions ON THE FILE,
        // not on the parent directory.
        const tab = this._activeTab();
        if (tab) tab._listing_from_share_patterns = true;
      }
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
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve();
        } else {
          let msg = `${xhr.status}`;
          try {
            const body = JSON.parse(xhr.responseText);
            if (body.error) msg = body.error;
          } catch (_) {
            if (xhr.responseText) msg = xhr.responseText.substring(0, 200);
          }
          reject(new Error(msg));
        }
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

  async _createSnapshot(name) {
    const response = await window.api('/versions/snapshots', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({ error: 'Unknown error' }));
      throw new Error(err.error || `HTTP ${response.status}`);
    }
    const data = await response.json().catch(() => ({}));
    if (data.duplicate) {
      throw new Error('No changes');
    }
  }

  async _restoreFromSnapshot(filePath, snapshotId) {
    const cleanPath = filePath.replace(/^\//, '');
    const response = await window.api(`/versions/restore/${cleanPath}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: snapshotId }),
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({ error: 'Unknown error' }));
      throw new Error(err.error || `HTTP ${response.status}`);
    }
  }

  async _restoreFile(filePath) {
    const response = await window.api('/files/restore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: filePath }),
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({ error: 'Unknown error' }));
      throw new Error(err.error || `HTTP ${response.status}`);
    }
  }

  async _pasteAsCopy(paths, destination) {
    const response = await window.api('/files/copy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paths, destination }),
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({ error: 'Copy failed' }));
      throw new Error(err.error || `HTTP ${response.status}`);
    }
  }

  async _pasteAsMove(paths, destination) {
    for (const srcPath of paths) {
      const name = srcPath.split('/').pop();
      const toPath = destination.replace(/\/$/, '') + '/' + name;
      await this.renamePath(srcPath, toPath);
    }
  }

  async _createSymlink(path, target) {
    const response = await window.api(`/files${path}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-Aeor-Symlink': target },
    });
    if (!response.ok) throw new Error(`Symlink failed: ${response.status}`);
  }

  async _fetchDeleted(dirPath) {
    const response = await window.api(`/files/deleted?path=${encodeURIComponent(dirPath)}`);
    if (!response.ok) return [];
    const data = await response.json();
    return data.items || [];
  }

  async _fetchVersionHistory(filePath) {
    const cleanPath = filePath.replace(/^\//, '');
    const response = await window.api(`/versions/history/${cleanPath}`);
    if (!response.ok) return [];
    const data = await response.json();
    return data.history || [];
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

  async _fetchSnapshotList() {
    const response = await window.api('/versions/snapshots');
    if (!response.ok) return [];
    const data = await response.json();
    const items = data.items || [];
    // Map to the same shape as version history entries (newest first)
    return items
      .sort((a, b) => b.created_at - a.created_at)
      .map((s, idx) => ({
        snapshot: s.name,
        id: s.id,
        timestamp: s.created_at,
        change_type: idx === 0 ? 'added' : 'modified',
        size: null,
        content_type: null,
        content_hash: s.root_hash,
      }));
  }

  // ---------------------------------------------------------------------------
  // Hook overrides
  // ---------------------------------------------------------------------------

  rootLabel() {
    return 'Database';
  }

  /**
   * Return a URL for the preview component. For streamable media (video, audio),
   * returns a ?token= URL so the browser uses range requests — no full download.
   * For everything else, fetches with auth and returns a blob URL.
   */
  async getPreviewSrc(path, contentType, skipRevoke) {
    // Streamable media: use ?token= URL for browser range requests
    const ct = (contentType || '').toLowerCase();
    if (ct.startsWith('video/') || ct.startsWith('audio/')) {
      const token = (window.AUTH && window.AUTH.token) ? window.AUTH.token : '';
      return `${this.fileUrl(path)}?token=${encodeURIComponent(token)}`;
    }

    try {
      const response = await window.api(this.fileUrl(path));
      if (!response.ok)
        return this.fileUrl(path);

      const blob = await response.blob();
      // Only revoke previous blob for single-file preview, not grid thumbnails
      if (!skipRevoke && this._lastPreviewBlobUrl) URL.revokeObjectURL(this._lastPreviewBlobUrl);
      const url = URL.createObjectURL(blob);
      if (!skipRevoke) this._lastPreviewBlobUrl = url;
      return url;
    } catch (error) {
      return this.fileUrl(path);
    }
  }

  previewActions(entry) {
    return `
      <button class="primary small" data-action="download">Download</button>
      ${this._hasPermission('y', entry) ? '<button class="secondary small" data-action="share">Share</button>' : ''}
    `;
  }

  directoryPreviewActions(entry) {
    return `
      <button class="primary small" data-action="download-zip">Download ZIP</button>
      ${this._hasPermission('y', entry) ? '<button class="secondary small" data-action="share">Share</button>' : ''}
    `;
  }

  selectionActions(tab) {
    // Selection bar buttons are always in the DOM. _updateSelectionVisual
    // toggles their visibility based on the per-item permissions of the
    // current selection.
    //
    // Copy is always available — if the user can read the bytes (which
    // they must, since the entry shows up in their listing), they can
    // copy them. Permission to PASTE is enforced at the destination.
    return `
      <button class="secondary small selection-cut hidden">Cut</button>
      <button class="secondary small selection-copy">Copy</button>
      <button class="primary small selection-download-zip">Download ZIP</button>
    `;
  }

  selectionActionsRight(tab) {
    return this._hasPermission('y') ? '<button class="secondary small selection-share">Share</button>' : '';
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
    const cutBtn = selectionBar.querySelector('.selection-cut');
    if (cutBtn) {
      cutBtn.addEventListener('click', () => {
        this._setClipboard('cut', [...tab.selectedEntries]);
        this._updateTabContent(tab.id);
        if (window.aeorToast) window.aeorToast('Files cut!', 'success');
      });
    }
    const copyBtn = selectionBar.querySelector('.selection-copy');
    if (copyBtn) {
      copyBtn.addEventListener('click', () => {
        this._setClipboard('copy', [...tab.selectedEntries]);
        if (window.aeorToast) window.aeorToast('Files copied!', 'success');
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
      let filePath = tab.path.replace(/\/$/, '') + '/' + tab.preview_entry.name;
      // Directories need trailing slash for wildcard glob in share
      if (tab.preview_entry.entry_type === ENTRY_TYPE_DIR) filePath += '/';
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

  // ---------------------------------------------------------------------------
  // SSE: live-reload listing when entries are created or deleted elsewhere
  // ---------------------------------------------------------------------------

  _connectSSE() {
    if (this._eventSource) return;
    if (!window.AUTH || !window.AUTH.token) return;

    // EventSource doesn't support Authorization headers, so pass token as query param.
    const url = `/system/events?token=${encodeURIComponent(window.AUTH.token)}`;
    try {
      this._eventSource = new EventSource(url);
      this._eventSource.addEventListener('entries_created', (e) => this._onRemoteChange(e));
      this._eventSource.addEventListener('entries_deleted', (e) => this._onRemoteChange(e));
      this._eventSource.onerror = () => {
        // Silently reconnect — EventSource auto-retries
      };
    } catch (_) {
      // SSE not supported — no live updates
    }
  }

  _onRemoteChange(event) {
    // Only refresh if a file (not directory) changed in the currently viewed directory.
    // Directory index updates fire on every upload as parents propagate — ignoring
    // them prevents constant refreshing during bulk uploads.
    try {
      const data = JSON.parse(event.data);
      const entries = (data.payload && data.payload.entries) || data.entries || [];
      const tab = this._activeTab();
      if (!tab) return;
      const currentDir = tab.path || '/';

      const isRelevant = entries.some((entry) => {
        if (!entry.path) return false;
        if (entry.entry_type === 'directory') return false;
        const lastSlash = entry.path.lastIndexOf('/');
        const parentDir = lastSlash > 0 ? entry.path.substring(0, lastSlash + 1) : '/';
        return parentDir === currentDir;
      });

      if (!isRelevant) return;
    } catch (_) {
      // Can't parse — refresh to be safe
    }

    clearTimeout(this._sseDebounce);
    this._sseDebounce = setTimeout(() => this._fetchListing(), 500);
  }

  disconnectedCallback() {
    if (this._eventSource) {
      this._eventSource.close();
      this._eventSource = null;
    }
    if (super.disconnectedCallback) super.disconnectedCallback();
  }
}

customElements.define('aeor-file-browser-portal', AeorFileBrowserPortal);
