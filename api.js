'use strict';

/**
 * Shared API client for AeorDB.
 *
 * Usage:
 *   import { api, AUTH } from '/shared/api.js';
 *
 *   // Make authenticated request:
 *   const response = await api('/system/stats');
 *
 *   // Login:
 *   AUTH.setToken(jwt);
 *
 *   // Logout:
 *   AUTH.clear();
 *
 *   // Check auth:
 *   if (AUTH.token) { ... }
 */

const TOKEN_KEY = 'aeordb_token';

let _baseUrl = '';

/**
 * Returns the base URL for API requests.
 * Returns '' for same-origin (the common case) or a configurable base URL
 * for cross-origin deployments.
 *
 * @returns {string}
 */
export function getBaseUrl() {
  return _baseUrl;
}

/**
 * Set a custom base URL for cross-origin API requests.
 *
 * @param {string} url — The base URL (e.g. 'https://aeordb.example.com').
 *                        Pass '' to reset to same-origin.
 */
export function setBaseUrl(url) {
  // Strip trailing slash to avoid double-slash in path construction
  _baseUrl = url.replace(/\/+$/, '');
}

/**
 * Auth state management backed by localStorage.
 */
export const AUTH = {
  /** @returns {string|null} The current JWT token, or null if not authenticated. */
  get token() {
    return localStorage.getItem(TOKEN_KEY);
  },

  /**
   * Store a JWT token.
   * @param {string} jwt
   */
  setToken(jwt) {
    localStorage.setItem(TOKEN_KEY, jwt);
  },

  /** Clear the stored token (logout). */
  clear() {
    localStorage.removeItem(TOKEN_KEY);
  },

  /**
   * Build an Authorization header object if a token is present.
   * @returns {Object} Headers object — either `{ Authorization: 'Bearer ...' }` or `{}`.
   */
  headers() {
    const t = this.token;
    return t ? { 'Authorization': `Bearer ${t}` } : {};
  },
};

/**
 * Fetch wrapper that injects the Bearer token and handles 401 responses.
 *
 * On 401:
 *   - Clears the stored token
 *   - Dispatches a custom 'aeordb:unauthorized' event on window
 *   - Throws an Error (callers can catch to show UI)
 *
 * @param {string} path  — API path (e.g. '/system/stats').
 * @param {RequestInit} [options] — Standard fetch options.
 * @returns {Promise<Response>}
 */
export async function api(path, options = {}) {
  const url = `${_baseUrl}${path}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      ...AUTH.headers(),
      ...options.headers,
    },
  });

  if (response.status === 401) {
    AUTH.clear();
    window.dispatchEvent(new CustomEvent('aeordb:unauthorized'));
    throw new Error('Unauthorized');
  }

  return response;
}
