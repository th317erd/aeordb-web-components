'use strict';

import { elements } from '../../aeor/elements.js';
import {
  formatSize, formatDate, fileIcon, fileExtension,
  escapeHtml, escapeAttr, isImageFile, isVideoFile, isAudioFile,
  flashButton, ENTRY_TYPE_DIR,
} from './aeor-file-view-shared.js';
import { loadPrefs, getPref, mergePrefs } from '../preferences.js';
import '../../aeor/components/aeor-modal.js';
import '../../aeor/components/aeor-confirm-button.js';
import '../../aeor/components/aeor-info-box.js';
import '../../aeor/components/aeor-tab-view.js';
import './aeor-snapshot-card.js';

const { div, span, button, input, label, h2, h3, ul, li, table, thead, tbody, tr, th, td, canvas } = elements;
const aeorModal = elements['aeor-modal'];
const aeorConfirmButton = elements['aeor-confirm-button'];

/** Subclass hook return types (previewActions, directoryPreviewActions)
 *  may be a Node, an Array of Nodes, or an HTML string (legacy contract
 *  still used by aeor-file-browser.js and aeor-file-browser-portal.js).
 *  This helper funnels all three into appendChild calls on a target.
 *  When every subclass returns Nodes the string branch can be removed
 *  along with all CONTRACT-INJECTION comments below. */
function _appendHook(target, content) {
  if (content == null || content === '') return;
  if (content instanceof Node) { target.appendChild(content); return; }
  if (Array.isArray(content)) { for (const c of content) _appendHook(target, c); return; }
  if (typeof content === 'string') {
    const carrier = document.createElement('template');
    carrier.innerHTML = content;
    target.appendChild(carrier.content);
    return;
  }
}

// File type icon factories for grid view thumbnails (non-image files).
// Each returns a fresh element-builder DEFINITION (not a built DOM Node)
// so callers can either pass them as children to another element-builder
// call or build them into a Node with `.build(document)`.
const { svg, path, polyline, rect, circle, line } = elements;
const _ICON_TEXT = elements.text;

function _svgIcon(strokeColor, ...children) {
  return svg
    .width('48').height('48').viewBox('0 0 24 24')
    .fill('none').stroke(strokeColor).strokeWidth('1.5')
    .strokeLinecap('round').strokeLinejoin('round')(...children);
}

const _FILE_ICONS = {
  folder: () => span('📁'),
  video: () => _svgIcon('#8b5cf6',
    rect.x('2').y('2').width('20').height('20').rx('2.18')(),
    path.d('M10 8l6 4-6 4z')(),
  ),
  audio: () => _svgIcon('#06b6d4',
    path.d('M9 18V5l12-2v13')(),
    circle.cx('6').cy('18').r('3')(),
    circle.cx('18').cy('16').r('3')(),
  ),
  pdf: () => _svgIcon('#ef4444',
    path.d('M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z')(),
    polyline.points('14 2 14 8 20 8')(),
    _ICON_TEXT.x('8').y('17').fontSize('6').fill('#ef4444').stroke('none').fontWeight('bold')('PDF'),
  ),
  code: () => _svgIcon('#3fb950',
    polyline.points('16 18 22 12 16 6')(),
    polyline.points('8 6 2 12 8 18')(),
  ),
  text: () => _svgIcon('#8b949e',
    path.d('M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z')(),
    polyline.points('14 2 14 8 20 8')(),
    line.x1('16').y1('13').x2('8').y2('13')(),
    line.x1('16').y1('17').x2('8').y2('17')(),
    line.x1('10').y1('9').x2('8').y2('9')(),
  ),
  archive: () => _svgIcon('#d29922',
    polyline.points('21 8 21 21 3 21 3 8')(),
    rect.x('1').y('3').width('22').height('5')(),
    line.x1('10').y1('12').x2('14').y2('12')(),
  ),
  file: () => _svgIcon('#8b949e',
    path.d('M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z')(),
    polyline.points('14 2 14 8 20 8')(),
  ),
};

function _fileTypeIcon(entry) {
  if (entry.entry_type === 3) return _FILE_ICONS.folder();
  if (entry.entry_type === 8) return _FILE_ICONS.file(); // symlink
  const ext = fileExtension(entry.name);
  if (isVideoFile(entry.name)) return _FILE_ICONS.video();
  if (isAudioFile(entry.name)) return _FILE_ICONS.audio();
  if (ext === 'pdf') return _FILE_ICONS.pdf();
  if (['zip','tar','gz','bz2','7z','rar','xz','zst'].includes(ext)) return _FILE_ICONS.archive();
  if (['js','ts','py','rs','go','java','c','cpp','h','rb','php','sh','css','html','xml','json','yaml','yml','toml','md','sql'].includes(ext)) return _FILE_ICONS.code();
  if (['txt','log','csv','tsv','ini','cfg','conf'].includes(ext)) return _FILE_ICONS.text();
  return _FILE_ICONS.file();
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

/** Build a canvas sized to fit inside a thumbnail box. Internal pixels
 *  match the device pixel ratio for crisp output; CSS size matches the
 *  box so layout doesn't shift. */
function _makeThumbnailCanvas(boxEl) {
  const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
  const displayW = Math.max(1, boxEl.clientWidth  || 140);
  const displayH = Math.max(1, boxEl.clientHeight || 100);
  const intrinsicW = Math.round(displayW * dpr);
  const intrinsicH = Math.round(displayH * dpr);
  const canvasEl = canvas
    .width(String(intrinsicW))
    .height(String(intrinsicH))()
    .build(document);
  canvasEl.style.width  = displayW + 'px';
  canvasEl.style.height = displayH + 'px';
  return canvasEl;
}

/** Draw `source` (HTMLImageElement, ImageBitmap, HTMLVideoElement) into
 *  `canvas`, preserving aspect ratio. Letterboxes if the source's aspect
 *  doesn't match the canvas. */
function _drawCovered(canvas, source, srcWidth, srcHeight) {
  const ctx = canvas.getContext('2d');
  const sw = srcWidth  || source.width  || source.videoWidth  || 1;
  const sh = srcHeight || source.height || source.videoHeight || 1;
  const ratio = Math.min(canvas.width / sw, canvas.height / sh);
  const drawW = sw * ratio;
  const drawH = sh * ratio;
  ctx.drawImage(
    source,
    (canvas.width  - drawW) / 2,
    (canvas.height - drawH) / 2,
    drawW,
    drawH,
  );
}

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
    this._showHidden = getPref('file_browser.show_hidden', false) === true;
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
  /** Whether the current user is the root user (nil UUID). Used to gate
   *  database-level admin actions like creating snapshots. */
  _isRoot() {
    if (typeof window === 'undefined' || !window.AUTH || !window.AUTH.currentUserId) return false;
    return window.AUTH.currentUserId() === '00000000-0000-0000-0000-000000000000';
  }

  /** Empty-state card shown when a non-root user lands on `/` with no
   *  visible content. The default "This directory is empty." message
   *  is technically true (no entries listable for THEM) but opaque —
   *  it doesn't tell the user that the root probably has data they
   *  just can't see, nor how to get access. This card shows their
   *  user ID (with one-click copy) and a clear next step. */
  _renderNoAccessCard(userId) {
    const card = div.class('empty-state-card no-access-card').style(
      'max-width:520px;margin:3rem auto;padding:1.5rem;text-align:left;' +
      'background:var(--card,#161b22);border:1px solid var(--border,#30363d);' +
      'border-radius:0.5rem;'
    )(
      div.style('font-size:1rem;font-weight:600;margin-bottom:0.5rem;color:var(--text,#e6edf3)')(
        "You don't have access to anything yet.",
      ),
      div.class('text-muted').style('margin-bottom:1rem;line-height:1.5')(
        'An admin needs to grant you access to a folder. Once they do, ' +
        'it will show up here. Share your user ID with the admin so they ' +
        'know which account to grant.',
      ),
      div.style('margin-bottom:0.5rem;font-size:0.85rem')(
        'Your user ID:',
      ),
      div.style('display:flex;gap:0.5rem;align-items:center')(
        input.type('text').readonly('')
          .class('form-input form-input-mono')
          .style('flex:1;font-family:var(--font-mono,monospace);font-size:0.85rem')
          .value(userId || '(unknown — refresh the page)')
          .id('no-access-userid')(),
        button.class('primary small').id('no-access-copy').type('button')('Copy'),
      ),
    ).build(document);

    // Wire the copy button. Same pattern as the keys-page copy:
    // navigator.clipboard.writeText, then briefly swap the label so the
    // user sees the action confirmed.
    const copyBtn = card.querySelector('#no-access-copy');
    const idInput = card.querySelector('#no-access-userid');
    if (copyBtn && idInput) {
      copyBtn.addEventListener('click', () => {
        if (!userId) return;
        navigator.clipboard.writeText(userId).then(() => {
          copyBtn.textContent = 'Copied!';
          setTimeout(() => { copyBtn.textContent = 'Copy'; }, 2000);
        }).catch(() => { idInput.select(); });
      });
    }

    return card;
  }

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
    // The crudlify pattern uses the LETTER for "granted" and any other
    // character (typically '.' or '-') for "not granted". The server-side
    // parser checks for an exact letter match, so we mirror that here.
    return perms[idx] === flag;
  }

  /** Get the effective permissions for the current directory.
   *  Returns directory-level permissions only — file-pattern shares set
   *  permissions ON THE FILE not on the directory, so those are skipped. */
  _currentDirectoryPermissions() {
    const tab = this._activeTab ? this._activeTab() : null;

    // Highest priority: tab is showing a file-pattern share (synthetic
    // listing from shared-with-me OR a share-link to a single file). The
    // user has NO directory-level permissions — return all-denied so
    // dir actions (New Folder, Upload, Snapshot) stay hidden.
    if (tab && tab._listing_from_share_patterns) {
      return '--------';
    }

    if (tab && tab.entries && tab.entries.length > 0) {
      // Skip entries marked as file-pattern shares — their permissions
      // describe what the user can do TO THAT FILE.
      const first = tab.entries.find(e => e.effective_permissions && !e._from_share_pattern);
      if (first) return first.effective_permissions;
    }

    // Fallback: share session URL perm param. For share-link sessions
    // where the share targets the directory itself (path ends with /),
    // this is correct.
    if (typeof window !== 'undefined' && window.AUTH && window.AUTH._sharePermissions) {
      return window.AUTH._sharePermissions;
    }
    return null; // normal session — all allowed, server enforces
  }

  // -------------------------------------------------------------------------
  // Hook methods — subclasses CAN override these
  // -------------------------------------------------------------------------

  renderNoTabContent() {
    // Non-root users with no shares typically land here on first visit:
    // no tab was auto-opened (or they closed it), and the default
    // "No tabs open." message is uselessly opaque. Surface the same
    // no-access guidance card the per-tab empty state uses.
    if (!this._isRoot()) {
      const userId =
        (typeof window !== 'undefined' && window.AUTH && window.AUTH.currentUserId)
          ? window.AUTH.currentUserId()
          : null;
      return this._renderNoAccessCard(userId);
    }
    return div.class('empty-state')('No tabs open. Click "+" to open one.').build(document);
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

  /**
   * Extra action buttons rendered into the directory toolbar, to the
   * LEFT of Snapshot / New Folder / Upload. Subclasses can return a
   * Node, an array of Nodes, an HTML string, or null. Use this to
   * surface affordances that only make sense for a particular subclass
   * (e.g. the desktop client's "Open Locally" button, which has no
   * meaning in the portal).
   *
   * Called fresh on every directory render, so subclasses can safely
   * key off the active tab's relationship + path without caching.
   */
  directoryActions(tab) {
    return null;
  }

  /**
   * Per-entry status indicator rendered inline with the filename in
   * BOTH list and grid views. Subclasses can return a Node (typically
   * a small status dot) or null to skip. Default: null — the portal
   * subclass inherits this and renders nothing.
   *
   * Used by the desktop client to surface per-file sync state
   * (entry.sync_status: synced / pending_push / pending_pull / error /
   * not_synced) as a colored dot. The base intentionally doesn't
   * read entry.sync_status itself — that field is only meaningful in
   * client contexts where a SyncMetadataStore exists, and we don't
   * want the portal to start showing dots if the engine ever decides
   * to populate the field there too.
   *
   * Called fresh per-row on every render, so subclasses don't need
   * to cache: a re-listing after a sync naturally updates the dot.
   */
  syncStatusIndicator(entry) {
    return null;
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
      mergePrefs({
        file_browser: {
          tabs:          serializable_tabs,
          active_tab_id: this._active_tab_id,
          tab_counter:   this._tab_counter,
        },
      });
    } catch (error) {
      // preferences unavailable
    }
  }

  _loadState() {
    try {
      const state = getPref('file_browser', null);
      if (!state) return;

      this._active_tab_id = state.active_tab_id || null;
      this._tab_counter   = state.tab_counter   || 0;

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

  async connectedCallback() {
    // Prime the preferences cache before _loadState reads it. On the
    // first navigation this is a single localhost round-trip (~10ms);
    // subsequent mounts hit the in-memory cache and return instantly.
    // Also seeds _showHidden, which was read in the constructor against
    // whatever the cache contained at that moment (typically nothing).
    await loadPrefs();
    this._showHidden = getPref('file_browser.show_hidden', false) === true;

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
    this.textContent = '';

    this.appendChild(
      div.class('page-header')(
        h2.class('page-title')('Files'),
      ).build(document),
    );

    if (this._tabs.length > 0) {
      this.appendChild(this._renderTabBar());
    }

    if (!this._active_tab_id) {
      _appendHook(this, this.renderNoTabContent());
      this._bindShellEvents();
      return;
    }

    // Render all tab content containers — only the active one is visible.
    // Build via element-builder for the static wrapper, then appendChild
    // the already-built child nodes (the chain returns DOM Nodes; the
    // element-builder stringifies any Node passed as a child).
    for (const tab of this._tabs) {
      const isActive = (tab.id === this._active_tab_id);
      const tabContent = div
        .class(isActive ? 'tab-content' : 'tab-content hidden')
        .id(`tab-content-${tab.id}`)()
        .build(document);
      const listingArea = div.class('tab-listing-area')().build(document);
      for (const node of this._renderDirectoryViewFor(tab)) {
        listingArea.appendChild(node);
      }
      tabContent.appendChild(listingArea);
      tabContent.appendChild(this._renderPreviewPanel(tab));
      this.appendChild(tabContent);
    }

    this._bindShellEvents();
    // Bind events for ALL tab containers (not just active) since render()
    // rebuilds everything — inactive tabs need handlers for when switched to.
    for (const tab of this._tabs) {
      this._bindTabContentEvents(tab.id);
    }
    this._hydratePreview();
  }

  _renderTabBar() {
    return elements['aeor-tab-view']
      .closable('').newTab('').id('file-tab-view')()
      .build(document);
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
    if (!path.includes('/.aeordb-config')) return null;

    return [
      button.class('secondary small config-action-btn').dataAction('add-index')('Add Index'),
      button.class('secondary small config-action-btn').dataAction('add-parser')('Add Parser'),
      button.class('secondary small config-action-btn').dataAction('cors-config')('CORS Config'),
    ];
  }

  _renderDirectoryViewFor(tab) {
    const viewMode    = tab.view_mode || 'list';
    const configActions = this._getConfigActions(tab);

    // Per-tab header (breadcrumbs + per-tab actions).
    const headerActions = div.class('page-header-actions')(
      configActions ? div.class('config-actions-bar')(...configActions) : null,
      button.class('secondary small header-paste-btn hidden')('Paste'),
      // Subclass-injected actions (e.g. desktop client's "Open Locally").
      // Placed BEFORE the Snapshot/New Folder/Upload group so they sit
      // on the left side of those affordances.
      this.directoryActions(tab),
      this._isRoot() ? button.class('success small snapshot-button')('Snapshot') : null,
      this._hasPermission('c') ? button.class('secondary small new-folder-button')('New Folder') : null,
      this._hasPermission('c') ? button.class('primary small upload-button')('Upload') : null,
      this._hasPermission('c') ? input.type('file').class('upload-input hidden').multiple('')() : null,
    );

    const header = div.class('tab-header')().build(document);
    const pageHeader = div.class('page-header')().build(document);
    pageHeader.appendChild(this._renderBreadcrumbs(tab));
    pageHeader.appendChild(headerActions.build(document));
    header.appendChild(pageHeader);

    // Unified toolbar: selection actions on left, view controls on right.
    // Selection bar buttons are always in the DOM. Visibility is toggled
    // dynamically in _updateSelectionVisual based on the actual permissions
    // of the selected entries — a mixed folder may contain both deletable
    // and non-deletable files, and the button should appear when ALL
    // selected items grant the action.
    const selectionLeft = div.class('selection-actions-left invisible')(
      span.class('selection-count')(),
      aeorConfirmButton
        .class('selection-delete hidden')
        .label('Delete Selected')
        .confirmedText('Deleted!')
        .duration('1000')
        .style('--lpb-fill:var(--danger,#f85149);--lpb-text:var(--danger,#f85149);')(),
      button.class('primary small selection-restore hidden')('Undelete Selected'),
    ).build(document);
    _appendHook(selectionLeft, this.selectionActions(tab));
    selectionLeft.appendChild(
      button.class('secondary small selection-clear')('Clear Selection').build(document),
    );
    if (this.selectionActionsRight) {
      _appendHook(selectionLeft, this.selectionActionsRight(tab));
    }

    // Build toolbar in two layers: outer wrappers via element-builder,
    // then appendChild the already-built `selectionLeft` (a DOM node)
    // so it isn't stringified by the builder's child machinery.
    const toolbarRight = div.class('toolbar-right')(
      button
        .class('small ' + (this._showHidden ? 'primary' : 'secondary') + ' toggle-hidden-btn')
        .title(this._showHidden ? 'Hide hidden and deleted files' : 'Show hidden and deleted files')(
          '👁',
        ),
      div.class('view-toggle')(
        button.class('small ' + ((viewMode === 'list') ? 'primary' : 'secondary'))
          .dataView('list').title('List view')('☰'),
        button.class('small ' + ((viewMode === 'grid') ? 'primary' : 'secondary'))
          .dataView('grid').title('Grid view')('▦'),
      ),
    ).build(document);

    const selectionBar = div.class('selection-bar')().build(document);
    selectionBar.appendChild(selectionLeft);
    selectionBar.appendChild(toolbarRight);

    const toolbar = div.class('tab-toolbar')().build(document);
    toolbar.appendChild(selectionBar);

    const listing = div.class('tab-listing')().build(document);
    listing.appendChild(this._renderListingContent(tab, viewMode));

    // No-access state: a non-root user with an empty listing is being
    // shown the user-ID guidance card. Strip BOTH the page header
    // (the breadcrumb is just "Database /" with nothing to navigate
    // to) and the toolbar (no view-mode/selection actions apply when
    // there's no content). Return only the guidance card.
    if (this._isNoAccessState(tab)) {
      return [listing];
    }

    return [header, toolbar, listing];
  }

  /** Whether the file browser is in "no-access" empty state for the
   *  current tab. Mirrors the condition in _renderListingContent's
   *  empty-state branch so the toolbar can be hidden in lockstep. */
  _isNoAccessState(tab) {
    if (this._isRoot()) return false;
    if (tab.loading) return false;
    if (tab._fetchError && tab._fetchError.category &&
        tab._fetchError.category !== 'upstream_rejected') return false;
    if (tab.entries.length !== 0) return false;
    const visible = this._getVisibleEntries(tab);
    return visible.length === 0;
  }

  _renderListingContent(tab, viewMode) {
    viewMode = viewMode || tab.view_mode || 'list';

    // Render a banner for fetch errors whose CAUSE is not a permission
    // denial — connection failures, server 5xx, parse errors. The
    // 4xx (upstream_rejected) case deliberately falls through to the
    // empty-state below to avoid leaking the engine's denial-vs-
    // nonexistent distinction (DB team's 2026-05-23 retraction). The
    // category comes from the backend's categorized ClientError, NOT
    // from regex-matching the error message — categories are the
    // stable contract.
    if (tab._fetchError && tab._fetchError.category &&
        tab._fetchError.category !== 'upstream_rejected') {
      const aeorInfoBox = elements['aeor-info-box'];
      const { category, message } = tab._fetchError;
      let headline, detail;
      switch (category) {
        case 'upstream_unreachable':
          headline = 'Cannot reach the server.';
          detail   = 'Check that the engine is running and your network connection is up.';
          break;
        case 'upstream_server':
          headline = 'The server reported an internal error.';
          detail   = 'Try again, or contact your admin.';
          break;
        case 'upstream_protocol':
          headline = 'The server returned an unexpected response.';
          detail   = 'The client may be out of date.';
          break;
        default:
          // Any other non-rejection category (e.g. server-internal
          // errors raised inside our own client code) — generic copy.
          headline = 'Couldn’t load this folder.';
          detail   = 'The client received an error. Try again, or check the activity feed and dev-tools for details.';
      }
      return aeorInfoBox.warning('')(
        div(headline),
        div.class('text-muted')(detail),
        div.class('text-muted').style('margin-top:0.5rem;font-size:0.8125rem;')(`Error: ${message}`),
      ).build(document);
    }

    if (tab.loading && tab.entries.length === 0) {
      return div.class('empty-state')(' ').build(document);
    }

    const visible = this._getVisibleEntries(tab);

    if (visible.length === 0 && tab.entries.length === 0) {
      // Non-root user with an empty listing: most often they have no
      // grants at all (and the engine returns an empty listing per
      // anti-leak design rather than 403). Show the user-ID + ask-admin
      // card instead of "This directory is empty." — same guidance
      // applies whether they're at `/` or deeper.
      //
      // Root users see the original "empty" message because they CAN
      // act on it (mkdir/upload). Non-root + write permission would
      // have surfaced a New Folder button via _hasPermission already.
      if (!this._isRoot()) {
        const userId =
          (typeof window !== 'undefined' && window.AUTH && window.AUTH.currentUserId)
            ? window.AUTH.currentUserId()
            : null;
        return this._renderNoAccessCard(userId);
      }
      return div.class('empty-state')('This directory is empty.').build(document);
    }

    if (visible.length === 0 && tab.entries.length > 0) {
      return div.class('empty-state')(
        `All ${tab.entries.length} items are hidden. Click the eye icon to show them.`,
      ).build(document);
    }

    const hiddenCount = tab.entries.length - visible.length;
    const countText = (tab.total != null)
      ? `Showing ${visible.length} of ${tab.total}${(hiddenCount > 0) ? ` (${hiddenCount} hidden)` : ''}`
      : `${visible.length} items${(hiddenCount > 0) ? ` (${hiddenCount} hidden)` : ''}`;

    const listing = (viewMode === 'grid')
      ? this._renderGridViewFor(tab, visible)
      : this._renderListViewFor(tab, visible);

    // The chain expects a single Node \u2014 wrap listing + count + optional loading-more.
    const frag = document.createDocumentFragment();
    frag.appendChild(listing);
    frag.appendChild(div.class('entry-count')(countText).build(document));
    if (tab.loading_more) {
      frag.appendChild(div.class('scroll-loading')('Loading more...').build(document));
    }
    return frag;
  }

  _renderPreviewPanel(tab) {
    const aeorInfoBox = elements['aeor-info-box'];
    let panel = div.class('preview-panel hidden').translate('no');
    if (tab.preview_height) {
      panel = panel.style(`height:${tab.preview_height}px`);
    }
    return panel(
      div.class('preview-resize-handle')(),
      div.class('preview-header')(
        input.type('text').class('preview-title').spellcheck('false')(),
        div.class('preview-actions')(),
      ),
      div.class('preview-inner')(
        div.class('preview-main')(
          div.class('preview-content')(),
          div.class('preview-meta')(),
          div.class('preview-warning hidden')(),
        ),
        div.class('preview-versions hidden').translate('no')(
          div.class('preview-versions-heading')('Version History'),
          aeorInfoBox.compact('').class('preview-versions-info hidden').style('margin-bottom:0.5rem')(
            'Any version can be safely restored.',
          ),
          div.class('preview-versions-list')(),
        ),
      ),
    ).build(document);
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
    const rowClassName = 'file-entry' + (isDeleted ? ' deleted-row' : isCut ? ' cut-row' : '');

    // fileIcon() returns a plain emoji codepoint (not HTML), so we can
    // pass it as a child to `span()`. Keeping it a builder (not a built
    // DOM node) lets the surrounding `td()` compose it via the
    // element-builder's child machinery without stringification.
    const fileIconSpan = span.class('file-icon')(icon);
    const nameSpan = isDeleted
      ? span.class('deleted-file-name')(entry.name)
      : span(entry.name);

    const modifiedCell = isDeleted
      ? td(span.class('text-danger')(`Deleted ${formatDate(entry._deleted_at)}`))
      : td(formatDate(entry.updated_at));

    let rowBuilder = tr
      .class(rowClassName)
      .dataName(entry.name)
      .dataType(String(entry.entry_type));
    if (isDeleted) rowBuilder = rowBuilder.dataDeleted('true');

    // Subclass-injected status indicator (e.g. desktop client's sync
    // dot). Returns Node | null. Placed at the START of the name cell
    // (before the file icon) so it stays anchored to the row's left
    // edge regardless of how long the filename is — long names that
    // overflow into ellipsis won't clip the dot.
    const statusDot = this.syncStatusIndicator(entry);

    return rowBuilder(
      td(statusDot, fileIconSpan, nameSpan),
      td(size),
      td(created),
      modifiedCell,
    ).build(document);
  }

  _renderListViewFor(tab, entries) {
    const tbodyEl = tbody();
    const rows = entries.map((entry) => this._renderListRow(entry));

    const tableEl = table(
      thead(
        tr(
          th.dataSort('name')('Name ', this._sortIndicator('name')),
          th.dataSort('size')('Size ', this._sortIndicator('size')),
          th.dataSort('created_at')('Created ', this._sortIndicator('created_at')),
          th.dataSort('updated_at')('Modified ', this._sortIndicator('updated_at')),
        ),
      ),
      tbodyEl,
    ).build(document);

    // Append rows after the wrapper is built (since _renderListRow already
    // returns DOM nodes, we can't pass them as element-builder children).
    const tbodyNode = tableEl.querySelector('tbody');
    for (const row of rows) tbodyNode.appendChild(row);

    return tableEl;
  }

  _renderGridViewFor(tab, entries) {
    const gridEl = div.class('file-grid')().build(document);

    for (const entry of entries) {
      const isDir = (entry.entry_type === ENTRY_TYPE_DIR);
      const size  = (isDir) ? 'Folder' : formatSize(entry.size);
      const isDeleted = !!entry._deleted;

      let thumbnailEl;
      if (!isDir && (isImageFile(entry.name) || isVideoFile(entry.name))) {
        // Image/video: show a loading placeholder, async-load with auth later
        const thumbType = isVideoFile(entry.name) ? 'video' : 'image';
        const thumbPath = tab.path.replace(/\/$/, '') + '/' + entry.name;
        thumbnailEl = div
          .class('grid-card-thumbnail')
          .dataThumbPath(thumbPath)
          .dataThumbType(thumbType)(
            div.class('grid-card-loading')('\u23F3'),
          );
      } else {
        // Non-image: show a file type icon (element-builder tree).
        thumbnailEl = div.class('grid-card-icon')(_fileTypeIcon(entry));
      }

      let cardBuilder = div
        .class('grid-card file-entry' + (isDeleted ? ' deleted-card' : ''))
        .dataName(entry.name)
        .dataType(String(entry.entry_type));
      if (isDeleted) cardBuilder = cardBuilder.dataDeleted('true');

      const truncatedName = this._truncate(entry.name, 20);
      // Subclass-injected status indicator. Lives as a direct child of
      // the card (NOT inside .grid-card-name) so CSS can absolute-
      // position it to the top-left corner of the card via
      // `.grid-card > .aeor-sync-dot`. That keeps the dot anchored
      // to the card's leading corner regardless of truncated-name
      // length or thumbnail content — same "far left of the entry"
      // intent as the list view, expressed correctly for a 2D card.
      const statusDot = this.syncStatusIndicator(entry);

      const cardEl = cardBuilder(
        statusDot,
        thumbnailEl,
        div.class('grid-card-name' + (isDeleted ? ' deleted-name' : '')).title(entry.name)(
          truncatedName,
        ),
        div.class('grid-card-meta')(
          isDeleted ? span.class('text-danger')('Deleted') : size,
        ),
      ).build(document);
      gridEl.appendChild(cardEl);
    }

    return gridEl;
  }

  /** Load image/video thumbnails with auth after grid renders.
   *  Thumbnails render into small <canvas> elements rather than <img> so
   *  the browser doesn't hold a full-resolution decoded bitmap per file.
   *  We `createImageBitmap`, `drawImage` at thumbnail resolution, then
   *  `bitmap.close()` to release the full-res decode immediately — the
   *  canvas only retains the small scaled-down pixels (~50KB each vs.
   *  tens of MB for a 5MP photo). Without this the grid view bogs down
   *  after just a handful of large images. */
  _loadGridThumbnails(container) {
    if (!container || typeof this.getPreviewSrc !== 'function') return;
    const tab = this._activeTab();
    if (!tab) return;
    tab._gridBlobUrls = tab._gridBlobUrls || [];

    const thumbs = container.querySelectorAll('.grid-card-thumbnail[data-thumb-path]');
    for (const el of thumbs) {
      const path = el.dataset.thumbPath;
      const type = el.dataset.thumbType || 'image';
      if (!path) continue;
      if (el.querySelector('canvas')) continue;

      if (type === 'video') {
        this._loadVideoThumbnail(el, path);
      } else {
        this.getPreviewSrc(path, 'image/*', true).then(async (blobUrl) => {
          tab._gridBlobUrls.push(blobUrl);
          // Re-query the element in the current DOM (original may be gone)
          const current = container.querySelector(`.grid-card-thumbnail[data-thumb-path="${CSS.escape(path)}"]`);
          if (!current || current.querySelector('canvas')) return;
          await this._drawImageThumbnail(current, blobUrl);
        }).catch(() => {});
      }
    }
  }

  /** Decode an image (from blob URL) and paint it onto a small canvas
   *  sized to the thumbnail box, preserving aspect ratio. */
  async _drawImageThumbnail(thumbnailEl, blobUrl) {
    let bitmap;
    try {
      const response = await fetch(blobUrl);
      const blob = await response.blob();
      bitmap = await createImageBitmap(blob);

      const canvas = _makeThumbnailCanvas(thumbnailEl);
      _drawCovered(canvas, bitmap);

      thumbnailEl.textContent = '';
      thumbnailEl.appendChild(canvas);
    } catch (_) {
      // leave placeholder in place — fallback icon would require type info
    } finally {
      if (bitmap) bitmap.close();
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

      const video = elements.video
        .crossOrigin('anonymous')
        .muted('')
        .preload('metadata')()
        .build(document);
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

      // Draw the keyframe straight into a thumbnail-sized canvas \u2014 the
      // full-res video frame never lives in DOM, only the small scaled
      // pixels do.
      const canvasEl = _makeThumbnailCanvas(el);
      _drawCovered(canvasEl, video, video.videoWidth, video.videoHeight);

      el.textContent = '';
      el.appendChild(canvasEl);
      el.appendChild(
        div.class('grid-card-play-overlay')('\u25B6').build(document),
      );
      el.style.position = 'relative';

      // Release resources
      video.src = '';
      video.load();
    } catch (e) {
      // Fallback to the generic video file-type icon (element-builder tree).
      el.textContent = '';
      el.appendChild(
        div.class('grid-card-icon')(_FILE_ICONS.video()).build(document),
      );
    }
  }

  _renderBreadcrumbs(tab) {
    const path = tab.path;
    const labelText = this.rootLabel();
    const segments = path.split('/').filter((s) => s.length > 0);

    const children = [
      span.class('breadcrumb-segment').dataPath('/')(labelText),
    ];

    let accumulated = '/';
    for (const segment of segments) {
      accumulated += segment + '/';
      children.push(span.class('breadcrumb-separator')('/'));
      children.push(
        span.class('breadcrumb-segment').dataPath(accumulated)(segment),
      );
    }

    return div.class('breadcrumbs')(...children).build(document);
  }

  // Update only a single tab's content container — no structural DOM change.
  _updateTabContent(tabId) {
    const container = this.querySelector(`#tab-content-${tabId}`);
    const tab = this._tabs.find((t) => t.id === tabId);
    if (!container || !tab) return;

    const listingArea = container.querySelector('.tab-listing-area');

    if (!listingArea) {
      // First render: full build
      container.textContent = '';
      const newListingArea = div.class('tab-listing-area')().build(document);
      for (const node of this._renderDirectoryViewFor(tab)) {
        newListingArea.appendChild(node);
      }
      container.appendChild(newListingArea);
      container.appendChild(this._renderPreviewPanel(tab));
      this._bindTabContentEvents(tabId);
    } else {
      // Selective update: only replace the file listing, preserve toolbar + header
      const listing = listingArea.querySelector('.tab-listing');
      const scrollTop = (listing) ? listing.scrollTop : 0;

      // Update breadcrumbs + header buttons in place
      const headerEl = listingArea.querySelector('.tab-header');
      if (headerEl) {
        const configActions = this._getConfigActions(tab);
        headerEl.textContent = '';

        const headerActions = div.class('page-header-actions')(
          configActions ? div.class('config-actions-bar')(...configActions) : null,
          button.class('secondary small header-paste-btn hidden')('Paste'),
          // Subclass-injected actions, same as the full render path.
          this.directoryActions(tab),
          this._isRoot() ? button.class('success small snapshot-button')('Snapshot') : null,
          this._hasPermission('c') ? button.class('secondary small new-folder-button')('New Folder') : null,
          this._hasPermission('c') ? button.class('primary small upload-button')('Upload') : null,
          this._hasPermission('c') ? input.type('file').class('upload-input hidden').multiple('')() : null,
        ).build(document);

        const pageHeader = div.class('page-header')().build(document);
        pageHeader.appendChild(this._renderBreadcrumbs(tab));
        pageHeader.appendChild(headerActions);
        headerEl.appendChild(pageHeader);
      }

      // Update listing content only (toolbar is preserved)
      if (listing) {
        listing.textContent = '';
        listing.appendChild(this._renderListingContent(tab));
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
        const actionsEl = panel.querySelector('.preview-actions');
        actionsEl.textContent = '';
        actionsEl.appendChild(
          div.class('preview-actions-row')(
            button.class('secondary small').dataAction('close-preview')('\u2715'),
          ).build(document),
        );

        // Load the preview from the snapshot
        const contentType = latestVersion.content_type || 'application/octet-stream';
        const componentName = await loadPreviewComponent(contentType);
        const contentEl = panel.querySelector('.preview-content');
        if (componentName) {
          contentEl.textContent = '';
          contentEl.appendChild(elements[componentName]().build(document));
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

        // Load version history sidebar
        this._loadVersionHistory(panel, tab, entry);
        // Bind other action buttons (close)
        panel.querySelectorAll('[data-action]').forEach((button) => {
          button.addEventListener('click', (event) => {
            event.stopPropagation();
            this._handlePreviewAction(button.dataset.action);
          });
        });
      } else {
        // No snapshots — show trash can with "Undelete" button
        const noSnapActions = panel.querySelector('.preview-actions');
        noSnapActions.textContent = '';
        if (this._hasPermission('u', entry)) {
          noSnapActions.appendChild(
            button.class('primary small').dataAction('restore-deleted')('Undelete').build(document),
          );
        }
        noSnapActions.appendChild(
          button.class('secondary small').dataAction('close-preview')('\u2715').build(document),
        );

        const { strong } = elements;
        const contentEl = panel.querySelector('.preview-content');
        contentEl.textContent = '';
        contentEl.appendChild(
          div.class('deleted-file-placeholder')(
            div.class('deleted-file-icon')('\uD83D\uDDD1'),
            div.class('deleted-file-title')('File Deleted'),
            div.class('deleted-file-info')(`Deleted on ${formatDate(entry._deleted_at)}`),
            div.class('deleted-file-hint')(
              'No snapshots available. Click ',
              strong('Undelete'),
              ' to recover from the database history.',
            ),
          ).build(document),
        );

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
    // CONTRACT-INJECTION: previewActions(entry) may return a Node, an array
    // of Nodes, or an HTML string (legacy). _appendHook handles all three.
    const fileActions = panel.querySelector('.preview-actions');
    fileActions.textContent = '';
    if (this._hasPermission('d', entry)) {
      fileActions.appendChild(
        aeorConfirmButton
          .class('preview-delete-btn')
          .label('Delete')
          .confirmedText('Deleted!')
          .duration('1000')
          .style('--lpb-fill:var(--danger,#f85149);--lpb-text:var(--danger,#f85149);')()
          .build(document),
      );
    }
    _appendHook(fileActions, this.previewActions(entry));
    fileActions.appendChild(
      button.class('secondary small').dataAction('close-preview')('\u2715').build(document),
    );

    // Update preview component — only swap if the component type changed
    const contentEl = panel.querySelector('.preview-content');
    const existingPreview = contentEl.firstElementChild;
    if (!existingPreview || existingPreview.tagName.toLowerCase() !== componentName) {
      contentEl.textContent = '';
      contentEl.appendChild(elements[componentName]().build(document));
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
        warningEl.textContent = '';
        const warnSvg = elements.svg
          .width('18').height('18').viewBox('0 0 24 24')
          .fill('none').stroke('#d29922').strokeWidth('2')
          .strokeLinecap('round').strokeLinejoin('round')(
            elements.path.d('M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z')(),
            elements.line.x1('12').y1('9').x2('12').y2('13')(),
            elements.line.x1('12').y1('17').x2('12.01').y2('17')(),
          );
        warningEl.appendChild(
          div.class('system-file-warning')(
            warnSvg,
            span.class('system-file-warning-text')(
              'This is a system configuration file. Modifying or deleting it may affect database behavior and could cause instability.',
            ),
          ).build(document),
        );
      } else {
        warningEl.classList.add('hidden');
        warningEl.textContent = '';
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
    // CONTRACT-INJECTION: directoryPreviewActions(entry) may return Node/
    // array/string. _appendHook handles all three.
    const dirActionsEl = panel.querySelector('.preview-actions');
    dirActionsEl.textContent = '';
    if (this._hasPermission('d', entry)) {
      dirActionsEl.appendChild(
        aeorConfirmButton
          .class('preview-delete-btn')
          .label('Delete')
          .confirmedText('Deleted!')
          .duration('1000')
          .style('--lpb-fill:var(--danger,#f85149);--lpb-text:var(--danger,#f85149);')()
          .build(document),
      );
    }
    _appendHook(dirActionsEl, this.directoryPreviewActions(entry));
    dirActionsEl.appendChild(
      button.class('secondary small').dataAction('close-preview')('\u2715').build(document),
    );

    const dirContentEl = panel.querySelector('.preview-content');
    dirContentEl.textContent = '';
    dirContentEl.appendChild(
      div.class('directory-preview-icon')('\uD83D\uDCC1').build(document),
    );

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
        mergePrefs({ file_browser: { show_hidden: this._showHidden } });
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

    // Load data if this tab hasn't been fetched yet, OR if a background-
    // tab refresh was queued while we weren't looking (subclass-set
    // `_needsRefresh` flag — e.g. an SSE sync-activity event for this
    // relationship landed while a different tab was active).
    const tab = this._activeTab();
    const needsRefresh = tab && (tab._needsRefresh === true);
    if (tab && needsRefresh) {
      tab._needsRefresh = false;
      this._fetchListing();
    } else if (tab && tab.entries.length === 0 && !tab.loading) {
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

        // Check which selected files are deleted vs live
        const allEntries = [...tab.entries, ...(tab._deletedEntries || [])];
        const selectedPaths = [...tab.selectedEntries];
        const hasDeletedSelected = selectedPaths.some((path) => {
          const name = path.split('/').pop();
          return allEntries.some((e) => e.name === name && e._deleted);
        });
        const allDeleted = selectedPaths.every((path) => {
          const name = path.split('/').pop();
          return allEntries.some((e) => e.name === name && e._deleted);
        });

        // Resolve each selected path to its entry so we can inspect
        // per-entry effective_permissions (mixed folders may contain
        // some deletable + some not).
        const selectedEntries = selectedPaths.map((path) => {
          const name = path.split('/').pop();
          return allEntries.find((e) => e.name === name) || null;
        }).filter(Boolean);

        // Helper: true when EVERY selected entry grants the given flag
        // (read it via the entry's effective_permissions, falling back to
        // the directory's permissions). Empty selection → false.
        const allCan = (flag) => {
          if (selectedEntries.length === 0) return false;
          return selectedEntries.every((e) => this._hasPermission(flag, e));
        };

        const canDeleteAll = allCan('d');
        const canUndeleteAll = allCan('u');

        // Show/hide restore button — only when deleted files are selected
        // AND the user can update them.
        const restoreBtn = leftSlot.querySelector('.selection-restore');
        if (restoreBtn) {
          restoreBtn.classList.toggle('hidden', !hasDeletedSelected || !canUndeleteAll);
        }

        // Show delete button only when ALL selected items are deletable AND
        // not already deleted.
        const deleteBtn = leftSlot.querySelector('.selection-delete');
        if (deleteBtn) {
          deleteBtn.classList.toggle('hidden', allDeleted || !canDeleteAll);
        }

        // Cut requires update + delete on every selected item (moving =
        // remove from source). Copy is always allowed — if the user can
        // read the bytes, they can copy; paste permission is enforced
        // at the destination.
        const canUpdateAll = allCan('u');
        const cutBtn = leftSlot.querySelector('.selection-cut');
        if (cutBtn) {
          cutBtn.classList.toggle('hidden', !(canUpdateAll && canDeleteAll));
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
    tab.preview_entry = null;
    tab.preview_component = null;
    this._updateSelectionVisual(tab);
    this._showPreview(tab);
  }

  async _deleteSelected() {
    const tab = this._activeTab();
    if (!tab || tab.selectedEntries.size === 0) return;

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
    await this._fetchListing();
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
      tab._fetchError = null;
    } catch (error) {
      console.error('Failed to fetch listing:', error);
      tab.entries = [];
      // Capture the structured category from the throw site (see
      // AeorFileBrowser.browse). Render-side decides whether to surface
      // it as a banner or fall through to the empty-state — see
      // _renderListingContent. We intentionally DON'T render a banner
      // for 4xx (upstream_rejected) to avoid leaking the engine's
      // denial-vs-nonexistent distinction (DB team's 2026-05-23
      // retraction); those land in the same empty-state as a truly
      // empty folder.
      tab._fetchError = {
        category: (error && error.category) || null,
        status:   (error && error.status) || null,
        message:  (error && error.message) ? String(error.message) : String(error),
      };
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

    // Auto-open a file preview if a share link targeted a specific file.
    // Set by AeorFileBrowserPortal.connectedCallback when ?path=<file> was
    // present in the share URL (vs ?path=<directory>/).
    if (this._pendingSharePreview) {
      const target = this._pendingSharePreview;
      this._pendingSharePreview = null;
      const entry = tab.entries.find((e) => e.name === target);
      if (entry) {
        // Open the file preview using the same path the listing rows use.
        tab.preview_entry = entry;
        if (typeof this._loadPreview === 'function') {
          this._loadPreview();
        }
      }
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
          path_pattern: s.path_pattern || null,
          permissions: s.permissions || '-r--l---',
          size: s.size || 0,
          created_at: s.created_at || null,
          updated_at: s.updated_at || null,
          content_type: s.content_type || null,
        }));
      }

      if (this._sharedPathData.length === 0) return;

      const currentPath = tab.path;

      // Find child directories at this level that are ancestors of shared paths.
      const childDirs = new Set();
      // Also find specific files shared at THIS level via path_pattern
      // (e.g. /Pictures/Family/.aeordb-permissions has links with
      // path_pattern="aeolus1.png" — show aeolus1.png as a file entry).
      const sharedFiles = new Map(); // name -> { permissions }
      for (const sp of this._sharedPathData) {
        if (!sp.path.startsWith(currentPath)) continue;
        const remainder = sp.path.slice(currentPath.length);
        if (remainder === '' && sp.path_pattern) {
          // We're AT the shared directory — show the specific file
          if (!sharedFiles.has(sp.path_pattern)) {
            sharedFiles.set(sp.path_pattern, {
              permissions: sp.permissions,
              size: sp.size,
              created_at: sp.created_at,
              updated_at: sp.updated_at,
              content_type: sp.content_type,
            });
          }
        } else {
          const nextSegment = remainder.split('/')[0];
          if (nextSegment) childDirs.add(nextSegment);
        }
      }

      const dirEntries = [...childDirs].sort().map((name) => ({
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

      const fileEntries = [...sharedFiles.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([name, info]) => ({
          name,
          path: currentPath + name,
          entry_type: 1, // FileRecord
          size: info.size || 0,
          content_type: info.content_type || null,
          created_at: info.created_at || null,
          updated_at: info.updated_at || null,
          effective_permissions: info.permissions,
          _from_share_pattern: true, // marks file-pattern share — perms are file-level, not directory-level
        }));

      const all = [...dirEntries, ...fileEntries];
      if (all.length > 0) {
        tab.entries = all;
        tab.total = all.length;
        // Track whether this listing is purely synthetic from file-pattern
        // shares. When true, directory-level actions (New Folder, Upload,
        // Snapshot) must NOT be enabled — the user has perms on the FILE,
        // not on the directory itself.
        tab._listing_from_share_patterns = fileEntries.length > 0 && dirEntries.length === 0;
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
    const { select, option } = elements;
    const fieldGroup = (labelText, inputBuilder) =>
      div.class('modal-field-group')(
        label.class('modal-field-label')(labelText),
        inputBuilder,
      );

    const typeOptions = ['string', 'u64', 'i64', 'f64', 'bool', 'timestamp', 'trigram', 'phonetic']
      .map((t) => option.value(t)(t));

    const modal = aeorModal(
      fieldGroup('Field Name',
        input.type('text').class('index-field-name modal-field-input').placeholder('e.g. email')(),
      ),
      fieldGroup('Index Type',
        select.class('index-field-type modal-field-input')(...typeOptions),
      ),
      fieldGroup('Min Value (optional, numeric types)',
        input.type('number').class('index-field-min modal-field-input').placeholder('')(),
      ),
      fieldGroup('Max Value (optional, numeric types)',
        input.type('number').class('index-field-max modal-field-input').placeholder('')(),
      ),
      div.class('modal-footer-actions')(
        button.class('secondary small modal-cancel')('Cancel'),
        button.class('primary small modal-save')('Add Index'),
      ),
    ).build(document);
    modal.title = 'Add Index';
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
    const fieldGroup = (labelText, inputBuilder) =>
      div.class('modal-field-group')(
        label.class('modal-field-label')(labelText),
        inputBuilder,
      );

    const modal = aeorModal(
      fieldGroup('Content Type',
        input.type('text').class('parser-content-type modal-field-input').placeholder('e.g. application/pdf')(),
      ),
      fieldGroup('Parser Path',
        input.type('text').class('parser-path modal-field-input').placeholder('e.g. /parsers/pdf')(),
      ),
      div.class('modal-footer-actions')(
        button.class('secondary small modal-cancel')('Cancel'),
        button.class('primary small modal-save')('Add Parser'),
      ),
    ).build(document);
    modal.title = 'Add Parser';
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
    const fieldGroup = (labelText, inputBuilder) =>
      div.class('modal-field-group')(
        label.class('modal-field-label')(labelText),
        inputBuilder,
      );

    const modal = aeorModal(
      fieldGroup('Origins (comma-separated)',
        input.type('text').class('cors-origins modal-field-input')
          .placeholder('e.g. https://example.com, https://app.example.com')(),
      ),
      fieldGroup('Methods (comma-separated)',
        input.type('text').class('cors-methods modal-field-input').value('GET,POST,PUT,DELETE')(),
      ),
      fieldGroup('Headers (comma-separated)',
        input.type('text').class('cors-headers modal-field-input').value('Content-Type,Authorization')(),
      ),
      div.class('modal-footer-actions')(
        button.class('secondary small modal-cancel')('Cancel'),
        button.class('primary small modal-save')('Save CORS'),
      ),
    ).build(document);
    modal.title = 'CORS Config';
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
    const modal = aeorModal(
      div.class('modal-field-group')(
        label.class('modal-field-label')('Folder Name'),
        input.type('text').class('new-folder-name modal-field-input').placeholder('my-folder')(),
      ),
      div.class('modal-footer-actions')(
        button.class('secondary small modal-cancel')('Cancel'),
        button.class('primary small modal-create')('Create'),
      ),
    ).build(document);
    modal.title = 'New Folder';
    document.body.appendChild(modal);

    const nameInput = modal.querySelector('.new-folder-name');
    const createBtn = modal.querySelector('.modal-create');
    const cancelBtn = modal.querySelector('.modal-cancel');

    // Focus the input
    setTimeout(() => nameInput.focus(), 100);

    let resolved = false;
    const done = () => {
      if (resolved) return;
      resolved = true;
      modal.remove();
    };

    const doCreate = async () => {
      const name = nameInput.value.trim();
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
    nameInput.addEventListener('keydown', (event) => {
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
      progressPanel = div.class('upload-progress')().build(document);
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
        progressPanel.textContent = '';
        progressPanel.appendChild(
          div(
            div.class('upload-progress-header')(
              span.class('upload-progress-title')(),
              span.class('upload-progress-speed')(),
            ),
            div.class('upload-progress-filename')(),
            div.class('upload-progress-bar-track')(
              div.class('upload-progress-bar-fill').style('width: 0%')(),
            ),
            div.class('upload-progress-meta upload-progress-meta-flex')(
              span.class('upload-progress-count')(),
              aeorConfirmButton.label('Cancel').duration('1000')(),
            ),
          ).build(document),
        );
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
      const widthPct = cancelled ? Math.round((completedFiles / totalFiles) * 100) : 100;
      const failedText = (failedCount > 0) ? ' \u00B7 ' + failedCount + ' failed' : '';

      progressPanel.textContent = '';
      progressPanel.appendChild(
        div(
          div.class('upload-progress-header')(
            span.class('upload-progress-title')(statusTitle),
          ),
          div.class('upload-progress-bar-track')(
            div.class('upload-progress-bar-fill').style(`width: ${widthPct}%`)(),
          ),
          div.class('upload-progress-meta')(
            `${completedFiles} files uploaded${failedText}${skippedText}`,
          ),
        ).build(document),
      );
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
      progressPanel = div.class('upload-progress')().build(document);
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
        progressPanel.textContent = '';
        progressPanel.appendChild(
          div(
            div.class('upload-progress-header')(
              span.class('upload-progress-title')(),
              span.class('upload-progress-speed')(),
            ),
            div.class('upload-progress-filename')(),
            div.class('upload-progress-bar-track')(
              div.class('upload-progress-bar-fill').style('width: 0%')(),
            ),
            div.class('upload-progress-meta')(),
          ).build(document),
        );
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
      const failedText = (failedCount > 0) ? ' \u00B7 ' + failedCount + ' failed' : '';
      progressPanel.textContent = '';
      progressPanel.appendChild(
        div(
          div.class('upload-progress-header')(
            span.class('upload-progress-title')('Upload complete'),
          ),
          div.class('upload-progress-bar-track')(
            div.class('upload-progress-bar-fill').style('width: 100%')(),
          ),
          div.class('upload-progress-meta')(
            `${completedFiles} files uploaded${failedText}`,
          ),
        ).build(document),
      );
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

    const modal = aeorModal(
      div.class('share-loading')('Loading...'),
    ).build(document);
    modal.title = 'Share';
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

    // Build group options — filter out user:UUID auto-groups (redundant with Users selector)
    const filteredGroups = groups.filter((g) => {
      const name = g.name || g.group || '';
      return !name.startsWith('user:');
    });

    const { select, option } = elements;
    const aeorTabView = elements['aeor-tab-view'];
    const aeorTab = elements['aeor-tab'];
    const aeorCrudlify = elements['aeor-crudlify'];

    const section = (...children) => div.class('share-section')(...children);
    const fieldLabel = (text) => label.class('modal-field-label')(text);

    const userOptionEls = filteredUsers.map((u) =>
      option.value(u.user_id || u.id || '')(u.username || u.user_id || ''),
    );
    const groupOptionEls = filteredGroups.map((g) => {
      const name = g.name || g.group || g.id || '';
      return option.value(name)(name);
    });

    const summaryText = `Sharing: ${fileNames}${(paths.length > 1) ? ` (${paths.length} items)` : ''}`;

    const peopleTab = aeorTab.label('People').name('people')(
      section(
        fieldLabel('Users'),
        input.type('text').class('share-users-filter modal-field-input share-filter-input').placeholder('Search users...')(),
        select.class('share-users-select modal-field-input share-multi-select').multiple('')(
          ...userOptionEls,
        ),
        div.class('share-select-hint')('Hold Ctrl/Cmd to select multiple'),
      ),
      section(
        fieldLabel('Groups'),
        input.type('text').class('share-groups-filter modal-field-input share-filter-input').placeholder('Search groups...')(),
        select.class('share-groups-select modal-field-input share-multi-select').multiple('')(
          ...groupOptionEls,
        ),
      ),
      section(
        fieldLabel('Permission Level'),
        select.class('share-permission-select modal-field-input')(
          option.value('.r..l...')('View only'),
          option.value('crudl...')('Can edit'),
          option.value('crudlify')('Full access'),
          option.value('custom')('Custom'),
        ),
      ),
      div.class('share-custom-flags hidden custom-flags-section')(
        aeorCrudlify.class('share-crudlify').value('--------')(),
      ),
      div.class('modal-footer-actions')(
        button.class('secondary small share-cancel')('Cancel'),
        button.class('primary small share-submit')('Share'),
      ),
    );

    const expirySelect = select.class('link-expiry-select modal-field-input')(
      option.value('')('Never'),
      option.value('1')('1 day'),
      option.value('7')('7 days'),
      option.value('30')('30 days'),
      option.value('90')('90 days'),
      option.value('365')('1 year'),
    );

    // Build active share-links list as DOM nodes.
    const linkSharesEl = activeLinks.length > 0
      ? activeLinks.map((l) =>
          div.class('link-entry-row')(
            div(
              span.class('link-entry-label')(l.label || 'Share link'),
              span.class('link-entry-expires')(
                l.expires_at ? new Date(l.expires_at).toLocaleDateString() : 'Never expires',
              ),
            ),
            button.class('danger small link-revoke-btn').dataKeyId(l.key_id)('×'),
          ),
        )
      : [div.class('no-active-links')('No active links')];

    const linkTab = aeorTab.label('Link').name('link')(
      section(
        fieldLabel('Permission Level'),
        select.class('link-permission-select modal-field-input')(
          option.value('-r--l---')('View only'),
          option.value('crudl...').selected('')('Can edit'),
          option.value('crudlify')('Full access'),
          option.value('custom')('Custom'),
        ),
      ),
      div.class('link-custom-flags hidden share-section')(
        aeorCrudlify.class('link-crudlify').value('--------')(),
      ),
      section(
        fieldLabel('Expiration'),
        expirySelect,
      ),
      div.class('link-create-footer')(
        button.class('primary small link-create-btn')('Create Link'),
      ),
      div.class('link-result hidden link-result-section')(
        fieldLabel('Share URL'),
        div.class('link-result-row')(
          input.type('text').class('link-url-input modal-field-input flex-1')
            .readonly('').onFocus((e) => e.target.select())(),
          button.class('secondary small link-copy-btn')('Copy'),
        ),
      ),
      div.class('link-active-links')(...linkSharesEl),
    );

    const currentSharesSection = (Array.isArray(currentShares) && currentShares.length > 0)
      ? div.class('current-shares-section')(
          div.class('modal-field-label')('Current Shares'),
          ...currentShares.map((s) => {
            const target = s.username || s.display_name || s.group || 'Unknown';
            const perm = s.allow || s.permissions || '';
            const pattern = s.path_pattern || s.path || '';
            return div.class('share-entry-row')(
              div(
                span.class('share-entry-name')(target),
                span.class('share-entry-perm')(perm),
              ),
              button.class('danger small share-revoke-btn')
                .dataGroup(s.group || '').dataPattern(pattern)('×'),
            );
          }),
        )
      : null;

    // Replace modal body content
    const body = modal.querySelector('.aeor-modal__body');
    body.textContent = '';
    body.appendChild(
      div(
        div.class('share-file-summary')(summaryText),
        aeorTabView.active('people').class('share-tab-bar')(
          peopleTab,
          linkTab,
        ),
        currentSharesSection,
      ).build(document),
    );

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

    const menu = div.class('context-menu')(
      div.class('context-menu-item').dataContext('paste')(
        'Paste ',
        span.class('context-menu-hotkey')(`${mod}+V`),
      ),
    ).build(document);
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';
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

    const { hr } = elements;
    const menuItem = (action, text, hotkey, extraClass = '') =>
      div.class('context-menu-item' + (extraClass ? ' ' + extraClass : '')).dataContext(action)(
        text,
        hotkey ? span.class('context-menu-hotkey')(hotkey) : null,
      );

    const menu = div.class('context-menu')(
      menuItem('preview', 'Preview'),
      this._hasPermission('y') ? menuItem('share', 'Share') : null,
      this._hasPermission('u') ? menuItem('cut', 'Cut ', `${mod}+X`) : null,
      menuItem('copy', 'Copy ', `${mod}+C`),
      clipboard ? menuItem('paste', 'Paste ', `${mod}+V`) : null,
      this._hasPermission('d') ? hr.class('context-menu-separator')() : null,
      this._hasPermission('d') ? menuItem('delete-instant', 'Delete ', 'Del', 'context-menu-danger') : null,
    ).build(document);
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';

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
    if (this._sortField !== field) return null;
    const arrow = (this._sortOrder === 'asc') ? '\u25B2' : '\u25BC';
    return span.class('sort-indicator active')(arrow);
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
    versionsList.textContent = '';
    versionsList.appendChild(div.class('text-muted')('Loading...').build(document));

    // Hide the info box until we know snapshots exist — claiming
    // "Any version can be safely restored" alongside "No snapshots"
    // is contradictory. We re-show it below once we have results.
    const infoBox = versionsPanel.querySelector('.preview-versions-info');
    if (infoBox) infoBox.classList.add('hidden');

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
        versionsList.textContent = '';
        versionsList.appendChild(div.class('text-muted')('No snapshots').build(document));
        return;
      }

      if (infoBox) infoBox.classList.remove('hidden');

      // Current version is the first entry (newest-first from API)
      const currentHash = entry.hash || '';

      // The user must have UPDATE permission ('u' at position 2 of the
      // 8-char crudlify pattern) to restore a previous version. View-only
      // shares (e.g. '.r..l...') hide the Restore button entirely.
      const canUpdate = this._hasPermission('u', entry);

      versionsList.textContent = '';
      const aeorSnapshotCard = elements['aeor-snapshot-card'];
      for (let idx = 0; idx < versions.length; idx++) {
        const v = versions[idx];
        const date = formatDate(v.timestamp);
        const size = v.size ? formatSize(v.size) : '';
        const isCurrent = idx === 0;
        const snapshotId = v.id || v.snapshot;
        const snapshotName = v.snapshot;
        const changeType = v.change_type || '';

        // Restorable unless: (a) it's the current version of a live file,
        // (b) the file was deleted in this snapshot, OR (c) the user lacks
        // update permission on this file.
        const isRestorable = canUpdate
          && changeType !== 'deleted'
          && (!isCurrent || entry._deleted);

        let cardBuilder = aeorSnapshotCard
          .name(snapshotName)
          .snapshotId(snapshotId)
          .date(date)
          .contentHash(v.content_hash || '');
        if (size) cardBuilder = cardBuilder.size(size);
        if (changeType) cardBuilder = cardBuilder.changeType(changeType);
        if (isCurrent && !entry._deleted) cardBuilder = cardBuilder.current('');
        if (isRestorable) cardBuilder = cardBuilder.restorable('');

        versionsList.appendChild(cardBuilder().build(document));
      }

      // Bind click (preview version) and restore events
      versionsList.querySelectorAll('aeor-snapshot-card').forEach((card, idx) => {
        const snapshot = card.getAttribute('snapshot-id');
        const isCurrent = idx === 0;

        card.addEventListener('click', (e) => {
          // Ignore clicks on confirm buttons or copy buttons
          if (e.target.closest('aeor-confirm-button') || e.target.closest('.snapshot-card-copy-btn')) return;

          // Highlight selected version
          versionsList.querySelectorAll('aeor-snapshot-card').forEach((c) => {
            c.removeAttribute('current');
          });
          card.setAttribute('current', '');

          if (isCurrent && !entry._deleted) {
            tab.preview_component = null;
            this._loadPreview();
          } else {
            const versionInfo = versions.find((v) => (v.id || v.snapshot) === snapshot);
            this._previewAtSnapshot(panel, tab, entry, snapshot, versionInfo);
          }
        });

        card.addEventListener('snapshot-restore', () => {
          this._confirmRestoreVersion(tab, entry, snapshot);
        });
      });
    } catch (_) {
      versionsList.textContent = '';
      versionsList.appendChild(div.class('text-muted')('Unable to load').build(document));
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
      contentEl.textContent = '';
      contentEl.appendChild(elements[componentName]().build(document));
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

    // Update the stored snapshot ID for version restore
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
      // Refresh listing after a short delay
      this._refreshSuppressed = true;
      setTimeout(() => {
        this._refreshSuppressed = false;
        this._fetchListing();
      }, 2000);
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
      const { p } = elements;
      // The message body can be a plain string or pre-rendered HTML. For
      // HTML mode we still need an innerHTML assignment because callers
      // pass an HTML fragment string (e.g. for inline filename emphasis);
      // for plain strings we use a text node which is the safe default.
      const textEl = p.class('confirm-modal-text')().build(document);
      if (isHtml) {
        textEl.innerHTML = message;
      } else {
        textEl.textContent = message;
      }

      const modal = aeorModal(
        textEl,
        div.class('modal-footer-actions')(
          button.class('secondary small confirm-cancel')('Cancel'),
          button.class(`${confirmStyle} small confirm-ok`)(confirmLabel),
        ),
      ).build(document);
      modal.title = title;
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
