'use strict';

/**
 * Per-installation user preferences helper.
 *
 * Talks to the aeordb-client daemon's `/api/v1/preferences` endpoint,
 * which persists to `{config_dir}/preferences.yaml`. Preferences are
 * scoped to the installation (one daemon = one preferences file), so
 * all front-ends pointed at the same daemon (Tauri webview, browser at
 * localhost:9400, future CLI) see the same state.
 *
 * On the engine's web portal (different origin, no /api/v1/preferences
 * route) the helper detects the missing endpoint on first load and
 * falls back to localStorage for the lifetime of the page. That keeps
 * the same call sites working in both contexts without per-consumer
 * branches.
 *
 * Wire protocol matches the engine's merge-patch spec
 * (../aeordb/docs/src/api/merge-patch.md):
 *   - GET  → full preferences JSON
 *   - PATCH with Content-Type: application/merge-patch+json
 *           and a sparse object body → RFC 7396 merge
 *
 * API:
 *   await loadPrefs();                      // explicit prime; auto-called on first read
 *   const v = getPref('file_browser.open_default', 'local');
 *   await setPref('file_browser.open_default', 'remote');
 *   await mergePrefs({ file_browser: { show_hidden: true } });
 */

const PREFS_URL = '/api/v1/preferences';

// Module-level cache. Populated on first loadPrefs() and updated
// optimistically on every write.
let _cache         = null;     // full prefs object once loaded
let _loadPromise   = null;     // in-flight load promise (so concurrent calls dedup)
let _fallbackMode  = false;    // true once we've decided the API isn't available
let _migrationDone = false;    // legacy-localStorage migration only runs once

// Legacy localStorage keys to drain into preferences.yaml on first load.
// Each entry: { key, into(value, prefs) } where `into` mutates a merge
// patch with the migrated value. Returning falsy means "skip — this
// legacy value isn't useful." After a successful merge the localStorage
// key is deleted.
const _LEGACY_MIGRATIONS = [
  {
    key: 'aeordb-file-browser',
    into: (raw, patch) => {
      if (!raw) return false;
      let parsed;
      try { parsed = JSON.parse(raw); } catch (_) { return false; }
      if (!parsed || typeof parsed !== 'object') return false;
      // Old shape: { tabs, active_tab_id, tab_counter }
      patch.file_browser = patch.file_browser || {};
      if (Array.isArray(parsed.tabs))             patch.file_browser.tabs           = parsed.tabs;
      if (typeof parsed.active_tab_id === 'number') patch.file_browser.active_tab_id = parsed.active_tab_id;
      if (typeof parsed.tab_counter   === 'number') patch.file_browser.tab_counter   = parsed.tab_counter;
      return true;
    },
  },
  {
    key: 'aeordb-show-hidden',
    into: (raw, patch) => {
      if (raw == null) return false;
      patch.file_browser = patch.file_browser || {};
      patch.file_browser.show_hidden = (raw === 'true');
      return true;
    },
  },
  {
    key: 'aeor-file-browser:open-default',
    into: (raw, patch) => {
      if (raw !== 'local' && raw !== 'remote') return false;
      patch.file_browser = patch.file_browser || {};
      patch.file_browser.open_default = raw;
      return true;
    },
  },
];

/**
 * Prime the cache from the daemon (or localStorage in fallback mode).
 * Subsequent calls are deduplicated against the in-flight promise.
 * Safe to call repeatedly — it's a no-op after the first success.
 */
export function loadPrefs() {
  if (_cache !== null) return Promise.resolve(_cache);
  if (_loadPromise)    return _loadPromise;

  _loadPromise = (async () => {
    try {
      const response = await fetch(PREFS_URL);
      if (response.status === 404) {
        _fallbackMode = true;
        _cache = _readFallbackPrefs();
        return _cache;
      }
      if (!response.ok) {
        // 5xx or auth issue: don't permanently fall back, just return
        // an empty doc so the UI keeps working. Next call retries.
        _loadPromise = null;
        return {};
      }
      _cache = await response.json();
      await _runLegacyMigration();
      return _cache;
    } catch (error) {
      // Network error → temporary blank state. Don't latch into
      // fallback mode; a later call may succeed.
      _loadPromise = null;
      return {};
    } finally {
      // Allow re-priming after explicit cache clear; the in-flight
      // promise itself stays valid until then.
    }
  })();

  return _loadPromise;
}

/**
 * Read a preference by dot-separated path. Returns `defaultValue` if
 * the cache hasn't been primed yet, the path doesn't exist, or the
 * value is null/undefined.
 *
 * Synchronous and cheap — call from render hot paths without worrying.
 * Pair with `loadPrefs()` somewhere early (e.g. connectedCallback) to
 * make sure the cache is populated.
 */
export function getPref(path, defaultValue) {
  if (_cache === null) return defaultValue;
  const value = _digPath(_cache, path);
  return (value == null) ? defaultValue : value;
}

/**
 * Set a single preference by dot-separated path. Builds the minimal
 * merge-patch object and sends it. Updates the cache optimistically
 * before the network round-trip lands.
 */
export async function setPref(path, value) {
  const patch = _buildPatchFromPath(path, value);
  return mergePrefs(patch);
}

/**
 * Send an arbitrary merge-patch object. Use this when you need to
 * update several fields at once (e.g. atomic tab-layout writes).
 */
export async function mergePrefs(patch) {
  await loadPrefs();
  _applyPatchToCache(_cache || (_cache = {}), patch);

  if (_fallbackMode) {
    _writeFallbackPrefs(_cache);
    return _cache;
  }

  try {
    const response = await fetch(PREFS_URL, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/merge-patch+json' },
      body:    JSON.stringify(patch),
    });
    if (!response.ok) {
      console.warn('preferences PATCH failed:', response.status);
      return _cache;
    }
    // Server is the source of truth — replace cache with its response
    // so we don't drift on validation rewrites.
    _cache = await response.json();
    return _cache;
  } catch (error) {
    console.warn('preferences PATCH errored:', error);
    return _cache;
  }
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function _digPath(obj, path) {
  if (!path) return undefined;
  const keys = path.split('.');
  let cur = obj;
  for (const key of keys) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = cur[key];
  }
  return cur;
}

function _buildPatchFromPath(path, value) {
  const keys = path.split('.');
  const patch = {};
  let cur = patch;
  for (let i = 0; i < keys.length - 1; i++) {
    cur[keys[i]] = {};
    cur = cur[keys[i]];
  }
  cur[keys[keys.length - 1]] = value;
  return patch;
}

// RFC 7396-style merge into the local cache so getPref reflects the
// write immediately, even before the network round-trip.
function _applyPatchToCache(target, patch) {
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) {
    return; // can't merge a scalar/array into an object cache — leave it
  }
  for (const key of Object.keys(patch)) {
    const value = patch[key];
    if (value === null) {
      delete target[key];
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      if (!target[key] || typeof target[key] !== 'object' || Array.isArray(target[key])) {
        target[key] = {};
      }
      _applyPatchToCache(target[key], value);
    } else {
      target[key] = value;
    }
  }
}

async function _runLegacyMigration() {
  if (_migrationDone) return;
  _migrationDone = true;
  if (typeof localStorage === 'undefined') return;

  const patch = {};
  const drained = [];
  for (const entry of _LEGACY_MIGRATIONS) {
    let raw;
    try { raw = localStorage.getItem(entry.key); } catch (_) { continue; }
    if (raw == null) continue;
    if (entry.into(raw, patch)) drained.push(entry.key);
  }
  if (drained.length === 0) return;

  try {
    const response = await fetch(PREFS_URL, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/merge-patch+json' },
      body:    JSON.stringify(patch),
    });
    if (response.ok) {
      _cache = await response.json();
      for (const key of drained) {
        try { localStorage.removeItem(key); } catch (_) { /* ignore */ }
      }
    }
  } catch (_) {
    // Migration is best-effort — if the merge fails, the legacy keys
    // stay in localStorage and we'll retry on next load.
  }
}

// Fallback storage: a single localStorage key holding the whole prefs
// blob. Only used when /api/v1/preferences isn't reachable (i.e. on the
// engine's portal, where the daemon isn't running on the same origin).
const _FALLBACK_KEY = 'aeordb-preferences-fallback';
function _readFallbackPrefs() {
  try {
    const raw = localStorage.getItem(_FALLBACK_KEY);
    if (!raw) return {};
    return JSON.parse(raw);
  } catch (_) {
    return {};
  }
}
function _writeFallbackPrefs(prefs) {
  try { localStorage.setItem(_FALLBACK_KEY, JSON.stringify(prefs)); }
  catch (_) { /* ignore */ }
}
