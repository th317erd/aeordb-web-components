'use strict';

import { elements } from '../../../aeor/elements.js';
import { formatBytes } from '../../utils.js';

const { img, div, svg, path, polyline } = elements;

// Same document outline used by aeor-preview-default for any binary
// fallback. Defined locally to avoid a circular-ish import between
// preview components.
function _binaryIcon() {
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

class AeorPreviewImage extends HTMLElement {
  connectedCallback() {
    this._render();
  }

  _render() {
    this.textContent = '';
    const tree = img.class('preview-image').loading('lazy').build(document);
    this.appendChild(tree);
  }

  load() {
    let imageEl = this.querySelector('img');
    if (!imageEl) {
      this._render();
      imageEl = this.querySelector('img');
    }
    imageEl.onerror = () => this._showBinaryFallback();
    imageEl.src = this.getAttribute('src') || '';
    imageEl.alt = this.getAttribute('filename') || '';
  }

  // Swap to the same document-outline fallback aeor-preview-default
  // uses, so unsupported image MIME types (image/x-xcf, image/heic
  // without a polyfill, etc.) don't render as the webview's broken-img
  // icon. Content-type and size come from attributes set by the caller.
  _showBinaryFallback() {
    const filename = this.getAttribute('filename') || 'Unknown';
    const contentType = this.getAttribute('content-type') || 'image/*';
    const size = parseInt(this.getAttribute('size') || '0', 10);
    const sizeStr = size > 0 ? formatBytes(size) : '';

    this.textContent = '';
    const tree = div.class('preview-binary-info')(
      div.class('preview-binary-icon')(_binaryIcon()),
      div.class('preview-binary-details')(
        div.class('preview-binary-name')(filename),
        div.class('preview-binary-meta preview-binary-type')(contentType),
        div.class('preview-binary-meta preview-binary-size')(sizeStr),
      ),
    ).build(document);
    this.appendChild(tree);
  }
}

customElements.define('aeor-preview-image', AeorPreviewImage);
export { AeorPreviewImage };
