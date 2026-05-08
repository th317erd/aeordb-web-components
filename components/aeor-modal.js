/**
 * <aeor-modal> — Reusable modal dialog.
 *
 * Usage:
 *   const modal = document.createElement('aeor-modal');
 *   modal.title = 'Create User';
 *   modal.innerHTML = '<form>...</form>';
 *   document.body.appendChild(modal);
 *
 *   modal.addEventListener('close', () => modal.remove());
 *
 * Attributes:
 *   - title: The modal title displayed in the header bar.
 *
 * Events:
 *   - close: Fired when the modal is dismissed (backdrop click, close button, or Escape key).
 */

export class AeorModal extends HTMLElement {
  constructor() {
    super();
    this._title = '';
    this._boundOnKeyDown = this._onKeyDown.bind(this);
  }

  static get observedAttributes() {
    return ['title'];
  }

  get title() {
    return this._title;
  }

  set title(value) {
    this._title = value || '';
    const titleElement = this.querySelector('.aeor-modal__title');
    if (titleElement)
      titleElement.textContent = this._title;
  }

  attributeChangedCallback(name, _oldValue, newValue) {
    if (name === 'title')
      this.title = newValue;
  }

  connectedCallback() {
    this._render();
    document.addEventListener('keydown', this._boundOnKeyDown);
  }

  disconnectedCallback() {
    document.removeEventListener('keydown', this._boundOnKeyDown);
  }

  _render() {
    // Preserve existing child nodes (not just HTML) so event listeners survive
    const fragment = document.createDocumentFragment();
    while (this.firstChild) {
      fragment.appendChild(this.firstChild);
    }

    this.innerHTML = `
      <div class="aeor-modal__overlay">
        <div class="aeor-modal__dialog">
          <div class="aeor-modal__header">
            <div class="aeor-modal__title">${this._escapeHtml(this._title)}</div>
            <button class="aeor-modal__close-btn" aria-label="Close">&times;</button>
          </div>
          <div class="aeor-modal__body"></div>
        </div>
      </div>
    `;

    // Re-attach preserved child nodes into the body
    this.querySelector('.aeor-modal__body').appendChild(fragment);

    // Wire up close handlers
    const overlay = this.querySelector('.aeor-modal__overlay');
    const closeButton = this.querySelector('.aeor-modal__close-btn');

    overlay.addEventListener('click', (event) => {
      if (event.target === overlay)
        this._dismiss();
    });

    closeButton.addEventListener('click', () => this._dismiss());

    // Auto-focus the first focusable element inside the modal
    requestAnimationFrame(() => {
      const dialog = this.querySelector('.aeor-modal__dialog');
      if (dialog) {
        const first = dialog.querySelector(
          'input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"]), a[href]'
        );
        if (first) first.focus();
      }
    });
  }

  _onKeyDown(event) {
    if (event.key === 'Escape') {
      this._dismiss();
      return;
    }

    // Focus trap: cycle Tab/Shift+Tab within the modal dialog
    if (event.key === 'Tab') {
      const dialog = this.querySelector('.aeor-modal__dialog');
      if (!dialog) return;

      const focusable = dialog.querySelectorAll(
        'input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"]), a[href]'
      );
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (event.shiftKey) {
        if (document.activeElement === first || !dialog.contains(document.activeElement)) {
          event.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last || !dialog.contains(document.activeElement)) {
          event.preventDefault();
          first.focus();
        }
      }
    }
  }

  /** Open the modal (show the overlay). */
  open() {
    const overlay = this.querySelector('.aeor-modal__overlay');
    if (overlay) overlay.style.display = '';
  }

  /** Close the modal programmatically. */
  close() {
    this._dismiss();
  }

  _dismiss() {
    const overlay = this.querySelector('.aeor-modal__overlay');
    if (overlay) overlay.style.display = 'none';
    this.dispatchEvent(new CustomEvent('close', { bubbles: true }));
  }

  _escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

if (!customElements.get('aeor-modal'))
  customElements.define('aeor-modal', AeorModal);
