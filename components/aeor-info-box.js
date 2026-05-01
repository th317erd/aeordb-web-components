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

const STYLE = document.createElement('style');
STYLE.textContent = `
  aeor-info-box { display: block; }
  aeor-info-box[compact] { display: inline-block; }
`;

export class AeorInfoBox extends HTMLElement {
  connectedCallback() {
    if (this._rendered) return;
    this._rendered = true;

    // Inject shared styles once
    if (!document.getElementById('aeor-info-box-styles')) {
      const s = STYLE.cloneNode(true);
      s.id = 'aeor-info-box-styles';
      document.head.appendChild(s);
    }

    const compact = this.hasAttribute('compact');
    const padding = compact ? '6px 10px' : '16px';
    const fontSize = compact ? '0.78rem' : '0.9rem';
    const iconSize = compact ? '16' : '20';
    const gap = compact ? '8px' : '12px';
    const radius = compact ? '4px' : '8px';

    const content = this.innerHTML;

    this.innerHTML = `
      <div style="
        display:flex;gap:${gap};align-items:flex-start;
        padding:${padding};
        background:rgba(56,139,253,0.08);
        border:1px solid rgba(56,139,253,0.25);
        border-radius:${radius};
      ">
        <svg width="${iconSize}" height="${iconSize}" viewBox="0 0 24 24" fill="none" stroke="#58a6ff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;margin-top:1px;">
          <circle cx="12" cy="12" r="10"/>
          <line x1="12" y1="16" x2="12" y2="12"/>
          <line x1="12" y1="8" x2="12.01" y2="8"/>
        </svg>
        <div style="color:#58a6ff;font-size:${fontSize};line-height:1.5;">
          ${content}
        </div>
      </div>
    `;
  }
}

if (!customElements.get('aeor-info-box'))
  customElements.define('aeor-info-box', AeorInfoBox);
