'use strict';

import { elements } from '../../aeor/elements.js';
import { AUTH, api, getBaseUrl } from '../api.js';

const { div, label, input, button, form } = elements;

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
    this._form = null;
  }

  render() {
    this.textContent = '';
    this.appendChild(
      div.class('login-wrap')(
        div.class('login-card')(
          div.class('login-title')('Sign in to AeorDB'),
          div.class('login-error').role('alert')(),
          form.class('login-form')(
            div.class('form-group')(
              label.class('form-label').for('aeor-login-api-key')('API Key'),
              input
                .class('form-input')
                .id('aeor-login-api-key')
                .type('password')
                .placeholder('Enter your API key')
                .autocomplete('off')
                .required('')(),
            ),
            button
              .class('button button-primary')
              .type('submit')
              .style('width:100%')('Login'),
          ),
        ),
      ).build(document),
    );

    this._form = this.querySelector('.login-form');
    this._form.addEventListener('submit', (event) => this.handleSubmit(event));
  }

  async handleSubmit(event) {
    event.preventDefault();

    const errorContainer = this.querySelector('.login-error');
    const apiKeyInput = this.querySelector('#aeor-login-api-key');
    const submitButton = this.querySelector('button[type="submit"]');

    errorContainer.textContent = '';
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
        // The engine returns `{"error":"<human-readable message>"}` on
        // failures. Surface the message to the user instead of the raw
        // JSON envelope. Fall back to the status text only if the body
        // isn't JSON or lacks an `error` field.
        let message = `Authentication failed (${response.status})`;
        const raw = await response.text();
        if (raw) {
          try {
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed.error === 'string') {
              message = parsed.error;
            } else if (parsed && typeof parsed.message === 'string') {
              message = parsed.message;
            } else {
              message = raw;
            }
          } catch (_) {
            message = raw;
          }
        }
        throw new Error(message);
      }

      const data = await response.json();
      AUTH.setToken(data.token);
      window.dispatchEvent(new CustomEvent('aeordb:authenticated'));
    } catch (error) {
      errorContainer.textContent = '';
      errorContainer.appendChild(
        div.class('alert alert-error')(error.message).build(document),
      );
      submitButton.disabled = false;
      submitButton.textContent = 'Login';
    }
  }
}

if (!customElements.get('aeor-login')) {
  customElements.define('aeor-login', AeorLogin);
}
