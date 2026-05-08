/**
 * <aeor-confirm-button> — Button that requires a 1-second hold to activate.
 *
 * A red progress bar fills from left to right while held. Releasing early
 * aborts. Reaching 100% fires the "confirm" event.
 *
 * Usage:
 *   <aeor-confirm-button label="Cancel Upload"></aeor-confirm-button>
 *
 *   button.addEventListener('confirm', () => { ... });
 *
 * Attributes:
 *   - label: Button text (default: "Cancel")
 *   - duration: Hold duration in ms (default: 1000)
 *   - disabled: Disables the button
 *
 * CSS custom properties:
 *   --lpb-bg: Background color (default: var(--card, #161b22))
 *   --lpb-border: Border color (default: var(--border, #30363d))
 *   --lpb-text: Text color (default: var(--text, #e6edf3))
 *   --lpb-fill: Progress fill color (default: var(--danger, #f85149))
 *   --lpb-radius: Border radius (default: 6px)
 */

export class AeorConfirmButton extends HTMLElement {
  constructor() {
    super();
    this._duration = 1000;
    this._pressing = false;
    this._startTime = 0;
    this._rafId = null;

    this._onPointerDown = this._onPointerDown.bind(this);
    this._onPointerUp = this._onPointerUp.bind(this);
    this._tick = this._tick.bind(this);
  }

  static get observedAttributes() {
    return ['label', 'duration', 'disabled', 'confirmed-text', 'reset-delay'];
  }

  get label() { return this.getAttribute('label') || 'Cancel'; }
  set label(v) { this.setAttribute('label', v); }

  get confirmedText() { return this.getAttribute('confirmed-text') || ''; }

  get duration() { return parseInt(this.getAttribute('duration') || '1000', 10); }
  set duration(v) { this.setAttribute('duration', String(v)); }

  get resetDelay() { return parseInt(this.getAttribute('reset-delay') || '1500', 10); }

  get disabled() { return this.hasAttribute('disabled'); }
  set disabled(v) { v ? this.setAttribute('disabled', '') : this.removeAttribute('disabled'); }

  attributeChangedCallback(name, _old, _new) {
    if (name === 'label') this._updateLabel();
    if (name === 'duration') this._duration = this.duration;
  }

  connectedCallback() {
    this._duration = this.duration;
    this._render();
    this._btn = this.querySelector('.aeor-confirm-btn');
    this._fill = this.querySelector('.aeor-confirm-btn-fill');
    this._btn.addEventListener('pointerdown', this._onPointerDown);
    window.addEventListener('pointerup', this._onPointerUp);
    window.addEventListener('pointercancel', this._onPointerUp);
  }

  disconnectedCallback() {
    this._cancel();
    window.removeEventListener('pointerup', this._onPointerUp);
    window.removeEventListener('pointercancel', this._onPointerUp);
  }

  _render() {
    this.innerHTML = `
      <button class="aeor-confirm-btn">
        <span class="aeor-confirm-btn-fill"></span>
        <span class="aeor-confirm-btn-label">
          ${this._esc(this.label)}
        </span>
      </button>
    `;
  }

  _updateLabel() {
    const el = this.querySelector('.aeor-confirm-btn-label');
    if (el) el.textContent = this.label;
  }

  _onPointerDown(e) {
    if (this.disabled) return;
    e.preventDefault();
    this._pressing = true;
    this._startTime = performance.now();
    this._originalBg = getComputedStyle(this._btn).backgroundColor;
    this._btn.classList.remove('resetting', 'confirmed');
    this._btn.classList.add('pressing');
    this._fill.style.setProperty('--progress', '0%');
    this._rafId = requestAnimationFrame(this._tick);
  }

  _onPointerUp() {
    if (!this._pressing) return;
    this._cancel();
  }

  _tick(now) {
    if (!this._pressing) return;
    const elapsed = now - this._startTime;
    const pct = Math.min(elapsed / this._duration, 1);
    this._fill.style.setProperty('--progress', `${pct * 100}%`);
    // Fade background to transparent at 2x speed (fully gone at 50% progress)
    const bgOpacity = Math.max(0, 1 - pct * 2);
    this._btn.style.setProperty('--btn-bg', `color-mix(in srgb, ${this._originalBg} ${Math.round(bgOpacity * 100)}%, transparent)`);
    this._btn.style.backgroundColor = 'var(--btn-bg)';
    // Fade text color from original to white as progress increases
    const label = this.querySelector('.aeor-confirm-btn-label');
    if (label) {
      label.style.setProperty('--label-color', `color-mix(in srgb, white ${Math.round(pct * 100)}%, var(--lpb-text, var(--text, #e6edf3)))`);
      label.style.color = 'var(--label-color)';
    }

    if (pct >= 1) {
      this._pressing = false;
      this._fill.style.setProperty('--progress', '100%');
      this.dispatchEvent(new CustomEvent('confirm', { bubbles: true }));

      // Show confirmed state
      const confirmedText = this.confirmedText;
      if (confirmedText) {
        const label = this.querySelector('.aeor-confirm-btn-label');
        if (label) label.textContent = confirmedText;
        this._btn.classList.remove('pressing');
        this._btn.classList.add('confirmed');
        this.disabled = true;
        setTimeout(() => {
          this._reset();
          this.disabled = false;
        }, this.resetDelay);
      } else {
        setTimeout(() => this._reset(), 300);
      }
    } else {
      this._rafId = requestAnimationFrame(this._tick);
    }
  }

  _cancel() {
    this._pressing = false;
    if (this._rafId) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
    this._reset();
  }

  _reset() {
    if (this._fill) {
      this._btn.classList.add('resetting');
      this._fill.style.setProperty('--progress', '0%');
    }
    if (this._btn) {
      this._btn.classList.remove('pressing', 'confirmed');
      const label = this.querySelector('.aeor-confirm-btn-label');
      if (label) {
        label.style.color = '';
        label.style.removeProperty('--label-color');
        label.textContent = this.label; // Restore original label text
      }
      // Restore original background
      this._btn.style.backgroundColor = '';
      this._btn.style.removeProperty('--btn-bg');
      setTimeout(() => {
        if (this._btn) this._btn.classList.remove('resetting');
      }, 250);
    }
  }

  _esc(text) {
    const d = document.createElement('div');
    d.textContent = text;
    return d.innerHTML;
  }
}

if (!customElements.get('aeor-confirm-button'))
  customElements.define('aeor-confirm-button', AeorConfirmButton);
