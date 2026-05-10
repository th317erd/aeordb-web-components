'use strict';

import './aeor-confirm-button.js';

/**
 * <aeor-snapshot-card> — Shared snapshot/version card component.
 *
 * Attributes:
 *   name            — Snapshot name (displayed prominently)
 *   snapshot-id     — Full hash ID
 *   date            — Formatted date string
 *   badge           — Badge text (e.g. "2d ago"); ignored when `current` is set
 *   current         — Boolean attr; shows "current" badge, hides restore button
 *   change-type     — "added" | "deleted" | "modified" | "other" (shows icon)
 *   size            — File size text (optional, appended after date)
 *   deletable       — Boolean attr; shows delete button in top-right
 *   restorable      — Boolean attr; shows full-width restore button at bottom
 *   selected        — Boolean attr; applies selected visual state
 *   truncate-id     — Boolean attr; truncates the displayed ID
 *   content-hash    — Optional content hash (exposed as data attr)
 *
 * Events emitted:
 *   snapshot-restore  — Restore confirmed (long-press complete)
 *   snapshot-delete   — Delete confirmed (long-press complete)
 *   snapshot-copy-id  — ID copied to clipboard; detail: { id }
 */
class AeorSnapshotCard extends HTMLElement {
  static get observedAttributes() {
    return [
      'name', 'snapshot-id', 'date', 'badge', 'current',
      'change-type', 'size', 'deletable', 'restorable',
      'selected', 'truncate-id', 'content-hash',
    ];
  }

  connectedCallback() {
    this._render();
  }

  attributeChangedCallback() {
    if (this.isConnected) this._render();
  }

  // ── Attribute helpers ─────────────────────────────────────────────────

  get snapshotName() { return this.getAttribute('name') || 'Unnamed'; }
  get snapshotId() { return this.getAttribute('snapshot-id') || ''; }
  get date() { return this.getAttribute('date') || ''; }
  get badge() { return this.getAttribute('badge') || ''; }
  get isCurrent() { return this.hasAttribute('current'); }
  get changeType() { return this.getAttribute('change-type') || ''; }
  get size() { return this.getAttribute('size') || ''; }
  get isDeletable() { return this.hasAttribute('deletable'); }
  get isRestorable() { return this.hasAttribute('restorable'); }
  get isSelected() { return this.hasAttribute('selected'); }
  get truncateId() { return this.hasAttribute('truncate-id'); }
  get contentHash() { return this.getAttribute('content-hash') || ''; }

  // ── Render ────────────────────────────────────────────────────────────

  _render() {
    const name = this._esc(this.snapshotName);
    const id = this.snapshotId;
    const displayId = this.truncateId ? this._truncate(id) : this._esc(id);
    const date = this._esc(this.date);
    const size = this._esc(this.size);
    const changeType = this.changeType;

    // Change-type icon
    let changeIcon = '';
    if (changeType) {
      const icon = changeType === 'added' ? '+'
        : changeType === 'deleted' ? '\u2212'
        : changeType === 'modified' ? '\u2022'
        : '\u2013';
      const colorClass = `snapshot-card-change-${changeType}`;
      changeIcon = `<span class="snapshot-card-change-icon ${colorClass}">${icon}</span>`;
    }

    // Badge
    let badgeHtml = '';
    if (this.isCurrent) {
      badgeHtml = '<span class="snapshot-card-badge snapshot-card-badge-current">current</span>';
    } else if (this.badge) {
      badgeHtml = `<span class="snapshot-card-badge snapshot-card-badge-muted">${this._esc(this.badge)}</span>`;
    }

    // Top-right actions (delete button)
    let actionsHtml = '';
    if (this.isDeletable) {
      actionsHtml = `
        <div class="snapshot-card-actions">
          <aeor-confirm-button class="snapshot-card-delete-btn confirm-button-danger" label="Delete" confirmed-text="Deleted!" duration="1000"></aeor-confirm-button>
        </div>`;
    }

    // Bottom restore button
    let restoreHtml = '';
    if (this.isRestorable) {
      restoreHtml = `
        <div class="snapshot-card-bottom">
          <aeor-confirm-button class="snapshot-card-restore-btn confirm-button-restore" label="Restore" confirmed-text="Restored!" duration="1000"></aeor-confirm-button>
        </div>`;
    }

    // Meta line (date + optional size)
    let metaHtml = '';
    if (date || size) {
      const metaText = date + (size ? ' \u00B7 ' + size : '');
      metaHtml = `<div class="snapshot-card-meta">${metaText}</div>`;
    }

    // Selection class
    if (this.isSelected) {
      this.classList.add('selected');
    } else {
      this.classList.remove('selected');
    }

    // Current class
    if (this.isCurrent) {
      this.classList.add('current');
    } else {
      this.classList.remove('current');
    }

    this.innerHTML = `
      <div class="snapshot-card-top">
        <div class="snapshot-card-info">
          <div class="snapshot-card-name">
            ${changeIcon}${name}
            ${badgeHtml}
          </div>
          <div class="snapshot-card-id">
            <span title="${this._esc(id)}">${displayId}</span>
            <span class="snapshot-card-copy-btn" title="Copy ID">&#128203;</span>
          </div>
          ${metaHtml}
        </div>
        ${actionsHtml}
      </div>
      ${restoreHtml}`;

    this._bindEvents();
  }

  // ── Events ────────────────────────────────────────────────────────────

  _bindEvents() {
    // Copy ID
    const copyBtn = this.querySelector('.snapshot-card-copy-btn');
    if (copyBtn) {
      copyBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = this.snapshotId;
        if (!id) return;
        navigator.clipboard.writeText(id).then(() => {
          copyBtn.textContent = '\u2713';
          setTimeout(() => { copyBtn.textContent = '\uD83D\uDCCB'; }, 1500);
        }).catch(() => {});
        this.dispatchEvent(new CustomEvent('snapshot-copy-id', {
          bubbles: true, detail: { id },
        }));
      });
    }

    // Restore
    const restoreBtn = this.querySelector('.snapshot-card-restore-btn');
    if (restoreBtn) {
      restoreBtn.addEventListener('confirm', (e) => {
        e.stopPropagation();
        this.dispatchEvent(new CustomEvent('snapshot-restore', {
          bubbles: true,
          detail: { name: this.snapshotName, id: this.snapshotId },
        }));
      });
    }

    // Delete
    const deleteBtn = this.querySelector('.snapshot-card-delete-btn');
    if (deleteBtn) {
      deleteBtn.addEventListener('confirm', (e) => {
        e.stopPropagation();
        this.dispatchEvent(new CustomEvent('snapshot-delete', {
          bubbles: true,
          detail: { name: this.snapshotName, id: this.snapshotId },
        }));
      });
    }
  }

  // ── Utilities ─────────────────────────────────────────────────────────

  _esc(str) {
    if (!str) return '';
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  _truncate(id) {
    if (!id) return '\u2014';
    const str = String(id);
    if (str.length <= 16) return this._esc(str);
    return this._esc(str.slice(0, 8)) + '\u2026' + this._esc(str.slice(-8));
  }
}

customElements.define('aeor-snapshot-card', AeorSnapshotCard);
