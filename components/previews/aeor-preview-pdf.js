'use strict';

class AeorPreviewPdf extends HTMLElement {
  constructor() {
    super();
    this._currentSrc = null;
  }

  connectedCallback() {
    this.innerHTML = '<div class="loading">Loading PDF...</div>';
  }

  async load() {
    const newSrc = this.getAttribute('src');
    if (newSrc === this._currentSrc) return;
    this._currentSrc = newSrc;

    if (!newSrc) {
      this.innerHTML = '<div class="preview-binary">No source URL</div>';
      return;
    }

    this.innerHTML = `<iframe
      src="${newSrc}"
      style="width: 100%; height: 100%; border: none; border-radius: 4px; background: #fff;"
      title="PDF Preview"
    ></iframe>`;
  }
}

customElements.define('aeor-preview-pdf', AeorPreviewPdf);
export { AeorPreviewPdf };
