/**
 * <aeor-info-box> — Blue info hint box with an (i) icon.
 *
 * Usage:
 *   <aeor-info-box>Any version can be safely restored.</aeor-info-box>
 *
 * Attributes:
 *   - compact: When present, uses smaller padding and font size,
 *              and renders inline instead of block.
 */

export class AeorInfoBox extends HTMLElement {
  connectedCallback() {
    if (this._rendered) return;
    this._rendered = true;

    const compact = this.hasAttribute('compact');
    const iconSize = compact ? '16' : '20';

    const content = this.innerHTML;

    this.innerHTML = `
      <div class="aeor-info-box__container">
        <svg class="aeor-info-box__icon" width="${iconSize}" height="${iconSize}" viewBox="0 0 24 24" fill="none" stroke="#58a6ff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"/>
          <line x1="12" y1="16" x2="12" y2="12"/>
          <line x1="12" y1="8" x2="12.01" y2="8"/>
        </svg>
        <div class="aeor-info-box__content">
          ${content}
        </div>
      </div>
    `;
  }
}

if (!customElements.get('aeor-info-box'))
  customElements.define('aeor-info-box', AeorInfoBox);
