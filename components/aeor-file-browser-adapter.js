'use strict';

/**
 * Base adapter class for the file browser component.
 * Subclass this to connect the file browser to different backends.
 * The file browser calls these methods — it never constructs URLs itself.
 */
export class FileBrowserAdapter {
  /** Fetch directory listing. Returns { entries: [], total: N } */
  async browse(path, limit, offset) {
    throw new Error('FileBrowserAdapter.browse() not implemented');
  }

  /** Return a relative URL string for accessing/downloading a file. */
  fileUrl(path) {
    throw new Error('FileBrowserAdapter.fileUrl() not implemented');
  }

  /** Return an absolute URL (with origin) for drag-out / external use. */
  fullFileUrl(path) {
    return `${window.location.origin}${this.fileUrl(path)}`;
  }

  /** Upload a file. body is ArrayBuffer, contentType is MIME string. */
  async upload(path, body, contentType) {
    throw new Error('FileBrowserAdapter.upload() not implemented');
  }

  /** Delete a file or directory at path. */
  async delete(path) {
    throw new Error('FileBrowserAdapter.delete() not implemented');
  }

  /** Rename/move a file from fromPath to toPath. */
  async rename(fromPath, toPath) {
    throw new Error('FileBrowserAdapter.rename() not implemented');
  }

  /** Open a file in the native OS file manager (optional). */
  async openLocally(path) {
    throw new Error('FileBrowserAdapter.openLocally() not implemented');
  }

  // Feature flags — override in subclasses
  get supportsTabs() { return false; }
  get supportsSync() { return false; }
  get supportsOpenLocally() { return false; }
  get supportsUpload() { return true; }
  get supportsRename() { return true; }
  get supportsDelete() { return true; }
}
