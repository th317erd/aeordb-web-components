/**
 * <aeor-long-press-button> — Button that requires a 1-second hold to activate.
 *
 * A red progress bar fills from left to right while held. Releasing early
 * aborts. Reaching 100% fires the "confirm" event.
 *
 * Usage:
 *   <aeor-long-press-button label="Cancel Upload"></aeor-long-press-button>
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

export class AeorLongPressButton extends HTMLElement {
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
    return ['label', 'duration', 'disabled', 'confirmed-text'];
  }

  get label() { return this.getAttribute('label') || 'Cancel'; }
  set label(v) { this.setAttribute('label', v); }

  get confirmedText() { return this.getAttribute('confirmed-text') || ''; }

  get duration() { return parseInt(this.getAttribute('duration') || '1000', 10); }
  set duration(v) { this.setAttribute('duration', String(v)); }

  get disabled() { return this.hasAttribute('disabled'); }
  set disabled(v) { v ? this.setAttribute('disabled', '') : this.removeAttribute('disabled'); }

  attributeChangedCallback(name, _old, _new) {
    if (name === 'label') this._updateLabel();
    if (name === 'duration') this._duration = this.duration;
  }

  connectedCallback() {
    this._duration = this.duration;
    this._render();
    this._btn = this.querySelector('.lpb');
    this._fill = this.querySelector('.lpb-fill');
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
    // Inject hover styles once
    if (!document.getElementById('aeor-lpb-styles')) {
      const s = document.createElement('style');
      s.id = 'aeor-lpb-styles';
      s.textContent = `
        aeor-long-press-button .lpb:hover {
          background: color-mix(in srgb, var(--lpb-bg, var(--bg-tertiary, #21262d)) 80%, #fff) !important;
          border-color: var(--lpb-fill, var(--danger, #f85149)) !important;
        }
      `;
      document.head.appendChild(s);
    }

    this.innerHTML = `
      <button class="lpb" style="
        position: relative;
        overflow: hidden;
        height: 28px;
        padding: 0 10px;
        border: 1px solid var(--lpb-border, var(--border, #30363d));
        border-radius: var(--lpb-radius, 6px);
        background: var(--lpb-bg, var(--bg-tertiary, #21262d));
        color: var(--lpb-text, var(--text, #e6edf3));
        font: inherit;
        font-size: 12px;
        cursor: pointer;
        user-select: none;
        touch-action: none;
        -webkit-user-select: none;
        box-sizing: border-box;
        transition: background-color 0.15s, border-color 0.15s;
      ">
        <span class="lpb-fill" style="
          position: absolute;
          top: 0; left: 0; bottom: 0;
          width: 0%;
          background: var(--lpb-fill, var(--danger, #f85149));
          opacity: 0.3;
          transition: none;
          pointer-events: none;
        "></span>
        <span class="lpb-label" style="position: relative; pointer-events: none;">
          ${this._esc(this.label)}
        </span>
      </button>
    `;
  }

  _updateLabel() {
    const el = this.querySelector('.lpb-label');
    if (el) el.textContent = this.label;
  }

  _onPointerDown(e) {
    if (this.disabled) return;
    e.preventDefault();
    this._pressing = true;
    this._startTime = performance.now();
    this._originalBg = getComputedStyle(this._btn).backgroundColor;
    this._fill.style.transition = 'none';
    this._fill.style.width = '0%';
    this._fill.style.opacity = '1';
    this._btn.style.borderColor = 'var(--lpb-fill, var(--danger, #f85149))';
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
    this._fill.style.width = `${pct * 100}%`;
    // Fade background to transparent at 2x speed (fully gone at 50% progress)
    const bgOpacity = Math.max(0, 1 - pct * 2);
    this._btn.style.backgroundColor = `color-mix(in srgb, ${this._originalBg} ${Math.round(bgOpacity * 100)}%, transparent)`;
    // Fade text color from original to white as progress increases
    const label = this.querySelector('.lpb-label');
    if (label) {
      label.style.color = `color-mix(in srgb, white ${Math.round(pct * 100)}%, var(--lpb-text, var(--text, #e6edf3)))`;
    }

    if (pct >= 1) {
      this._pressing = false;
      this._fill.style.width = '100%';
      this.dispatchEvent(new CustomEvent('confirm', { bubbles: true }));

      // Show confirmed state
      const confirmedText = this.confirmedText;
      if (confirmedText) {
        const label = this.querySelector('.lpb-label');
        if (label) label.textContent = confirmedText;
        this._btn.style.backgroundColor = 'var(--lpb-fill, var(--success, #3fb950))';
        this._btn.style.borderColor = 'var(--lpb-fill, var(--success, #3fb950))';
        this._fill.style.opacity = '0';
        this.disabled = true;
        setTimeout(() => {
          this._reset();
          this.disabled = false;
        }, 5000);
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
      this._fill.style.transition = 'width 0.15s ease-out';
      this._fill.style.width = '0%';
      this._fill.style.opacity = '1';
    }
    if (this._btn) {
      this._btn.style.borderColor = '';
      const label = this.querySelector('.lpb-label');
      if (label) label.style.color = '';
      // Restore original background with a smooth transition
      this._btn.style.transition = 'background-color 0.2s ease-out';
      this._btn.style.backgroundColor = this._originalBg || '';
      setTimeout(() => { if (this._btn) this._btn.style.transition = ''; }, 250);
    }
  }

  _esc(text) {
    const d = document.createElement('div');
    d.textContent = text;
    return d.innerHTML;
  }
}

if (!customElements.get('aeor-long-press-button'))
  customElements.define('aeor-long-press-button', AeorLongPressButton);
