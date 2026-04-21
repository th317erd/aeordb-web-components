'use strict';

/**
 * Shared utility functions for AeorDB web components.
 * Used by both the portal (server) and client applications.
 */

/**
 * Escape a string for safe insertion into HTML content.
 * Uses the browser's built-in text content encoding.
 *
 * @param {string} text - The raw text to escape.
 * @returns {string} HTML-safe string.
 */
export function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Escape a string for safe insertion into an HTML attribute value.
 *
 * @param {string} str - The raw string to escape.
 * @returns {string} Attribute-safe string.
 */
export function escapeAttr(str) {
  return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Format a byte count into a human-readable string (e.g. "1.5 MB").
 * Handles the full range from bytes to terabytes.
 *
 * @param {number} bytes - The byte count to format.
 * @returns {string} Formatted byte string.
 */
export function formatBytes(bytes) {
  if (bytes === 0)
    return '0 B';

  const kilobyte = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.floor(Math.log(bytes) / Math.log(kilobyte));
  return parseFloat((bytes / Math.pow(kilobyte, index)).toFixed(1)) + ' ' + sizes[index];
}

/**
 * Format a number with locale-appropriate thousand separators.
 *
 * @param {number} n - The number to format.
 * @returns {string} Locale-formatted number string.
 */
export function formatNumber(n) {
  return n.toLocaleString();
}

/**
 * Format an operations-per-second rate value.
 * Returns an em-dash for null/undefined values.
 *
 * @param {number|null|undefined} value - The rate value.
 * @returns {string} Formatted rate string.
 */
export function formatRate(value) {
  if (value == null)
    return '\u2014';

  return (value < 10) ? value.toFixed(2) : formatNumber(Math.round(value));
}

/**
 * Format a bytes-per-second rate into a human-readable string (e.g. "1.5 MB/s").
 *
 * @param {number|null|undefined} bytesPerSec - Bytes per second.
 * @returns {string} Formatted rate string.
 */
export function formatBytesRate(bytesPerSec) {
  if (bytesPerSec == null || bytesPerSec === 0)
    return '0 B/s';

  const units = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
  const index = Math.floor(Math.log(bytesPerSec) / Math.log(1024));
  const clamped = Math.min(index, units.length - 1);
  return parseFloat((bytesPerSec / Math.pow(1024, clamped)).toFixed(1)) + ' ' + units[clamped];
}

/**
 * Format a percentage value with one decimal place.
 * Returns an em-dash for null/undefined values.
 *
 * @param {number|null|undefined} value - The percentage value.
 * @returns {string} Formatted percentage string.
 */
export function formatPercent(value) {
  if (value == null)
    return '\u2014';

  return value.toFixed(1) + '%';
}

/**
 * Format an uptime duration in seconds into a human-readable string
 * (e.g. "3d 12h 5m" or "45m 12s").
 * Returns an em-dash for null/undefined values.
 *
 * @param {number|null|undefined} seconds - The uptime in seconds.
 * @returns {string} Formatted uptime string.
 */
export function formatUptime(seconds) {
  if (seconds == null)
    return '\u2014';

  const days    = Math.floor(seconds / 86400);
  const hours   = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs    = Math.floor(seconds % 60);

  if (days > 0)
    return `${days}d ${hours}h ${minutes}m`;

  if (hours > 0)
    return `${hours}h ${minutes}m ${secs}s`;

  if (minutes > 0)
    return `${minutes}m ${secs}s`;

  return `${secs}s`;
}

/**
 * Format a timestamp (ISO string or epoch ms) into "YYYY/MM/DD HH:MM:SS".
 * Returns an em-dash for falsy values.
 *
 * @param {string|number|null|undefined} timestamp - The timestamp to format.
 * @returns {string} Formatted date string.
 */
export function formatDate(timestamp) {
  if (!timestamp)
    return '\u2014';

  const date    = new Date(timestamp);
  const year    = date.getFullYear();
  const month   = String(date.getMonth() + 1).padStart(2, '0');
  const day     = String(date.getDate()).padStart(2, '0');
  const hours   = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${year}/${month}/${day} ${hours}:${minutes}:${seconds}`;
}
