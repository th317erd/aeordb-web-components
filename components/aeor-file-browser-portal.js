'use strict';

import { AeorFileBrowserBase } from './aeor-file-browser-base.js';

export class AeorFileBrowserPortal extends AeorFileBrowserBase {
  connectedCallback() {
    super.connectedCallback();

    // Auto-open a tab if none were restored from localStorage
    if (!this._active_tab_id) {
      this._openTab('portal', 'Database');
    }
  }

  // ---------------------------------------------------------------------------
  // Abstract method implementations
  // ---------------------------------------------------------------------------

  async browse(path, limit, offset) {
    // AeorDB route is /files/{*path} — root requires %2F
    const filesPath = (path && path !== '/')
      ? `/files/${path}`
      : '/files/%2F';
    const response = await window.api(`${filesPath}?limit=${limit}&offset=${offset}`);
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
    return '<button class="primary small" data-action="download">Download</button>';
  }

  selectionActions(tab) {
    return '<button class="primary small selection-download-zip">Download ZIP</button>';
  }

  _bindSelectionBarExtra(selectionBar, tab) {
    const zipBtn = selectionBar.querySelector('.selection-download-zip');
    if (zipBtn) {
      zipBtn.addEventListener('click', () => this._downloadSelectedAsZip());
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
