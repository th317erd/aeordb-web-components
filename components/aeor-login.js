'use strict';

import { AUTH, api, getBaseUrl } from '../api.js';
import { escapeHtml } from '../utils.js';

/**
 * <aeor-login> — Login form web component.
 *
 * Usage:
 *   document.body.appendChild(document.createElement('aeor-login'));
 *
 * Dispatches 'aeordb:authenticated' event on window when login succeeds.
 */
export class AeorLogin extends HTMLElement {
  connectedCallback() {
    this.render();
  }

  disconnectedCallback() {
    // Clean up event listener reference
    this._form = null;
  }

  render() {
    this.innerHTML = `
      <div class="login-wrap">
        <div class="login-card">
          <div class="login-title">Sign in to AeorDB</div>
          <div class="login-error" role="alert"></div>
          <form class="login-form">
            <div class="form-group">
              <label class="form-label" for="aeor-login-api-key">API Key</label>
              <input
                class="form-input"
                id="aeor-login-api-key"
                type="password"
                placeholder="Enter your API key"
                autocomplete="off"
                required
              >
            </div>
            <button class="button button-primary" type="submit" style="width:100%">Login</button>
          </form>
        </div>
      </div>
    `;

    this._form = this.querySelector('.login-form');
    this._form.addEventListener('submit', (event) => this.handleSubmit(event));
  }

  async handleSubmit(event) {
    event.preventDefault();

    const errorContainer = this.querySelector('.login-error');
    const apiKeyInput = this.querySelector('#aeor-login-api-key');
    const submitButton = this.querySelector('button[type="submit"]');

    errorContainer.innerHTML = '';
    submitButton.disabled = true;
    submitButton.textContent = 'Signing in...';

    try {
      const url = `${getBaseUrl()}/auth/token`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: apiKeyInput.value }),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || `Authentication failed (${response.status})`);
      }

      const data = await response.json();
      AUTH.setToken(data.token);
      window.dispatchEvent(new CustomEvent('aeordb:authenticated'));
    } catch (error) {
      errorContainer.innerHTML = `<div class="alert alert-error">${escapeHtml(error.message)}</div>`;
      submitButton.disabled = false;
      submitButton.textContent = 'Login';
    }
  }
}

if (!customElements.get('aeor-login')) {
  customElements.define('aeor-login', AeorLogin);
}
