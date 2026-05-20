'use strict';

import { elements } from '../../aeor/elements.js';
import '../../aeor/components/aeor-modal.js';
import '../../aeor/components/aeor-confirm-button.js';

const { div, h1, input, button, span } = elements;
const aeorModal = elements['aeor-modal'];

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
 *
 * Subclass contract for `renderCard`, `renderCreateForm`,
 * `renderEditForm`, and `getActionButtons`: each returns either
 *   - a `Node` (Element / DocumentFragment), OR
 *   - an `Array` of Nodes (mostly for getActionButtons), OR
 *   - `null` / nothing when there's nothing to render.
 * Helper `_appendContent` below is the single funnel.
 */
function _appendContent(target, content) {
  if (content == null || content === '') return;
  if (content instanceof Node) {
    target.appendChild(content);
    return;
  }
  if (Array.isArray(content)) {
    for (const item of content) _appendContent(target, item);
    return;
  }
  // Unknown return type — silently ignore rather than throw.
}
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
    cardEl.classList.toggle('selected', isSelected);
  }

  // ── Lifecycle ──────────────────────────────────────────────────────

  connectedCallback() {
    this._render();
    this._loadItems();
  }

  // ── Render ─────────────────────────────────────────────────────────

  _render() {
    this.textContent = '';
    this.appendChild(
      div(
        div.class('page-header')(
          h1.class('page-title')(this.title),
          this.showCreateButton
            ? button.class('admin-create-btn primary')('Create')
            : null,
        ),
        div.class('admin-search-wrap')(
          input.class('form-input admin-search').type('text').placeholder('Search...')(),
        ),
        div.class('admin-action-bar invisible')(),
        div.class('admin-error')(),
        div.class('admin-list')(),
      ).build(document),
    );

    this.querySelector('.admin-search').addEventListener('input', (event) => {
      this._searchQuery = event.target.value.trim().toLowerCase();
      this._renderList();
    });

    const createBtn = this.querySelector('.admin-create-btn');
    if (createBtn) {
      createBtn.addEventListener('click', () => this._openCreateModal());
    }

    this._keydownHandler = (event) => {
      if (document.activeElement === this.querySelector('.admin-search')) return;

      if ((event.ctrlKey || event.metaKey) && event.key === 'a') {
        event.preventDefault();
        const visible = this._getVisibleItems();
        for (const item of visible) this._selectedIds.add(this.getItemId(item));
        if (visible.length > 0) {
          this._lastSelectedAnchor = this.getItemId(visible[visible.length - 1]);
        }
        this._updateSelectionVisuals();
        this._updateActionBar();
      } else if (event.key === 'Escape') {
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
    errorEl.textContent = '';
    if (this._error) {
      errorEl.appendChild(
        div.class('alert alert-error')(this._error).build(document),
      );
    }

    // Loading
    if (this._loading && this._items.length === 0) {
      listEl.textContent = '';
      listEl.appendChild(div.class('admin-empty')(' ').build(document));
      return;
    }

    const visible = this._getVisibleItems();

    if (visible.length === 0) {
      listEl.textContent = '';
      listEl.appendChild(
        div.class('admin-empty')(
          this._searchQuery ? 'No matches found.' : 'No items.',
        ).build(document),
      );
      return;
    }

    listEl.textContent = '';
    for (const item of visible) {
      const id = this.getItemId(item);
      const isSelected = this._selectedIds.has(String(id));
      const cardEl = div
        .class(isSelected ? 'admin-card selected' : 'admin-card')
        .dataItemId(String(id))()
        .build(document);
      _appendContent(cardEl, this.renderCard(item));
      listEl.appendChild(cardEl);
    }

    this._bindCardEvents(listEl, visible);
  }

  // ── Card events (selection) ────────────────────────────────────────

  _bindCardEvents(listEl, visibleItems) {
    listEl.querySelectorAll('.admin-card').forEach((cardEl) => {
      cardEl.addEventListener('click', (event) => {
        if (event.target.closest('button') || event.target.closest('aeor-confirm-button') ||
            event.target.closest('input') || event.target.closest('a')) return;

        const itemId = cardEl.dataset.itemId;
        const index = visibleItems.findIndex((item) => String(this.getItemId(item)) === itemId);
        const isMobile = window.innerWidth <= 768;
        const isCtrl = isMobile || event.ctrlKey || event.metaKey;
        const isShift = !isMobile && event.shiftKey;

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

    bar.textContent = '';

    if (this._selectedIds.size === 0) {
      bar.appendChild(document.createTextNode(' '));
      bar.classList.add('invisible');
      return;
    }

    const selectedItems = this._getSelectedItems();

    // Build the static parts via the element-builder.
    bar.appendChild(
      span.class('admin-sel-count')(`${this._selectedIds.size} selected`).build(document),
    );
    if (this.shouldShowEditButton(selectedItems)) {
      bar.appendChild(
        button.class('secondary small admin-edit-btn')('Edit').build(document),
      );
    }

    _appendContent(bar, this.getActionButtons(selectedItems));

    bar.appendChild(
      button.class('secondary small admin-clear-btn')('Clear Selection').build(document),
    );
    bar.classList.remove('invisible');

    const editBtn = bar.querySelector('.admin-edit-btn');
    if (editBtn) editBtn.addEventListener('click', () => this._openEditModal(selectedItems));

    const clearBtn = bar.querySelector('.admin-clear-btn');
    if (clearBtn) clearBtn.addEventListener('click', () => this._clearSelection());

    this._bindActionBarEvents(bar, selectedItems);
  }

  /** Subclasses override to bind event listeners on their custom action buttons. */
  _bindActionBarEvents(bar, selectedItems) { }

  // ── Create modal ───────────────────────────────────────────────────

  _openCreateModal() {
    const modal = aeorModal.title(`Create ${this.title.replace(/s$/, '')}`)().build(document);

    const formContainer = div.class('admin-modal-form')().build(document);
    _appendContent(formContainer, this.renderCreateForm());
    formContainer.appendChild(
      div.class('modal-footer-actions')(
        button.class('secondary small admin-modal-cancel')('Cancel'),
        button.class('primary small admin-modal-submit')('Create'),
      ).build(document),
    );
    modal.appendChild(formContainer);

    // Universal aeor-modal auto-displays on appendChild (connectedCallback
    // builds the DOM) and dispatches a 'close' event when dismissed via
    // backdrop / Escape / close button — no explicit .open()/.close().
    document.body.appendChild(modal);

    modal.querySelector('.admin-modal-cancel').addEventListener('click', () => {
      modal.remove();
    });

    const submitBtn = modal.querySelector('.admin-modal-submit');
    submitBtn.addEventListener('click', async () => {
      if (submitBtn.disabled) return;
      submitBtn.disabled = true;
      submitBtn.textContent = 'Creating...';
      try {
        const result = await this.submitCreate(modal);
        this.onPostCreate(result);
        if (!this._postCreateHandled) {
          modal.remove();
          if (window.aeorToast) window.aeorToast('Created successfully', 'success');
          await this._loadItems();
        }
        this._postCreateHandled = false;
      } catch (error) {
        if (window.aeorToast) window.aeorToast('Create failed: ' + error.message, 'error');
        submitBtn.disabled = false;
        submitBtn.textContent = 'Create';
      }
    });

    modal.addEventListener('close', () => modal.remove());
  }

  // ── Edit modal ─────────────────────────────────────────────────────

  _openEditModal(items) {
    const noun = this.title.replace(/s$/, '');
    const modalTitle = items.length === 1
      ? `Edit ${noun}`
      : `Edit ${items.length} ${this.title}`;

    const modal = aeorModal.title(modalTitle)().build(document);

    const formContainer = div.class('admin-modal-form')().build(document);
    _appendContent(formContainer, this.renderEditForm(items));
    formContainer.appendChild(
      div.class('modal-footer-actions')(
        button.class('secondary small admin-modal-cancel')('Cancel'),
        button.class('primary small admin-modal-submit')('Save'),
      ).build(document),
    );
    modal.appendChild(formContainer);

    // See note in _openCreateModal — universal aeor-modal has no
    // explicit open()/close(); appendChild shows it, remove() hides it.
    document.body.appendChild(modal);

    modal.querySelector('.admin-modal-cancel').addEventListener('click', () => {
      modal.remove();
    });

    const saveBtn = modal.querySelector('.admin-modal-submit');
    saveBtn.addEventListener('click', async () => {
      if (saveBtn.disabled) return;
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving...';
      try {
        await this.submitEdit(items, modal);
        modal.remove();
        if (window.aeorToast) window.aeorToast('Updated successfully', 'success');
        this._clearSelection();
        await this._loadItems();
      } catch (error) {
        if (window.aeorToast) window.aeorToast('Update failed: ' + error.message, 'error');
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save';
      }
    });

    modal.addEventListener('close', () => modal.remove());
  }
}
