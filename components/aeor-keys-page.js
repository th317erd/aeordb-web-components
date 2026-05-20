'use strict';

import { elements } from '../../aeor/elements.js';
import { AeorAdminPage } from './aeor-admin-page.js';

const { div, label, input, button, span, code, select, option, svg, path, circle } = elements;

/**
 * <aeor-keys-page> — Admin page for managing API keys.
 *
 * Features:
 *   - Lazy search: empty search shows own keys, typing lazy-loads all keys
 *   - Current session badge on the active key
 *   - Create keys with optional user selector, label, and expiry
 *   - Copy-once display of generated API key after creation
 *   - Revoke keys (single or bulk) via hold-to-confirm button
 *   - Edit key label (single select only)
 *
 * Usage:
 *   <aeor-keys-page></aeor-keys-page>
 *
 * Properties:
 *   - currentKeyId: Set by the portal's app.mjs to identify the active session key.
 */
export class AeorKeysPage extends AeorAdminPage {
  constructor() {
    super();
    this._allKeys = null;
    this._allKeysLoaded = false;
    this.currentKeyId = null;
  }

  // ── Subclass contract ───────────────────────────────────────────────

  get title() { return 'API Keys'; }
  get showCreateButton() { return true; }

  async fetchItems() {
    const resp = await window.api('/auth/keys');
    if (!resp.ok) throw new Error(`Failed to fetch keys (${resp.status})`);
    const data = await resp.json();
    return data.items || data;
  }

  getItemId(item) {
    return String(item.key_id);
  }

  matchesSearch(item, query) {
    const label = (item.label || '').toLowerCase();
    const keyId = (item.key_id || '').toLowerCase();
    const userId = (item.user_id || '').toLowerCase();
    const rulesStr = JSON.stringify(item.rules || []).toLowerCase();
    return label.includes(query) || keyId.includes(query) ||
           userId.includes(query) || rulesStr.includes(query);
  }

  shouldShowEditButton(selectedItems) {
    return selectedItems.length === 1;
  }

  renderCard(item) {
    const status = this._getStatus(item);
    const created = item.created_at ? new Date(item.created_at).toLocaleDateString() : '\u2014';
    const expires = item.expires_at ? new Date(item.expires_at).toLocaleDateString() : '\u2014';
    const user = item.username || this._truncateId(item.user_id);

    // Use the same .admin-card-* classes as Users/Groups/Snapshots so
    // typography is consistent across all admin pages.
    return div(
      div.class('admin-card-header')(
        div.class('admin-card-title')(
          item.label || 'Unnamed Key',
          ' ',
          span.class(`badge ${status.cssClass}`)(status.label),
        ),
      ),
      div.class('admin-card-meta').title(String(item.key_id || ''))(
        this._truncateId(item.key_id),
      ),
      div.class('admin-card-meta')(
        `User: ${user} \u00B7 Created ${created} \u00B7 Expires ${expires}`,
      ),
    ).build(document);
  }

  getActionButtons(selectedItems) {
    const revocable = selectedItems.filter((k) => !k.is_revoked);
    if (revocable.length === 0) return null;

    const labelText = revocable.length === 1 ? 'Revoke' : `Revoke ${revocable.length} Keys`;
    const aeorConfirmButton = elements['aeor-confirm-button'];
    return aeorConfirmButton
      .class('confirm-button-danger')
      .label(labelText)
      .confirmedText('Revoked!')
      .duration('1000')()
      .build(document);
  }

  _bindActionBarEvents(bar, selectedItems) {
    const confirmBtn = bar.querySelector('aeor-confirm-button');
    if (!confirmBtn) return;

    confirmBtn.addEventListener('confirm', async () => {
      const revocable = selectedItems.filter((k) => !k.is_revoked);
      if (revocable.length === 0) return;

      // Check if revoking the current session key
      const revokingCurrent = revocable.some((k) => k.key_id === this.currentKeyId);

      for (const key of revocable) {
        try {
          await window.api(`/auth/keys/admin/${key.key_id}`, { method: 'DELETE' });
        } catch (err) {
          if (window.aeorToast)
            window.aeorToast(`Revoke failed for ${this._truncateId(key.key_id)}: ${err.message}`, 'error');
        }
      }

      if (revokingCurrent) {
        if (window.AUTH) window.AUTH.clear();
        window.location.href = '/';
        return;
      }

      // Reset lazy-loaded cache and reload
      this._allKeys = null;
      this._allKeysLoaded = false;
      this._clearSelection();
      await this._loadItems();
    });
  }

  // ── Create modal ────────────────────────────────────────────────────

  _openCreateModal() {
    super._openCreateModal();
    // Async-populate the user selector after the modal is in the DOM
    const modal = document.querySelector('aeor-modal');
    if (modal) this._populateUserSelector(modal);
  }

  renderCreateForm() {
    // The user selector is populated asynchronously after the modal opens.
    // We render a placeholder container and fill it in _populateUserSelector.
    return div(
      div.id('keys-user-selector-slot')(),
      div.class('form-group')(
        label.class('form-label').for('keys-create-label')('Label (optional)'),
        input.class('form-input').id('keys-create-label').type('text').placeholder('e.g. CI pipeline key')(),
      ),
      div.class('form-group')(
        label.class('form-label').for('keys-create-expires')('Expires in (days)'),
        input.class('form-input').id('keys-create-expires').type('number')
          .value('365').min('1').max('3650')(),
      ),
    ).build(document);
  }

  async submitCreate(modal) {
    const labelInput = modal.querySelector('#keys-create-label');
    const expiresInput = modal.querySelector('#keys-create-expires');
    const userSelect = modal.querySelector('#keys-create-user');

    const body = {
      expires_in_days: parseInt(expiresInput.value, 10) || 365,
    };

    if (labelInput.value.trim()) {
      body.label = labelInput.value.trim();
    }

    if (userSelect && userSelect.value) {
      body.user_id = userSelect.value;
    }

    const resp = await window.api('/auth/keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(text || `Create failed (${resp.status})`);
    }

    const data = await resp.json();

    // Invalidate cached all-keys
    this._allKeys = null;
    this._allKeysLoaded = false;

    return data;
  }

  onPostCreate(result) {
    this._postCreateHandled = true;

    // Find the modal that's currently open
    const modal = document.querySelector('aeor-modal');
    if (!modal) return;

    // Replace modal body with the generated key display
    const formContainer = modal.querySelector('.admin-modal-form');
    if (!formContainer) return;

    formContainer.textContent = '';
    formContainer.appendChild(
      div(
        div.class('alert alert-warning')(
          'This key will not be shown again. Copy it now and store it securely.',
        ),
        div.class('form-group')(
          label.class('form-label')('API Key'),
          div.class('keys-copy-row')(
            input
              .class('form-input form-input-mono')
              .id('keys-created-value')
              .type('text')
              .readonly('')
              .value(result.key || '')(),
            button.class('primary small').id('keys-copy-btn').type('button')('Copy'),
          ),
        ),
        result.label
          ? div.class('detail-line')('Label: ', result.label)
          : null,
        div.class('detail-line')(
          'Key ID: ',
          code.class('mono')(String(result.key_id || '')),
        ),
        div.class('detail-line')(
          'Expires: ',
          result.expires_at ? new Date(result.expires_at).toLocaleDateString() : '\u2014',
        ),
        div.class('modal-footer-actions')(
          button.class('primary small').id('keys-done-btn').type('button')('Done'),
        ),
      ).build(document),
    );

    const copyBtn = formContainer.querySelector('#keys-copy-btn');
    if (copyBtn) {
      copyBtn.addEventListener('click', () => {
        const input = formContainer.querySelector('#keys-created-value');
        if (!input) return;
        navigator.clipboard.writeText(input.value).then(() => {
          copyBtn.textContent = 'Copied!';
          setTimeout(() => { copyBtn.textContent = 'Copy'; }, 2000);
        }).catch(() => {
          input.select();
        });
      });
    }

    const doneBtn = formContainer.querySelector('#keys-done-btn');
    if (doneBtn) {
      doneBtn.addEventListener('click', () => {
        modal.remove();
        this._loadItems();
      });
    }
  }

  // ── Edit modal ──────────────────────────────────────────────────────

  renderEditForm(items) {
    const item = items[0];
    return div.class('form-group')(
      label.class('form-label').for('keys-edit-label')('Label'),
      input.class('form-input').id('keys-edit-label').type('text')
        .value(item.label || '')
        .placeholder('e.g. CI pipeline key')(),
    ).build(document);
  }

  async submitEdit(items, modal) {
    const labelInput = modal.querySelector('#keys-edit-label');
    const newLabel = labelInput ? labelInput.value.trim() : '';

    const resp = await window.api(`/auth/keys/admin/${items[0].key_id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: newLabel }),
    });

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(text || `Update failed (${resp.status})`);
    }

    // Invalidate cached all-keys
    this._allKeys = null;
    this._allKeysLoaded = false;
  }

  // ── Search override (lazy load all keys) ────────────────────────────

  connectedCallback() {
    super.connectedCallback();
    this._allKeys = null;
    this._allKeysLoaded = false;
    this._eyeballOn = false;

    const searchInput = this.querySelector('.admin-search');
    const searchWrap = this.querySelector('.admin-search-wrap');
    if (!searchInput || !searchWrap) return;

    searchInput.placeholder = 'Showing your keys. Search (or click the eye) to show all keys…';

    // Inject the eyeball toggle as a sibling of the input so the user can
    // force "show all keys" without typing anything. Matches the legacy
    // "type a single space" behaviour: any input OR the eyeball lazy-loads
    // all keys; clearing both resets to own keys.
    searchWrap.style.position = 'relative';
    searchInput.style.paddingRight = '2.25rem';

    const eyeballBtn = button
      .type('button')
      .class('admin-search-eyeball')
      .ariaLabel('Show all keys')
      .title('Show all keys')
      .style(
        'position:absolute;right:0.5rem;top:50%;transform:translateY(-50%);' +
        'background:transparent;border:0;cursor:pointer;padding:0.25rem;' +
        'color:var(--text-muted,#7d8590);display:flex;align-items:center;' +
        'border-radius:0.25rem;',
      )(
        svg.width('18').height('18').viewBox('0 0 24 24')
          .fill('none').stroke('currentColor').strokeWidth('2')
          .strokeLinecap('round').strokeLinejoin('round')(
            path.d('M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z')(),
            circle.cx('12').cy('12').r('3')(),
          ),
      ).build(document);
    searchWrap.appendChild(eyeballBtn);

    const loadAll = async () => {
      if (this._allKeysLoaded) return;
      try {
        const resp = await window.api('/auth/keys/admin');
        if (resp.ok) {
          const data = await resp.json();
          this._allKeys = data.items || data;
          this._allKeysLoaded = true;
          this._items = this._allKeys;
          this._renderList();
        }
      } catch (_) {
        // Fall back to own keys filtering
      }
    };

    const resetToOwn = async () => {
      this._allKeysLoaded = false;
      this._allKeys = null;
      await this._loadItems();
    };

    const refresh = async () => {
      const hasInput = searchInput.value.length > 0;
      const shouldShowAll = hasInput || this._eyeballOn;

      if (shouldShowAll && !this._allKeysLoaded) {
        await loadAll();
      } else if (!shouldShowAll && this._allKeysLoaded) {
        await resetToOwn();
      }
    };

    // Any input — even a single space — triggers the lazy-load. We do NOT
    // trim here; the base class already trims for actual filter matching,
    // but the *trigger* must fire on raw input so legacy "type a space"
    // muscle memory still works.
    searchInput.addEventListener('input', refresh);

    eyeballBtn.addEventListener('click', async () => {
      this._eyeballOn = !this._eyeballOn;
      eyeballBtn.style.color = this._eyeballOn
        ? 'var(--accent, #f97316)'
        : 'var(--text-muted, #7d8590)';
      eyeballBtn.setAttribute(
        'aria-label',
        this._eyeballOn ? 'Hide other users\' keys' : 'Show all keys',
      );
      await refresh();
    });
  }

  // ── Helpers ─────────────────────────────────────────────────────────

  /**
   * Populate the user selector in the create modal.
   * Only shown when multiple users are available.
   */
  async _populateUserSelector(modal) {
    const slot = modal.querySelector('#keys-user-selector-slot');
    if (!slot || slot.dataset.populated) return;
    slot.dataset.populated = 'true';

    try {
      const resp = await window.api('/auth/keys/users');
      if (!resp.ok) return;

      const data = await resp.json();
      const users = data.items || [];

      if (users.length > 1) {
        slot.textContent = '';
        slot.appendChild(
          div.class('form-group')(
            label.class('form-label').for('keys-create-user')('User'),
            select.class('form-input').id('keys-create-user')(
              ...users.map((u) =>
                option.value(String(u.user_id))(String(u.username)),
              ),
            ),
          ).build(document),
        );
      }
    } catch (_) {
      // No user selector — fall back to default (own user)
    }
  }

  /**
   * Truncate a key/user ID for display.
   * If longer than 16 chars, show first 8 + "..." + last 8.
   */
  _truncateId(id) {
    if (!id) return '\u2014';
    const str = String(id);
    if (str.length <= 16) return str;
    return str.slice(0, 8) + '\u2026' + str.slice(-8);
  }

  /**
   * Determine the status badge for a key.
   * Returns { label, cssClass }.
   */
  _getStatus(key) {
    if (key.key_id === this.currentKeyId) {
      return { label: 'Current Session', cssClass: 'badge-session' };
    }
    if (key.is_revoked) {
      return { label: 'Revoked', cssClass: 'badge-inactive' };
    }
    if (key.expires_at && key.expires_at < Date.now()) {
      return { label: 'Expired', cssClass: 'badge-expired' };
    }
    return { label: 'Active', cssClass: 'badge-active' };
  }
}

if (!customElements.get('aeor-keys'))
  customElements.define('aeor-keys', AeorKeysPage);
