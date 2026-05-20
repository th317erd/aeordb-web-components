'use strict';

import { elements } from '../../../aeor/elements.js';
import { formatBytes } from '../../utils.js';

const { div, svg, path, polyline } = elements;

// Document-outline icon — vector replaces the 📄 emoji which the Tauri
// webview was rendering as a tofu glyph. Matches the grid view's
// generic "file" icon (see aeor-file-browser-base.js _FILE_ICONS.file).
function _binaryIcon() {
  // The element-builder kebab-cases JS-camelCase attribute names
  // (strokeWidth → stroke-width), except for the SVG_CAMEL_ATTRIBUTES
  // set which preserves camelCase (viewBox stays viewBox).
  return svg
    .width('64').height('64').viewBox('0 0 24 24')
    .fill('none')
    .stroke('currentColor')
    .strokeWidth('1.5')
    .strokeLinecap('round')
    .strokeLinejoin('round')(
      path.d('M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z')(),
      polyline.points('14 2 14 8 20 8')(),
    );
}

class AeorPreviewDefault extends HTMLElement {
  connectedCallback() {
    this.textContent = '';

    const root = div.class('preview-binary-info')(
      div.class('preview-binary-icon')(_binaryIcon()),
      div.class('preview-binary-details')(
        div.class('preview-binary-name')(),
        div.class('preview-binary-meta preview-binary-type')(),
        div.class('preview-binary-meta preview-binary-size')(),
      ),
    ).build(document);

    this.appendChild(root);
  }

  load() {
    const filename = this.getAttribute('filename') || 'Unknown';
    const size = parseInt(this.getAttribute('size') || '0', 10);
    const contentType = this.getAttribute('content-type') || 'application/octet-stream';

    const nameEl = this.querySelector('.preview-binary-name');
    const typeEl = this.querySelector('.preview-binary-type');
    const sizeEl = this.querySelector('.preview-binary-size');

    if (nameEl) nameEl.textContent = filename;
    if (typeEl) typeEl.textContent = contentType;
    if (sizeEl) sizeEl.textContent = formatBytes(size);
  }
}

customElements.define('aeor-preview-default', AeorPreviewDefault);
export { AeorPreviewDefault };
