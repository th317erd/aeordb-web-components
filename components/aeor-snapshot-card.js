'use strict';

import { elements } from '../../aeor/elements.js';
import '../../aeor/components/aeor-confirm-button.js';

const { div, span } = elements;
const aeorConfirmButton = elements['aeor-confirm-button'];

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
    const name = this.snapshotName;
    const id = this.snapshotId;
    const displayId = this.truncateId ? this._truncate(id) : id;
    const date = this.date;
    const size = this.size;
    const changeType = this.changeType;

    this.classList.toggle('selected', this.isSelected);
    this.classList.toggle('current', this.isCurrent);

    // Change-type icon — emitted only when a type was provided.
    let changeIcon = null;
    if (changeType) {
      const ch = changeType === 'added' ? '+'
        : changeType === 'deleted' ? '−'
        : changeType === 'modified' ? '•'
        : '–';
      changeIcon = span.class(`snapshot-card-change-icon snapshot-card-change-${changeType}`)(ch);
    }

    // Badge variants
    let badgeEl = null;
    if (this.isCurrent) {
      badgeEl = span.class('snapshot-card-badge snapshot-card-badge-current')('current');
    } else if (this.badge) {
      badgeEl = span.class('snapshot-card-badge snapshot-card-badge-muted')(this.badge);
    }

    // Top-right delete action
    const deleteAction = this.isDeletable
      ? div.class('snapshot-card-actions')(
          aeorConfirmButton
            .class('snapshot-card-delete-btn confirm-button-danger')
            .label('Delete')
            .confirmedText('Deleted!')
            .duration('1000')(),
        )
      : null;

    // Bottom restore button
    const restoreBottom = this.isRestorable
      ? div.class('snapshot-card-bottom')(
          aeorConfirmButton
            .class('snapshot-card-restore-btn confirm-button-restore')
            .label('Restore')
            .confirmedText('Restored!')
            .duration('1000')(),
        )
      : null;

    // Meta (date · size)
    const metaEl = (date || size)
      ? div.class('snapshot-card-meta')(date + (size ? ' · ' + size : ''))
      : null;

    // The copy-id icon span — its textContent flips to ✓ briefly via _bindEvents.
    const copyBtn = span.class('snapshot-card-copy-btn').title('Copy ID')('📋');

    this.textContent = '';
    const tree = div.context(this)(
      div.class('snapshot-card-top')(
        div.class('snapshot-card-info')(
          div.class('snapshot-card-name')(
            changeIcon,
            name,
            badgeEl,
          ),
          div.class('snapshot-card-id')(
            span.title(id)(displayId),
            copyBtn,
          ),
          metaEl,
        ),
        deleteAction,
      ),
      restoreBottom,
    ).build(document);

    this.appendChild(tree);
    this._bindEvents();
  }

  // ── Events ────────────────────────────────────────────────────────────

  _bindEvents() {
    const copyBtn = this.querySelector('.snapshot-card-copy-btn');
    if (copyBtn) {
      copyBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        const id = this.snapshotId;
        if (!id) return;
        navigator.clipboard.writeText(id).then(() => {
          copyBtn.textContent = '✓';
          setTimeout(() => { copyBtn.textContent = '📋'; }, 1500);
        }).catch(() => {});
        this.dispatchEvent(new CustomEvent('snapshot-copy-id', {
          bubbles: true, detail: { id },
        }));
      });
    }

    const restoreBtn = this.querySelector('.snapshot-card-restore-btn');
    if (restoreBtn) {
      restoreBtn.addEventListener('confirm', (event) => {
        event.stopPropagation();
        this.dispatchEvent(new CustomEvent('snapshot-restore', {
          bubbles: true,
          detail: { name: this.snapshotName, id: this.snapshotId },
        }));
      });
    }

    const deleteBtn = this.querySelector('.snapshot-card-delete-btn');
    if (deleteBtn) {
      deleteBtn.addEventListener('confirm', (event) => {
        event.stopPropagation();
        this.dispatchEvent(new CustomEvent('snapshot-delete', {
          bubbles: true,
          detail: { name: this.snapshotName, id: this.snapshotId },
        }));
      });
    }
  }

  // ── Utilities ─────────────────────────────────────────────────────────

  _truncate(id) {
    if (!id) return '—';
    const str = String(id);
    if (str.length <= 16) return str;
    return str.slice(0, 8) + '…' + str.slice(-8);
  }
}

customElements.define('aeor-snapshot-card', AeorSnapshotCard);
