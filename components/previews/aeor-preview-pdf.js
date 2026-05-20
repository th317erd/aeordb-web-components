'use strict';

import { elements } from '../../../aeor/elements.js';

const { div, iframe } = elements;

class AeorPreviewPdf extends HTMLElement {
  constructor() {
    super();
    this._currentSrc = null;
  }

  connectedCallback() {
    this.textContent = '';
    this.appendChild(div.class('loading')('Loading PDF...').build(document));
  }

  async load() {
    const newSrc = this.getAttribute('src');
    if (newSrc === this._currentSrc) return;
    this._currentSrc = newSrc;

    this.textContent = '';

    if (!newSrc) {
      this.appendChild(div.class('preview-binary')('No source URL').build(document));
      return;
    }

    this.appendChild(
      iframe
        .src(newSrc)
        .title('PDF Preview')
        .style('width:100%;height:100%;border:none;border-radius:4px;background:#fff')()
        .build(document),
    );
  }
}

customElements.define('aeor-preview-pdf', AeorPreviewPdf);
export { AeorPreviewPdf };
