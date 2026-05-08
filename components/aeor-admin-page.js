'use strict';

import '/shared/components/aeor-modal.js';
import '/shared/components/aeor-confirm-button.js';

/**
 * AeorAdminPage — Base class for admin list pages (Users, Groups, Keys, Snapshots).
 *
 * Provides: page header, search bar, card list, multi-select, action bar,
 * create/edit modals, loading/error states.
 *
 * Subclasses MUST override:
 *   - get title()
 *   - get showCreateButton()
 *   - fetchItems()
 *   - getItemId(item)
 *   - renderCard(item)
 *   - matchesSearch(item, query)
 *   - getActionButtons(selectedItems)
 *   - shouldShowEditButton(selectedItems)
 *   - renderCreateForm()      (if showCreateButton)
 *   - submitCreate(formData)  (if showCreateButton)
 *   - renderEditForm(items)
 *   - submitEdit(items, formData)
 *
 * Subclasses MAY override:
 *   - onPostCreate(result)         — custom post-create behavior
 *   - updateCardSelection(el, sel) — custom selection visuals
 *   - onItemsLoaded(items)         — post-fetch hook (e.g. async name resolution)
 */
export class AeorAdminPage extends HTMLElement {
  constructor() {
    super();
    this._items = [];
    this._selectedIds = new Set();
    this._lastSelectedAnchor = null;
    this._searchQuery = '';
    this._error = null;
    this._loading = false;
  }

  // ── Subclass contract (MUST override) ──────────────────────────────

  get title() { return 'Admin'; }
  get showCreateButton() { return true; }

  async fetchItems() { return []; }
  getItemId(item) { return item.id || item.name; }
  renderCard(item) { return `<div>${JSON.stringify(item)}</div>`; }
  matchesSearch(item, query) { return true; }
  getActionButtons(selectedItems) { return ''; }
  shouldShowEditButton(selectedItems) { return selectedItems.length === 1; }
  renderCreateForm() { return ''; }
  async submitCreate(formData) { }
  renderEditForm(items) { return ''; }
  async submitEdit(items, formData) { }

  // ── Subclass hooks (MAY override) ──────────────────────────────────

  onPostCreate(result) { /* default: close modal and refresh */ }
  onItemsLoaded(items) { /* default: no-op */ }

  updateCardSelection(cardEl, isSelected) {
    if (isSelected) {
      cardEl.classList.add('selected');
    } else {
      cardEl.classList.remove('selected');
    }
  }

  // ── Lifecycle ──────────────────────────────────────────────────────

  connectedCallback() {
    this._render();
    this._loadItems();
  }

  // ── Render ─────────────────────────────────────────────────────────

  _render() {
    this.innerHTML = `
      <div class="page-header">
        <h1 class="page-title">${this._esc(this.title)}</h1>
        ${this.showCreateButton ? '<button class="admin-create-btn primary">Create</button>' : ''}
      </div>
      <div class="admin-search-wrap">
        <input class="form-input admin-search" type="text" placeholder="Search...">
      </div>
      <div class="admin-action-bar invisible"></div>
      <div class="admin-error"></div>
      <div class="admin-list"></div>
    `;

    // Search
    this.querySelector('.admin-search').addEventListener('input', (e) => {
      this._searchQuery = e.target.value.trim().toLowerCase();
      this._renderList();
    });

    // Create button
    const createBtn = this.querySelector('.admin-create-btn');
    if (createBtn) {
      createBtn.addEventListener('click', () => this._openCreateModal());
    }

    // Keyboard shortcuts
    this._keydownHandler = (e) => {
      // Don't capture when search input is focused
      if (document.activeElement === this.querySelector('.admin-search')) return;

      if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
        e.preventDefault();
        const visible = this._getVisibleItems();
        for (const item of visible) this._selectedIds.add(this.getItemId(item));
        if (visible.length > 0) this._lastSelectedAnchor = this.getItemId(visible[visible.length - 1]);
        this._updateSelectionVisuals();
        this._updateActionBar();
      } else if (e.key === 'Escape') {
        this._clearSelection();
      }
    };
    this.setAttribute('tabindex', '0');
    this.style.outline = 'none';
    this.addEventListener('keydown', this._keydownHandler);
  }

  disconnectedCallback() {
    if (this._keydownHandler) {
      this.removeEventListener('keydown', this._keydownHandler);
    }
  }

  // ── Data loading ───────────────────────────────────────────────────

  async _loadItems() {
    this._loading = true;
    this._renderList();

    try {
      this._items = await this.fetchItems();
      this._error = null;
      await this.onItemsLoaded(this._items);
    } catch (error) {
      this._error = error.message;
      this._items = [];
    }

    this._loading = false;
    this._renderList();
  }

  // ── List rendering ─────────────────────────────────────────────────

  _getVisibleItems() {
    if (!this._searchQuery) return this._items;
    return this._items.filter((item) => this.matchesSearch(item, this._searchQuery));
  }

  _renderList() {
    const listEl = this.querySelector('.admin-list');
    const errorEl = this.querySelector('.admin-error');
    if (!listEl || !errorEl) return;

    // Error
    if (this._error) {
      errorEl.innerHTML = `<div class="alert alert-error">${this._esc(this._error)}</div>`;
    } else {
      errorEl.innerHTML = '';
    }

    // Loading
    if (this._loading && this._items.length === 0) {
      listEl.innerHTML = '<div class="admin-empty">&nbsp;</div>';
      return;
    }

    const visible = this._getVisibleItems();

    if (visible.length === 0) {
      listEl.innerHTML = `<div class="admin-empty">${this._searchQuery ? 'No matches found.' : 'No items.'}</div>`;
      return;
    }

    listEl.innerHTML = visible.map((item) => {
      const id = this.getItemId(item);
      const isSelected = this._selectedIds.has(id);
      return `<div class="admin-card${isSelected ? ' selected' : ''}" data-item-id="${this._escAttr(String(id))}">${this.renderCard(item)}</div>`;
    }).join('');

    this._bindCardEvents(listEl, visible);
  }

  // ── Card events (selection) ────────────────────────────────────────

  _bindCardEvents(listEl, visibleItems) {
    listEl.querySelectorAll('.admin-card').forEach((cardEl) => {
      cardEl.addEventListener('click', (e) => {
        // Ignore clicks on buttons/inputs inside the card
        if (e.target.closest('button') || e.target.closest('aeor-confirm-button') ||
            e.target.closest('input') || e.target.closest('a')) return;

        const itemId = cardEl.dataset.itemId;
        const index = visibleItems.findIndex((item) => String(this.getItemId(item)) === itemId);
        const isMobile = window.innerWidth <= 768;
        const isCtrl = isMobile || e.ctrlKey || e.metaKey;
        const isShift = !isMobile && e.shiftKey;

        if (!isCtrl && !isShift) {
          this._selectedIds.clear();
          this._selectedIds.add(itemId);
          this._lastSelectedAnchor = itemId;
        } else if (isCtrl) {
          if (this._selectedIds.has(itemId)) {
            this._selectedIds.delete(itemId);
          } else {
            this._selectedIds.add(itemId);
          }
          this._lastSelectedAnchor = itemId;
        } else if (isShift) {
          const anchorIndex = this._lastSelectedAnchor
            ? visibleItems.findIndex((item) => String(this.getItemId(item)) === this._lastSelectedAnchor)
            : 0;
          const anchor = (anchorIndex >= 0) ? anchorIndex : 0;
          const start = Math.min(anchor, index);
          const end = Math.max(anchor, index);
          for (let i = start; i <= end; i++) {
            if (visibleItems[i]) this._selectedIds.add(String(this.getItemId(visibleItems[i])));
          }
        }

        this._updateSelectionVisuals();
        this._updateActionBar();
      });
    });
  }

  // ── Selection visuals ──────────────────────────────────────────────

  _updateSelectionVisuals() {
    this.querySelectorAll('.admin-card').forEach((cardEl) => {
      const isSelected = this._selectedIds.has(cardEl.dataset.itemId);
      this.updateCardSelection(cardEl, isSelected);
    });
  }

  _clearSelection() {
    this._selectedIds.clear();
    this._lastSelectedAnchor = null;
    this._updateSelectionVisuals();
    this._updateActionBar();
  }

  // ── Action bar ─────────────────────────────────────────────────────

  _getSelectedItems() {
    return this._items.filter((item) => this._selectedIds.has(String(this.getItemId(item))));
  }

  _updateActionBar() {
    const bar = this.querySelector('.admin-action-bar');
    if (!bar) return;

    if (this._selectedIds.size === 0) {
      bar.innerHTML = '';
      bar.classList.add('invisible');
      return;
    }

    const selectedItems = this._getSelectedItems();

    bar.innerHTML = `
      <span class="admin-sel-count">${this._selectedIds.size} selected</span>
      ${this.shouldShowEditButton(selectedItems) ? '<button class="secondary small admin-edit-btn">Edit</button>' : ''}
      ${this.getActionButtons(selectedItems)}
      <button class="secondary small admin-clear-btn">Clear Selection</button>
    `;
    bar.classList.remove('invisible');

    // Bind action bar events
    const editBtn = bar.querySelector('.admin-edit-btn');
    if (editBtn) editBtn.addEventListener('click', () => this._openEditModal(selectedItems));

    const clearBtn = bar.querySelector('.admin-clear-btn');
    if (clearBtn) clearBtn.addEventListener('click', () => this._clearSelection());

    // Let subclass bind its custom action buttons
    this._bindActionBarEvents(bar, selectedItems);
  }

  /** Subclasses override to bind event listeners on their custom action buttons. */
  _bindActionBarEvents(bar, selectedItems) { }

  // ── Create modal ───────────────────────────────────────────────────

  _openCreateModal() {
    const formHtml = this.renderCreateForm();
    const modal = document.createElement('aeor-modal');
    modal.setAttribute('title', `Create ${this.title.replace(/s$/, '')}`);
    modal.innerHTML = `
      <div class="admin-modal-form">
        ${formHtml}
        <div class="modal-footer-actions">
          <button class="secondary small admin-modal-cancel">Cancel</button>
          <button class="primary small admin-modal-submit">Create</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);
    modal.open();

    modal.querySelector('.admin-modal-cancel').addEventListener('click', () => {
      modal.close();
      modal.remove();
    });

    modal.querySelector('.admin-modal-submit').addEventListener('click', async () => {
      try {
        const result = await this.submitCreate(modal);
        this.onPostCreate(result);
        if (!this._postCreateHandled) {
          modal.close();
          modal.remove();
          if (window.aeorToast) window.aeorToast('Created successfully', 'success');
          await this._loadItems();
        }
        this._postCreateHandled = false;
      } catch (error) {
        if (window.aeorToast) window.aeorToast('Create failed: ' + error.message, 'error');
      }
    });

    modal.addEventListener('close', () => modal.remove());
  }

  // ── Edit modal ─────────────────────────────────────────────────────

  _openEditModal(items) {
    const formHtml = this.renderEditForm(items);
    const noun = this.title.replace(/s$/, '');
    const modalTitle = items.length === 1
      ? `Edit ${noun}`
      : `Edit ${items.length} ${this.title}`;

    const modal = document.createElement('aeor-modal');
    modal.setAttribute('title', modalTitle);
    modal.innerHTML = `
      <div class="admin-modal-form">
        ${formHtml}
        <div class="modal-footer-actions">
          <button class="secondary small admin-modal-cancel">Cancel</button>
          <button class="primary small admin-modal-submit">Save</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);
    modal.open();

    modal.querySelector('.admin-modal-cancel').addEventListener('click', () => {
      modal.close();
      modal.remove();
    });

    modal.querySelector('.admin-modal-submit').addEventListener('click', async () => {
      try {
        await this.submitEdit(items, modal);
        modal.close();
        modal.remove();
        if (window.aeorToast) window.aeorToast('Updated successfully', 'success');
        this._clearSelection();
        await this._loadItems();
      } catch (error) {
        if (window.aeorToast) window.aeorToast('Update failed: ' + error.message, 'error');
      }
    });

    modal.addEventListener('close', () => modal.remove());
  }

  // ── Utilities ──────────────────────────────────────────────────────

  _esc(str) {
    if (!str) return '';
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  _escAttr(str) {
    return (str || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
}
