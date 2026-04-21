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
    // Preserve any existing innerHTML as content
    const contentHTML = this.innerHTML;

    this.innerHTML = `
      <div class="aeor-modal__overlay" style="
        position: fixed;
        inset: 0;
        z-index: 1000;
        background: rgba(0, 0, 0, 0.6);
        display: flex;
        align-items: center;
        justify-content: center;
        animation: aeor-modal-fade-in 0.15s ease;
      ">
        <div class="aeor-modal__dialog" style="
          background: var(--card, #161b22);
          border: 1px solid var(--border, #30363d);
          border-radius: 12px;
          min-width: 360px;
          max-width: 560px;
          width: 100%;
          max-height: 85vh;
          overflow-y: auto;
          box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
          animation: aeor-modal-scale-in 0.15s ease;
        ">
          <div class="aeor-modal__header" style="
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 16px 20px;
            border-bottom: 1px solid var(--border, #30363d);
          ">
            <div class="aeor-modal__title" style="
              font-size: 1.1rem;
              font-weight: 600;
              color: var(--text, #e6edf3);
            ">${this._escapeHtml(this._title)}</div>
            <button class="aeor-modal__close-btn" style="
              background: none;
              border: none;
              color: var(--text-muted, #8b949e);
              cursor: pointer;
              font-size: 1.25rem;
              line-height: 1;
              padding: 4px 8px;
              border-radius: 4px;
              transition: color 0.15s ease, background 0.15s ease;
            " aria-label="Close">&times;</button>
          </div>
          <div class="aeor-modal__body" style="
            padding: 20px;
          ">${contentHTML}</div>
        </div>
      </div>
    `;

    // Wire up close handlers
    const overlay = this.querySelector('.aeor-modal__overlay');
    const closeButton = this.querySelector('.aeor-modal__close-btn');

    overlay.addEventListener('click', (event) => {
      if (event.target === overlay)
        this._dismiss();
    });

    closeButton.addEventListener('click', () => this._dismiss());

    // Inject keyframe animations if not already present
    if (!document.getElementById('aeor-modal-styles')) {
      const style = document.createElement('style');
      style.id = 'aeor-modal-styles';
      style.textContent = `
        @keyframes aeor-modal-fade-in {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @keyframes aeor-modal-scale-in {
          from { transform: scale(0.95); opacity: 0; }
          to   { transform: scale(1); opacity: 1; }
        }
        .aeor-modal__close-btn:hover {
          color: var(--text, #e6edf3) !important;
          background: var(--border, #30363d) !important;
        }
      `;
      document.head.appendChild(style);
    }
  }

  _onKeyDown(event) {
    if (event.key === 'Escape')
      this._dismiss();
  }

  _dismiss() {
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
