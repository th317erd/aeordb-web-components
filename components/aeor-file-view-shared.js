'use strict';

/// Shared utilities for file view components (list and grid).
/// Not a component itself — just exported helper functions.

// Re-export generic utilities so existing consumers don't break.
export { escapeHtml, escapeAttr, formatBytes, formatDate } from '../utils.js';

// Import for local use
import { formatBytes } from '../utils.js';

// Alias formatSize → formatBytes for backward compatibility
export const formatSize = formatBytes;

export function fileIcon(entryType) {
  if (entryType === 3) return '\uD83D\uDCC1'; // folder
  if (entryType === 8) return '\uD83D\uDD17'; // symlink
  return '\uD83D\uDCC4'; // file
}

// Entry type constants (from aeordb)
export const ENTRY_TYPE_FILE    = 2;
export const ENTRY_TYPE_DIR     = 3;
export const ENTRY_TYPE_SYMLINK = 8;

export function formatRelativeTime(ms) {
  const diff = Date.now() - ms;
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  const date = new Date(ms);
  return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function directionLabel(direction) {
  switch (direction) {
    case 'pull_only':     return '\u2190 Pull';
    case 'push_only':     return 'Push \u2192';
    case 'bidirectional': return '\u2194 Bidirectional';
    default:              return direction;
  }
}

export function directionArrow(direction) {
  switch (direction) {
    case 'pull_only':     return '\u2190';
    case 'push_only':     return '\u2192';
    case 'bidirectional': return '\u2194';
    default:              return '\u2194';
  }
}

export function bindResizeHandle(handle, panel, { minHeight = 150, maxRatio = 0.8, onResize } = {}) {
  handle.addEventListener('mousedown', (event) => {
    event.preventDefault();
    const startY = event.clientY;
    const startHeight = panel.offsetHeight;

    const onMouseMove = (moveEvent) => {
      const delta = startY - moveEvent.clientY;
      const newHeight = Math.max(minHeight, Math.min(window.innerHeight * maxRatio, startHeight + delta));
      panel.style.height = newHeight + 'px';
      if (onResize) onResize(newHeight);
    };

    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  });
}

export async function openFolder(path) {
  if (!path || path === '-') return;
  try {
    await fetch('/api/v1/open-folder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path }),
    });
  } catch (error) {
    console.error('Failed to open folder:', error);
  }
}

export function fileExtension(name) {
  const dot = name.lastIndexOf('.');
  if (dot < 0) return '';
  return name.substring(dot + 1).toLowerCase();
}

export function isImageFile(name) {
  const ext = fileExtension(name);
  return ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico'].includes(ext);
}

export function isVideoFile(name) {
  const ext = fileExtension(name);
  return ['mp4', 'webm', 'ogg', 'mov', 'avi', 'mkv'].includes(ext);
}

export function isAudioFile(name) {
  const ext = fileExtension(name);
  return ['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a'].includes(ext);
}

export function isTextFile(name) {
  const ext = fileExtension(name);
  return ['txt', 'md', 'json', 'yaml', 'yml', 'toml', 'xml', 'csv',
    'html', 'htm', 'css', 'js', 'mjs', 'ts', 'jsx', 'tsx',
    'rs', 'py', 'go', 'java', 'c', 'cpp', 'h', 'hpp',
    'sh', 'bash', 'zsh', 'fish', 'conf', 'cfg', 'ini', 'env',
    'log', 'sql', 'graphql', 'proto', 'dockerfile'].includes(ext);
}
